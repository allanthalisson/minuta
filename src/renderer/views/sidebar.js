'use strict';
(function (A) {
  const { esc, h, I, menu, prompt, toast } = A;

  function projectTree(projects) {
    const byParent = new Map();
    for (const p of projects) { const k = p.parentId || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(p); }
    for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return byParent;
  }
  A.projectTree = projectTree;
  A.projectPath = (id) => {
    const out = []; let p = A.state.projects.find((x) => x.id === id);
    while (p) { out.unshift(p); p = A.state.projects.find((x) => x.id === p.parentId); }
    return out;
  };
  A.descendantIds = (id) => {
    const out = [id]; let changed = true;
    while (changed) { changed = false; for (const p of A.state.projects) if (p.parentId && out.includes(p.parentId) && !out.includes(p.id)) { out.push(p.id); changed = true; } }
    return out;
  };

  function count(id) {
    const ids = A.descendantIds(id);
    return A.state.allMeetings.filter((m) => ids.includes(m.projectId)).length;
  }

  function renderSidebar() {
    const S = A.state; const sb = document.getElementById('sidebar');
    const rec = S.recordingId;
    const tree = projectTree(S.projects);
    const nav = S.nav;
    const isActive = (v, pid) => (nav.view === v && (pid === undefined || nav.projectId === pid) ? 'active' : '');
    const renderLevel = (parentId, depth) => (tree.get(parentId || '') || []).map((p) => {
      const kids = tree.get(p.id) || []; const open = S.expanded.has(p.id);
      return `<div role="treeitem" aria-expanded="${kids.length ? open : ''}">
        <button class="nav-item ${isActive('project', p.id)}" data-project="${esc(p.id)}" style="padding-left:${6 + depth * 14}px">
          <span class="chev ${kids.length ? (open ? 'open' : '') : 'leaf'}" data-toggle="${esc(p.id)}" aria-label="${open ? 'Recolher' : 'Expandir'}">${I.chev}</span>
          ${I.folder}<span class="label">${esc(p.name)}</span><span class="count">${count(p.id) || ''}</span>
        </button>
        ${kids.length && open ? `<div role="group">${renderLevel(p.id, depth + 1)}</div>` : ''}
      </div>`;
    }).join('');

    const dl = S.models && S.models.download;
    const dlHtml = dl && dl.active ? `<div class="dl-mini" title="${esc(dl.label || '')}">Baixando modelos… ${Math.round(100 * dl.received / dl.total)}%<div class="bar"><i style="width:${(100 * dl.received / dl.total).toFixed(1)}%"></i></div></div>`
      : S.models && !S.models.ready && S.settings.onboarded ? `<div class="dl-mini">Modelos incompletos. <a href="#" data-nav="settings">Ver ajustes</a></div>` : '';

    sb.innerHTML = `
      <div class="sb-top drag"></div>
      <button class="sb-new" id="sb-new" title="Nova reunião (${S.platform === 'darwin' ? '⌘' : 'Ctrl+'}N)">
        ${rec ? '<span class="dot pulse"></span><span>Gravando…</span>' : '<span class="dot"></span><span>Nova reunião</span>'}<span class="kbd">${S.platform === 'darwin' ? '⌘N' : 'Ctrl N'}</span>
      </button>
      <div class="sb-search">${I.search}<input id="sb-q" placeholder="Buscar reuniões" aria-label="Buscar reuniões" value="${esc(nav.view === 'home' ? nav.q || '' : '')}"></div>
      <div class="sb-scroll" role="tree" aria-label="Projetos">
        <button class="nav-item ${isActive('home', null)}" data-nav="home">${I.home}<span class="label">Todas as reuniões</span><span class="count">${S.allMeetings.length || ''}</span></button>
        <button class="nav-item ${nav.view === 'inbox' ? 'active' : ''}" data-nav="inbox">${I.inbox}<span class="label">Sem projeto</span><span class="count">${S.allMeetings.filter((m) => !m.projectId).length || ''}</span></button>
        <div class="sb-section">
          <div class="sb-head"><span>Projetos</span><button class="icon-btn" id="sb-addp" aria-label="Novo projeto" title="Novo projeto">${I.plus}</button></div>
          ${renderLevel(null, 0) || '<div class="dl-mini">Crie projetos para organizar as atas. Arraste reuniões para cá.</div>'}
        </div>
      </div>
      <div class="sb-bottom">
        ${dlHtml}
        <button class="nav-item ${nav.view === 'templates' ? 'active' : ''}" data-nav="templates">${I.doc}<span class="label">Templates de ata</span></button>
        <button class="nav-item ${nav.view === 'settings' ? 'active' : ''}" data-nav="settings">${I.gear}<span class="label">Ajustes</span><span class="count">${S.settings.mode === 'advanced' ? 'Avançado' : 'Light'}</span></button>
      </div>`;

    sb.querySelector('#sb-new').onclick = () => (rec ? A.go({ view: 'meeting', id: rec }) : A.newMeeting());
    const q = sb.querySelector('#sb-q');
    q.oninput = A.debounce(() => A.go({ view: 'home', q: q.value, projectId: null }, { keepFocus: true }), 200);
    q.onkeydown = (e) => { if (e.key === 'Escape') { q.value = ''; q.oninput(); } };
    sb.querySelector('#sb-addp').onclick = () => newProject(null);
    sb.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); A.go({ view: b.dataset.nav }); }));
    sb.querySelectorAll('[data-project]').forEach((b) => {
      const id = b.dataset.project;
      b.onclick = (e) => {
        if (e.target.closest('[data-toggle]')) { S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id); renderSidebar(); return; }
        A.go({ view: 'project', projectId: id });
      };
      b.oncontextmenu = (e) => { e.preventDefault(); projectMenu(id, null, e.clientX, e.clientY); };
      b.ondragover = (e) => { if (e.dataTransfer.types.includes('text/minuta-meeting')) { e.preventDefault(); b.classList.add('drop'); } };
      b.ondragleave = () => b.classList.remove('drop');
      b.ondrop = async (e) => {
        b.classList.remove('drop'); const mid = e.dataTransfer.getData('text/minuta-meeting'); if (!mid) return;
        e.preventDefault(); await A.moveMeeting(mid, id);
      };
    });
    const inbox = sb.querySelector('[data-nav=inbox]');
    inbox.ondragover = (e) => { if (e.dataTransfer.types.includes('text/minuta-meeting')) { e.preventDefault(); inbox.classList.add('drop'); } };
    inbox.ondragleave = () => inbox.classList.remove('drop');
    inbox.ondrop = async (e) => { inbox.classList.remove('drop'); const mid = e.dataTransfer.getData('text/minuta-meeting'); if (mid) { e.preventDefault(); await A.moveMeeting(mid, null); } };
  }

  async function newProject(parentId) {
    const name = await prompt({ title: parentId ? 'Novo subprojeto' : 'Novo projeto', placeholder: 'Ex.: Cliente Acme', ok: 'Criar' });
    if (!name) return;
    try {
      const p = await window.minuta.createProject({ name, parentId });
      if (parentId) A.state.expanded.add(parentId);
      await A.refreshLibrary(); A.go({ view: 'project', projectId: p.id });
    } catch (e) { toast(e.message, 'err'); }
  }
  A.newProject = newProject;

  function projectMenu(id, anchor, x, y) {
    const p = A.state.projects.find((q) => q.id === id); if (!p) return;
    const others = A.state.projects.filter((q) => !A.descendantIds(id).includes(q.id));
    menu(anchor, [
      { label: 'Novo subprojeto', onClick: () => newProject(id) },
      { label: 'Renomear…', onClick: async () => { const n = await prompt({ title: 'Renomear projeto', value: p.name }); if (n) { try { await window.minuta.updateProject(id, { name: n }); await A.refreshLibrary(); } catch (e) { toast(e.message, 'err'); } } } },
      { label: 'Mover para…', onClick: () => menu(anchor, [{ label: '(nível principal)', onClick: () => move(null) }, ...others.map((o) => ({ label: A.projectPath(o.id).map((q) => q.name).join(' › '), onClick: () => move(o.id) }))], { x, y }) },
      { sep: true },
      { label: 'Excluir projeto', danger: true, onClick: async () => {
        if (!confirm(`Excluir "${p.name}" e seus subprojetos? As reuniões não são apagadas: vão para "Sem projeto".`)) return;
        await window.minuta.deleteProject(id); await A.refreshLibrary(); await A.refreshMeetings(); if (A.state.nav.projectId === id) A.go({ view: 'home' });
      } },
    ], { x, y });
    async function move(parentId) { try { await window.minuta.updateProject(id, { parentId }); if (parentId) A.state.expanded.add(parentId); await A.refreshLibrary(); } catch (e) { toast(e.message, 'err'); } }
  }
  A.projectMenu = projectMenu;
  A.renderSidebar = renderSidebar;
})(window.App);
