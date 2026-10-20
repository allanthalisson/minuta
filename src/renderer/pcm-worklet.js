// AudioWorklet: converte o áudio (já em 16 kHz pelo AudioContext) em blocos PCM 16 bits + nível para o medidor.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096; this.buf = new Int16Array(this.size); this.n = 0; this.peak = 0; this.frames = 0; this.start = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        let v = ch[i]; if (inputs[0].length > 1) v = (v + inputs[0][1][i]) / 2;
        const a = v < 0 ? -v : v; if (a > this.peak) this.peak = a;
        if (this.n === 0) this.start = currentFrame + i;
        this.buf[this.n++] = v < -1 ? -32768 : v > 1 ? 32767 : v * 32767;
        if (this.n === this.size) { this.port.postMessage({ pcm: this.buf.buffer, frame: this.start }, [this.buf.buffer]); this.buf = new Int16Array(this.size); this.n = 0; }
      }
    } else {
      // sem sinal neste quadro: mantém a linha do tempo alinhada com silêncio
      for (let i = 0; i < 128; i++) { if (this.n === 0) this.start = currentFrame + i; this.buf[this.n++] = 0; if (this.n === this.size) { this.port.postMessage({ pcm: this.buf.buffer, frame: this.start }, [this.buf.buffer]); this.buf = new Int16Array(this.size); this.n = 0; } }
    }
    if (++this.frames % 6 === 0) { this.port.postMessage({ level: this.peak }); this.peak = 0; }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
