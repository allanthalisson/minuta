'use strict';
// Lado do processo principal: inicia o motor num utilityProcess e conversa com ele por mensagens.
const path = require('path');
const { utilityProcess } = require('electron');

class EngineHost {
  constructor({ modelsDir, onEvent = () => {}, log = () => {}, llmOverride }) {
    this.modelsDir = modelsDir; this.onEvent = onEvent; this.log = log; this.llmOverride = llmOverride;
    this.proc = null; this.rid = 0; this.pending = new Map(); this.ready = null;
  }

  ensure() {
    if (this.ready) return this.ready;
    this.proc = utilityProcess.fork(path.join(__dirname, '..', 'engine', 'worker.js'), [], { serviceName: 'Minuta Engine', stdio: 'pipe' });
    this.proc.stdout && this.proc.stdout.on('data', (d) => this.log('[engine] ' + String(d).trim()));
    this.proc.stderr && this.proc.stderr.on('data', (d) => this.log('[engine!] ' + String(d).trim()));
    this.proc.on('message', (m) => {
      if (m && m.rid && this.pending.has(m.rid) && m.event === undefined) {
        const p = this.pending.get(m.rid); this.pending.delete(m.rid);
        return m.ok ? p.resolve(m.result) : p.reject(new Error(m.result || 'falha no motor'));
      }
      if (m && m.event === 'log') return this.log('[engine] ' + m.msg);
      this.onEvent(m);
    });
    this.proc.on('exit', (code) => {
      this.log('motor encerrou, código ' + code);
      for (const p of this.pending.values()) p.reject(new Error('O motor de IA parou inesperadamente (memória insuficiente?).'));
      this.pending.clear(); this.proc = null; this.ready = null;
      this.onEvent({ event: 'engineExit', code });
    });
    this.ready = this.call('init', { modelsDir: this.modelsDir, llmOverride: this.llmOverride });
    return this.ready;
  }

  call(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error('motor não iniciado'));
      const rid = ++this.rid;
      this.pending.set(rid, { resolve, reject });
      this.proc.postMessage({ rid, type, ...payload });
    });
  }

  async request(type, payload) { await this.ensure(); return this.call(type, payload); }

  // pedidos que podem ser cancelados (ata, chat): devolve {rid, promise}
  async requestCancelable(type, payload) {
    await this.ensure();
    const rid = this.rid + 1;
    return { rid, promise: this.call(type, payload) };
  }
  abort(rid) { if (this.proc) this.proc.postMessage({ type: 'abort', target: rid }); }

  chunk(id, track, data) { if (this.proc) this.proc.postMessage({ type: 'chunk', id, track, data }); }

  restart() { if (this.proc) this.proc.kill(); }
}

module.exports = { EngineHost };
