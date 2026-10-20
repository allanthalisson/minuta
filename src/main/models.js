'use strict';
// Catálogo e download dos modelos locais (feito uma vez, no onboarding; depois tudo roda offline).
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const GH = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const HF = 'https://huggingface.co';

const CATALOG = {
  vad: { label: 'Detector de fala', file: 'silero_vad.onnx', url: `${GH}/asr-models/silero_vad.onnx`, size: 643854 },
  asr: {
    label: 'Transcrição (Parakeet v3)', dir: 'parakeet-v3', url: `${GH}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, size: 487170055,
    archive: 'tar.bz2', keep: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  },
  spk: { label: 'Separação de vozes', file: 'speaker-3dspeaker.onnx', url: `${GH}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`, size: 39593761 },
  'llm-light': { label: 'IA da ata (Qwen2.5 1.5B)', file: 'llm-light.gguf', url: `${HF}/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`, size: 1120000000 },
  'llm-advanced': { label: 'IA da ata (Qwen3 4B)', file: 'llm-advanced.gguf', url: `${HF}/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`, size: 2500000000 },
};
const MODES = { light: ['vad', 'asr', 'llm-light'], advanced: ['vad', 'asr', 'spk', 'llm-advanced'] };

function installed(dir, key) {
  const c = CATALOG[key];
  if (c.dir) return c.keep.every((f) => fs.existsSync(path.join(dir, c.dir, f)));
  return fs.existsSync(path.join(dir, c.file));
}

// `skip` lista os modelos que não precisam ser baixados porque um serviço de IA vai fazer aquele trabalho.
function status(dir, mode, skip = []) {
  const keys = (MODES[mode] || MODES.light).filter((k) => !skip.includes(k));
  const items = keys.map((k) => ({ key: k, label: CATALOG[k].label, size: CATALOG[k].size, installed: installed(dir, k) }));
  const total = items.reduce((n, i) => n + i.size, 0);
  const missing = items.filter((i) => !i.installed).reduce((n, i) => n + i.size, 0);
  return { mode, items, total, missing, ready: missing === 0 };
}

async function freeBytes(dir) {
  try { const s = await fs.promises.statfs(dir); return s.bavail * s.bsize; } catch (_) { return Infinity; }
}

class Downloader {
  constructor({ dir, fetchImpl, onProgress = () => {}, log = () => {}, skip = () => [] }) {
    this.dir = dir; this.fetch = fetchImpl || globalThis.fetch; this.onProgress = onProgress; this.log = log; this.skip = skip;
    this.running = null; this.abort = null; this.state = { active: false };
  }

  async ensure(mode) {
    if (this.running) { if (this.running.mode === mode) return this.running.promise; this.cancel(); try { await this.running.promise; } catch (_) {} }
    const p = this.run(mode);
    this.running = { mode, promise: p };
    try { return await p; } finally { if (this.running && this.running.promise === p) this.running = null; }
  }

  cancel() { if (this.abort) this.abort.abort(); }

  async run(mode) {
    fs.mkdirSync(this.dir, { recursive: true });
    const st = status(this.dir, mode, this.skip());
    const todo = st.items.filter((i) => !i.installed);
    if (!todo.length) { this.emit({ active: false, done: true, mode }); return st; }
    const free = await freeBytes(this.dir);
    if (free < st.missing * 1.15) throw new Error(`Falta espaço em disco: são necessários ${(st.missing / 1e9).toFixed(1)} GB livres.`);
    let base = st.total - st.missing;
    for (const item of todo) {
      const c = CATALOG[item.key];
      await this.downloadOne(item.key, c, (rec) => this.emit({ active: true, mode, key: item.key, label: c.label, received: base + rec, total: st.total }));
      base += c.size;
    }
    this.emit({ active: false, done: true, mode });
    return status(this.dir, mode);
  }

  emit(s) { this.state = s; this.onProgress(s); }

  async downloadOne(key, c, progress) {
    const target = path.join(this.dir, c.dir ? `${key}.download` : c.file);
    const part = target + '.part';
    let have = 0; try { have = fs.statSync(part).size; } catch (_) {}
    this.abort = new AbortController();
    let attempt = 0;
    for (;;) {
      try {
        const res = await this.fetch(c.url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal: this.abort.signal });
        if (have && res.status === 200) have = 0; // servidor ignorou o Range: recomeça
        else if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get('content-length') || 0);
        const total = have + len;
        if (total) c.size = total;
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        let rec = have, last = 0;
        const body = Readable.fromWeb(res.body);
        body.on('data', (b) => { rec += b.length; const now = Date.now(); if (now - last > 250) { last = now; progress(rec); } });
        await pipeline(body, out);
        if (len && rec < total) throw new Error('download incompleto');
        break;
      } catch (e) {
        if (this.abort.signal.aborted) throw new Error('Download cancelado.');
        attempt++; try { have = fs.statSync(part).size; } catch (_) { have = 0; }
        this.log(`download ${key} falhou (${e.message}); tentativa ${attempt}`);
        if (attempt >= 5) throw new Error(`Não foi possível baixar "${c.label}". Verifique a internet e tente de novo.`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (c.archive === 'tar.bz2') { await extractTarBz2(part, path.join(this.dir, c.dir), c.keep); fs.rmSync(part, { force: true }); }
    else fs.renameSync(part, target);
  }
}

async function extractTarBz2(file, destDir, keep) {
  const bz2 = require('unbzip2-stream');
  const tar = require('tar-stream');
  const tmp = destDir + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const ex = tar.extract();
  const found = new Set();
  ex.on('entry', (header, stream, next) => {
    const base = path.basename(header.name);
    if (header.type === 'file' && keep.includes(base)) {
      found.add(base);
      stream.pipe(fs.createWriteStream(path.join(tmp, base))).on('finish', next).on('error', next);
    } else { stream.on('end', next); stream.resume(); }
  });
  await pipeline(fs.createReadStream(file), bz2(), ex);
  const miss = keep.filter((k) => !found.has(k));
  if (miss.length) throw new Error('Arquivo de modelo incompleto: ' + miss.join(', '));
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.renameSync(tmp, destDir);
}

function removeUnused(dir, mode) {
  const need = new Set(MODES[mode]);
  const freed = [];
  for (const [k, c] of Object.entries(CATALOG)) {
    if (need.has(k)) continue;
    const p = path.join(dir, c.dir || c.file);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); freed.push(k); }
  }
  return freed;
}

module.exports = { CATALOG, MODES, status, installed, Downloader, extractTarBz2, removeUnused };
