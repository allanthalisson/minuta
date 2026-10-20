// Atualização: limpeza das notas e a máquina de estados, com um atualizador falso. (npm test)
const assert = require('assert');
const { EventEmitter } = require('events');
const { Updater, shortNotes, releasesUrl } = require('../src/main/updater');

let ok = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ok  ' + n); } catch (e) { console.log('  FALHA  ' + n + '\n        ' + (e.stack || e.message)); process.exitCode = 1; } };
const ta = async (n, f) => { try { await f(); ok++; console.log('  ok  ' + n); } catch (e) { console.log('  FALHA  ' + n + '\n        ' + (e.stack || e.message)); process.exitCode = 1; } };

function fake() {
  const au = new EventEmitter();
  au.checkForUpdates = async () => { au.emit(au.next || 'update-not-available', au.info || {}); };
  au.downloadUpdate = async () => { au.emit('download-progress', { percent: 50 }); au.emit('update-downloaded', {}); };
  au.quitAndInstall = () => { au.installed = true; };
  au.setFeedURL = (c) => { au.feed = c; };
  return au;
}
function mk(extra = {}) {
  const au = fake(); const states = [];
  const u = new Updater({ app: {}, makeUpdater: () => au, onChange: (s) => states.push({ ...s }), open: (url) => { u.opened = url; }, ...extra });
  return { u, au, states };
}

t('notas do release viram texto limpo', () => {
  assert.strictEqual(shortNotes('<p>Corrige o <b>áudio</b></p>'), 'Corrige o áudio');
  assert.strictEqual(shortNotes('## Novidades\n- um\n- dois'), 'Novidades\n- um\n- dois');
  assert.strictEqual(shortNotes([{ note: 'linha a' }, { note: 'linha b' }]), 'linha a\nlinha b');
  assert(shortNotes('x'.repeat(500)).endsWith('…'));
  assert.strictEqual(shortNotes(null), '');
});
t('aponta para os releases do repositório', () => {
  const { u, au } = mk(); u.updater();
  assert.strictEqual(au.feed.provider, 'github');
  assert.strictEqual(au.feed.owner + '/' + au.feed.repo, 'allanthalisson/minuta');
  assert.strictEqual(au.autoDownload, false, 'não pode baixar sem o usuário pedir');
});
t('endereço do release', () => {
  assert(releasesUrl('1.2.3').endsWith('/releases/tag/v1.2.3'));
  assert(releasesUrl().endsWith('/releases/latest'));
});

(async () => {
  await ta('sem versão nova o estado vira "none"', async () => {
    const { u } = mk(); await u.check({ manual: true });
    assert.strictEqual(u.state.status, 'none');
  });
  await ta('versão nova aparece com notas e endereço', async () => {
    const { u, au } = mk();
    au.next = 'update-available'; au.info = { version: '9.9.9', releaseNotes: '<b>Novidades</b>' };
    await u.check({ manual: true });
    assert.strictEqual(u.state.status, 'available');
    assert.strictEqual(u.state.version, '9.9.9');
    assert.strictEqual(u.state.notes, 'Novidades');
    assert(u.state.url.endsWith('/tag/v9.9.9'));
  });
  await ta('Windows: baixa e instala; a instalação respeita gravação em andamento', async () => {
    let gravando = true;
    const { u, au } = mk({ canAutoInstall: true, busy: () => gravando });
    au.next = 'update-available'; au.info = { version: '9.9.9' };
    await u.check({ manual: true });
    await u.download();
    assert.strictEqual(u.state.status, 'ready');
    assert.throws(() => u.install(), /gravação ou um processamento/);
    gravando = false;
    assert.strictEqual(u.install(), true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(au.installed, true);
  });
  await ta('Mac: não instala sozinho, abre a página do release', async () => {
    const { u, au } = mk({ canAutoInstall: false });
    au.next = 'update-available'; au.info = { version: '9.9.9' };
    await u.check({ manual: true });
    await u.download();
    assert(u.opened && u.opened.endsWith('/tag/v9.9.9'), 'deveria abrir a página');
    assert.notStrictEqual(u.state.status, 'downloading');
  });
  await ta('erro de rede vira mensagem em português', async () => {
    const { u, au } = mk();
    au.checkForUpdates = async () => au.emit('error', new Error('net::ERR_CONNECTION_REFUSED'));
    await u.check({ manual: true });
    assert.strictEqual(u.state.status, 'error');
    assert.match(u.state.error, /conexão/);
  });
  await ta('checagem automática respeita a preferência desligada', async () => {
    const { u, au } = mk({ enabled: () => false });
    au.next = 'update-available'; au.info = { version: '9.9.9' };
    await u.check();
    assert.strictEqual(u.state.status, 'idle');
    await u.check({ manual: true });
    assert.strictEqual(u.state.status, 'available');
  });
  await ta('dispensar esconde o aviso e uma nova versão volta a mostrar', async () => {
    const { u, au } = mk();
    au.next = 'update-available'; au.info = { version: '9.9.9' };
    await u.check({ manual: true });
    u.dismiss(); assert.strictEqual(u.state.dismissed, true);
    await u.check({ manual: true });
    assert.strictEqual(u.state.dismissed, false);
  });
  console.log(`\n${ok} ok`);
})();
