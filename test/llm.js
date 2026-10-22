// Ata local: o contexto precisa caber na máquina. Testa o ajuste automático e a volta para o processador
// quando a placa de vídeo não tem memória — foi o erro "context size ... too large for the available VRAM". (npm test)
const assert = require('assert');
const { AtaWriter, isMemoryError } = require('../src/engine/ata');

let ok = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ok  ' + n); } catch (e) { console.log('  FALHA  ' + n + '\n        ' + (e.stack || e.message)); process.exitCode = 1; } };
const ta = async (n, f) => { try { await f(); ok++; console.log('  ok  ' + n); } catch (e) { console.log('  FALHA  ' + n + '\n        ' + (e.stack || e.message)); process.exitCode = 1; } };

// Simula o node-llama-cpp: a "placa" aceita no máximo `vram` tokens de contexto; o processador aceita tudo.
function fakeLlama({ vram = Infinity } = {}) {
  const calls = { loads: [], contexts: [] };
  const make = (gpu) => ({
    async loadModel(opts) {
      calls.loads.push({ gpu, gpuLayers: opts.gpuLayers });
      return {
        tokenize: (s) => new Array(Math.ceil(String(s).length / 4)),
        async dispose() {},
        async createContext({ contextSize }) {
          const max = typeof contextSize === 'object' ? contextSize.max : contextSize;
          const min = typeof contextSize === 'object' ? contextSize.min : contextSize;
          const cap = gpu ? vram : Infinity;
          const got = Math.min(max, cap);
          calls.contexts.push({ gpu, asked: max, got });
          if (got < min) throw new Error(`A context size of ${min} is too large for the available VRAM`);
          return { contextSize: got, getSequence: () => ({}), async dispose() {} };
        },
      };
    },
  });
  return { calls, getLlama: async ({ gpu }) => make(gpu !== false) };
}

t('reconhece erro de memória', () => {
  assert(isMemoryError(new Error('A context size of 11296 is too large for the available VRAM')));
  assert(isMemoryError(new Error('llama_init: failed to allocate')));
  assert(!isMemoryError(new Error('arquivo do modelo não encontrado')));
});

(async () => {
  await ta('pede o contexto desejado já ao carregar o modelo', async () => {
    const f = fakeLlama();
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 12288 });
    await w.load();
    assert.deepStrictEqual(f.calls.loads[0].gpuLayers, { fitContext: { contextSize: 12288 } });
    assert.strictEqual(w.contextSize, 12288);
  });

  await ta('placa com pouca memória: usa o maior contexto que cabe', async () => {
    const f = fakeLlama({ vram: 6144 });
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 12288 });
    await w.load();
    assert.strictEqual(w.contextSize, 6144, 'deveria encolher o contexto, não falhar');
    assert.strictEqual(w.onCpu, false, 'ainda dá para usar a placa');
  });

  await ta('placa sem memória nem para o mínimo: volta para o processador', async () => {
    const f = fakeLlama({ vram: 512 });
    const logs = [];
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 12288, log: (m) => logs.push(m) });
    await w.load();
    assert.strictEqual(w.onCpu, true);
    assert.strictEqual(w.contextSize, 12288, 'no processador o contexto inteiro cabe');
    assert(logs.some((l) => /processador/.test(l)), 'deveria registrar a mudança: ' + logs.join(' | '));
  });

  await ta('o orçamento da ata usa o contexto real, não o desejado', async () => {
    const f = fakeLlama({ vram: 4096 });
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 12288 });
    await w.load();
    assert.strictEqual(w.contextSize, 4096);
    const ctx = await w.makeContext(99999);
    assert.strictEqual(ctx.contextSize, 4096, 'nunca pede mais do que cabe');
  });

  await ta('memória apertando depois do carregamento também cai para o processador', async () => {
    const f = fakeLlama({ vram: 8192 });
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 8192 });
    await w.load();
    assert.strictEqual(w.onCpu, false);
    f.calls.contexts.length = 0;
    // a placa perdeu memória para outro programa
    const model = w.model; const orig = model.createContext.bind(model);
    let first = true;
    model.createContext = async (o) => { if (first) { first = false; throw new Error('A context size of 2048 is too large for the available VRAM'); } return orig(o); };
    const ctx = await w.makeContext(8192);
    assert(ctx.contextSize > 0 && w.onCpu, 'deveria ter recarregado no processador');
  });

  await ta('erro que não é de memória não vira troca de dispositivo', async () => {
    const f = fakeLlama();
    const w = new AtaWriter({ getLlama: f.getLlama, modelPath: '/x.gguf', contextSize: 8192 });
    await w.load();
    w.model.createContext = async () => { throw new Error('arquivo do modelo corrompido'); };
    await assert.rejects(() => w.makeContext(4096), /corrompido/);
    assert.strictEqual(w.onCpu, false);
  });

  console.log(`\n${ok} ok`);
})();
