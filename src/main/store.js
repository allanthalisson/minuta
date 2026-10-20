'use strict';
// Armazenamento local: ajustes (userData), biblioteca (projetos + templates) e reuniões (pasta escolhida).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BUILTIN_TEMPLATES } = require('../shared/templates');

const ID_RE = /^[a-z0-9-]{6,64}$/;

function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fallback; } }
function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f); // gravação atômica
}
function newId() { return crypto.randomBytes(6).toString('hex'); }
function str(v, max = 500) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function slugify(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'reuniao'; }

const AI_PROVIDERS = ['openai', 'openrouter', 'groq', 'custom'];
const AI_FEATURES = ['transcribe', 'ata', 'chat'];
function sanitizeAi(v, prev) {
  const cur = prev || {};
  const p = v && typeof v === 'object' ? v : {};
  const out = {
    provider: AI_PROVIDERS.includes(p.provider) ? p.provider : (cur.provider || 'openai'),
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl.trim().slice(0, 500) : (cur.baseUrl || ''),
    features: {}, models: {},
  };
  if (out.baseUrl && !/^https?:\/\//i.test(out.baseUrl)) throw new Error('O endereço do serviço precisa começar com http:// ou https://');
  for (const f of AI_FEATURES) {
    out.features[f] = p.features && f in p.features ? !!p.features[f] : !!((cur.features || {})[f]);
    const m = p.models && f in p.models ? p.models[f] : (cur.models || {})[f];
    out.models[f] = String(m || '').trim().slice(0, 120);
  }
  return out;
}

class Store {
  constructor({ userData, documents }) {
    this.userData = userData;
    this.settingsFile = path.join(userData, 'settings.json');
    this.settings = Object.assign({
      onboarded: false, mode: 'light', userName: '', rootDir: path.join(documents, 'Minuta'), language: 'auto',
      micDeviceId: 'default', shortcut: 'CommandOrControl+Shift+R', launchAtLogin: false, consentReminder: true, keepTracks: false, autoUpdate: true,
      // Serviço de IA opcional (compatível com OpenAI). Tudo desligado = só os modelos do computador.
      // A chave NÃO fica aqui: vai criptografada em outro arquivo (ver keyStore no main).
      ai: { provider: 'openai', baseUrl: '', features: { transcribe: false, ata: false, chat: false }, models: { transcribe: 'whisper-1', ata: '', chat: '' } },
    }, readJson(this.settingsFile, {}));
    this.meetings = new Map();
    this.loadLibrary();
    this.scan();
  }

  // ---- ajustes ---------------------------------------------------------------------------------
  saveSettings(patch) {
    const allowed = { mode: (v) => (v === 'advanced' ? 'advanced' : 'light'), userName: (v) => str(v, 60).trim(), language: (v) => (['auto', 'pt', 'en', 'es'].includes(v) ? v : 'auto'),
      micDeviceId: (v) => str(v, 200) || 'default', launchAtLogin: (v) => !!v, consentReminder: (v) => !!v, onboarded: (v) => !!v, keepTracks: (v) => !!v, autoUpdate: (v) => !!v,
      shortcut: (v) => str(v, 60), captureMode: (v) => (v === 'screen' ? 'screen' : 'frame'), ai: (v) => sanitizeAi(v, this.settings.ai), rootDir: (v) => { const p = str(v, 1000); if (!p || !path.isAbsolute(p)) throw new Error('Escolha uma pasta válida.'); return p; } };
    for (const [k, v] of Object.entries(patch || {})) if (allowed[k]) this.settings[k] = allowed[k](v);
    writeJson(this.settingsFile, this.settings);
    if (patch && patch.rootDir) { this.loadLibrary(); this.scan(); }
    return this.settings;
  }

  get meetingsDir() { return path.join(this.settings.rootDir, 'Reuniões'); }
  get libraryFile() { return path.join(this.settings.rootDir, 'biblioteca.json'); }

  // ---- biblioteca ------------------------------------------------------------------------------
  loadLibrary() {
    this.library = Object.assign({ projects: [], templates: [] }, readJson(this.libraryFile, {}));
  }
  saveLibrary() { writeJson(this.libraryFile, this.library); }
  getLibrary() { return { projects: this.library.projects, templates: BUILTIN_TEMPLATES.concat(this.library.templates) }; }

  createProject({ name, parentId }) {
    name = str(name, 80).trim(); if (!name) throw new Error('Dê um nome ao projeto.');
    if (parentId && !this.project(parentId)) throw new Error('Projeto pai não encontrado.');
    const p = { id: newId(), name, parentId: parentId || null, created: Date.now() };
    this.library.projects.push(p); this.saveLibrary(); return p;
  }
  project(id) { return this.library.projects.find((p) => p.id === id); }
  updateProject(id, { name, parentId }) {
    const p = this.project(id); if (!p) throw new Error('Projeto não encontrado.');
    if (name !== undefined) { name = str(name, 80).trim(); if (!name) throw new Error('Dê um nome ao projeto.'); p.name = name; }
    if (parentId !== undefined) {
      if (parentId && (!this.project(parentId) || this.descendants(id).includes(parentId))) throw new Error('Não dá para mover um projeto para dentro dele mesmo.');
      p.parentId = parentId || null;
    }
    this.saveLibrary(); return p;
  }
  descendants(id) {
    const out = [id]; let changed = true;
    while (changed) { changed = false; for (const p of this.library.projects) if (p.parentId && out.includes(p.parentId) && !out.includes(p.id)) { out.push(p.id); changed = true; } }
    return out;
  }
  deleteProject(id) {
    const ids = this.descendants(id);
    this.library.projects = this.library.projects.filter((p) => !ids.includes(p.id));
    this.saveLibrary();
    for (const m of this.meetings.values()) if (ids.includes(m.projectId)) this.updateMeeting(m.id, { projectId: null });
    return true;
  }

  saveTemplate(t) {
    const name = str(t.name, 80).trim(); if (!name) throw new Error('Dê um nome ao template.');
    const sections = (Array.isArray(t.sections) ? t.sections : []).slice(0, 12)
      .map((s) => ({ title: str(s.title, 80).trim(), instruction: str(s.instruction, 400).trim() })).filter((s) => s.title);
    if (!sections.length) throw new Error('Adicione pelo menos uma seção.');
    let tpl = t.id && this.library.templates.find((x) => x.id === t.id);
    if (!tpl) { tpl = { id: 'tpl-' + newId() }; this.library.templates.push(tpl); }
    Object.assign(tpl, { name, description: str(t.description, 200), sections });
    this.saveLibrary(); return tpl;
  }
  deleteTemplate(id) { this.library.templates = this.library.templates.filter((t) => t.id !== id); this.saveLibrary(); return true; }
  template(id) { return this.getLibrary().templates.find((t) => t.id === id) || BUILTIN_TEMPLATES[0]; }

  // ---- reuniões ---------------------------------------------------------------------------------
  scan() {
    this.meetings.clear();
    let dirs = [];
    try { dirs = fs.readdirSync(this.meetingsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return; }
    for (const d of dirs) {
      const m = readJson(path.join(this.meetingsDir, d.name, 'meeting.json'), null);
      if (m && ID_RE.test(m.id || '')) { m.folder = d.name; this.meetings.set(m.id, m); }
    }
  }

  dirOf(id) {
    if (!ID_RE.test(String(id))) throw new Error('Reunião inválida.');
    const m = this.meetings.get(id); if (!m) throw new Error('Reunião não encontrada.');
    const dir = path.join(this.meetingsDir, m.folder);
    if (path.relative(this.meetingsDir, dir).startsWith('..')) throw new Error('Caminho inválido.');
    return dir;
  }

  createMeeting({ title, projectId, templateId } = {}) {
    const now = new Date();
    const id = newId() + '-' + now.getTime().toString(36);
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`;
    const t = str(title, 120).trim() || `Reunião de ${p2(now.getDate())}/${p2(now.getMonth() + 1)} às ${p2(now.getHours())}:${p2(now.getMinutes())}`;
    const folder = `${stamp}_${slugify(t)}_${id.slice(0, 4)}`;
    const m = { id, folder, title: t, autoTitle: !str(title).trim(), createdAt: now.toISOString(), durationSec: 0, projectId: projectId && this.project(projectId) ? projectId : null,
      templateId: templateId || 'auto', notes: '', noteTimes: {}, status: 'new', stage: null, progress: 0, error: null, mode: this.settings.mode, speakers: {}, hasAudio: false, hasAta: false };
    fs.mkdirSync(path.join(this.meetingsDir, folder), { recursive: true });
    this.meetings.set(id, m); this.persist(m);
    return m;
  }

  persist(m) { const { folder, ...data } = m; writeJson(path.join(this.meetingsDir, m.folder, 'meeting.json'), data); }

  updateMeeting(id, patch) {
    const m = this.meetings.get(id); if (!m) throw new Error('Reunião não encontrada.');
    const allowed = { title: (v) => { const t = str(v, 120).trim(); if (t) m.autoTitle = false; return t || m.title; }, notes: (v) => str(v, 200000),
      noteTimes: (v) => (v && typeof v === 'object' ? v : {}), projectId: (v) => (v && this.project(v) ? v : null), templateId: (v) => str(v, 64) || 'auto',
      speakers: (v) => { const o = {}; for (const [k, n] of Object.entries(v || {})) o[str(k, 40)] = str(n, 60); return o; } };
    for (const [k, v] of Object.entries(patch || {})) if (allowed[k]) m[k] = allowed[k](v);
    this.persist(m); return m;
  }

  setStatus(id, patch) { // uso interno (status, stage, progress, error, durationSec, hasAta...)
    const m = this.meetings.get(id); if (!m) return null;
    Object.assign(m, patch); this.persist(m); return m;
  }

  deleteMeeting(id) {
    const dir = this.dirOf(id);
    fs.rmSync(dir, { recursive: true, force: true });
    this.meetings.delete(id); return true;
  }

  readFile(id, name) { try { return fs.readFileSync(path.join(this.dirOf(id), name), 'utf8'); } catch (_) { return null; } }
  readJsonFile(id, name) { const t = this.readFile(id, name); try { return t ? JSON.parse(t) : null; } catch (_) { return null; } }
  writeJsonFile(id, name, data) { writeJson(path.join(this.dirOf(id), name), data); }
  writeTextFile(id, name, text) { fs.writeFileSync(path.join(this.dirOf(id), name), text); }

  // Lista com filtros: q (texto), projectId (inclui subprojetos), from/to (ISO), status
  list({ q, projectId, from, to, noProject } = {}) {
    let arr = [...this.meetings.values()];
    if (projectId) { const ids = this.descendants(projectId); arr = arr.filter((m) => ids.includes(m.projectId)); }
    if (noProject) arr = arr.filter((m) => !m.projectId);
    if (from) arr = arr.filter((m) => m.createdAt >= from);
    if (to) arr = arr.filter((m) => m.createdAt <= to);
    if (q && String(q).trim()) {
      const terms = norm(q).split(' ').filter(Boolean);
      arr = arr.filter((m) => {
        const hay = norm([m.title, m.notes, this.searchText(m)].join(' '));
        return terms.every((t) => hay.includes(t));
      });
    }
    arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return arr.map(summary);
  }

  searchText(m) {
    if (m._search !== undefined) return m._search;
    let s = '';
    try { const a = JSON.parse(fs.readFileSync(path.join(this.meetingsDir, m.folder, 'ata.json'), 'utf8')); s += ' ' + [a.titulo, a.resumo, ...(a.secoes || []).flatMap((x) => x.itens.map((i) => i.texto)), ...(a.acoes || []).map((x) => x.tarefa + ' ' + x.responsavel)].join(' '); } catch (_) {}
    try { const t = JSON.parse(fs.readFileSync(path.join(this.meetingsDir, m.folder, 'transcript.json'), 'utf8')); s += ' ' + (t.segments || []).map((x) => x.text).join(' '); } catch (_) {}
    Object.defineProperty(m, '_search', { value: s, writable: true, configurable: true, enumerable: false });
    return s;
  }
  invalidateSearch(id) { const m = this.meetings.get(id); if (m) m._search = undefined; }
}

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' '); }
function summary(m) {
  return { id: m.id, title: m.title, createdAt: m.createdAt, durationSec: m.durationSec, projectId: m.projectId, status: m.status, stage: m.stage, progress: m.progress, hasAta: m.hasAta, mode: m.mode };
}

module.exports = { Store, sanitizeAi, AI_FEATURES, ID_RE, slugify, summary };
