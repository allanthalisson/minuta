const so = require('sherpa-onnx-node'); const M = '/home/claude/models';
const emb = process.argv[2] || 'wespeaker_en_voxceleb_CAM++.onnx';
const sd = new so.OfflineSpeakerDiarization({ segmentation: { pyannote: { model: `${M}/sherpa-onnx-pyannote-segmentation-3-0/model.onnx` }, numThreads: 2 },
  embedding: { model: `${M}/${emb}`, numThreads: 2 }, clustering: { numClusters: -1, threshold: +(process.argv[3] || 0.5) }, minDurationOn: 0.3, minDurationOff: 0.5 });
const w = so.readWave(__dirname + '/fixtures/sys.wav'); const t0 = Date.now();
const segs = sd.process(w.samples);
console.log(emb, Date.now() - t0 + 'ms'); for (const s of segs) console.log(s.start.toFixed(1), s.end.toFixed(1), 'S' + s.speaker);
console.log(require('./fixtures/reference.json').filter(r => r.who !== 'voce').map(r => `${r.who} ${r.start.toFixed(1)}-${r.end.toFixed(1)}`).join('\n'));
