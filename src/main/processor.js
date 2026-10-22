'use strict';
// Gravação → arquivos PCM → transcrição → (vozes) → ata. Uma reunião por vez na fila.
const fs = require('fs');
const path = require('path');
const render = require('../shared/render');

const SR = 16000;

function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

// Junta as duas faixas (você + computador) num WAV mono 16 kHz para ouvir e navegar.
function mixToWav(dir) {
  const files = ['mic.pcm', 'sys.pcm'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (!files.length) return 0;
  const sizes = files.map((f) => fs.statSync(f).size);
  const len = Math.max(...sizes) & ~1;
  const out = fs.openSync(path.join(dir, 'audio.wav.tmp'), 'w');
  fs.writeSync(out, wavHeader(len));
  const fds = files.map((f) => fs.openSync(f, 'r'));
  const CH = SR * 2 * 20; const bufs = fds.map(() => Buffer.alloc(CH)); const mix = Buffer.alloc(CH);
  try {
    for (let pos = 0; pos < len; pos += CH) {
      const n = Math.min(CH, len - pos);
      mix.fill(0, 0, n);
      fds.forEach((fd, k) => {
        const got = fs.readSync(fd, bufs[k], 0, n, pos);
        for (let i = 0; i + 1 < got; i += 2) {
          const v = mix.readInt16LE(i) + bufs[k].readInt16LE(i);
          mix.writeInt16LE(v > 32767 ? 32767 : v < -32768 ? -32768 : v, i);
        }
      });
      fs.writeSync(out, mix, 0, n);
    }
  } finally { fds.forEach((fd) => fs.closeSync(fd)); fs.closeSync(out); }
  fs.renameSync(path.join(dir, 'audio.wav.tmp'), path.join(dir, 'audio.wav'));
  return len / 2 / SR;
}

// Mensagens técnicas do motor viram algo que o usuário consegue agir.
function friendlyError(e) {
  const m = (e && e.message) || String(e);
  if (/too large for the available|out of memory|failed to allocate|InsufficientMemory/i.test(m)) {
    return 'Faltou memória para escrever a ata. O app reduz o contexto e tenta usar o processador no lugar da placa de vídeo; '
      + 'se continuar, troque para o modo Light em Ajustes (modelo menor) ou feche programas pesados e tente de novo.';
  }
  if (/motor de IA parou/i.test(m)) return m + ' Se repetir, o modo Light usa um modelo menor e exige menos memória.';
  return m;
}

class Processor {
  constructor({ store, engine, notify, log, modelStatus, aiFor = () => null }) {
    this.store = store; this.engine = engine; this.notify = notify; this.log = log; this.modelStatus = modelStatus; this.aiFor = aiFor;
    this.rec = new Map(); // id -> {streams, live, bytes}
    this.queue = []; this.busy = false; this.current = null;
  }

  // ---- gravação --------------------------------------------------------------------------------
  async startRecording(id) {
    const m = this.store.meetings.get(id); if (!m) throw new Error('Reunião não encontrada.');
    if (this.rec.size) throw new Error('Já existe uma gravação em andamento.');
    const dir = this.store.dirOf(id);
    const streams = { mic: fs.createWriteStream(path.join(dir, 'mic.pcm'), { flags: 'a' }), sys: fs.createWriteStream(path.join(dir, 'sys.pcm'), { flags: 'a' }) };
    const st = { streams, live: false, bytes: { mic: 0, sys: 0 } };
    this.rec.set(id, st);
    const diarize = m.mode === 'advanced';
    try { st.live = !!(await this.engine.request('start', { id, dir, opts: { diarize } })).live; } catch (e) { this.log('motor indisponível ao gravar: ' + e.message); }
    this.store.setStatus(id, { status: 'recording', stage: null, error: null, mode: this.store.settings.mode });
    this.notify(id);
    return { live: st.live };
  }

  chunk(id, track, data) {
    const st = this.rec.get(id); if (!st || !st.streams[track]) return;
    const buf = Buffer.from(data.buffer ? data.buffer : data, data.byteOffset || 0, data.byteLength);
    st.streams[track].write(buf); st.bytes[track] += buf.length;
    if (st.live) this.engine.chunk(id, track, new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }

  async stopRecording(id) {
    const st = this.rec.get(id); if (!st) return;
    this.rec.delete(id);
    await Promise.all(Object.values(st.streams).map((s) => new Promise((r) => s.end(r))));
    const dir = this.store.dirOf(id);
    const dur = mixToWav(dir);
    this.store.setStatus(id, { status: 'processing', stage: 'transcrevendo', progress: 0, durationSec: Math.round(dur), hasAudio: dur > 0 });
    this.notify(id);
    this.enqueue({ id, kind: 'full', live: st.live });
  }

  isRecording(id) { return id ? this.rec.has(id) : this.rec.size > 0; }

  // ---- fila ------------------------------------------------------------------------------------
  enqueue(job) {
    this.queue = this.queue.filter((j) => !(j.id === job.id && j.kind === job.kind));
    this.queue.push(job); this.pump();
  }

  async pump() {
    if (this.busy) return;
    const job = this.queue.shift(); if (!job) return;
    this.busy = true; this.current = job;
    try { await this.run(job); }
    catch (e) {
      this.log(`falha em ${job.id}: ${e.stack || e.message}`);
      if (this.store.meetings.has(job.id)) this.store.setStatus(job.id, { status: 'error', stage: null, error: friendlyError(e) });
      this.notify(job.id);
    } finally { this.busy = false; this.current = null; setImmediate(() => this.pump()); }
  }

  async run(job) {
    const { id } = job; const store = this.store;
    if (!store.meetings.has(id)) return;
    const m = store.meetings.get(id); const dir = store.dirOf(id);
    const ms = this.modelStatus(m.mode);
    const set = (patch) => { store.setStatus(id, patch); this.notify(id); };

    if (job.kind === 'full') {
      let segs = null;
      if (job.live) segs = await this.engine.request('stop', { id });
      if (!segs) {
        const cloudTr = this.aiFor('transcribe');
        if (!cloudTr && !ms.asr) { set({ status: 'queued', stage: 'aguardando modelos', progress: 0 }); return; }
        set({ status: 'processing', stage: cloudTr ? 'transcrevendo (serviço de IA)' : 'transcrevendo', progress: 0 });
        const opts = { diarize: m.mode === 'advanced' && ms.spk, language: store.settings.language };
        try { segs = await this.engine.request('transcribeFiles', { id, dir, opts: { ...opts, cloud: cloudTr } }); }
        catch (e) {
          // Se o serviço falhar, usa o modelo do computador (quando houver) em vez de perder a gravação.
          if (!cloudTr || !ms.asr || /cancelado/i.test(e.message)) throw e;
          this.log(`transcrição pelo serviço de IA falhou (${e.message}); usando o modelo do computador`);
          set({ status: 'processing', stage: 'transcrevendo (modelo local)', progress: 0 });
          segs = await this.engine.request('transcribeFiles', { id, dir, opts: { ...opts, cloud: null } });
        }
      }
      set({ status: 'processing', stage: m.mode === 'advanced' ? 'separando vozes' : 'organizando', progress: 0 });
      const transcript = await this.engine.request('buildTranscript', { segs, opts: { userName: store.settings.userName || 'Você', diarize: m.mode === 'advanced' && ms.spk } });
      store.writeJsonFile(id, 'transcript.json', { segments: transcript, diarized: m.mode === 'advanced' && ms.spk });
      store.writeTextFile(id, 'transcricao.txt', render.toText(transcript, m.speakers));
      store.invalidateSearch(id);
      for (const f of ['mic.pcm', 'sys.pcm']) { try { fs.renameSync(path.join(dir, f), path.join(dir, f + '.bak')); } catch (_) {} }
    }
    // ata
    const tr = store.readJsonFile(id, 'transcript.json');
    if (!tr) throw new Error('Transcrição não encontrada.');
    const cloudAta = this.aiFor('ata');
    if (!cloudAta && !ms.light && !ms.advanced) { set({ status: 'queued', stage: 'aguardando modelo da ata', progress: 0 }); return; }
    set({ status: 'processing', stage: 'escrevendo', progress: 0 });
    const tpl = store.template(job.templateId || m.templateId);
    const ataOpts = {
      segs: tr.segments, names: m.speakers, notes: m.notes, template: tpl, mode: m.mode, lang: store.settings.language, withRefs: true,
      meta: { title: m.autoTitle ? '' : m.title, date: new Date(m.createdAt).toLocaleString('pt-BR'), userName: store.settings.userName || 'Você' },
    };
    const askAta = async (cloud) => {
      const { rid, promise } = await this.engine.requestCancelable('ata', { id, opts: { ...ataOpts, cloud } });
      this.current.rid = rid;
      return promise;
    };
    let ata;
    try { ata = await askAta(cloudAta); }
    catch (e) {
      // Se o serviço escolhido falhar, cai para o modelo do computador em vez de perder a reunião.
      if (!cloudAta || /cancelado/i.test(e.message) || (!ms.light && !ms.advanced)) throw e;
      this.log(`ata pelo serviço de IA falhou (${e.message}); usando o modelo do computador`);
      set({ status: 'processing', stage: 'escrevendo (modelo local)', progress: 0 });
      ata = await askAta(null);
    }
    ata.templateId = tpl.id; ata.generatedAt = new Date().toISOString();
    store.writeJsonFile(id, 'ata.json', ata);
    store.writeTextFile(id, 'ata.md', render.toMarkdown(m, ata, tr.segments, m.speakers));
    store.invalidateSearch(id);
    const patch = { status: 'done', stage: null, progress: 1, error: null, hasAta: true, templateId: tpl.id };
    if (m.autoTitle && ata.titulo) patch.title = ata.titulo.slice(0, 120);
    set(patch);
    // a ata está pronta: o áudio de cada faixa não é mais necessário (o audio.wav fica).
    this.cleanupTracks(dir);
  }

  // Com "guardar as faixas" ligado elas ficam, e aí dá para refazer a transcrição depois.
  cleanupTracks(dir) {
    if (this.store.settings.keepTracks) return false;
    for (const f of ['mic.pcm.bak', 'sys.pcm.bak']) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
    return true;
  }

  // As faixas separadas ainda existem? (é o que permite refazer a transcrição)
  hasTracks(dir) { return ['mic.pcm', 'sys.pcm'].some((f) => fs.existsSync(path.join(dir, f)) || fs.existsSync(path.join(dir, f + '.bak'))); }
  restoreTracks(dir) { for (const f of ['mic.pcm', 'sys.pcm']) { const b = path.join(dir, f + '.bak'); if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(b)) fs.renameSync(b, path.join(dir, f)); } }

  cancel(id) {
    if (this.current && this.current.id === id && this.current.rid) this.engine.abort(this.current.rid);
    this.queue = this.queue.filter((j) => j.id !== id);
  }

  // Ao abrir o app: retoma o que ficou pela metade (queda de energia, app fechado gravando...).
  recover() {
    for (const m of this.store.meetings.values()) {
      if (m.status === 'recording') {
        const dir = this.store.dirOf(m.id);
        for (const f of ['mic.pcm', 'sys.pcm']) { const b = path.join(dir, f + '.bak'); if (!fs.existsSync(path.join(dir, f)) && fs.existsSync(b)) fs.renameSync(b, path.join(dir, f)); }
        const dur = mixToWav(dir);
        this.store.setStatus(m.id, { status: 'processing', stage: 'transcrevendo', durationSec: Math.round(dur), hasAudio: dur > 0 });
        this.enqueue({ id: m.id, kind: 'full' });
      } else if (m.status === 'processing' || m.status === 'queued') {
        const hasTr = !!this.store.readJsonFile(m.id, 'transcript.json');
        if (!hasTr) { const dir = this.store.dirOf(m.id); for (const f of ['mic.pcm', 'sys.pcm']) { const b = path.join(dir, f + '.bak'); if (fs.existsSync(b) && !fs.existsSync(path.join(dir, f))) fs.renameSync(b, path.join(dir, f)); } }
        this.enqueue({ id: m.id, kind: hasTr ? 'ata' : 'full' });
      }
    }
  }

  retryQueued() {
    for (const m of this.store.meetings.values()) if (m.status === 'queued') this.enqueue({ id: m.id, kind: this.store.readJsonFile(m.id, 'transcript.json') ? 'ata' : 'full' });
  }
}

module.exports = { Processor, friendlyError, mixToWav, wavHeader };
