import { getLlama, LlamaCompletion } from 'node-llama-cpp';
const t0 = Date.now(); const t = (m) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', m);
const llama = await getLlama({ gpu: false });
const model = await llama.loadModel({ modelPath: '/tmp/mud/models/llm-advanced.gguf' });
const ctx = await model.createContext({ contextSize: 2048, threads: 2 });
const seq = ctx.getSequence();
const toks = model.tokenize('Bom dia pessoal');
let n = 0; for await (const tok of seq.evaluate(toks, { temperature: 0.8 })) { n++; if (n >= 100) break; }
t('raw 100 tokens');
const c = new LlamaCompletion({ contextSequence: (await model.createContext({ contextSize: 2048 })).getSequence() });
await c.generateCompletion('Bom dia', { maxTokens: 100 }); t('completion 100');
