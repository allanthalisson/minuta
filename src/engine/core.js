'use strict';
// Motor local: VAD + transcrição (Parakeet via sherpa-onnx) ao vivo, embeddings de voz, ata (LLM local).
// Roda num processo separado (utilityProcess) para não travar a interface. Também roda em Node puro (testes).
const fs = require('fs');
const path = require('path');
const T = require('./transcript');
const { AtaWriter } = require('./ata');

const SR = 16000;
const PAD_BEFORE = Math.round(0.4 * SR);
const PAD_AFTER = Math.round(0.3 * SR);
const RING_SECONDS = 120;

function modelPaths(dir) {
  const asr = path.join(dir, 'parakeet-v3');
  return {
    vad: path.join(dir, 'silero_vad.onnx'),
    asr: { encoder: path.join(asr, 'encoder.int8.onnx'), decoder: path.join(asr, 'decoder.int8.onnx'), joiner: path.join(asr, 'joiner.int8.onnx'), tokens: path.join(asr, 'tokens.txt') },
    spk: path.join(dir, 'speaker-3dspeaker.onnx'),
    llm: { light: path.join(dir, 'llm-light.gguf'), advanced: path.join(dir, 'llm-advanced.gguf') },
  };
}

class Ring {
  constructor() { this.chunks = []; this.total = 0; }
  push(f32) { this.chunks.push({ start: this.total, data: f32 }); this.total += f32.length; this.prune(); }
  prune() { const min = this.total - RING_SECONDS * SR; while (this.chunks.length && this.chunks[0].start + this.chunks[0].data.length < min) this.chunks.shift(); }
  slice(a, b) {
    a = Math.max(a, this.chunks.length ? this.chunks[0].start : 0); b = Math.min(b, this.total);
    const out = new Float32Array(Math.max(0, b - a));
    for (const c of this.chunks) {
      const cs = c.start, ce = c.start + c.data.length;
      if (ce <= a || cs >= b) continue;
      const s = Math.max(a, cs), e = Math.min(b, ce);
      out.set(c.data.subarray(s - cs, e - cs), s - a);
    }
    return out;
  }
}

function int16ToFloat(buf) {
  const i16 = buf instanceof Int16Array ? buf : new Int16Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}

class Engine {
  constructor({ modelsDir, log = () => {}, emit = () => {}, sherpa, getLlama, llmOverride, numThreads }) {
    this.dir = modelsDir; this.P = modelPaths(modelsDir); this.log = log; this.emit = emit;
    this.so = sherpa || require('sherpa-onnx-node');
    this.getLlama = getLlama; this.llmOverride = llmOverride;
    this.threads = numThreads || Math.max(2, Math.min(6, require('os').cpus().length - 2));
    this.rec = null; this.spk = null; this.sessions = new Map(); this.writers = {};
  }

  have(name) {
    const P = this.P;
    if (name === 'asr') return fs.existsSync(P.vad) && Object.values(P.asr).every((f) => fs.existsSync(f));
    if (name === 'spk') return fs.existsSync(P.spk);
    if (name === 'llm-light') return !!this.llmOverride || fs.existsSync(P.llm.light);
    if (name === 'llm-advanced') return !!this.llmOverride || fs.existsSync(P.llm.advanced);
    return false;
  }

  recognizer() {
    if (!this.rec) {
      const a = this.P.asr;
      this.rec = new this.so.OfflineRecognizer({ modelConfig: { transducer: { encoder: a.encoder, decoder: a.decoder, joiner: a.joiner }, tokens: a.tokens, numThreads: this.threads, modelType: 'nemo_transducer' } });
    }
    return this.rec;
  }

  speaker() {
    if (!this.spk && this.have('spk')) this.spk = new this.so.SpeakerEmbeddingExtractor({ model: this.P.spk, numThreads: 2 });
    return this.spk;
  }

  // A faixa do microfone é sempre a mesma pessoa, então vale juntar frases separadas por pausas curtas:
  // trechos maiores dão mais contexto ao reconhecedor (menos erro e menos troca de idioma em palavras soltas).
  // A faixa da call tem várias pessoas: ali o silêncio curto é mantido, senão duas vozes viram um trecho só
  // e a separação de vozes piora. Medido com reunião sintética em pt-BR (WER do microfone: 9,3% → 7,0%).
  newVad(track) {
    const minSilenceDuration = track === 'mic' ? 0.6 : 0.25;
    return new this.so.Vad({ sileroVad: { model: this.P.vad, threshold: 0.5, minSilenceDuration, minSpeechDuration: 0.2, maxSpeechDuration: 15, windowSize: 512 }, sampleRate: SR, numThreads: 1 }, 30);
  }

  // ---- sessão ao vivo -------------------------------------------------------------------------
  start(id, dir, { diarize = false } = {}) {
    if (!this.have('asr')) return { live: false };
    const s = { id, dir, diarize, queue: Promise.resolve(), tracks: {}, pending: 0, done: 0 };
    for (const t of ['mic', 'sys']) s.tracks[t] = { vad: this.newVad(t), ring: new Ring(), segs: [] };
    const segFile = path.join(dir, 'segments.jsonl');
    try { fs.unlinkSync(segFile); } catch (_) {}
    this.sessions.set(id, s);
    return { live: true };
  }

  feed(id, track, int16) {
    const s = this.sessions.get(id); if (!s) return;
    const tr = s.tracks[track]; if (!tr) return;
    const f = int16ToFloat(int16);
    tr.ring.push(f);
    for (let i = 0; i < f.length; i += 512) tr.vad.acceptWaveform(f.subarray(i, i + 512));
    this.drain(s, track);
  }

  drain(s, track) {
    const tr = s.tracks[track];
    while (!tr.vad.isEmpty()) {
      const seg = tr.vad.front(false); tr.vad.pop();
      const a = Math.max(0, seg.start - PAD_BEFORE), b = seg.start + seg.samples.length + PAD_AFTER;
      const samples = tr.ring.slice(a, b);
      const job = { track, start: seg.start / SR, end: (seg.start + seg.samples.length) / SR, samples };
      s.pending++;
      s.queue = s.queue.then(() => this.recognize(s, job)).catch((e) => this.log('erro na transcrição: ' + e.message));
    }
  }

  async recognize(s, job) {
    const rec = this.recognizer();
    const st = rec.createStream();
    st.acceptWaveform({ sampleRate: SR, samples: job.samples });
    let text = '';
    if (rec.decodeAsync) text = (await rec.decodeAsync(st)).text; else { rec.decode(st); text = rec.getResult(st).text; }
    text = (text || '').trim();
    s.done++;
    if (!text) return;
    const seg = { track: job.track, start: +job.start.toFixed(2), end: +job.end.toFixed(2), text };
    if (s.diarize && job.track === 'sys' && job.end - job.start >= 0.8 && this.speaker()) {
      try {
        const es = this.spk.createStream(); es.acceptWaveform({ sampleRate: SR, samples: job.samples }); es.inputFinished();
        seg.emb = Array.from(this.spk.compute(es, false), (x) => +x.toFixed(4));
      } catch (e) { this.log('embedding falhou: ' + e.message); }
    }
    s.tracks[job.track].segs.push(seg);
    fs.appendFileSync(path.join(s.dir, 'segments.jsonl'), JSON.stringify(seg) + '\n');
    const { emb, ...pub } = seg;
    this.emit({ event: 'segment', id: s.id, seg: pub, pending: s.pending - s.done });
  }

  async stop(id, progress = () => {}) {
    const s = this.sessions.get(id); if (!s) return null;
    for (const t of Object.keys(s.tracks)) { s.tracks[t].vad.flush(); this.drain(s, t); }
    // aguarda a fila, informando o progresso
    const timer = setInterval(() => progress(s.pending ? s.done / s.pending : 1), 500);
    try { await s.queue; } finally { clearInterval(timer); }
    this.sessions.delete(id);
    return { mic: s.tracks.mic.segs, sys: s.tracks.sys.segs };
  }

  // ---- processamento a partir dos arquivos (fila offline / refazer) ----------------------------
  async transcribeFiles(id, dir, { diarize = false, cloud = null, language } = {}, progress = () => {}) {
    if (cloud) { try { fs.unlinkSync(path.join(dir, 'segments.jsonl')); } catch (_) {} return this.transcribeCloud(id, dir, { cloud, diarize, language }, progress); }
    if (!this.have('asr')) throw new Error('Os modelos de transcrição ainda não foram baixados.');
    this.start(id, dir, { diarize });
    const files = ['mic', 'sys'].map((t) => ({ t, f: path.join(dir, t + '.pcm') })).filter((x) => fs.existsSync(x.f));
    const total = files.reduce((n, x) => n + fs.statSync(x.f).size, 0) || 1;
    let read = 0;
    for (const { t, f } of files) {
      const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(SR * 2 * 10);
      try {
        for (;;) {
          const n = fs.readSync(fd, buf, 0, buf.length, null); if (n <= 0) break;
          this.feed(id, t, new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (n - (n % 2)))));
          read += n;
          const s = this.sessions.get(id);
          if (s.pending - s.done > 6) await s.queue; // não acumula memória
          progress(0.9 * read / total);
        }
      } finally { fs.closeSync(fd); }
    }
    return this.stop(id, (f) => progress(0.9 + 0.1 * f));
  }

  // ---- transcrição por serviço de IA (OpenAI e compatíveis) ------------------------------------
  // O áudio vai em blocos de alguns minutos (limite de tamanho dos serviços), cortados num ponto de silêncio
  // para não partir palavra. Cada faixa é enviada separada, então quem falou ("você" x participantes) continua certo.
  async transcribeCloud(id, dir, { cloud, diarize = false, language, maxSeconds = 240 }, progress = () => {}) {
    const cl = require('../shared/cloud');
    const out = { mic: [], sys: [] };
    const files = ['mic', 'sys'].map((t) => ({ t, f: path.join(dir, t + '.pcm') })).filter((x) => fs.existsSync(x.f));
    const total = files.reduce((n, x) => n + fs.statSync(x.f).size, 0) || 1;
    let done = 0;
    for (const { t, f } of files) {
      const size = fs.statSync(f).size;
      const fd = fs.openSync(f, 'r');
      try {
        let at = 0; // amostra inicial do bloco
        while (at * 2 < size) {
          const want = Math.min(maxSeconds * SR, (size - at * 2) / 2);
          const buf = Buffer.alloc(Math.floor(want) * 2);
          const n = fs.readSync(fd, buf, 0, buf.length, at * 2);
          if (n <= 0) break;
          let pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(n / 2));
          // corta no trecho mais silencioso perto do fim, se ainda houver áudio depois
          if (at * 2 + n < size) { const cut = quietCut(pcm); if (cut > SR * 10) pcm = pcm.subarray(0, cut); }
          const offset = at / SR;
          const wav = Buffer.concat([wavHeader(pcm.length * 2), Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]);
          const r = await cl.transcribe(cloud, { wav, model: cloud.model, language, log: this.log, fileName: `${t}-${Math.round(offset)}s.wav` });
          const segs = r.segments.length ? r.segments : (r.text ? [{ start: 0, end: pcm.length / SR, text: r.text }] : []);
          const floats = diarize && t === 'sys' && this.speaker() ? int16ToFloat(pcm) : null;
          for (const sg of segs) {
            const seg = { track: t, start: +(sg.start + offset).toFixed(2), end: +(sg.end + offset).toFixed(2), text: sg.text };
            if (floats && sg.end - sg.start >= 0.8) {
              try {
                const a = Math.max(0, Math.round(sg.start * SR)), b = Math.min(floats.length, Math.round(sg.end * SR));
                const es = this.spk.createStream(); es.acceptWaveform({ sampleRate: SR, samples: floats.subarray(a, b) }); es.inputFinished();
                seg.emb = Array.from(this.spk.compute(es, false), (x) => +x.toFixed(4));
              } catch (e) { this.log('embedding falhou: ' + e.message); }
            }
            out[t].push(seg);
            fs.appendFileSync(path.join(dir, 'segments.jsonl'), JSON.stringify(seg) + '\n');
            const { emb, ...pub } = seg;
            this.emit({ event: 'segment', id, seg: pub, pending: 0 });
          }
          at += pcm.length;
          done += pcm.length * 2;
          progress(Math.min(0.99, done / total));
        }
      } finally { fs.closeSync(fd); }
    }
    return out;
  }

  readSegments(dir) {
    const f = path.join(dir, 'segments.jsonl'); if (!fs.existsSync(f)) return null;
    const segs = { mic: [], sys: [] };
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l.trim()) continue; try { const s = JSON.parse(l); (segs[s.track] || segs.sys).push(s); } catch (_) {} }
    return segs;
  }

  buildTranscript(segs, { userName, diarize }) {
    return T.buildTranscript(segs.mic || [], segs.sys || [], { userName, diarize });
  }

  // ---- ata --------------------------------------------------------------------------------------
  writer(mode) {
    const key = mode === 'advanced' ? 'advanced' : 'light';
    if (!this.writers[key]) {
      const modelPath = this.llmOverride || this.P.llm[key];
      this.writers[key] = new AtaWriter({ getLlama: this.getLlama, modelPath, contextSize: key === 'advanced' ? 12288 : 8192, log: this.log });
    }
    return this.writers[key];
  }

  pickMode(pref) {
    const order = pref === 'advanced' ? ['advanced', 'light'] : ['light', 'advanced'];
    const m = order.find((k) => this.have('llm-' + k));
    if (!m) throw new Error('O modelo de IA da ata ainda não foi baixado.');
    return m;
  }

  // Com `opts.cloud`, a ata/pergunta vai para o serviço escolhido pelo usuário; sem ele, modelo local.
  writerFor(opts) {
    if (opts && opts.cloud) { const { CloudWriter } = require('./ata'); return new CloudWriter({ cfg: opts.cloud, log: this.log }); }
    return this.writer(this.pickMode(opts.mode));
  }

  async ata(opts) { return this.writerFor(opts).write(opts); }

  async chat(opts) { return this.writerFor(opts).chat(opts); }
}

// Cabeçalho WAV 16 kHz mono 16 bits.
function wavHeader(dataBytes) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

// Posição mais silenciosa no último terço do bloco: é ali que o corte tem menos chance de partir uma palavra.
function quietCut(pcm) {
  const win = Math.round(SR * 0.3), from = Math.floor(pcm.length * 0.66);
  let best = pcm.length, bestE = Infinity;
  for (let i = from; i + win <= pcm.length; i += Math.round(SR * 0.1)) {
    let e = 0; for (let j = i; j < i + win; j += 8) e += Math.abs(pcm[j]);
    if (e < bestE) { bestE = e; best = i + Math.round(win / 2); }
  }
  return best;
}

module.exports = { Engine, modelPaths, SR, int16ToFloat, Ring, wavHeader, quietCut };
