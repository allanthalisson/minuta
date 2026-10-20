import { getLlama, LlamaChatSession } from 'node-llama-cpp';
const llama = await getLlama({ gpu: false });
const model = await llama.loadModel({ modelPath: process.argv[2] || '/home/claude/models/tiny/tiny-qwen2.gguf' });
const ctx = await model.createContext({ contextSize: 4096 });
const session = new LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: 'Você escreve atas.' });
const schema = { type: 'object', properties: { resumo: { type: 'string' }, acoes: { type: 'array', items: { type: 'object', properties: { tarefa: { type: 'string' }, responsavel: { type: 'string' } }, required: ['tarefa', 'responsavel'] }, maxItems: 3 } }, required: ['resumo', 'acoes'] };
const grammar = await llama.createGrammarForJsonSchema(schema);
const t0 = Date.now();
const out = await session.prompt('Transcrição: Bom dia pessoal...', { grammar, maxTokens: 300, temperature: 0.2, onTextChunk: () => {} });
let parsed; try { parsed = grammar.parse(out); } catch (e) { parsed = 'PARSE FAIL: ' + e.message; }
console.log('tokens(prompt)=', model.tokenize('Bom dia pessoal').length, 'ms', Date.now() - t0);
console.log(typeof parsed === 'string' ? parsed + ' RAW=' + out.slice(0, 200) : JSON.stringify(parsed).slice(0, 300));
