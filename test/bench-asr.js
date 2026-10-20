const so = require('sherpa-onnx-node');
const M = '/home/claude/models'; const F = __dirname + '/fixtures';
const which = process.argv[2] || 'whisper-base';
function rec(which) {
  if (which.startsWith('whisper-')) { const n = which.slice(8), d = `${M}/sherpa-onnx-whisper-${n}`;
    return new so.OfflineRecognizer({ modelConfig: { whisper: { encoder: `${d}/${n}-encoder.int8.onnx`, decoder: `${d}/${n}-decoder.int8.onnx`, language: 'pt', task: 'transcribe' }, tokens: `${d}/${n}-tokens.txt`, numThreads: 4 } }); }
  const d = `${M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`;
  return new so.OfflineRecognizer({ modelConfig: { transducer: { encoder: `${d}/encoder.int8.onnx`, decoder: `${d}/decoder.int8.onnx`, joiner: `${d}/joiner.int8.onnx` }, tokens: `${d}/tokens.txt`, numThreads: 4, modelType: 'nemo_transducer' } });
}
let t0 = Date.now(); const r = rec(which); const load = Date.now() - t0;
const vad = new so.Vad({ sileroVad: { model: `${M}/silero_vad.onnx`, threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: 16000, numThreads: 1 }, 60);
t0 = Date.now(); let audio = 0;
for (const f of ["mic", "sys"]) { vad.reset();
  const w = so.readWave(`${F}/${f}.wav`); audio += w.samples.length / 16000;
  for (let i = 0; i < w.samples.length; i += 512) { vad.acceptWaveform(w.samples.subarray(i, i + 512)); }
  vad.flush(); 
  while (!vad.isEmpty()) { const seg = vad.front(false); vad.pop();
    const s = r.createStream(); s.acceptWaveform({ sampleRate: 16000, samples: seg.samples }); r.decode(s);
    console.log(f, (seg.start / 16000).toFixed(1), r.getResult(s).text.trim()); }
}
console.log(`${which}: load ${load}ms, decode ${Date.now() - t0}ms for ${audio.toFixed(0)}s audio`);
