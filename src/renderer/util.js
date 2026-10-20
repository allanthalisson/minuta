'use strict';
/* Utilidades da interface (sem dependências). */
window.App = window.App || {};
(function (A) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }
  function fmtDur(sec) {
    sec = Math.round(sec || 0); if (sec < 60) return sec ? `${sec}s` : '';
    const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  }
  const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayGroup(iso) {
    const d = new Date(iso), today = startOfDay(new Date()), dd = startOfDay(d);
    const diff = Math.round((today - dd) / 864e5);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Ontem';
    if (diff < 7) return 'Últimos 7 dias';
    if (d.getFullYear() === today.getFullYear()) return MONTHS[d.getMonth()][0].toUpperCase() + MONTHS[d.getMonth()].slice(1);
    return `${MONTHS[d.getMonth()][0].toUpperCase() + MONTHS[d.getMonth()].slice(1)} de ${d.getFullYear()}`;
  }
  function shortDate(iso) {
    const d = new Date(iso), now = new Date(), p = (n) => String(n).padStart(2, '0');
    const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const g = dayGroup(iso);
    if (g === 'Hoje' || g === 'Ontem') return time;
    if (g === 'Últimos 7 dias') return `${WD[d.getDay()]} ${time}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
  }
  function longDate(iso) {
    const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
    return `${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; };
  const GB = (b) => (b / 1e9 >= 1 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB');

  function toast(msg, kind) {
    const box = document.getElementById('toast');
    const t = h(`<div class="t ${kind === 'err' ? 'err' : ''}">${esc(msg)}</div>`);
    box.appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000);
  }

  // Menu pop-over ancorado num elemento. items: [{label, onClick, danger, sep, muted, icon}]
  let openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', popKey, true); } }
  function outside(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
  function popKey(e) {
    if (!openPop) return;
    const items = $$('button', openPop); const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closePop(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { (items[i + 1] || items[0]).focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { (items[i - 1] || items[items.length - 1]).focus(); e.preventDefault(); }
  }
  function menu(anchor, items, { x, y } = {}) {
    closePop();
    const pop = h('<div class="pop" role="menu"></div>');
    for (const it of items) {
      if (it.sep) { pop.appendChild(h('<hr>')); continue; }
      if (it.muted) { pop.appendChild(h(`<div class="muted">${esc(it.muted)}</div>`)); continue; }
      const b = h(`<button role="menuitem" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span>${it.check ? '<span style="margin-left:auto">✓</span>' : ''}</button>`);
      b.addEventListener('click', () => { closePop(); it.onClick && it.onClick(); });
      pop.appendChild(b);
    }
    openPopup(pop, anchor, { x, y });
    setTimeout(() => { const f = $('button', pop); f && f.focus(); });
    return pop;
  }

  // Coloca um popover ancorado num elemento (ou numa posição) e cuida de fechar ao clicar fora.
  function openPopup(pop, anchor, { x, y } = {}) {
    if (openPop !== pop) closePop();
    document.body.appendChild(pop); openPop = pop;
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, bottom: y, top: y };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left), innerWidth - pw - 8), top = r.bottom + 4;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', popKey, true); });
    return pop;
  }

  function prompt({ title, value = '', placeholder = '', ok = 'Salvar' }) {
    return new Promise((resolve) => {
      const bg = h(`<div class="modal-bg"><form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>
        <input value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80"><div class="row-btns"><button type="button" class="btn ghost" data-c>Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form></div>`);
      const done = (v) => { bg.remove(); resolve(v); };
      bg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(bg.querySelector('input').value.trim() || null); });
      bg.querySelector('[data-c]').addEventListener('click', () => done(null));
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(null); });
      bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
      document.body.appendChild(bg); const i = bg.querySelector('input'); i.focus(); i.select();
    });
  }

  // Ícones (traço simples, 16px)
  const ic = (d, size = 16, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const I = {
    search: ic('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>', 14),
    home: ic('<path d="M2.5 7 8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z"/>'),
    inbox: ic('<path d="M2 9h3.5l1 2h3l1-2H14"/><path d="M3.5 3.5h9L14 9v4H2V9z"/>'),
    folder: ic('<path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"/>'),
    plus: ic('<path d="M8 3v10M3 8h10"/>'),
    chev: ic('<path d="M6 4l4 4-4 4"/>', 12),
    doc: ic('<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3M6 8h4M6 10.5h4"/>'),
    gear: ic('<circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
    mic: ic('<rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>'),
    speaker: ic('<path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/>'),
    more: ic('<circle cx="3.5" cy="8" r=".8" fill="currentColor"/><circle cx="8" cy="8" r=".8" fill="currentColor"/><circle cx="12.5" cy="8" r=".8" fill="currentColor"/>'),
    play: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>',
    pause: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor"/></svg>',
    stop: '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    back15: ic('<path d="M3 8a5 5 0 1 0 1.5-3.5"/><path d="M3 2.5v2.5h2.5"/>'),
    fwd15: ic('<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5v2.5h-2.5"/>'),
    copy: ic('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5c0-.6.4-1 1-1h6.5"/>'),
    share: ic('<path d="M8 2v8M5 4.5 8 1.5l3 3"/><path d="M3.5 7.5v6h9v-6"/>'),
    sparkle: ic('<path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z"/>'),
    shield: ic('<path d="M8 1.8 13 3.5v4c0 3.2-2.2 5.5-5 6.7-2.8-1.2-5-3.5-5-6.7v-4z"/><path d="M5.8 8 7.4 9.5 10.4 6.4"/>'),
    bolt: ic('<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>'),
    users: ic('<circle cx="6" cy="5.5" r="2.2"/><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5"/><circle cx="11.2" cy="6" r="1.8"/><path d="M11 9.6c1.6.1 2.7 1.2 3 3.1"/>'),
    clock: ic('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>'),
    edit: ic('<path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/>'),
    trash: ic('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>'),
    check: ic('<path d="M3 8.5 6.5 12 13 4.5"/>'),
    ask: ic('<path d="M2.5 3.5h11v7H8l-3 2.5v-2.5H2.5z"/>'),
    x: ic('<path d="M4 4l8 8M12 4l-8 8"/>', 12),
    logo: '<svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 21V11l5 6 5-6v10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13v6M25 10.5v11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  };

  Object.assign(A, { esc, $, $$, h, fmtTime, fmtDur, dayGroup, shortDate, longDate, debounce, toast, menu, openPopup, closePop, prompt, I, GB, MONTHS });
})(window.App);
