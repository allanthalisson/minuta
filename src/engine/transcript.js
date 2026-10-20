'use strict';
// Funções puras: eco, agrupamento de vozes, montagem da transcrição, ligação com notas/fontes.

const STOP = new Set('a o as os de da do das dos e é em um uma uns umas que para por com no na nos nas se ao à é foi vai eu ele ela eles elas isso esse essa este esta the of and to in is it we you i'.split(' '));

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function words(s) { return norm(s).split(' ').filter((w) => w && !STOP.has(w)); }

// fração das palavras de `a` que aparecem em `b`
function containment(a, b) {
  const wa = words(a); if (!wa.length) return 0;
  const sb = new Set(words(b));
  let hit = 0; for (const w of wa) if (sb.has(w)) hit++;
  return hit / wa.length;
}

// Um trecho do microfone é eco se repete (no mesmo horário) o que veio do som do computador.
function isEcho(micSeg, sysSegs) {
  const mw = words(micSeg.text);
  if (mw.length < 3) {
    // trechos curtos: eco só se forem idênticos a algo dito no mesmo instante
    return sysSegs.some((s) => overlaps(micSeg, s, 1.0) && norm(s.text).includes(norm(micSeg.text)) && norm(micSeg.text).length > 0);
  }
  for (const s of sysSegs) {
    if (!overlaps(micSeg, s, 1.5)) continue;
    if (containment(micSeg.text, s.text) >= 0.6) return true;
  }
  return false;
}
function overlaps(a, b, slack = 0) { return a.start < b.end + slack && b.start < a.end + slack; }

function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x * y) || 1);
}

// Agrupamento aglomerativo (ligação média) por similaridade de cosseno.
// items: [{emb: Float32Array|number[] | null, start}] → retorna array de rótulos (0..k-1) na ordem de primeira aparição.
function clusterSpeakers(items, threshold = 0.45) {
  const idx = items.map((it, i) => (it.emb && it.emb.length ? i : -1)).filter((i) => i >= 0);
  let clusters = idx.map((i) => [i]);
  const sim = new Map();
  const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const s = (i, j) => { const k = key(i, j); if (!sim.has(k)) sim.set(k, cosine(items[i].emb, items[j].emb)); return sim.get(k); };
  const link = (A, B) => { let t = 0; for (const i of A) for (const j of B) t += s(i, j); return t / (A.length * B.length); };
  while (clusters.length > 1) {
    let best = -2, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const l = link(clusters[i], clusters[j]); if (l > best) { best = l; bi = i; bj = j; }
    }
    if (best < threshold) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]); clusters.splice(bj, 1);
  }
  const label = new Array(items.length).fill(-1);
  clusters.forEach((c, k) => c.forEach((i) => { label[i] = k; }));
  // itens sem embedding (falas curtas): herdam o rótulo do vizinho mais próximo no tempo
  for (let i = 0; i < items.length; i++) {
    if (label[i] >= 0) continue;
    let bestD = Infinity, bestL = -1;
    for (let j = 0; j < items.length; j++) if (label[j] >= 0) { const d = Math.abs(items[j].start - items[i].start); if (d < bestD) { bestD = d; bestL = label[j]; } }
    label[i] = bestL >= 0 ? bestL : 0;
  }
  // renumera na ordem em que cada voz aparece
  const order = new Map(); let n = 0;
  const byTime = items.map((it, i) => i).sort((a, b) => items[a].start - items[b].start);
  for (const i of byTime) if (!order.has(label[i])) order.set(label[i], n++);
  return label.map((l) => order.get(l));
}

// mic: falas do usuário; sys: falas do computador (participantes). Retorna segmentos ordenados.
function buildTranscript(micSegs, sysSegs, { userName = 'Você', diarize = false, threshold = 0.45 } = {}) {
  const sys = sysSegs.filter((s) => s.text && s.text.trim());
  const mic = micSegs.filter((s) => s.text && s.text.trim() && !isEcho(s, sys));
  let labels = null;
  if (diarize && sys.length) labels = clusterSpeakers(sys, threshold);
  const out = [];
  for (const s of mic) out.push({ start: s.start, end: s.end, speaker: userName, track: 'mic', text: s.text.trim() });
  sys.forEach((s, i) => out.push({ start: s.start, end: s.end, speaker: labels ? `Participante ${labels[i] + 1}` : 'Participantes', track: 'sys', text: s.text.trim() }));
  out.sort((a, b) => a.start - b.start || a.end - b.end || (a.track < b.track ? -1 : 1));
  return out;
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function transcriptToText(segs, names = {}) {
  return segs.map((s) => `[${fmtTime(s.start)}] ${names[s.speaker] || s.speaker}: ${s.text}`).join('\n');
}

// Encontra a fala da transcrição que melhor sustenta um item da ata (para o botão "fonte").
function findSource(text, segs) {
  let best = null, bestScore = 0;
  const w = words(text); if (w.length < 2) return null;
  for (const s of segs) {
    const sc = containment(text, s.text) * Math.min(1, words(s.text).length / 4);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return bestScore >= 0.3 ? best.start : null;
}

// Item da ata "veio das suas notas"?
function fromNotes(text, noteLines) {
  for (const n of noteLines) { if (words(n).length && containment(n, text) >= 0.5) return true; }
  return false;
}

function noteLinesOf(notes) {
  return String(notes || '').split('\n').map((l) => l.replace(/^\s*([-*•]|#+|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 1);
}

module.exports = { norm, words, containment, isEcho, cosine, clusterSpeakers, buildTranscript, fmtTime, transcriptToText, findSource, fromNotes, noteLinesOf };
