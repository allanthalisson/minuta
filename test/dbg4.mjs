import { getLlama, LlamaCompletion } from 'node-llama-cpp';
const t0 = Date.now(); const t = (m) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', m);
const llama = await getLlama({ gpu: false, logLevel: process.env.LL || 'warn' });
const model = await llama.loadModel({ modelPath: '/tmp/mud/models/llm-advanced.gguf' });
for (const opts of [{ contextSize: 2048, threads: 2 }, { contextSize: 2048, threads: 1 }, { contextSize: 2048, threads: 2, batchSize: 64 }]) {
  const ctx = await model.createContext(opts);
  const seq = ctx.getSequence(); let n = 0; const a = Date.now();
  for await (const tok of seq.evaluate(model.tokenize('Bom dia pessoal'), { temperature: 0.8 })) { if (++n >= 60) break; }
  const raw = Date.now() - a; const b = Date.now();
  const c = new LlamaCompletion({ contextSequence: (await model.createContext(opts)).getSequence() });
  await c.generateCompletion('Bom dia pessoal', { maxTokens: 60 });
  t(JSON.stringify(opts) + ` raw60=${raw}ms completion60=${Date.now() - b}ms`);
  await ctx.dispose();
}
