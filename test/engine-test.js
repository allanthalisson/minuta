// Teste do motor em Node puro: transcrição a partir dos arquivos + diarização + montagem.
const fs = require('fs'), path = require('path'), os = require('os');
const so = require('sherpa-onnx-node');
const { Engine } = require('../src/engine/core');
const T = require('../src/engine/transcript');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuta-eng-'));
for (const t of ['mic', 'sys']) {
  const w = so.readWave(path.join(__dirname, 'fixtures', t + '.wav'));
  const i16 = new Int16Array(w.samples.length); for (let i = 0; i < i16.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(w.samples[i] * 32767)));
  fs.writeFileSync(path.join(dir, t + '.pcm'), Buffer.from(i16.buffer));
}
(async () => {
  const eng = new Engine({ modelsDir: process.env.MODELS_APP || '/home/claude/models/app', log: console.log });
  const t0 = Date.now();
  const segs = await eng.transcribeFiles('t1', dir, { diarize: true });
  const tr = T.buildTranscript(segs.mic, segs.sys, { userName: 'Allan', diarize: true });
  console.log(T.transcriptToText(tr));
  console.log('ms', Date.now() - t0, 'segs', tr.length, 'echo-dropped', segs.mic.length + segs.sys.length - tr.length);
  const spk = new Set(tr.filter((s) => s.track === 'sys').map((s) => s.speaker));
  const ref = require('./fixtures/reference.json');
  console.log(JSON.stringify({ speakers: [...spk], refTurns: ref.length }));
})();
