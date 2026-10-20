'use strict';
const { app, BrowserWindow, ipcMain, session, desktopCapturer, protocol, Tray, Menu, nativeImage, globalShortcut, dialog, shell, clipboard, systemPreferences, net, powerSaveBlocker, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Store, ID_RE } = require('./store');
const models = require('./models');
const { EngineHost } = require('./engine-host');
const { Processor, wavHeader } = require('./processor');
const { Updater } = require('./updater');
const render = require('../shared/render');
const cloud = require('../shared/cloud');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'assets');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
if (process.env.MINUTA_USER_DATA) app.setPath('userData', process.env.MINUTA_USER_DATA);
app.setAppUserModelId('app.minuta.desktop');

protocol.registerSchemesAsPrivileged([{ scheme: 'minuta-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

let win = null, tray = null, store, downloader, engine, proc, updater, blocker = null, quitting = false;
const logFile = () => path.join(app.getPath('userData'), 'minuta.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile(), line); } catch (_) {}
  if (!app.isPackaged) process.stdout.write(line);
}
const modelsDir = () => path.join(app.getPath('userData'), 'models');
function modelFlags() {
  const d = modelsDir(), inst = (k) => models.installed(d, k), over = !!process.env.MINUTA_LLM_PATH;
  return { asr: inst('vad') && inst('asr'), spk: inst('spk'), light: over || inst('llm-light'), advanced: over || inst('llm-advanced') };
}
// Com a transcrição ou a ata num serviço de IA, o modelo local correspondente deixa de ser necessário.
function skipModels() {
  const skip = [];
  if (aiFor('transcribe')) skip.push('asr');
  if (aiFor('ata')) skip.push('llm-light', 'llm-advanced');
  return skip;
}
const modelsStatus = () => models.status(modelsDir(), store.settings.mode, skipModels());
function send(ch, ...args) { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); }

// ---- serviço de IA opcional -------------------------------------------------------------------
// A chave fica criptografada pelo sistema (safeStorage) num arquivo só dela, fora do settings.json,
// e nunca é enviada para a interface — o renderer só sabe se existe uma chave guardada.
const keyFile = () => path.join(app.getPath('userData'), 'ai-key.bin');
const keyStore = {
  get() {
    try {
      const j = JSON.parse(fs.readFileSync(keyFile(), 'utf8'));
      if (!j.enc) return String(j.data || '');
      return safeStorage.decryptString(Buffer.from(j.data, 'base64'));
    } catch (_) { return ''; }
  },
  set(k) {
    const key = String(k || '').trim();
    if (!key) return this.clear();
    const enc = (() => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } })();
    const j = enc ? { enc: true, data: safeStorage.encryptString(key).toString('base64') } : { enc: false, data: key };
    if (!enc) log('safeStorage indisponível: a chave será guardada sem criptografia do sistema');
    fs.writeFileSync(keyFile(), JSON.stringify(j), { mode: 0o600 });
    try { fs.chmodSync(keyFile(), 0o600); } catch (_) {}
    return true;
  },
  clear() { try { fs.unlinkSync(keyFile()); } catch (_) {} return true; },
  has() { return !!this.get(); },
};

// Para um serviço conhecido o endereço é sempre o dele. `ai.baseUrl` só vale para "Outro".
// (Antes um endereço antigo guardado vencia o do serviço escolhido, e a chave de um ia parar no outro.)
function baseUrlFor(ai) {
  const preset = cloud.PRESETS[ai.provider] || cloud.PRESETS.openai;
  return ai.provider === 'custom' ? String(ai.baseUrl || '').trim() : preset.baseUrl;
}
// Config pronta para uma feature, ou null quando ela deve usar o modelo do computador.
function aiFor(feature) {
  const ai = store.settings.ai || {};
  if (!ai.features || !ai.features[feature]) return null;
  const apiKey = keyStore.get(); if (!apiKey) return null;
  const baseUrl = baseUrlFor(ai); if (!baseUrl) return null;
  const model = (ai.models && ai.models[feature]) || '';
  if (!model) return null;
  return { baseUrl, apiKey, model, provider: ai.provider };
}
// Config a partir do que está na tela de Ajustes (para testar antes de salvar).
function draftConfig(draft, feature) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const ai = { ...(store.settings.ai || {}), ...d };
  const apiKey = String(d.apiKey || '').trim() || keyStore.get();
  if (!apiKey) throw new Error('Informe a chave de API.');
  const baseUrl = baseUrlFor(ai);
  if (!baseUrl) throw new Error('Informe o endereço do serviço.');
  const model = feature ? ((ai.models || {})[feature] || '') : '';
  return { baseUrl, apiKey, model, provider: ai.provider };
}
// WAV de 1 segundo em silêncio, só para validar a chave de transcrição.
function silentWav(seconds) {
  const data = Buffer.alloc(16000 * seconds * 2);
  return Buffer.concat([wavHeader(data.length), data]);
}

function aiPublic() {
  const ai = store.settings.ai || {};
  const active = ['transcribe', 'ata', 'chat'].filter((f) => !!aiFor(f));
  // `baseUrl` continua sendo o que o usuário digitou (só usado em "Outro"); `url` é o endereço realmente usado.
  return { ...ai, url: baseUrlFor(ai), hasKey: keyStore.has(), active, presets: cloud.PRESETS };
}

// ---------------------------------------------------------------------------------------------
function createWindow() {
  const opts = {
    width: 1180, height: 780, minWidth: 860, minHeight: 560, show: false, title: 'Minuta',
    backgroundColor: isMac ? '#00000000' : '#f7f6f3', icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  };
  if (isMac) Object.assign(opts, { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'followWindow', transparent: false });
  else Object.assign(opts, { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#6b6b70', height: 44 }, backgroundMaterial: isWin ? 'mica' : undefined });
  win = new BrowserWindow(opts);
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // erros da interface também vão para o minuta.log (é o que o usuário consegue enviar para diagnóstico)
  win.webContents.on('console-message', (...a) => {
    const d = a[0] && typeof a[0] === 'object' && 'level' in a[0] ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] };
    const err = d.level === 'error' || d.level === 3 || d.level === 2;
    if (err) log('[ui] ' + d.message + (d.sourceId ? ` (${String(d.sourceId).split('/').pop()}:${d.lineNumber})` : ''));
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.on('close', (e) => {
    if (quitting) return;
    if (isMac || proc.isRecording()) { e.preventDefault(); win.hide(); }
  });
}

function trayImage(recording) {
  const f = isMac ? (recording ? 'trayRecTemplate.png' : 'trayTemplate.png') : (recording ? 'tray-rec.png' : 'tray.png');
  const img = nativeImage.createFromPath(path.join(ASSETS, f));
  if (isMac) img.setTemplateImage(true);
  return img;
}
function updateTray() {
  if (!tray) return;
  const rec = proc && proc.isRecording();
  tray.setImage(trayImage(rec));
  tray.setToolTip(rec ? 'Minuta — gravando' : 'Minuta');
  tray.setContextMenu(Menu.buildFromTemplate([
    rec ? { label: 'Encerrar gravação', click: () => send('shortcut:record') } : { label: 'Nova reunião (gravar)', click: () => { showWindow(); send('shortcut:record'); } },
    { label: 'Abrir Minuta', click: showWindow },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]));
}
function showWindow() { if (!win) createWindow(); win.show(); win.focus(); }

function registerShortcut() {
  globalShortcut.unregisterAll();
  const acc = store.settings.shortcut;
  if (acc) { try { globalShortcut.register(acc, () => { showWindow(); send('shortcut:record'); }); } catch (e) { log('atalho inválido: ' + acc); } }
}

function appMenu() {
  const tpl = [
    ...(isMac ? [{ label: 'Minuta', submenu: [{ role: 'about', label: 'Sobre o Minuta' }, { type: 'separator' }, { label: 'Ajustes…', accelerator: 'Cmd+,', click: () => send('nav', 'settings') }, { type: 'separator' }, { role: 'hide', label: 'Ocultar Minuta' }, { role: 'hideOthers', label: 'Ocultar outros' }, { type: 'separator' }, { role: 'quit', label: 'Sair do Minuta' }] }] : []),
    { label: 'Arquivo', submenu: [{ label: 'Nova reunião', accelerator: 'CmdOrCtrl+N', click: () => send('nav', 'new') }, { label: 'Buscar', accelerator: 'CmdOrCtrl+K', click: () => send('nav', 'search') }, { type: 'separator' }, isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Visualizar', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { role: 'windowMenu', label: 'Janela' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------------------------------------------------------------------------------------------
function setupSession() {
  const ses = session.defaultSession;
  // áudio do computador (loopback) sem seletor de tela: o usuário só clica em "Gravar"
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (isMac && store.settings.captureMode !== 'screen') return callback({ video: request.frame, audio: 'loopback' });
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (e) { log('displayMedia: ' + e.message); callback({}); }
  });
  const ok = (wc) => wc && win && wc.id === win.webContents.id;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ok(wc) && (perm === 'media' || perm === 'display-capture' || perm === 'clipboard-sanitized-write')));
  ses.setPermissionCheckHandler((wc, perm) => !!wc && ok(wc) && ['media', 'display-capture', 'clipboard-sanitized-write'].includes(perm));
  // nada de rede a partir da interface
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => cb({ cancel: d.webContentsId === (win && win.webContents.id) }));

  protocol.handle('minuta-media', async (req) => {
    try {
      const u = new URL(req.url); const id = u.pathname.replace(/^\/+/, '').replace(/\.wav$/, '');
      if (u.host !== 'audio' || !ID_RE.test(id)) return new Response('not found', { status: 404 });
      const file = path.join(store.dirOf(id), 'audio.wav');
      const size = fs.statSync(file).size;
      const range = req.headers.get('range');
      const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' };
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range); let a = m[1] ? +m[1] : 0; let b = m[2] ? +m[2] : size - 1;
        if (!m[1] && m[2]) { a = size - +m[2]; b = size - 1; }
        b = Math.min(b, size - 1);
        return new Response(nodeStream(fs.createReadStream(file, { start: a, end: b })), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
      }
      return new Response(nodeStream(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
}
function nodeStream(rs) { return require('stream').Readable.toWeb(rs); }

// ---------------------------------------------------------------------------------------------
function meetingFull(id) {
  const m = store.meetings.get(id); if (!m) { log(`meetingFull: ${JSON.stringify(id)} não está entre ${JSON.stringify([...store.meetings.keys()])}`); throw new Error('Reunião não encontrada.'); }
  const { folder, ...meeting } = m;
  return { meeting: { ...meeting, hasTracks: proc.hasTracks(store.dirOf(id)) }, transcript: store.readJsonFile(id, 'transcript.json'), ata: store.readJsonFile(id, 'ata.json'), audio: m.hasAudio ? `minuta-media://audio/${id}.wav` : null };
}
function notifyMeeting(id) {
  const m = store.meetings.get(id); if (!m) return send('meeting:changed', { id, deleted: true });
  const { folder, ...meeting } = m;
  send('meeting:changed', meeting);
  updateTray();
  if (m.status === 'done' && !win.isFocused() && Notification.isSupported()) new Notification({ title: 'Ata pronta', body: m.title }).show();
}

function startDownloads(mode) {
  downloader.ensure(mode).then(() => { send('models:progress', { active: false, done: true, mode, flags: modelFlags() }); proc.retryQueued(); })
    .catch((e) => { log('download: ' + e.message); send('models:progress', { active: false, error: e.message, mode, flags: modelFlags() }); });
}

function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!win || e.sender.id !== win.webContents.id) throw new Error('origem não autorizada');
    try { return { ok: true, data: await fn(...args) }; } catch (err) { log(`${ch}: ${err.stack || err.message}`); return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), settings: store.settings, models: { ...modelsStatus(), flags: modelFlags(), download: downloader.state }, ai: aiPublic(), update: updater ? updater.state : null, recordingId: [...proc.rec.keys()][0] || null, totalMemGB: Math.round(require('os').totalmem() / 1e9) }));
  handle('settings:save', (patch) => {
    const before = { ...store.settings };
    const s = store.saveSettings(patch);
    if (patch.shortcut !== undefined) registerShortcut();
    if (patch.launchAtLogin !== undefined && (isMac || isWin)) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: ['--hidden'] });
    if (patch.mode && patch.mode !== before.mode && s.onboarded) startDownloads(s.mode);
    if (patch.onboarded && !before.onboarded) startDownloads(s.mode);
    return s;
  });
  handle('settings:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pasta das reuniões', defaultPath: store.settings.rootDir, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('library:get', () => store.getLibrary());
  handle('project:create', (p) => store.createProject(p || {}));
  handle('project:update', (id, p) => store.updateProject(id, p || {}));
  handle('project:delete', (id) => store.deleteProject(id));
  handle('template:save', (t) => store.saveTemplate(t || {}));
  handle('template:delete', (id) => store.deleteTemplate(id));
  handle('meetings:list', (f) => store.list(f || {}));
  handle('meeting:get', (id) => meetingFull(id));
  handle('meeting:create', (o) => { const m = store.createMeeting(o || {}); return meetingFull(m.id); });
  handle('meeting:update', (id, patch) => {
    const m = store.updateMeeting(id, patch);
    if (patch && patch.speakers) { const tr = store.readJsonFile(id, 'transcript.json'); if (tr) store.writeTextFile(id, 'transcricao.txt', render.toText(tr.segments, m.speakers)); }
    store.invalidateSearch(id);
    return true;
  });
  handle('meeting:delete', async (id) => {
    if (proc.isRecording(id)) throw new Error('Encerre a gravação antes de excluir.');
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Excluir', 'Cancelar'], defaultId: 1, cancelId: 1, message: 'Excluir esta reunião?', detail: 'O áudio, a transcrição e a ata serão apagados do seu computador. Não dá para desfazer.' });
    if (r.response !== 0) return false;
    proc.cancel(id); store.deleteMeeting(id); send('meeting:changed', { id, deleted: true }); return true;
  });
  handle('meeting:regenerate', (id, templateId) => {
    if (!store.readJsonFile(id, 'transcript.json')) throw new Error('Ainda não há transcrição.');
    if (templateId) store.updateMeeting(id, { templateId });
    store.setStatus(id, { status: 'processing', stage: 'na fila', progress: 0, error: null }); notifyMeeting(id);
    proc.enqueue({ id, kind: 'ata', templateId }); return true;
  });
  handle('meeting:retranscribe', (id) => {
    const dir = store.dirOf(id);
    if (!proc.hasTracks(dir)) throw new Error('As faixas separadas desta reunião já foram apagadas. Ligue "Guardar as faixas separadas" em Ajustes para poder refazer a transcrição das próximas.');
    proc.restoreTracks(dir);
    store.setStatus(id, { status: 'processing', stage: 'na fila', progress: 0, error: null }); notifyMeeting(id);
    proc.enqueue({ id, kind: 'full' }); return true;
  });
  handle('meeting:retry', (id) => {
    const hasTr = !!store.readJsonFile(id, 'transcript.json');
    store.setStatus(id, { status: 'processing', stage: 'na fila', progress: 0, error: null }); notifyMeeting(id);
    proc.enqueue({ id, kind: hasTr ? 'ata' : 'full' }); return true;
  });
  handle('meeting:saveAta', (id, ata) => {
    const m = store.meetings.get(id); if (!m || !ata || typeof ata !== 'object') throw new Error('Ata inválida.');
    const S = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');
    const clean = {
      titulo: S(ata.titulo, 200), resumo: S(ata.resumo, 4000), templateId: S(ata.templateId, 64), generatedAt: S(ata.generatedAt, 40), editedAt: new Date().toISOString(),
      secoes: (Array.isArray(ata.secoes) ? ata.secoes : []).slice(0, 20).map((x) => ({ titulo: S(x.titulo, 120), itens: (Array.isArray(x.itens) ? x.itens : []).slice(0, 60).map((i) => ({ texto: S(i.texto), seu: !!i.seu, ref: typeof i.ref === 'number' ? i.ref : null })) })),
      acoes: (Array.isArray(ata.acoes) ? ata.acoes : []).slice(0, 60).map((a) => ({ tarefa: S(a.tarefa, 500), responsavel: S(a.responsavel, 120), prazo: S(a.prazo, 120), seu: !!a.seu, ref: typeof a.ref === 'number' ? a.ref : null })),
    };
    store.writeJsonFile(id, 'ata.json', clean);
    const tr = store.readJsonFile(id, 'transcript.json');
    store.writeTextFile(id, 'ata.md', render.toMarkdown(m, clean, tr ? tr.segments : [], m.speakers));
    store.invalidateSearch(id); return true;
  });
  handle('meeting:cancel', (id) => { proc.cancel(id); return true; });
  handle('meeting:reveal', (id) => { shell.showItemInFolder(path.join(store.dirOf(id), 'meeting.json')); return true; });
  handle('meeting:copy', (id) => {
    const { meeting, ata, transcript } = meetingFull(id); if (!ata) throw new Error('A ata ainda não está pronta.');
    clipboard.writeText(render.toMarkdown(meeting, ata, [], meeting.speakers)); return true;
  });
  handle('meeting:export', async (id, fmt) => {
    const { meeting, ata, transcript } = meetingFull(id);
    const segs = (transcript && transcript.segments) || [];
    const kinds = { md: ['Markdown', 'md'], html: ['Página HTML', 'html'], txt: ['Texto', 'txt'] };
    const k = kinds[fmt] || kinds.md;
    if (fmt !== 'txt' && !ata) throw new Error('A ata ainda não está pronta.');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${require('./store').slugify(meeting.title)}.${k[1]}`), filters: [{ name: k[0], extensions: [k[1]] }] });
    if (r.canceled) return false;
    const body = fmt === 'html' ? render.toHtml(meeting, ata, segs, meeting.speakers) : fmt === 'txt' ? render.toText(segs, meeting.speakers) : render.toMarkdown(meeting, ata, segs, meeting.speakers);
    fs.writeFileSync(r.filePath, body); shell.showItemInFolder(r.filePath); return true;
  });
  handle('rec:start', async (id) => {
    const r = await proc.startRecording(id);
    if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
    updateTray(); return r;
  });
  handle('rec:stop', async (id) => {
    await proc.stopRecording(id);
    if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    updateTray(); return true;
  });
  ipcMain.on('rec:chunk', (e, id, track, data) => {
    if (!win || e.sender.id !== win.webContents.id) return;
    if (typeof id !== 'string' || (track !== 'mic' && track !== 'sys') || !data) return;
    proc.chunk(id, track, data);
  });
  handle('models:download', (mode) => { startDownloads(mode === 'advanced' ? 'advanced' : 'light'); return true; });
  handle('models:cancel', () => { downloader.cancel(); return true; });
  handle('models:removeUnused', () => models.removeUnused(modelsDir(), store.settings.mode));
  handle('chat:ask', async (id, question, history) => {
    const { meeting, transcript } = meetingFull(id);
    if (!transcript) throw new Error('Ainda não há transcrição.');
    const base = { segs: transcript.segments, names: meeting.speakers, question: String(question || '').slice(0, 1000), history: Array.isArray(history) ? history.slice(-6) : [], mode: meeting.mode, lang: store.settings.language };
    const cloudChat = aiFor('chat');
    try {
      const { promise } = await engine.requestCancelable('chat', { id, opts: { ...base, cloud: cloudChat } });
      return await promise;
    } catch (e) {
      if (!cloudChat || /cancelado/i.test(e.message)) throw e;
      log(`pergunta pelo serviço de IA falhou (${e.message}); usando o modelo do computador`);
      const { promise } = await engine.requestCancelable('chat', { id, opts: { ...base, cloud: null } });
      return promise;
    }
  });
  handle('ai:get', () => aiPublic());
  handle('ai:save', (patch) => {
    if (patch && 'apiKey' in patch) { keyStore.set(patch.apiKey); delete patch.apiKey; }
    if (patch && Object.keys(patch).length) store.saveSettings({ ai: patch });
    const pub = aiPublic();
    send('models:progress', { ...downloader.state, flags: modelFlags(), status: modelsStatus() });
    if (store.settings.onboarded && !modelsStatus().ready && !downloader.state.active) startDownloads(store.settings.mode);
    proc.retryQueued();
    log(`serviço de IA: ${pub.provider} · chave ${pub.hasKey ? 'guardada' : 'ausente'} · ativo em [${pub.active.join(', ') || 'nada'}]`);
    send('ai:changed', pub);
    return pub;
  });
  handle('ai:clearKey', () => { keyStore.clear(); const pub = aiPublic(); send('ai:changed', pub); return pub; });
  handle('ai:models', async (draft) => {
    const cfg = draftConfig(draft);
    return cloud.models(cfg);
  });
  handle('ai:test', async (draft, feature) => {
    const cfg = draftConfig(draft, feature);
    if (!cfg.model) throw new Error('Escolha um modelo primeiro.');
    if (feature === 'transcribe') {
      const wav = silentWav(1);
      await cloud.transcribe(cfg, { wav, model: cfg.model, log });
      return 'O serviço aceitou um áudio de teste.';
    }
    const out = await cloud.chat(cfg, { messages: [{ role: 'user', content: 'Responda apenas: ok' }], maxTokens: 10, temperature: 0, log });
    return 'Resposta do modelo: ' + String(out).trim().slice(0, 60);
  });
  handle('system:mediaAccess', async (kind) => {
    const type = kind === 'microphone' ? 'microphone' : 'screen';
    // Windows também tem chave de privacidade por app ("Deixar apps acessar o microfone"): se estiver desligada,
    // o Chromium não lista nem abre o microfone. Antes isso era ignorado e o app dizia "granted" à toa.
    if (isWin) { try { return systemPreferences.getMediaAccessStatus(type) || 'unknown'; } catch (_) { return 'granted'; } }
    if (!isMac) return 'granted';
    if (type === 'microphone') { const s = systemPreferences.getMediaAccessStatus('microphone'); if (s === 'not-determined') return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'; return s; }
    return systemPreferences.getMediaAccessStatus('screen');
  });
  handle('update:get', () => updater.state);
  handle('update:check', () => updater.check({ manual: true }));
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());
  handle('update:dismiss', () => updater.dismiss());
  handle('update:openPage', () => { shell.openExternal(updater.state.url); return true; });
  handle('system:diag', async () => {
    const st = (t) => { try { return systemPreferences.getMediaAccessStatus(t) || 'unknown'; } catch (e) { return 'indisponível (' + e.message + ')'; } };
    let sources = 'não testado';
    try { const l = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }); sources = l.length + ' tela(s): ' + l.map((x) => x.name).join(', '); }
    catch (e) { sources = 'FALHOU: ' + e.message; }
    return {
      platform: process.platform + ' ' + process.arch + ' · ' + os.release(),
      electron: process.versions.electron, chrome: process.versions.chrome,
      mic: isMac || isWin ? st('microphone') : 'n/d (Linux)', screen: isMac || isWin ? st('screen') : 'n/d (Linux)',
      sources, captureMode: store.settings.captureMode || 'padrão', logFile: logFile(),
    };
  });
  handle('system:logUi', (msg) => { log('[ui] ' + String(msg).slice(0, 2000)); return true; });
  handle('system:openPrivacy', (kind) => {
    if (isMac) shell.openExternal(kind === 'microphone' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    else if (isWin) shell.openExternal(kind === 'microphone' ? 'ms-settings:privacy-microphone' : 'ms-settings:sound');
    return true;
  });
  handle('system:openLog', () => { shell.showItemInFolder(logFile()); return true; });
}

// ---------------------------------------------------------------------------------------------
app.whenReady().then(() => {
  store = new Store({ userData: app.getPath('userData'), documents: app.getPath('documents') });
  downloader = new models.Downloader({ dir: modelsDir(), fetchImpl: (u, o) => net.fetch(u, o), log, skip: skipModels, onProgress: (s) => send('models:progress', { ...s, flags: modelFlags() }) });
  engine = new EngineHost({ modelsDir: modelsDir(), log, llmOverride: process.env.MINUTA_LLM_PATH, onEvent: (m) => {
    if (m.event === 'segment') send('live:segment', m.id, m.seg);
    else if (m.event === 'progress') { const mt = store.meetings.get(m.id); if (mt && mt.status === 'processing') { mt.stage = m.stage; mt.progress = m.progress; send('meeting:changed', (({ folder, ...x }) => x)(mt)); } }
    else if (m.event === 'chatToken') send('chat:token', m.id, m.text);
  } });
  proc = new Processor({ store, engine, notify: notifyMeeting, log, modelStatus: () => modelFlags(), aiFor });
  setupSession();
  registerIpc();
  appMenu();
  createWindow();
  tray = new Tray(trayImage(false)); updateTray();
  tray.on('click', () => { if (!isMac) showWindow(); });
  registerShortcut();
  updater = new Updater({
    app, log,
    onChange: (st) => send('update:changed', st),
    busy: () => proc.isRecording() || proc.busy,
    enabled: () => store.settings.autoUpdate !== false,
  });
  updater.start();
  engine.ensure().catch((e) => log('motor: ' + e.message));
  proc.recover();
  if (store.settings.onboarded && !modelsStatus().ready) startDownloads(store.settings.mode);
  log(`Minuta ${app.getVersion()} iniciado (${process.platform}/${process.arch})`);
});

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('before-quit', async (e) => {
  if (proc && proc.isRecording() && !quitting) {
    e.preventDefault();
    const id = [...proc.rec.keys()][0];
    send('app:stopRecording');
    const t0 = Date.now();
    while (proc.isRecording(id) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 100));
    if (proc.isRecording(id)) await proc.stopRecording(id).catch(() => {});
    quitting = true; app.quit(); return;
  }
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
