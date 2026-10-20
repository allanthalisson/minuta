'use strict';
(function (A) {
  const { esc, h, I, fmtDur, dayGroup, shortDate, menu, toast } = A;

  const PERIODS = [
    { id: 'all', label: 'Qualquer data' }, { id: 'today', label: 'Hoje' }, { id: '7d', label: 'Últimos 7 dias' },
    { id: '30d', label: 'Últimos 30 dias' }, { id: 'year', label: 'Este ano' }, { id: 'custom', label: 'Escolher datas…' },
  ];
  function periodRange(nav) {
    const now = new Date(), day = 864e5, sod = new Date(now); sod.setHours(0, 0, 0, 0);
    switch (nav.period) {
      case 'today': return { from: sod.toISOString() };
      case '7d': return { from: new Date(sod - 6 * day).toISOString() };
      case '30d': return { from: new Date(sod - 29 * day).toISOString() };
      case 'year': return { from: new Date(now.getFullYear(), 0, 1).toISOString() };
      case 'custom': return { from: nav.from ? new Date(nav.from + 'T00:00:00').toISOString() : undefined, to: nav.to ? new Date(nav.to + 'T23:59:59').toISOString() : undefined };
      default: return {};
    }
  }

  function statusTag(m) {
    if (m.status === 'recording') return '<span class="tag rec"><span class="dot pulse"></span>Gravando</span>';
    if (m.status === 'processing') return `<span class="tag proc">${esc(cap(m.stage || 'processando'))}${m.progress > 0 && m.progress < 1 ? ' ' + Math.round(m.progress * 100) + '%' : '…'}</span>`;
    if (m.status === 'queued') return '<span class="tag wait">Aguardando modelos</span>';
    if (m.status === 'error') return '<span class="tag err">Erro</span>';
    if (m.status === 'new') return '<span class="tag">Rascunho</span>';
    return '';
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  A.statusTag = statusTag;

  async function renderHome(root) {
    const S = A.state, nav = S.nav;
    const project = nav.view === 'project' ? S.projects.find((p) => p.id === nav.projectId) : null;
    const filter = { q: nav.q || '', ...periodRange(nav) };
    if (project) filter.projectId = project.id; else if (nav.view === 'inbox') filter.noProject = true; else if (nav.filterProject) filter.projectId = nav.filterProject;
    const list = await window.minuta.listMeetings(filter);
    if (S.nav !== nav) return; // navegação mudou enquanto carregava

    const path = project ? A.projectPath(project.id) : [];
    const title = project ? project.name : nav.view === 'inbox' ? 'Sem projeto' : 'Todas as reuniões';
    const subs = project ? (A.projectTree(S.projects).get(project.id) || []) : [];
    const pf = PERIODS.find((p) => p.id === (nav.period || 'all'));
    const fp = nav.filterProject && S.projects.find((p) => p.id === nav.filterProject);
    const anyFilter = (nav.q || '') || (nav.period && nav.period !== 'all') || fp;

    root.innerHTML = `
      <div class="toolbar drag"><div class="crumbs">${path.length > 1 ? path.slice(0, -1).map((p) => `<span>${esc(p.name)}</span><span class="sep">›</span>`).join('') : ''}<span>${esc(title)}</span></div><div class="spacer"></div>
        ${project ? `<button class="btn ghost sm" id="p-more" aria-label="Opções do projeto">${I.more}</button>` : ''}
        <button class="btn primary sm" id="h-new">${I.plus}Nova reunião</button></div>
      <div class="scroll" id="h-scroll"><div class="page wide">
        ${A.downloadBanner()}
        <h1 class="page-title">${esc(title)}</h1>
        ${subs.length ? `<div class="filters" style="margin:6px 0 14px">${subs.map((s) => `<button class="chip" data-sub="${esc(s.id)}">${I.folder}${esc(s.name)}</button>`).join('')}</div>` : '<div style="height:10px"></div>'}
        <div class="filters" role="search">
          <div class="search-lg">${I.search}<input id="h-q" placeholder="Buscar por título, notas, ata ou transcrição" value="${esc(nav.q || '')}" aria-label="Buscar"></div>
          <button class="chip ${nav.period && nav.period !== 'all' ? 'on' : ''}" id="h-period">${I.clock}${esc(pf.id === 'custom' ? customLabel(nav) : pf.label)}</button>
          ${!project && nav.view !== 'inbox' ? `<button class="chip ${fp ? 'on' : ''}" id="h-proj">${I.folder}${fp ? esc(A.projectPath(fp.id).map((p) => p.name).join(' › ')) : 'Todos os projetos'}</button>` : ''}
          ${nav.period === 'custom' ? `<input type="date" class="date-in" id="h-from" value="${esc(nav.from || '')}" aria-label="De"><input type="date" class="date-in" id="h-to" value="${esc(nav.to || '')}" aria-label="Até">` : ''}
          ${anyFilter ? '<button class="btn ghost sm" id="h-clear">Limpar filtros</button>' : ''}
        </div>
        <div id="h-list" role="list">${listHtml(list, !!anyFilter)}</div>
      </div></div>`;

    const $ = (s) => root.querySelector(s);
    $('#h-new').onclick = () => A.newMeeting({ projectId: project ? project.id : null });
    const q = $('#h-q'); q.oninput = A.debounce(() => A.go({ ...nav, q: q.value }, { keepFocus: true, replace: true }), 220);
    if (S.focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); S.focusSearch = false; }
    $('#h-period').onclick = (e) => menu(e.currentTarget, PERIODS.map((p) => ({ label: p.label, check: (nav.period || 'all') === p.id, onClick: () => A.go({ ...nav, period: p.id }) })));
    const hp = $('#h-proj');
    if (hp) hp.onclick = (e) => menu(e.currentTarget, [{ label: 'Todos os projetos', check: !nav.filterProject, onClick: () => A.go({ ...nav, filterProject: null }) }, { sep: true },
      ...S.projects.map((p) => ({ label: A.projectPath(p.id).map((x) => x.name).join(' › '), check: nav.filterProject === p.id, onClick: () => A.go({ ...nav, filterProject: p.id }) }))]);
    const from = $('#h-from'), to = $('#h-to');
    if (from) from.onchange = () => A.go({ ...nav, from: from.value });
    if (to) to.onchange = () => A.go({ ...nav, to: to.value });
    const clr = $('#h-clear'); if (clr) clr.onclick = () => A.go({ view: nav.view, projectId: nav.projectId });
    const pm = $('#p-more'); if (pm) pm.onclick = (e) => A.projectMenu(project.id, e.currentTarget);
    root.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => A.go({ view: 'project', projectId: b.dataset.sub })));
    const empty = root.querySelector('[data-empty-new]'); if (empty) empty.onclick = () => A.newMeeting({ projectId: project ? project.id : null });
    bindRows(root);
    A.bindDownloadBanner(root);
    const sc = $('#h-scroll'); sc.onscroll = () => root.querySelector('.toolbar').classList.toggle('scrolled', sc.scrollTop > 4);
  }

  function customLabel(nav) {
    const f = (d) => (d ? d.split('-').reverse().slice(0, 2).join('/') : '…');
    return nav.from || nav.to ? `${f(nav.from)} – ${f(nav.to)}` : 'Escolher datas';
  }

  function listHtml(list, filtered) {
    if (!list.length) {
      return filtered
        ? `<div class="empty"><div class="art">${I.search}</div><h2>Nada encontrado</h2><p>Tente outro termo ou limpe os filtros.</p></div>`
        : `<div class="empty"><div class="art">${I.mic}</div><h2>Grave sua primeira reunião</h2><p>Clique em gravar quando a call começar. A transcrição e a ata ficam prontas aqui, no seu computador.</p><button class="btn rec lg" data-empty-new><span class="dot" style="background:#fff"></span>Nova reunião</button><p class="hint">Atalho global: ${esc(A.shortcutLabel())}</p></div>`;
    }
    let out = '', g = null;
    for (const m of list) {
      const grp = dayGroup(m.createdAt);
      if (grp !== g) { out += `<div class="group-title">${esc(grp)}</div>`; g = grp; }
      const proj = m.projectId && A.state.projects.find((p) => p.id === m.projectId);
      out += `<div class="row" role="listitem" tabindex="0" draggable="true" data-id="${esc(m.id)}">
        <span class="ic">${m.hasAta ? I.doc : I.mic}</span>
        <span class="t">${esc(m.title)}</span>
        <span>${statusTag(m)}${proj ? `<span class="tag">${esc(proj.name)}</span>` : ''}</span>
        <span class="m">${esc(shortDate(m.createdAt))}${m.durationSec ? ' · ' + esc(fmtDur(m.durationSec)) : ''}</span></div>`;
    }
    return out;
  }

  function bindRows(root) {
    root.querySelectorAll('.row[data-id]').forEach((r) => {
      const id = r.dataset.id;
      r.onclick = () => A.go({ view: 'meeting', id });
      r.onkeydown = (e) => { if (e.key === 'Enter') A.go({ view: 'meeting', id }); if (e.key === 'ArrowDown') { e.preventDefault(); (r.nextElementSibling && r.nextElementSibling.classList.contains('row') ? r.nextElementSibling : r.nextElementSibling && r.nextElementSibling.nextElementSibling)?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); (r.previousElementSibling && r.previousElementSibling.classList.contains('row') ? r.previousElementSibling : r.previousElementSibling && r.previousElementSibling.previousElementSibling)?.focus(); } };
      r.ondragstart = (e) => { e.dataTransfer.setData('text/minuta-meeting', id); e.dataTransfer.effectAllowed = 'move'; };
      r.oncontextmenu = (e) => { e.preventDefault(); A.meetingMenu(id, null, e.clientX, e.clientY); };
    });
  }

  A.renderHome = renderHome;
})(window.App);
