'use strict';
// Processo utilitário do Electron que hospeda o motor (transcrição, vozes, ata).
const { Engine } = require('./core');

let engine = null;
const port = process.parentPort;
const send = (m) => port.postMessage(m);
const log = (msg) => send({ event: 'log', msg: String(msg) });
const aborts = new Map();

port.on('message', async (e) => {
  const m = e.data;
  if (m.type === 'chunk') { try { engine && engine.feed(m.id, m.track, m.data); } catch (err) { log('feed: ' + err.message); } return; }
  if (m.type === 'abort') { const a = aborts.get(m.target); if (a) a.abort(); return; }
  const reply = (ok, result) => send({ rid: m.rid, ok, result });
  try {
    switch (m.type) {
      case 'init': {
        const { getLlama } = await import('node-llama-cpp');
        engine = new Engine({ modelsDir: m.modelsDir, log, emit: send, getLlama, llmOverride: m.llmOverride || null });
        return reply(true, { ok: 1 });
      }
      case 'have': return reply(true, { asr: engine.have('asr'), spk: engine.have('spk'), light: engine.have('llm-light'), advanced: engine.have('llm-advanced') });
      case 'start': return reply(true, engine.start(m.id, m.dir, m.opts));
      case 'stop': return reply(true, await engine.stop(m.id, (f) => send({ event: 'progress', id: m.id, stage: 'transcrevendo', progress: f })));
      case 'transcribeFiles': return reply(true, await engine.transcribeFiles(m.id, m.dir, m.opts, (f) => send({ event: 'progress', id: m.id, stage: 'transcrevendo', progress: f })));
      case 'readSegments': return reply(true, engine.readSegments(m.dir));
      case 'buildTranscript': return reply(true, engine.buildTranscript(m.segs, m.opts));
      case 'ata': {
        const ac = new AbortController(); aborts.set(m.rid, ac);
        try { return reply(true, await engine.ata({ ...m.opts, signal: ac.signal, progress: (stage, f) => send({ event: 'progress', id: m.id, stage: stage === 'lendo' ? 'lendo' : 'escrevendo', progress: f }) })); }
        finally { aborts.delete(m.rid); }
      }
      case 'chat': {
        const ac = new AbortController(); aborts.set(m.rid, ac);
        try { return reply(true, await engine.chat({ ...m.opts, signal: ac.signal, onToken: (t) => send({ event: 'chatToken', id: m.id, rid: m.rid, text: t }) })); }
        finally { aborts.delete(m.rid); }
      }
      default: return reply(false, 'comando desconhecido');
    }
  } catch (err) {
    log((err && err.stack) || err);
    reply(false, (err && err.message) || String(err));
  }
});
