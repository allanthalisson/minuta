// Gera uma "reunião" sintética em pt-BR com 3 vozes (TTS local) para testar o pipeline.
// mic.wav = você (faber); sys.wav = participantes (cadu, jeff) — como o app grava.
const so = require('sherpa-onnx-node');
const fs = require('fs'); const path = require('path');
const M = process.env.MODELS || '/home/claude/models';
const out = process.argv[2] || path.join(__dirname, 'fixtures');
fs.mkdirSync(out, { recursive: true });
const voice = (n) => new so.OfflineTts({ model: { vits: { model: `${M}/vits-piper-${n}/${n}.onnx`, tokens: `${M}/vits-piper-${n}/tokens.txt`, dataDir: `${M}/vits-piper-${n}/espeak-ng-data` }, numThreads: 2 }, maxNumSentences: 1 });
const V = { voce: voice('pt_BR-faber-medium'), ana: voice('pt_BR-cadu-medium'), bruno: voice('pt_BR-jeff-medium') };
const script = [
  ['voce', 'Bom dia pessoal, vamos começar a reunião de planejamento do lançamento do aplicativo.'],
  ['ana', 'Bom dia. Eu revisei o cronograma e acho que a data de quinze de novembro está apertada.'],
  ['bruno', 'Concordo com a Ana. A integração com o sistema de pagamentos ainda não foi testada.'],
  ['voce', 'Entendi. Então vamos decidir: o lançamento passa para o dia vinte e nove de novembro.'],
  ['ana', 'Perfeito. Eu fico responsável por atualizar o cronograma até sexta-feira.'],
  ['bruno', 'E eu faço os testes da integração de pagamentos até a próxima quarta.'],
  ['voce', 'Ótimo. Ainda falta definir o orçamento de marketing, deixamos isso para a próxima reunião.'],
  ['bruno', 'Só um ponto: precisamos confirmar com o jurídico os termos de uso antes do lançamento.'],
  ['voce', 'Boa lembrança. Obrigado a todos, até a próxima.'],
];
const SR = 16000; let t = 0.6; const mic = [], sys = []; const ref = [];
function resample(s, from) { if (from === SR) return s; const r = from / SR, n = Math.floor(s.length / r), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = s[Math.floor(i * r)]; return o; }
for (const [who, text] of script) {
  const a = V[who].generate({ text, sid: 0, speed: 1.0 });
  const s = resample(a.samples, a.sampleRate);
  const start = Math.round(t * SR);
  (who === 'voce' ? mic : sys).push([start, s]);
  ref.push({ who, start: t, end: t + s.length / SR, text });
  t += s.length / SR + 0.7;
}
const total = Math.ceil((t + 0.5) * SR);
function mix(parts) { const b = new Float32Array(total); for (const [st, s] of parts) for (let i = 0; i < s.length; i++) b[st + i] += s[i] * 0.8; return b; }
const micB = mix(mic), sysB = mix(sys);
// pequeno vazamento (eco) da reunião no microfone, como sem fone
for (let i = 0; i < total; i++) micB[i] += sysB[i] * 0.05;
so.writeWave(path.join(out, 'mic.wav'), { samples: micB, sampleRate: SR });
so.writeWave(path.join(out, 'sys.wav'), { samples: sysB, sampleRate: SR });
fs.writeFileSync(path.join(out, 'reference.json'), JSON.stringify(ref, null, 2));
console.log('ok', (total / SR).toFixed(1) + 's', out);
