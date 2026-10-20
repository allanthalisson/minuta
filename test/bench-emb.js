const so = require('sherpa-onnx-node'); const M = '/home/claude/models';
const ex = new so.SpeakerEmbeddingExtractor({ model: `${M}/${process.argv[2] || 'wespeaker_en_voxceleb_CAM++.onnx'}`, numThreads: 2 });
const w = so.readWave(__dirname + '/fixtures/sys.wav');
const ref = require('./fixtures/reference.json').filter(r => r.who !== 'voce');
const E = ref.map(r => { const s = ex.createStream(); s.acceptWaveform({ sampleRate: 16000, samples: w.samples.subarray(Math.round(r.start * 16000), Math.round(r.end * 16000)) }); s.inputFinished(); return ex.compute(s, false); });
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
for (let i = 0; i < E.length; i++) console.log(ref[i].who.padEnd(6), E.map(e => cos(E[i], e).toFixed(2)).join(' '));
