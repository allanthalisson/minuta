'use strict';
(function (A) {
  const { esc, h, I, fmtTime, fmtDur, longDate, menu, prompt, toast, debounce } = A;

  const STAGES = {
    light: [['transcrevendo', 'Finalizando a transcrição'], ['organizando', 'Organizando as falas'], ['lendo', 'Lendo a reunião'], ['escrevendo', 'Escrevendo a ata']],
    advanced: [['transcrevendo', 'Finalizando a transcrição'], ['separando vozes', 'Separando as vozes'], ['lendo', 'Lendo a reunião'], ['escrevendo', 'Escrevendo a ata']],
  };
  const adv = () => A.cur && A.cur.meeting.mode === 'advanced';

  // ---------------------------------------------------------------------------------------------
  async function openMeeting(root, id) {
    let data;
    try { data = await window.minuta.getMeeting(id); } catch (e) { toast(e.message, 'err'); return A.go({ view: 'home' }); }
    if (A.state.nav.id !== id) return;
    const prev = A.cur && A.cur.id === id ? A.cur : null;
    A.cur = { id, ...data, tab: prev ? prev.tab : null, live: prev ? prev.live : (A.state.liveBuffer[id] || []), chat: prev ? prev.chat : [], editing: false };
    if (!A.cur.tab) A.cur.tab = defaultTab();
    renderShell(root);
  }

  function defaultTab() {
    const m = A.cur.meeting;
    if (m.status === 'recording' || m.status === 'new') return 'notes';
    return 'ata';
  }

  function renderShell(root) {
    const C = A.cur, m = C.meeting;
    const path = m.projectId ? A.projectPath(m.projectId) : [];
    root.innerHTML = `
      <div class="toolbar drag"><div class="crumbs">${path.length ? path.map((p) => `<span>${esc(p.name)}</span>`).join('<span class="sep">›</span>') + '<span class="sep">›</span>' : '<span>Sem projeto</span><span class="sep">›</span>'}<span>${esc(m.title)}</span></div>
        <div class="spacer"></div>
        <button class="btn ghost sm" id="m-copy" title="Copiar a ata em Markdown">${I.copy}Copiar</button>
        <button class="btn ghost sm" id="m-export">${I.share}Exportar</button>
        <button class="btn ghost sm" id="m-more" aria-label="Mais opções">${I.more}</button>
      </div>
      <div class="scroll" id="m-scroll"><div class="page">
        <input class="title-in" id="m-title" value="${esc(m.title)}" aria-label="Título da reunião" maxlength="120">
        <div class="meta" id="m-meta"></div>
        <div id="m-banner"></div>
        <div class="seg" role="tablist" id="m-tabs"></div>
        <div id="m-body"></div>
      </div></div>
      <div id="m-dock"></div>`;
    const $ = (s) => root.querySelector(s);
    const title = $('#m-title');
    title.onchange = async () => { await window.minuta.updateMeeting(C.id, { title: title.value }); C.meeting.title = title.value.trim() || C.meeting.title; renderMeta(); A.refreshMeetings(); };
    title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
    $('#m-copy').onclick = async () => { try { await window.minuta.copyAta(C.id); toast('Ata copiada em Markdown'); } catch (e) { toast(e.message, 'err'); } };
    $('#m-export').onclick = (e) => menu(e.currentTarget, [
      { label: 'Ata em página HTML…', onClick: () => exp('html') }, { label: 'Ata em Markdown…', onClick: () => exp('md') }, { label: 'Transcrição em texto…', onClick: () => exp('txt') },
    ]);
    $('#m-more').onclick = (e) => A.meetingMenu(C.id, e.currentTarget);
    const sc = $('#m-scroll'); sc.onscroll = () => root.querySelector('.toolbar').classList.toggle('scrolled', sc.scrollTop > 4);
    renderMeta(); renderBanner(); renderTabs(); renderBody(); renderDock();
  }
  async function exp(fmt) { try { await window.minuta.exportMeeting(A.cur.id, fmt); } catch (e) { toast(e.message, 'err'); } }

  function renderMeta() {
    const C = A.cur, m = C.meeting, el = document.getElementById('m-meta'); if (!el) return;
    const crumb = document.querySelector('.toolbar .crumbs span:last-child'); if (crumb) crumb.textContent = m.title;
    const proj = m.projectId && A.state.projects.find((p) => p.id === m.projectId);
    const tpl = A.state.templates.find((t) => t.id === m.templateId) || A.state.templates[0];
    el.innerHTML = `<span>${esc(longDate(m.createdAt))}</span>${m.durationSec ? `<span class="sep">·</span><span>${esc(fmtDur(m.durationSec))}</span>` : ''}
      <span class="sep">·</span><button class="pick" id="m-proj">${I.folder}${proj ? esc(A.projectPath(proj.id).map((p) => p.name).join(' › ')) : 'Sem projeto'}</button>
      <button class="pick" id="m-tpl" title="Template da ata">${I.doc}${esc(tpl ? tpl.name : 'Automático')}</button>
      ${m.mode === 'advanced' ? '<span class="badge">Avançado</span>' : ''}`;
    el.querySelector('#m-proj').onclick = (e) => projectPicker(e.currentTarget, C.id, m.projectId);
    el.querySelector('#m-tpl').onclick = (e) => templatePicker(e.currentTarget);
  }

  function projectPicker(anchor, id, current) {
    menu(anchor, [
      { label: 'Sem projeto', check: !current, onClick: () => A.moveMeeting(id, null) },
      { sep: true },
      ...A.state.projects.map((p) => ({ label: A.projectPath(p.id).map((x) => x.name).join(' › '), check: current === p.id, onClick: () => A.moveMeeting(id, p.id) })),
      { sep: true },
      { label: 'Novo projeto…', onClick: async () => { const n = await prompt({ title: 'Novo projeto', ok: 'Criar' }); if (n) { const p = await window.minuta.createProject({ name: n }); await A.refreshLibrary(); await A.moveMeeting(id, p.id); } } },
    ]);
  }
  A.projectPicker = projectPicker;

  function templatePicker(anchor) {
    const C = A.cur, m = C.meeting;
    const canRegen = !!C.transcript && m.status !== 'recording' && m.status !== 'processing';
    menu(anchor, [
      { muted: canRegen ? 'Escolher template e refazer a ata' : 'Template usado na ata' },
      ...A.state.templates.map((t) => ({ label: t.name, check: m.templateId === t.id, onClick: async () => {
        await window.minuta.updateMeeting(C.id, { templateId: t.id }); m.templateId = t.id; renderMeta();
        if (canRegen) regenerate(t.id);
      } })),
      { sep: true }, { label: 'Gerenciar templates…', onClick: () => A.go({ view: 'templates' }) },
    ]);
  }

  async function regenerate(tplId) {
    try { await window.minuta.regenerate(A.cur.id, tplId || A.cur.meeting.templateId); A.cur.tab = 'ata'; renderTabs(); renderBody(); }
    catch (e) { toast(e.message, 'err'); }
  }

  function renderBanner() {
    const C = A.cur, m = C.meeting, el = document.getElementById('m-banner'); if (!el) return;
    let html = A.downloadBanner();
    if (m.status === 'error') html += `<div class="banner err"><div class="grow"><b>Não deu para terminar.</b><small>${esc(m.error || 'Erro desconhecido')}${C.transcript ? ' A transcrição está salva.' : ''}</small></div><button class="btn sm" id="b-retry">Tentar de novo</button></div>`;
    if (m.status === 'queued') html += `<div class="banner warn"><div class="grow"><b>A gravação está salva.</b><small>A transcrição e a ata começam assim que os modelos terminarem de baixar.</small></div></div>`;
    if (m.status === 'recording' && C.rec && C.rec.noMic) html += `<div class="banner err"><div class="grow"><b>Não está entrando áudio do microfone.</b><small>${esc(C.rec.noMicMsg)}</small></div><button class="btn sm" id="b-mic">Abrir permissões</button></div>`;
    if (m.status === 'recording' && C.rec && C.rec.noSys) html += `<div class="banner warn"><div class="grow"><b>Não estou ouvindo o som do computador.</b><small>${esc(C.rec.noSysMsg)}</small></div><button class="btn sm" id="b-sys">Como resolver</button><button class="btn ghost sm" id="b-sys-x">${I.x}</button></div>`;
    el.innerHTML = html;
    const r = el.querySelector('#b-retry'); if (r) r.onclick = async () => { await window.minuta.retry(C.id); };
    const s = el.querySelector('#b-sys'); if (s) s.onclick = () => window.minuta.openPrivacy('screen');
    const mc = el.querySelector('#b-mic'); if (mc) mc.onclick = () => window.minuta.openPrivacy('microphone');
    const x = el.querySelector('#b-sys-x'); if (x) x.onclick = () => { C.rec.noSys = false; renderBanner(); };
    A.bindDownloadBanner(el);
  }

  function tabs() {
    const C = A.cur, m = C.meeting;
    const t = [['ata', 'Ata'], ['notes', 'Notas'], ['transcript', 'Transcrição']];
    if (adv() && (C.transcript || m.status === 'done')) t.push(['ask', 'Perguntar']);
    return t;
  }

  function renderTabs() {
    const C = A.cur, el = document.getElementById('m-tabs'); if (!el) return;
    const n = C.transcript ? C.transcript.segments.length : C.live.length;
    el.innerHTML = tabs().map(([k, l]) => `<button role="tab" aria-selected="${C.tab === k}" class="${C.tab === k ? 'on' : ''}" data-tab="${k}">${l}${k === 'transcript' && n ? `<span class="n">${n}</span>` : ''}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { C.tab = b.dataset.tab; renderTabs(); renderBody(); }));
  }

  function renderBody() {
    const C = A.cur, el = document.getElementById('m-body'); if (!el) return;
    if (C.tab === 'notes') return renderNotes(el);
    if (C.tab === 'transcript') return renderTranscript(el);
    if (C.tab === 'ask') return renderAsk(el);
    return renderAta(el);
  }

  // ---- Ata ---------------------------------------------------------------------------------------
  function renderAta(el) {
    const C = A.cur, m = C.meeting, a = C.ata;
    if (m.status === 'processing' || (m.status === 'queued' && !a)) return renderSteps(el);
    if (!a) {
      if (m.status === 'new') { el.innerHTML = startCta('A ata aparece aqui quando a reunião terminar.'); bindStart(el); return; }
      if (m.status === 'recording') { el.innerHTML = `<div class="hint">A ata é escrita quando você encerrar a gravação. Enquanto isso, anote o que for importante na aba <b>Notas</b>: a ata parte das suas notas.</div>`; return; }
      el.innerHTML = `<div class="empty"><h2>Sem ata ainda</h2><p>${C.transcript ? 'Gere a ata a partir da transcrição.' : 'Não há transcrição para esta reunião.'}</p>${C.transcript ? '<button class="btn primary" id="a-gen">Gerar ata</button>' : ''}</div>`;
      const g = el.querySelector('#a-gen'); if (g) g.onclick = () => regenerate();
      return;
    }
    const src = (ref) => (adv() && ref != null ? `<button class="src" data-seek="${ref}" title="Ver na transcrição">${fmtTime(ref)}</button>` : '');
    const ed = C.editing ? 'contenteditable="plaintext-only" spellcheck="true"' : '';
    el.innerHTML = `<article class="ata selectable ${C.editing ? 'editing' : ''}" aria-label="Ata">
      ${a.resumo ? `<p class="summary" data-f="resumo" ${ed}>${esc(a.resumo)}</p>` : ''}
      ${a.secoes.filter((s) => s.itens.length || C.editing).map((s, si) => `<h3>${esc(s.titulo)}</h3><ul>${s.itens.map((it, ii) => `<li class="${it.seu ? 'seu' : ''}"><span data-s="${si}" data-i="${ii}" ${ed}>${esc(it.texto)}</span>${C.editing ? '' : src(it.ref)}</li>`).join('')}</ul>`).join('')}
      ${a.acoes.length ? `<h3>Ações</h3><table class="actions-tbl">${a.acoes.map((x, i) => `<tr><td style="width:22px"><span class="check"></span></td><td class="${x.seu ? '' : ''}"><span data-a="${i}" data-k="tarefa" ${ed}>${esc(x.tarefa)}</span>${C.editing ? '' : src(x.ref)}</td><td class="who"><span data-a="${i}" data-k="responsavel" ${ed}>${esc(x.responsavel)}</span></td><td class="when"><span data-a="${i}" data-k="prazo" ${ed}>${esc(x.prazo)}</span></td></tr>`).join('')}</table>` : ''}
      <div class="legend"><span><b>Texto escuro</b>: veio das suas notas</span><span><i>Texto cinza</i>: completado pela IA a partir da conversa</span></div>
      <div class="ata-foot">${C.editing ? '<button class="btn primary sm" id="a-save">Salvar alterações</button><button class="btn ghost sm" id="a-cancel">Cancelar</button>'
        : `<button class="btn sm" id="a-edit">${I.edit}Editar</button><button class="btn sm" id="a-regen">${I.sparkle}Refazer ata</button><span class="hint" style="margin:0 0 0 6px">Gerada no seu computador · ${esc((A.state.templates.find((t) => t.id === a.templateId) || {}).name || '')}</span>`}</div>
    </article>`;
    el.querySelectorAll('[data-seek]').forEach((b) => (b.onclick = () => showInTranscript(+b.dataset.seek)));
    const q = (s) => el.querySelector(s);
    if (q('#a-edit')) q('#a-edit').onclick = () => { C.editing = true; renderBody(); };
    if (q('#a-regen')) q('#a-regen').onclick = () => { if (confirm('Refazer a ata? As edições manuais desta ata serão substituídas.')) regenerate(); };
    if (q('#a-cancel')) q('#a-cancel').onclick = () => { C.editing = false; renderBody(); };
    if (q('#a-save')) q('#a-save').onclick = async () => {
      const ata = JSON.parse(JSON.stringify(a));
      const r = el.querySelector('[data-f=resumo]'); if (r) ata.resumo = r.innerText.trim();
      el.querySelectorAll('[data-s]').forEach((n) => { ata.secoes[+n.dataset.s].itens[+n.dataset.i].texto = n.innerText.trim(); });
      el.querySelectorAll('[data-a]').forEach((n) => { ata.acoes[+n.dataset.a][n.dataset.k] = n.innerText.trim(); });
      ata.secoes.forEach((s) => (s.itens = s.itens.filter((i) => i.texto)));
      ata.acoes = ata.acoes.filter((x) => x.tarefa);
      try { await window.minuta.saveAta(C.id, ata); C.ata = ata; C.editing = false; renderBody(); toast('Ata salva'); } catch (e) { toast(e.message, 'err'); }
    };
  }

  function renderSteps(el) {
    const C = A.cur, m = C.meeting;
    const st = STAGES[m.mode === 'advanced' ? 'advanced' : 'light'];
    let idx = st.findIndex(([k]) => k === m.stage); if (idx < 0) idx = m.status === 'queued' ? -1 : 0;
    el.innerHTML = `<div class="steps" role="status"><h3>${m.status === 'queued' ? 'Na fila' : 'Preparando a ata'}</h3>
      ${st.map(([k, l], i) => `<div class="step ${i < idx ? 'ok' : i === idx ? 'now' : ''}"><span>${i < idx ? I.check : i === idx ? '<span class="spin"></span>' : '<span class="dot" style="background:var(--active)"></span>'}</span><span>${l}</span><span>${i === idx && m.progress > 0 && m.progress < 1 ? Math.round(m.progress * 100) + '%' : ''}</span></div>`).join('')}
      <p class="hint" style="margin:12px 0 0">Tudo roda no seu computador. Você pode continuar usando o app.</p>
      ${m.status === 'processing' ? '<button class="btn ghost sm" id="s-cancel" style="margin-top:6px">Cancelar</button>' : ''}</div>`;
    const c = el.querySelector('#s-cancel'); if (c) c.onclick = () => window.minuta.cancel(C.id);
  }

  function startCta(msg) {
    return `<div class="empty" style="padding:40px 20px"><div class="art">${I.mic}</div><h2>Pronto para gravar</h2><p>${esc(msg)}</p>
      <button class="btn rec lg" data-start><span class="dot" style="background:#fff"></span>Gravar reunião</button>
      <p class="hint">Grava o seu microfone e o som do computador (a call). Avise os participantes.</p></div>`;
  }
  function bindStart(el) { const b = el.querySelector('[data-start]'); if (b) b.onclick = () => A.startRecording(A.cur.id); }

  // ---- Notas -------------------------------------------------------------------------------------
  function renderNotes(el) {
    const C = A.cur, m = C.meeting;
    const timed = adv() && Object.keys(m.noteTimes || {}).length > 0;
    el.innerHTML = `${m.status === 'new' ? startCta('Escreva a pauta antes, se quiser. Durante a reunião, anote só o essencial: a IA completa depois.') : ''}
      <div class="notes-wrap ${timed ? 'timed' : ''}"><div class="gutter" id="n-gut" aria-hidden="${!timed}"></div>
      <div style="position:relative"><textarea class="notes" id="n-text" placeholder="${m.status === 'recording' ? 'Anote os pontos importantes… (a ata vai partir daqui)' : 'Suas notas. Use # para tópicos e - para itens.'}" aria-label="Notas da reunião">${esc(m.notes || '')}</textarea><div class="mirror" id="n-mirror"></div></div></div>
      <p class="hint">${adv() ? 'No modo Avançado, cada linha guarda o momento em que foi escrita: clique no horário para ouvir aquele trecho.' : 'Suas notas são a base da ata.'}</p>`;
    bindStart(el);
    const ta = el.querySelector('#n-text');
    const cur = () => (A.cur && A.cur.id === C.id ? A.cur.meeting : m); // sempre o objeto atual (evita salvar notas antigas)
    const save = debounce(() => { const mm = cur(); window.minuta.updateMeeting(C.id, { notes: mm.notes, noteTimes: mm.noteTimes }); }, 500);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(360, ta.scrollHeight) + 'px'; };
    let dirty = false;
    ta.oninput = () => {
      const mm = cur(); mm.notes = ta.value; dirty = true;
      if (adv() && A.state.recordingId === C.id && A.recorder) {
        const t = Math.floor(A.recorder.seconds);
        mm.noteTimes = mm.noteTimes || {};
        for (const line of ta.value.split('\n')) { const k = line.trim(); if (k.length > 1 && mm.noteTimes[k] === undefined) mm.noteTimes[k] = Math.max(0, t - 2); }
      }
      grow(); save(); gutter();
    };
    C.flushNotes = () => { if (dirty) save.flush(); };
    requestAnimationFrame(() => { grow(); gutter(); });
    if (m.status === 'recording' || m.status === 'new') setTimeout(() => ta.focus(), 50);
    function gutter() {
      const g = el.querySelector('#n-gut'); if (!g) return;
      const wrap = el.querySelector('.notes-wrap');
      const times = cur().noteTimes || {};
      const has = adv() && Object.keys(times).length > 0;
      wrap.classList.toggle('timed', has); if (!has) { g.innerHTML = ''; return; }
      const mir = el.querySelector('#n-mirror'); mir.style.width = ta.clientWidth + 'px';
      const lines = ta.value.split('\n');
      mir.innerHTML = lines.map((l) => `<div>${esc(l) || '&nbsp;'}</div>`).join('');
      const kids = mir.children; let html = '';
      lines.forEach((l, i) => { const t = times[l.trim()]; if (t !== undefined && l.trim().length > 1) html += `<button data-seek="${t}" style="top:${kids[i].offsetTop + 3}px" title="Ouvir este momento">${fmtTime(t)}</button>`; });
      g.innerHTML = html;
      g.querySelectorAll('[data-seek]').forEach((b) => (b.onclick = () => A.seek(+b.dataset.seek, true)));
    }
  }

  // ---- Transcrição -------------------------------------------------------------------------------
  function speakerClass(name, me) {
    if (name === me) return 'spk-me';
    const n = /(\d+)$/.exec(name); return 'spk-' + ((n ? +n[1] - 1 : 0) % 6);
  }
  function renderTranscript(el, highlight) {
    const C = A.cur, m = C.meeting;
    const me = A.state.settings.userName || 'Você';
    const segs = C.transcript ? C.transcript.segments : C.live.map((s) => ({ ...s, speaker: s.track === 'mic' ? me : 'Participantes' }));
    const names = m.speakers || {};
    if (!segs.length) {
      el.innerHTML = m.status === 'recording' ? '<p class="hint">Ouvindo… as falas aparecem aqui alguns segundos depois de ditas.</p>' : m.status === 'new' ? startCta('A transcrição aparece aqui durante a gravação.') : '<p class="hint">Sem falas transcritas.</p>';
      bindStart(el); return;
    }
    const canSeek = adv() && m.hasAudio && m.status !== 'recording';
    const canRename = !!C.transcript && C.transcript.diarized;
    el.innerHTML = `<div class="selectable" id="t-list">${segs.map((s, i) => `<div class="tr-line ${C.transcript ? '' : 'live'}" data-start="${s.start}">
      ${canSeek ? `<button class="tr-time" data-seek="${s.start}" title="Ouvir daqui">${fmtTime(s.start)}</button>` : `<span class="tr-time">${fmtTime(s.start)}</span>`}
      <div>${canRename && s.speaker !== me ? `<button class="tr-who ${speakerClass(s.speaker, me)}" data-spk="${esc(s.speaker)}" title="Renomear">${esc(names[s.speaker] || s.speaker)}</button>` : `<span class="tr-who ${speakerClass(s.speaker, me)}">${esc(names[s.speaker] || s.speaker)}</span>`}
      <div class="tr-text">${esc(s.text)}</div></div></div>`).join('')}</div>
      ${canRename ? '<p class="hint">Clique no nome de um participante para dizer quem é.</p>' : ''}`;
    el.querySelectorAll('[data-seek]').forEach((b) => (b.onclick = () => A.seek(+b.dataset.seek, true)));
    el.querySelectorAll('[data-spk]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.spk; const n = await prompt({ title: `Quem é "${k}"?`, value: names[k] || '', placeholder: 'Nome da pessoa' });
      if (n === null) return;
      m.speakers = { ...names, [k]: n }; await window.minuta.updateMeeting(C.id, { speakers: m.speakers }); renderTranscript(el);
      if (C.ata) toast('Nome atualizado. Use "Refazer ata" para aplicar na ata.');
    }));
    if (highlight != null) {
      const lines = [...el.querySelectorAll('.tr-line')]; let best = lines[0];
      for (const l of lines) if (+l.dataset.start <= highlight + 0.01) best = l;
      best.classList.add('hl'); best.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => best.classList.remove('hl'), 2500);
    } else if (m.status === 'recording') { const sc = document.getElementById('m-scroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) sc.scrollTop = sc.scrollHeight; }
  }
  function showInTranscript(t) { A.cur.tab = 'transcript'; renderTabs(); renderTranscript(document.getElementById('m-body'), t); A.seek(t, false); }

  // ---- Perguntar (Avançado) ----------------------------------------------------------------------
  function renderAsk(el) {
    const C = A.cur;
    const sugg = ['Quais foram as decisões?', 'O que ficou para mim?', 'Quais prazos foram citados?'];
    el.innerHTML = `<div class="chat" id="c-list">${C.chat.length ? C.chat.map((x) => `<div class="msg ${x.role === 'user' ? 'user' : 'bot'} selectable">${esc(x.text)}</div>`).join('') : `<p class="hint">Pergunte sobre esta reunião. A resposta é gerada no seu computador a partir da transcrição.</p><div class="filters">${sugg.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}</div>
      <form class="chat-in" id="c-form"><input id="c-q" placeholder="Pergunte algo sobre a reunião" maxlength="500" aria-label="Pergunta"><button class="btn primary">Perguntar</button></form>`;
    const form = el.querySelector('#c-form'), q = el.querySelector('#c-q');
    el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { q.value = b.dataset.q; form.requestSubmit(); }));
    form.onsubmit = async (e) => {
      e.preventDefault(); const text = q.value.trim(); if (!text || C.asking) return;
      const history = C.chat.slice();
      C.chat.push({ role: 'user', text }); C.chat.push({ role: 'bot', text: '…' }); C.asking = true; renderAsk(el);
      const bot = C.chat[C.chat.length - 1]; let first = true;
      const off = window.minuta.onChatToken((id, t) => { if (id !== C.id) return; bot.text = first ? t : bot.text + t; first = false; const last = el.querySelector('.msg.bot:last-of-type'); if (last) last.textContent = bot.text; });
      try { bot.text = (await window.minuta.ask(C.id, text, history)).trim(); } catch (err) { bot.text = 'Não consegui responder: ' + err.message; }
      finally { off(); C.asking = false; if (C.tab === 'ask') renderAsk(el); }
    };
    setTimeout(() => q.focus(), 30);
  }

  // ---- Barra inferior: gravação ou player --------------------------------------------------------
  function renderDock() {
    const C = A.cur, m = C.meeting, el = document.getElementById('m-dock'); if (!el) return;
    if (A.state.recordingId === C.id) {
      const R = A.recorder;
      el.innerHTML = `<div class="dock" role="region" aria-label="Gravação">
        <span class="dot ${R && R.paused ? '' : 'pulse'}"></span><span class="time" id="d-time">${fmtTime(R ? R.seconds : 0)}</span>
        <div class="meter"><span class="lbl">Você</span><div class="bar"><i id="lv-mic" style="width:0"></i></div></div>
        <div class="meter"><span class="lbl">Computador</span><div class="bar"><i id="lv-sys" style="width:0"></i></div></div>
        <div class="spacer"></div>
        <button class="round" id="d-pause" aria-label="${R && R.paused ? 'Retomar' : 'Pausar'}" title="${R && R.paused ? 'Retomar' : 'Pausar'}">${R && R.paused ? I.play : I.pause}</button>
        <button class="btn rec" id="d-stop">${I.stop}Encerrar</button></div>`;
      el.querySelector('#d-pause').onclick = () => { A.recorder.pause(!A.recorder.paused); renderDock(); };
      el.querySelector('#d-stop').onclick = () => A.stopRecording();
      return;
    }
    if (C.audio && m.status !== 'recording') {
      if (!C.player || C.player.dataset.id !== C.id) {
        if (C.player) C.player.pause();
        C.player = new Audio(C.audio); C.player.dataset.id = C.id; C.player.preload = 'metadata';
      }
      const P = C.player;
      el.innerHTML = `<div class="dock" role="region" aria-label="Áudio da reunião">
        <button class="round" id="p-back" aria-label="Voltar 15 segundos">${I.back15}</button>
        <button class="round play" id="p-play" aria-label="Tocar">${P.paused ? I.play : I.pause}</button>
        <button class="round" id="p-fwd" aria-label="Avançar 15 segundos">${I.fwd15}</button>
        <span class="time" id="p-time">${fmtTime(P.currentTime)}</span>
        <input type="range" id="p-range" min="0" max="${m.durationSec || 1}" step="1" value="${Math.floor(P.currentTime)}" aria-label="Posição">
        <span class="time" style="color:var(--text-3)">${fmtTime(m.durationSec)}</span>
        <button class="btn ghost sm" id="p-rate" title="Velocidade">${P.playbackRate}×</button></div>`;
      const play = el.querySelector('#p-play'), time = el.querySelector('#p-time'), range = el.querySelector('#p-range');
      play.onclick = () => (P.paused ? P.play() : P.pause());
      el.querySelector('#p-back').onclick = () => { P.currentTime = Math.max(0, P.currentTime - 15); };
      el.querySelector('#p-fwd').onclick = () => { P.currentTime = Math.min(m.durationSec, P.currentTime + 15); };
      range.oninput = () => { P.currentTime = +range.value; };
      el.querySelector('#p-rate').onclick = (e) => { const r = [1, 1.25, 1.5, 2]; P.playbackRate = r[(r.indexOf(P.playbackRate) + 1) % r.length]; e.currentTarget.textContent = P.playbackRate + '×'; };
      P.onplay = P.onpause = () => { play.innerHTML = P.paused ? I.play : I.pause; play.setAttribute('aria-label', P.paused ? 'Tocar' : 'Pausar'); };
      P.ontimeupdate = () => { time.textContent = fmtTime(P.currentTime); if (document.activeElement !== range) range.value = Math.floor(P.currentTime); };
      return;
    }
    el.innerHTML = '';
  }

  A.seek = (t, play) => {
    const C = A.cur; if (!C || !C.player) return;
    C.player.currentTime = Math.max(0, t - 0.5); if (play) C.player.play();
  };

  // ---- atualizações vindas do processo principal -------------------------------------------------
  A.onMeetingChanged = async (m) => {
    const C = A.cur; if (!C || C.id !== m.id || A.state.nav.view !== 'meeting') return;
    const prevStatus = C.meeting.status;
    if (m.deleted) return A.go({ view: 'home' });
    C.meeting = { ...C.meeting, ...m, notes: C.meeting.notes, noteTimes: C.meeting.noteTimes };
    if (prevStatus !== m.status || (m.status === 'done' && !C.ata) || m.hasAudio !== !!C.audio) {
      const data = await window.minuta.getMeeting(C.id);
      Object.assign(C, { transcript: data.transcript, ata: data.ata, audio: data.audio });
      C.meeting = { ...data.meeting, notes: C.meeting.notes, noteTimes: C.meeting.noteTimes };
      if (prevStatus === 'recording' && m.status !== 'recording') { C.tab = 'ata'; C.live = []; }
      if (prevStatus === 'processing' && m.status === 'done') C.tab = 'ata';
      renderMeta(); renderBanner(); renderTabs(); if (C.tab !== 'notes') renderBody(); renderDock();
      const t = document.getElementById('m-title'); if (t && document.activeElement !== t) t.value = C.meeting.title;
    } else {
      if (C.tab === 'ata' && (m.status === 'processing' || m.status === 'queued')) renderBody();
      renderMeta();
    }
  };

  A.onLiveSegment = (id, seg) => {
    // Insere pelo horário da fala, não pela ordem em que o reconhecedor terminou.
    // Uma fala longa de outra pessoa é transcrita depois de uma fala curta sua que a interrompeu,
    // e antes isso aparecia fora de ordem na tela.
    const buf = (A.state.liveBuffer[id] = A.state.liveBuffer[id] || []);
    let i = buf.length; while (i > 0 && buf[i - 1].start > seg.start) i--;
    buf.splice(i, 0, seg);
    const C = A.cur; if (!C || C.id !== id) return;
    if (C.live !== A.state.liveBuffer[id]) C.live = A.state.liveBuffer[id];
    renderTabs(); if (C.tab === 'transcript') renderTranscript(document.getElementById('m-body'));
  };

  // ---- gravação ----------------------------------------------------------------------------------
  A.startRecording = async (id) => {
    const S = A.state;
    if (S.startingRec) return; // clique repetido enquanto o microfone abre
    if (S.recordingId) return toast('Já existe uma gravação em andamento.', 'err');
    S.startingRec = true; let R = null;
    try {
      const mic = await window.minuta.mediaAccess('microphone');
      if (mic === 'denied' || mic === 'restricted') { toast('Sem permissão para o microfone. Libere nos ajustes do sistema.', 'err'); window.minuta.openPrivacy('microphone'); return; }
      R = new A.Recorder();
      await R.open({
        micDeviceId: S.settings.micDeviceId,
        onChunk: (track, buf) => window.minuta.sendChunk(id, track, buf),
        onLevel: (track, v) => { const b = document.getElementById('lv-' + track); if (b) b.style.width = Math.min(100, Math.sqrt(v) * 140) + '%'; },
      });
      await window.minuta.startRecording(id);
      R.begin(); A.recorder = R; S.recordingId = id; S.liveBuffer[id] = [];
      if (A.cur && A.cur.id === id) { A.cur.rec = { noSys: !R.hasSys, noSysMsg: noSysMsg(R) }; A.cur.live = S.liveBuffer[id]; A.cur.meeting.status = 'recording'; A.cur.tab = 'notes'; }
      const t0 = Date.now(); let noMicWarned = false;
      A.timer = setInterval(() => {
        const t = document.getElementById('d-time'); if (t) t.textContent = fmtTime(R.seconds);
        // Nenhum bloco de áudio chegando = o gráfico de áudio não está rodando (saída de áudio desligada,
        // microfone bloqueado pelo sistema). Antes a gravação seguia muda, sem avisar.
        if (!noMicWarned && !R.seen.mic && Date.now() - t0 > 4000) {
          noMicWarned = true;
          const msg = A.state.platform === 'win32'
            ? 'O Windows não está entregando o áudio do microfone. Verifique se há uma saída de áudio ligada (fone ou caixa de som) e se o acesso ao microfone está liberado para aplicativos da área de trabalho. Em Ajustes, use "Diagnóstico de áudio".'
            : 'Nenhum áudio está chegando do microfone. Verifique as permissões e a saída de áudio. Em Ajustes, use "Diagnóstico de áudio".';
          try { window.minuta.logUi('gravação sem áudio: nenhum bloco do microfone em 4s'); } catch (_) {}
          toast('Não está entrando áudio. Veja o aviso na reunião.', 'err');
          if (A.cur && A.cur.id === id && A.cur.rec) { A.cur.rec.noMic = true; A.cur.rec.noMicMsg = msg; renderBanner(); }
        }
        if (R.seconds > 25 && R.hasSys && !R.sysHeard && A.cur && A.cur.id === id && A.cur.rec && !A.cur.rec.warned) { A.cur.rec.warned = true; A.cur.rec.noSys = true; A.cur.rec.noSysMsg = noSysMsg(R); renderBanner(); }
      }, 500);
      if (S.settings.consentReminder) toast('Gravando. Lembre-se de avisar os participantes.');
      A.renderSidebar();
      if (A.cur && A.cur.id === id) { renderBanner(); renderTabs(); renderBody(); renderDock(); } else A.go({ view: 'meeting', id });
    } catch (e) {
      console.error(e);
      if (R && S.recordingId !== id) { try { await R.close(); } catch (_) {} }
      if (!e.cancelled) toast(e.name === 'NotAllowedError' ? 'O sistema não liberou o microfone. Verifique as permissões.' : 'Não foi possível começar a gravar: ' + e.message, 'err');
    } finally { S.startingRec = false; }
  };
  function noSysMsg(R) {
    const mac = A.state.platform === 'darwin';
    if (!R.hasSys) return mac ? 'Permita "Gravação de áudio do sistema" para o Minuta em Ajustes do Sistema › Privacidade e Segurança. Enquanto isso, só o seu microfone está sendo gravado.' : 'O Windows não liberou o som do computador. Só o seu microfone está sendo gravado.';
    return 'Nenhum som do computador nos últimos segundos. Se a call já começou, confira se o som está saindo pelo dispositivo padrão.' + (mac ? ' No Mac, verifique a permissão de gravação de áudio do sistema.' : '');
  }

  A.stopRecording = async () => {
    const S = A.state, id = S.recordingId; if (!id) return;
    clearInterval(A.timer);
    if (A.cur && A.cur.id === id && A.cur.flushNotes) A.cur.flushNotes();
    const R = A.recorder;
    await new Promise((r) => setTimeout(r, 300)); // último bloco de áudio
    try { await R.close(); } catch (_) {}
    S.recordingId = null; A.recorder = null;
    try { await window.minuta.stopRecording(id); } catch (e) { toast(e.message, 'err'); }
    A.renderSidebar();
    if (A.cur && A.cur.id === id) { A.cur.rec = null; renderDock(); }
  };

  A.meetingMenu = (id, anchor, x, y) => {
    const m = A.state.allMeetings.find((q) => q.id === id) || (A.cur && A.cur.id === id ? A.cur.meeting : null);
    menu(anchor, [
      { label: 'Mover para projeto…', onClick: () => projectPicker(anchor || { getBoundingClientRect: () => ({ left: x, bottom: y, top: y }) }, id, m && m.projectId) },
      { label: 'Refazer ata', onClick: async () => { try { await window.minuta.regenerate(id); } catch (e) { toast(e.message, 'err'); } } },
      { label: 'Refazer transcrição…', onClick: async () => { try { await window.minuta.retranscribe(id); toast('Refazendo a transcrição com as configurações atuais.'); } catch (e) { toast(e.message, 'err'); } } },
      { label: 'Mostrar na pasta', onClick: () => window.minuta.reveal(id) },
      { sep: true },
      { label: 'Excluir reunião…', danger: true, onClick: async () => { try { if (await window.minuta.deleteMeeting(id)) { toast('Reunião excluída'); await A.refreshMeetings(); if (A.state.nav.id === id) A.go({ view: 'home' }); } } catch (e) { toast(e.message, 'err'); } } },
    ], { x, y });
  };

  A.openMeeting = openMeeting;
  A.renderMeetingDock = renderDock;
})(window.App);
