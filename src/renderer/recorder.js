'use strict';
/* Captura: microfone (você) + som do computador (participantes), cada um em sua faixa, 16 kHz mono. */
(function (A) {
  class Recorder {
    constructor() { this.ctx = null; this.streams = []; this.nodes = []; this.paused = false; this.samples = 0; this.levels = { mic: 0, sys: 0 }; this.hasSys = false; this.sysHeard = false; this.closed = false; this.seen = { mic: 0, sys: 0 }; }

    // Lança um erro "cancelado" (sem barulho para o usuário) se o gravador foi fechado durante a abertura.
    alive() { if (this.closed) { const e = new Error('cancelado'); e.cancelled = true; throw e; } }

    async open({ micDeviceId, onChunk, onLevel, wantSystem = true }) {
      this.onChunk = onChunk; this.onLevel = onLevel; this.closed = false;
      try {
        this.ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' });
        const ctx = this.ctx;
        await ctx.audioWorklet.addModule('pcm-worklet.js'); this.alive();
        const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
        // microfone
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micDeviceId && micDeviceId !== 'default' ? { exact: micDeviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        this.streams.push(micStream); this.alive();
        this.attach(micStream, 'mic', sink);
        // som do computador (sem seletor: o app libera direto o "loopback")
        if (wantSystem) {
          const grab = async () => {
            const disp = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
            this.streams.push(disp); // já registrado: se o gravador for fechado agora, close() também solta este
            disp.getVideoTracks().forEach((t) => t.stop());
            if (!disp.getAudioTracks().length) { disp.getTracks().forEach((t) => t.stop()); throw new Error('sem faixa de áudio'); }
            return disp;
          };
          let disp = null;
          try { disp = await grab(); this.alive(); }
          catch (e) {
            if (e.cancelled) throw e;
            // no Mac, se a captura via janela do app não trouxer áudio, tenta pela tela (e lembra a escolha)
            if (A.state && A.state.platform === 'darwin' && A.state.settings.captureMode !== 'screen') {
              try { A.state.settings = await window.minuta.saveSettings({ captureMode: 'screen' }); this.alive(); disp = await grab(); this.alive(); } catch (e2) { if (e2.cancelled) throw e2; this.sysError = e2.message; }
            } else this.sysError = e.message;
          }
          if (disp) { this.attach(new MediaStream(disp.getAudioTracks()), 'sys', sink); this.hasSys = true; }
        }
        if (ctx.state !== 'running') await ctx.resume();
        this.alive();
      } catch (e) {
        await this.close(); // nada fica vazando (microfone aberto, AudioContext) se a abertura falhar ou for cancelada
        throw e;
      }
    }

    attach(stream, track, sink) {
      this.alive();
      const src = this.ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(this.ctx, 'pcm-capture');
      node.port.onmessage = (e) => {
        const d = e.data;
        this.seen[track]++; // prova de que o gráfico de áudio está rodando (sem saída de áudio no Windows, nada chega aqui)
        if (d.level !== undefined) { this.levels[track] = d.level; if (track === 'sys' && d.level > 0.01) this.sysHeard = true; this.onLevel && this.onLevel(track, d.level); return; }
        if (!d.pcm || !this.recording) return;
        this.place(track, new Int16Array(d.pcm), d.frame);
      };
      src.connect(node); node.connect(sink);
      this.nodes.push(src, node);
    }

    // Linha do tempo gravada: cada amostra tem um "frame" do relógio de áudio (igual para as duas faixas).
    // Intervalos ativos (sem as pausas) → posição na gravação. Assim as faixas ficam alinhadas e as pausas somem.
    nowFrame() { return Math.round(this.ctx.currentTime * 16000); }
    begin() { this.spans = [{ from: this.nowFrame(), to: Infinity, base: 0 }]; this.written = { mic: 0, sys: 0 }; this.recording = true; }
    pause(v) {
      if (!this.recording || v === this.paused) return;
      const f = this.nowFrame(); const last = this.spans[this.spans.length - 1];
      if (v) last.to = f; else this.spans.push({ from: f, to: Infinity, base: last.base + (last.to - last.from) });
      this.paused = v;
    }
    get seconds() { return (this.written ? this.written.mic : 0) / 16000; }
    place(track, pcm, frame) {
      for (const sp of this.spans) {
        const a = Math.max(frame, sp.from), b = Math.min(frame + pcm.length, sp.to);
        if (b <= a) continue;
        const pos = sp.base + (a - sp.from);
        let part = pcm.subarray(a - frame, b - frame);
        const w = this.written[track];
        if (pos > w) { const gap = new Int16Array(pos - w); this.emit(track, gap); }
        else if (pos < w) { part = part.subarray(Math.min(part.length, w - pos)); }
        if (part.length) this.emit(track, part);
      }
    }
    emit(track, arr) {
      this.written[track] += arr.length;
      const copy = new Int16Array(arr); // buffer próprio para enviar
      this.onChunk && this.onChunk(track, copy.buffer);
    }

    async close() {
      this.closed = true; this.recording = false;
      const { streams, nodes, ctx } = this;
      this.streams = []; this.nodes = []; this.ctx = null;
      for (const s of streams) s.getTracks().forEach((t) => t.stop());
      for (const n of nodes) { try { n.disconnect(); } catch (_) {} }
      if (ctx && ctx.state !== 'closed') { try { await ctx.close(); } catch (_) {} }
    }
  }
  A.Recorder = Recorder;

  // ---- diagnóstico de áudio -------------------------------------------------------------------
  // Mede se o áudio realmente chega. Sem saída de áudio ativa no Windows o AudioWorklet nunca roda,
  // e a gravação sai muda sem nenhum erro: é isso que este teste revela.
  function measure(ctx, stream, ms) {
    return new Promise((res) => {
      let frames = 0, peak = 0, src = null, node = null;
      try {
        src = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'pcm-capture');
        const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
        node.port.onmessage = (e) => { frames++; if (e.data && e.data.level > peak) peak = e.data.level; };
        src.connect(node); node.connect(sink);
      } catch (e) { return res({ frames: 0, peak: 0, err: e.message }); }
      setTimeout(() => { try { src.disconnect(); node.disconnect(); } catch (_) {} res({ frames, peak }); }, ms || 2500);
    });
  }

  async function audioDiag() {
    const L = []; const add = (k, v) => L.push(k + ': ' + v);
    const S = A.state || {};
    add('Minuta', (S.version || '?') + ' · modo ' + ((S.settings && S.settings.mode) || '?'));
    try { const d = await window.minuta.diag();
      add('Sistema', d.platform + ' · Electron ' + d.electron + ' · Chromium ' + d.chrome);
      add('Permissão de microfone (sistema)', d.mic);
      add('Permissão de tela/som (sistema)', d.screen);
      add('Captura de tela', d.sources);
    } catch (e) { add('Sistema', 'falhou: ' + e.message); }

    const list = async (tag) => {
      try {
        const ds = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind !== 'videoinput');
        add(tag, ds.length ? ds.map((x) => `${x.kind === 'audioinput' ? 'entrada' : 'saída'}="${x.label || 'sem rótulo'}"`).join(' | ') : 'NENHUM dispositivo de áudio');
      } catch (e) { add(tag, 'falhou: ' + e.name + ' — ' + e.message); }
    };
    await list('Dispositivos antes da permissão');

    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const t = micStream.getAudioTracks()[0];
      add('Microfone', `ok "${t.label}" mudo=${t.muted} estado=${t.readyState}`);
    } catch (e) { add('Microfone', 'FALHOU: ' + e.name + ' — ' + e.message); }
    await list('Dispositivos depois da permissão');

    let ctx = null;
    try {
      ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'playback' });
      await ctx.audioWorklet.addModule('pcm-worklet.js');
      if (ctx.state !== 'running') { try { await ctx.resume(); } catch (e) { add('Retomar o AudioContext', 'FALHOU: ' + e.message); } }
      add('AudioContext', `estado=${ctx.state} taxa=${ctx.sampleRate}Hz`);
      if (micStream) { const r = await measure(ctx, micStream); add('Áudio do microfone chegando', r.frames ? `sim (${r.frames} blocos, nível máx ${r.peak.toFixed(3)})` : 'NÃO — nenhum bloco de áudio' + (r.err ? ' (' + r.err + ')' : '')); }
    } catch (e) { add('AudioContext', 'FALHOU: ' + e.message); }

    let disp = null;
    try {
      disp = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
      disp.getVideoTracks().forEach((t) => t.stop());
      const at = disp.getAudioTracks();
      add('Som do computador', at.length ? `ok "${at[0].label}"` : 'sem faixa de áudio');
      if (at.length && ctx) { const r = await measure(ctx, new MediaStream(at)); add('Áudio do computador chegando', r.frames ? `sim (${r.frames} blocos, nível máx ${r.peak.toFixed(3)})` : 'NÃO — nenhum bloco de áudio'); }
    } catch (e) { add('Som do computador', 'FALHOU: ' + e.name + ' — ' + e.message); }

    try { if (micStream) micStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { if (disp) disp.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { if (ctx) await ctx.close(); } catch (_) {}
    const txt = L.join('\n');
    try { await window.minuta.logUi('diagnóstico de áudio\n' + txt); } catch (_) {}
    return txt;
  }
  A.audioDiag = audioDiag;
})(window.App);
