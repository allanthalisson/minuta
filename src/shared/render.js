'use strict';
// Exporta a ata em Markdown / HTML / texto (tudo escapado).
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function dateBR(iso) { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }); } catch (_) { return iso; } }

function toMarkdown(meeting, ata, segs = [], names = {}) {
  const L = [`# ${ata.titulo || meeting.title}`, '', `*${dateBR(meeting.createdAt)} · ${fmt(meeting.durationSec)}*`, ''];
  if (ata.resumo) L.push(ata.resumo, '');
  for (const s of ata.secoes || []) { if (!s.itens.length) continue; L.push(`## ${s.titulo}`, ...s.itens.map((i) => `- ${i.texto}`), ''); }
  if ((ata.acoes || []).length) { L.push('## Ações', ...ata.acoes.map((a) => `- [ ] ${a.tarefa} — **${a.responsavel}**${a.prazo && a.prazo !== '—' ? ` (prazo: ${a.prazo})` : ''}`), ''); }
  if (segs.length) { L.push('## Transcrição', '', ...segs.map((s) => `**[${fmt(s.start)}] ${names[s.speaker] || s.speaker}:** ${s.text}  `)); }
  return L.join('\n');
}

function toText(segs, names = {}) { return segs.map((s) => `[${fmt(s.start)}] ${names[s.speaker] || s.speaker}: ${s.text}`).join('\n'); }

function toHtml(meeting, ata, segs = [], names = {}) {
  const sec = (ata.secoes || []).filter((s) => s.itens.length).map((s) => `<h2>${esc(s.titulo)}</h2><ul>${s.itens.map((i) => `<li class="${i.seu ? 'seu' : ''}">${esc(i.texto)}</li>`).join('')}</ul>`).join('');
  const acoes = (ata.acoes || []).length ? `<h2>Ações</h2><table><tr><th>Tarefa</th><th>Responsável</th><th>Prazo</th></tr>${ata.acoes.map((a) => `<tr><td>${esc(a.tarefa)}</td><td>${esc(a.responsavel)}</td><td>${esc(a.prazo)}</td></tr>`).join('')}</table>` : '';
  const tr = segs.length ? `<details><summary>Transcrição</summary>${segs.map((s) => `<p><b>[${fmt(s.start)}] ${esc(names[s.speaker] || s.speaker)}:</b> ${esc(s.text)}</p>`).join('')}</details>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ata.titulo || meeting.title)}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1d1d1f;background:#fff}
h1{font-size:28px;margin:0 0 4px}.meta{color:#6e6e73;margin:0 0 24px}h2{font-size:18px;margin:28px 0 8px}li{margin:4px 0;color:#55555a}li.seu{color:#1d1d1f;font-weight:500}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e5ea;vertical-align:top}th{font-size:13px;color:#6e6e73}
details{margin-top:32px}summary{cursor:pointer;font-weight:600}details p{margin:6px 0;color:#3a3a3c}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#f2f2f7}li{color:#aeaeb2}li.seu{color:#f2f2f7}th,td{border-color:#38383a}.meta{color:#98989d}details p{color:#d1d1d6}}</style></head>
<body><h1>${esc(ata.titulo || meeting.title)}</h1><p class="meta">${esc(dateBR(meeting.createdAt))} · ${fmt(meeting.durationSec)}</p>${ata.resumo ? `<p>${esc(ata.resumo)}</p>` : ''}${sec}${acoes}${tr}</body></html>`;
}

module.exports = { toMarkdown, toHtml, toText, fmt, esc };
