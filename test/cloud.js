// Serviço de IA opcional: cliente, erros e ata/pergunta pela nuvem, contra um servidor falso. (npm test)
const assert = require('assert');
const fake = require('./fake-openai');
const cloud = require('../src/shared/cloud');
const { CloudWriter } = require('../src/engine/ata');
const { BUILTIN_TEMPLATES } = require('../src/shared/templates');
(async () => {
  const srv = await fake.start({});
  const cfg = { baseUrl: srv.url, apiKey: fake.KEY, model: 'gpt-4o-mini' };
  let ok = 0; const t = async (n, f) => { try { await f(); ok++; console.log('  ok  ' + n); } catch (e) { console.log('  FALHA  ' + n + '\n    ' + e.message); process.exitCode = 1; } };

  await t('lista modelos', async () => assert.deepStrictEqual(await cloud.models(cfg), ['gpt-4o-mini', 'modelo-de-teste', 'whisper-1']));
  await t('conversa simples', async () => assert.match(await cloud.chat(cfg, { messages: [{ role: 'user', content: 'oi' }] }), /VEIO-DO-SERVICO/));
  await t('conversa em streaming entrega os pedaços', async () => {
    let n = 0; const out = await cloud.chat(cfg, { messages: [{ role: 'user', content: 'oi' }], onToken: () => n++ });
    assert(n > 1, 'deveria vir em vários pedaços'); assert.match(out, /VEIO-DO-SERVICO/);
  });
  await t('transcreve e devolve horários', async () => {
    const r = await cloud.transcribe(cfg, { wav: Buffer.alloc(100), model: 'whisper-1', language: 'pt' });
    assert.strictEqual(r.segments.length, 2); assert.strictEqual(r.segments[0].start, 0.5);
    assert.strictEqual(srv.lastTranscribe.language, 'pt');
  });
  await t('chave errada vira mensagem clara', async () => {
    await assert.rejects(() => cloud.models({ ...cfg, apiKey: 'errada' }), (e) => /recusada/.test(e.message) && e.status === 401);
  });
  await t('endereço inexistente vira mensagem clara', async () => {
    await assert.rejects(() => cloud.models({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'x' }), (e) => /recusou a conexão|alcançar/.test(e.message));
  });
  await t('erro temporário é repetido e depois desiste', async () => {
    srv.fail = 503; const t0 = Date.now();
    await assert.rejects(() => cloud.chat(cfg, { messages: [{ role: 'user', content: 'oi' }] }), /problema no momento/);
    assert(Date.now() - t0 > 3000, 'deveria ter esperado entre as tentativas');
    srv.fail = null;
  });
  await t('ata pela nuvem usa o schema do template', async () => {
    const w = new CloudWriter({ cfg });
    const ata = await w.write({ segs: [{ start: 1, end: 3, speaker: 'Allan', text: 'vamos adiar o lançamento' }], notes: '- adiar lançamento', template: BUILTIN_TEMPLATES[0], meta: {}, lang: 'pt', withRefs: true });
    assert(srv.lastChat.hasSchema, 'deveria pedir JSON pelo schema');
    assert(ata.secoes.length > 0 && ata.secoes.some((s) => s.itens.some((i) => /VEIO-DO-SERVICO/.test(i.texto))), 'a ata deveria vir do serviço');
  });
  await t('pergunta pela nuvem responde em streaming', async () => {
    const w = new CloudWriter({ cfg }); let n = 0;
    const r = await w.chat({ segs: [{ start: 1, end: 2, speaker: 'Allan', text: 'oi' }], names: {}, question: 'o que foi dito?', onToken: () => n++ });
    assert.match(r, /VEIO-DO-SERVICO/); assert(n > 1);
  });
  console.log(`\n${ok} ok`);
  srv.close();
})();
