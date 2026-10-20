'use strict';
/* Atualização pelos releases do GitHub.
   Windows: baixa e instala sozinho (o instalador NSIS troca a versão e reabre o app).
   macOS: instalar sozinho exigiria app assinado e notarizado pela Apple, então o app avisa e abre a página do release.
   Linux: idem (o build é uma pasta, não um pacote atualizável). */
const { shell } = require('electron');

const REPO = { owner: 'allanthalisson', repo: 'minuta' };
const releasesUrl = (v) => `https://github.com/${REPO.owner}/${REPO.repo}/releases` + (v ? `/tag/v${v}` : '/latest');

// Primeiras linhas do texto do release, sem HTML nem marcação, para caber no popup.
function shortNotes(notes, max = 320) {
  let t = typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => n && n.note).filter(Boolean).join('\n') : '';
  t = String(t || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\r/g, '')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    .join('\n');
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}

class Updater {
  // busy() deve dizer se o app está gravando ou processando — nunca reiniciamos no meio disso.
  // makeUpdater/open são injetáveis para os testes rodarem sem o electron-updater real.
  constructor({ app, log = () => {}, onChange = () => {}, busy = () => false, enabled = () => true,
                makeUpdater = null, open = (u) => shell.openExternal(u), canAutoInstall = process.platform === 'win32' } = {}) {
    this.app = app; this.log = log; this.onChange = onChange; this.busy = busy; this.enabled = enabled;
    this.make = makeUpdater; this.open = open;
    this.canAutoInstall = canAutoInstall;
    this.state = { status: 'idle', version: null, notes: '', url: releasesUrl(), percent: 0, error: null, canAutoInstall: this.canAutoInstall, dismissed: false, manual: false };
    this.au = null; this.timer = null;
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }

  updater() {
    if (this.au) return this.au;
    const autoUpdater = this.make ? this.make() : require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;            // só baixa quando o usuário manda
    autoUpdater.autoInstallOnAppQuit = false;    // instalar é decisão explícita
    autoUpdater.logger = { info: (m) => this.log('atualização: ' + m), warn: (m) => this.log('atualização: ' + m), error: (m) => this.log('atualização: ' + m), debug: () => {} };
    const feed = process.env.MINUTA_UPDATE_FEED;
    if (feed) { autoUpdater.forceDevUpdateConfig = true; autoUpdater.setFeedURL({ provider: 'generic', url: feed }); }
    else autoUpdater.setFeedURL({ provider: 'github', ...REPO });

    autoUpdater.on('update-available', (info) => {
      this.set({ status: 'available', version: info.version, notes: shortNotes(info.releaseNotes || info.releaseName), url: releasesUrl(info.version), error: null, dismissed: false });
    });
    autoUpdater.on('update-not-available', () => this.set({ status: 'none', version: null, error: null }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', () => this.set({ status: 'ready', percent: 100 }));
    autoUpdater.on('error', (e) => {
      const msg = /net::|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(String(e && e.message)) ? 'Não foi possível falar com o GitHub. Verifique a conexão.' : (e && e.message) || String(e);
      this.log('atualização falhou: ' + msg);
      this.set({ status: 'error', error: msg });
    });
    this.au = autoUpdater;
    return autoUpdater;
  }

  // manual = pedido pelo usuário (mostra "você já está na última versão"); automático fica quieto.
  async check({ manual = false } = {}) {
    if (!manual && !this.enabled()) return this.state;
    if (this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking', manual, error: null });
    try { await this.updater().checkForUpdates(); }
    catch (e) { this.set({ status: 'error', error: (e && e.message) || String(e) }); }
    return this.state;
  }

  async download() {
    if (!this.canAutoInstall) { this.open(this.state.url); return this.state; }
    if (this.state.status === 'downloading') return this.state;
    this.set({ status: 'downloading', percent: 0, error: null });
    try { await this.updater().downloadUpdate(); }
    catch (e) { this.set({ status: 'error', error: (e && e.message) || String(e) }); }
    return this.state;
  }

  install() {
    if (!this.canAutoInstall || this.state.status !== 'ready') { this.open(this.state.url); return false; }
    if (this.busy()) throw new Error('Há uma gravação ou um processamento em andamento. Termine antes de atualizar.');
    this.log('instalando a atualização e reiniciando');
    setImmediate(() => this.updater().quitAndInstall(false, true));
    return true;
  }

  dismiss() { this.set({ dismissed: true }); return this.state; }

  // Checa pouco depois de abrir e a cada 6 horas.
  start() {
    clearInterval(this.timer);
    setTimeout(() => this.check().catch(() => {}), 8000);
    this.timer = setInterval(() => this.check().catch(() => {}), 6 * 60 * 60 * 1000);
  }
  stop() { clearInterval(this.timer); }
}

module.exports = { Updater, shortNotes, releasesUrl, REPO };
