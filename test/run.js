// Testes unitários (Node puro, sem modelos): npm test
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const T = require('../src/engine/transcript');
const { shapeAta, buildSchema, repairJson, chunkLines } = require('../src/engine/ata');
const { Store } = require('../src/main/store');
const { mixToWav, Processor } = require('../src/main/processor');
const render = require('../src/shared/render');
const { BUILTIN_TEMPLATES } = require('../src/shared/templates');

let ok = 0;
const t = (name, fn) => { try { fn(); ok++; console.log('  ok  ' + name); } catch (e) { console.log('  FALHA  ' + name + '\n        ' + e.message); process.exitCode = 1; } };

t('eco do microfone é descartado', () => {
  const sys = [{ start: 10, end: 14, text: 'A integração com o sistema de pagamentos ainda não foi testada' }];
  assert(T.isEcho({ start: 10.3, end: 14.2, text: 'integração com sistema de pagamentos ainda não testada' }, sys));
  assert(!T.isEcho({ start: 30, end: 33, text: 'integração com sistema de pagamentos ainda não testada' }, sys));
  assert(!T.isEcho({ start: 10.3, end: 14, text: 'Concordo, vamos adiar o lançamento então' }, sys));
});
t('agrupamento de vozes separa 2 pessoas', () => {
  const a = [1, 0, 0, 0], b = [0, 1, 0, 0], n = (v) => v.map((x) => x + Math.random() * 0.05);
  const items = [{ emb: n(a), start: 0 }, { emb: n(b), start: 5 }, { emb: n(a), start: 9 }, { emb: null, start: 9.5 }, { emb: n(b), start: 12 }];
  assert.deepStrictEqual(T.clusterSpeakers(items, 0.45), [0, 1, 0, 0, 1]);
});
t('transcrição: você + participantes, ordenada', () => {
  const tr = T.buildTranscript([{ start: 3, end: 4, text: 'oi' }], [{ start: 1, end: 2, text: 'bom dia' }], { userName: 'Allan' });
  assert.deepStrictEqual(tr.map((s) => s.speaker), ['Participantes', 'Allan']);
});
t('ata: itens das notas marcados e notas não usadas preservadas', () => {
  const tpl = BUILTIN_TEMPLATES[0]; const { keys } = buildSchema(tpl);
  const raw = { titulo: 'Plano', resumo: 'r', [keys[0]]: ['Lançamento passa para 29 de novembro', 'Outro ponto'], [keys[1]]: [], [keys[2]]: [], acoes: [{ tarefa: 'Testar pagamentos', responsavel: 'Bruno', prazo: 'quarta' }, { tarefa: '—', responsavel: '', prazo: '' }] };
  const segs = [{ start: 16, text: 'o lançamento passa para o dia 29 de novembro' }, { start: 26, text: 'eu faço os testes de pagamentos até quarta' }];
  const a = shapeAta(raw, { template: tpl, keys, notes: '- lançamento 29 de novembro\n- confirmar jurídico', segs });
  assert.strictEqual(a.secoes[0].itens[0].seu, true);
  assert.strictEqual(a.secoes[0].itens[0].ref, 16);
  assert.strictEqual(a.secoes[0].itens[1].seu, false);
  assert.strictEqual(a.acoes.length, 1);
  assert.strictEqual(a.secoes[a.secoes.length - 1].titulo, 'Suas notas');
  assert.deepStrictEqual(a.secoes[a.secoes.length - 1].itens.map((i) => i.texto), ['confirmar jurídico']);
});
t('JSON truncado é recuperado', () => {
  assert.deepStrictEqual(JSON.parse(repairJson('{"a": ["x", "y')), { a: ['x', 'y'] });
  assert.deepStrictEqual(JSON.parse(repairJson('{"t": "ok", "acoes": [{"tarefa": "x", "resp')), { t: 'ok', acoes: [{ tarefa: 'x' }] });
});
t('reunião longa é dividida em blocos', () => {
  const lines = Array.from({ length: 100 }, (_, i) => 'linha ' + i);
  const ch = chunkLines(lines, (l) => l.length, 100);
  assert(ch.length > 5 && ch.join('\n').split('\n').length === 100);
});
t('biblioteca: projetos, subprojetos, filtros e templates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuta-st-'));
  const s = new Store({ userData: path.join(dir, 'ud'), documents: dir });
  const p = s.createProject({ name: 'Cliente' }); const sub = s.createProject({ name: 'Sub', parentId: p.id });
  assert.throws(() => s.updateProject(p.id, { parentId: sub.id }), /dentro dele mesmo/);
  const m1 = s.createMeeting({ title: 'Kickoff Acme', projectId: sub.id }); const m2 = s.createMeeting({ title: 'Daily' });
  s.updateMeeting(m2.id, { notes: 'falar sobre orçamento' });
  assert.deepStrictEqual(s.list({ projectId: p.id }).map((x) => x.id), [m1.id]);
  assert.deepStrictEqual(s.list({ q: 'orcamento' }).map((x) => x.id), [m2.id]);
  assert.deepStrictEqual(s.list({ noProject: true }).map((x) => x.id), [m2.id]);
  assert.strictEqual(s.list({ from: '2000-01-01T00:00:00Z', to: '2000-12-31T00:00:00Z' }).length, 0);
  s.deleteProject(p.id); assert.strictEqual(s.meetings.get(m1.id).projectId, null);
  const tp = s.saveTemplate({ name: 'Meu', sections: [{ title: 'A', instruction: 'x' }] });
  assert(s.getLibrary().templates.some((x) => x.id === tp.id));
  assert.throws(() => s.dirOf('../../etc'), /inválida/);
  const s2 = new Store({ userData: path.join(dir, 'ud'), documents: dir });
  assert.strictEqual(s2.meetings.size, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
t('mistura das faixas em WAV', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuta-wav-'));
  const a = new Int16Array(16000).fill(1000), b = new Int16Array(8000).fill(32000);
  fs.writeFileSync(path.join(dir, 'mic.pcm'), Buffer.from(a.buffer)); fs.writeFileSync(path.join(dir, 'sys.pcm'), Buffer.from(b.buffer));
  assert.strictEqual(mixToWav(dir), 1);
  const w = fs.readFileSync(path.join(dir, 'audio.wav'));
  assert.strictEqual(w.length, 44 + 32000); assert.strictEqual(w.readInt16LE(44), 32767); assert.strictEqual(w.readInt16LE(44 + 20000), 1000);
  fs.rmSync(dir, { recursive: true, force: true });
});
t('exportação escapa HTML', () => {
  const html = render.toHtml({ title: 'x', createdAt: new Date().toISOString(), durationSec: 1 }, { titulo: '<script>', resumo: '', secoes: [{ titulo: 'a', itens: [{ texto: '<img src=x onerror=1>' }] }], acoes: [] });
  assert(!html.includes('<script>') && !html.includes('<img'));
});
t('falas ao vivo entram em ordem de tempo, não de chegada', () => {
  // o reconhecedor termina uma fala curta antes de uma fala longa que começou antes
  const buf = [];
  const push = (seg) => { let i = buf.length; while (i > 0 && buf[i - 1].start > seg.start) i--; buf.splice(i, 0, seg); };
  [{ start: 26, t: 'participante longo' }, { start: 48, t: 'você interrompe' }, { start: 41, t: 'participante continua' }].forEach(push);
  assert.deepStrictEqual(buf.map((s) => s.start), [26, 41, 48]);
});
t('transcrição final fica ordenada mesmo com interrupção', () => {
  const tr = T.buildTranscript([{ start: 48, end: 50, text: 'o que é isso' }], [{ start: 26, end: 40, text: 'eu assisti o filme' }, { start: 41, end: 55, text: 'tem o hobbit tambem' }], { userName: 'Allan' });
  assert.deepStrictEqual(tr.map((s) => s.start), [26, 41, 48]);
});
t('faixas separadas: guardadas ou apagadas conforme a opção', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuta-kt-'));
  const mk = () => { for (const f of ['mic.pcm.bak', 'sys.pcm.bak']) fs.writeFileSync(path.join(dir, f), 'x'); };
  const p = Object.create(Processor.prototype);
  p.store = { settings: { keepTracks: true } };
  mk(); assert.strictEqual(p.cleanupTracks(dir), false);
  assert(fs.existsSync(path.join(dir, 'mic.pcm.bak')), 'deveria manter as faixas');
  p.store.settings.keepTracks = false;
  assert.strictEqual(p.cleanupTracks(dir), true);
  assert(!fs.existsSync(path.join(dir, 'mic.pcm.bak')) && !fs.existsSync(path.join(dir, 'sys.pcm.bak')), 'deveria apagar as faixas');
  assert.strictEqual(p.hasTracks(dir), false);
  mk(); assert.strictEqual(p.hasTracks(dir), true);
  p.restoreTracks(dir); assert(fs.existsSync(path.join(dir, 'mic.pcm')));
  fs.rmSync(dir, { recursive: true, force: true });
});
console.log(`\n${ok} ok`);
