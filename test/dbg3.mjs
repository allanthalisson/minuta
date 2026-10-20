import { getLlama, LlamaCompletion, TokenBias } from 'node-llama-cpp';
const t0 = Date.now(); const t = (m) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', m);
const llama = await getLlama({ gpu: false });
const model = await llama.loadModel({ modelPath: '/tmp/mud/models/llm-advanced.gguf' });
const bias = new TokenBias(model.tokenizer);
let banned = 0;
for (let i = 0; i < model.tokens.bos + 0 || i < 687; i++) { const s = model.detokenize([i]); if (!/^[\x20-\x7e]*$/.test(s) || s.includes('�')) { bias.set(i, 'never'); banned++; } }
t('banned ' + banned);
const c = new LlamaCompletion({ contextSequence: (await model.createContext({ contextSize: 2048 })).getSequence() });
const out = await c.generateCompletion('Bom dia', { maxTokens: 100, tokenBias: bias }); t('completion 100: ' + out.slice(0, 80));
