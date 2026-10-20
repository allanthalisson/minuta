'use strict';
(function (A) {
  const S = A.state = { nav: { view: 'home' }, projects: [], templates: [], allMeetings: [], expanded: new Set(), liveBuffer: {}, recordingId: null, settings: {}, models: null };
  const content = () => document.getElementById('content');

  A.refreshInfo = async () => {
    const info = await window.minuta.info();
    Object.assign(S, { platform: info.platform, version: info.version, settings: info.settings, models: info.models, ai: info.ai, update: info.update, totalMemGB: info.totalMemGB });
    if (info.recordingId && !S.recordingId) S.recordingId = null; // gravação de outra janela/sessão não é retomada
  };
  A.refreshLibrary = async () => { const lib = await window.minuta.library(); S.projects = lib.projects; S.templates = lib.templates; A.renderSidebar(); };
  A.refreshMeetings = async () => { S.allMeetings = await window.minuta.listMeetings({}); A.renderSidebar(); };
  A.refreshAll = async () => { await A.refreshInfo(); await A.refreshLibrary(); await A.refreshMeetings(); };

  // Navegação
  A.go = (nav, opts = {}) => {
    S.nav = nav;
    if (opts.keepFocus) S.focusSearch = true;
    if (nav.view !== 'meeting' && A.cur) { if (A.cur.player) A.cur.player.pause(); if (A.cur.flushNotes) A.cur.flushNotes(); A.cur = null; }
    A.renderSidebar();
    A.rerender();
  };
  A.rerender = () => {
    const v = S.nav.view, root = content();
    if (v === 'meeting') return A.openMeeting(root, S.nav.id);
    if (v === 'templates') return A.renderTemplates(root);
    if (v === 'settings') return A.renderSettings(root);
    return A.renderHome(root);
  };

  A.newMeeting = async (opts = {}) => {
    if (S.recordingId) return A.go({ view: 'meeting', id: S.recordingId });
    try {
      const pid = opts.projectId !== undefined ? opts.projectId : (S.nav.view === 'project' ? S.nav.projectId : null);
      const { meeting } = await window.minuta.createMeeting({ projectId: pid });
      await A.refreshMeetings();
      A.go({ view: 'meeting', id: meeting.id });
      if (opts.record) setTimeout(() => A.startRecording(meeting.id), 150);
    } catch (e) { A.toast(e.message, 'err'); }
  };

  A.moveMeeting = async (id, projectId) => {
    try {
      await window.minuta.updateMeeting(id, { projectId });
      const p = projectId && S.projects.find((x) => x.id === projectId);
      A.toast(p ? `Movida para ${p.name}` : 'Movida para Sem projeto');
      await A.refreshMeetings();
      if (S.nav.view === 'meeting' && S.nav.id === id && A.cur) { A.cur.meeting.projectId = projectId; A.rerender(); } else if (S.nav.view !== 'meeting') A.rerender();
    } catch (e) { A.toast(e.message, 'err'); }
  };

  // Eventos do processo principal
  let listTimer = null;
  window.minuta.onMeetingChanged((m) => {
    const i = S.allMeetings.findIndex((x) => x.id === m.id);
    if (m.deleted) { if (i >= 0) S.allMeetings.splice(i, 1); }
    else if (i >= 0) Object.assign(S.allMeetings[i], m); else S.allMeetings.unshift(m);
    A.onMeetingChanged(m);
    clearTimeout(listTimer);
    listTimer = setTimeout(() => { A.renderSidebar(); if (['home', 'project', 'inbox'].includes(S.nav.view)) A.renderHome(content()); }, 300);
  });
  window.minuta.onLiveSegment((id, seg) => A.onLiveSegment(id, seg));
  let dlTimer = null;
  window.minuta.onModelsProgress(async (p) => {
    if (!S.models) return;
    S.models.download = p;
    if (p.done || p.error) { await A.refreshInfo(); S.models.download = p.done ? { active: false } : p; if (p.done) A.toast('IA local pronta. Tudo funciona sem internet agora.'); }
    clearTimeout(dlTimer);
    dlTimer = setTimeout(() => {
      A.renderSidebar();
      updateBanners();
    }, 150);
  });
  function updateBanners() {
    document.querySelectorAll('#content [data-dlb]').forEach((el) => { el.innerHTML = A.downloadBanner().replace(/^<div data-dlb>|<\/div>$/g, ''); });
    A.bindDownloadBanner(document.getElementById('content'));
  }
  window.minuta.onShortcutRecord(() => { if (S.recordingId) A.stopRecording(); else A.newMeeting({ record: true }); });
  window.minuta.onStopRequest(() => A.stopRecording());
  window.minuta.onUpdateChanged((st) => { S.update = st; A.renderUpdatePopup(); if (A.state.nav.view === 'settings') A.renderUpdateCard(); });
  window.minuta.onNav((what) => {
    if (what === 'new') A.newMeeting();
    else if (what === 'search') { const q = document.getElementById('h-q') || document.getElementById('sb-q'); if (q) q.focus(); else A.go({ view: 'home' }, { keepFocus: true }); }
    else A.go({ view: what });
  });

  // Teclado
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); const q = document.getElementById('sb-q'); q && q.focus(); }
    if (mod && e.key === ',') { e.preventDefault(); A.go({ view: 'settings' }); }
    if (!typing && e.key === ' ' && A.cur && A.cur.player) { e.preventDefault(); A.cur.player.paused ? A.cur.player.play() : A.cur.player.pause(); }
    if (e.key === 'Escape') A.closePop();
  });

  // Início
  (async () => {
    await A.refreshAll();
    document.documentElement.classList.add('platform-' + S.platform);
    document.body.classList.add('platform-' + S.platform);
    A.go({ view: 'home' });
    if (!S.settings.onboarded) A.renderOnboarding();
  })();
})(window.App);
