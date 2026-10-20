'use strict';
/* Cliente HTTP para serviços compatíveis com a API da OpenAI (OpenAI, OpenRouter, Groq, LM Studio, Ollama…).
   Roda no processo principal e no motor — nunca na interface, para a chave não passar pelo renderer. */
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Sugestões de modelo por serviço. São só um ponto de partida: quando há chave, o app busca a lista real
// em /models e mostra ela; o que o usuário digitar também vale.
const PRESETS = {
  openai: {
    label: 'OpenAI', hint: 'ChatGPT', baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-', transcribes: true,
    suggest: {
      transcribe: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
      ata: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
      chat: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    },
  },
  openrouter: {
    label: 'OpenRouter', hint: 'vários modelos', baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-', transcribes: false,
    suggest: {
      transcribe: [],
      ata: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
      chat: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'anthropic/claude-haiku-4.5'],
    },
  },
  groq: {
    label: 'Groq', hint: 'muito rápido', baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys', keyPrefix: 'gsk_', transcribes: true,
    suggest: {
      transcribe: ['whisper-large-v3-turbo', 'whisper-large-v3'],
      ata: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      chat: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    },
  },
  xai: {
    label: 'xAI', hint: 'Grok', baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai', keyPrefix: 'xai-', transcribes: false,
    suggest: { transcribe: [], ata: ['grok-4', 'grok-3-mini'], chat: ['grok-3-mini', 'grok-4'] },
  },
  custom: {
    label: 'Outro', hint: 'API compatível', baseUrl: '', keyUrl: '', transcribes: true,
    suggest: { transcribe: [], ata: [], chat: [] },
  },
};

// Dos modelos que o serviço lista, quais servem para cada parte.
const AUDIO_RE = /whisper|transcri|speech-to-text|stt|voxtral|scribe/i;
const NOT_CHAT_RE = /embed|moderation|tts|audio|whisper|transcri|image|dall-e|rerank|guard|vision-encoder|speech/i;
function pickModels(list, feature) {
  const l = (list || []).filter(Boolean);
  if (feature === 'transcribe') return l.filter((m) => AUDIO_RE.test(m));
  return l.filter((m) => !NOT_CHAT_RE.test(m));
}

class CloudError extends Error {
  constructor(msg, { status, retryable } = {}) { super(msg); this.status = status; this.retryable = !!retryable; }
}

function friendly(status, body) {
  const detail = (() => { try { const j = JSON.parse(body); return (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) { return String(body || '').slice(0, 200); } })();
  const map = {
    401: 'A chave de API foi recusada. Confira se copiou a chave inteira e se ela ainda é válida.',
    403: 'A chave não tem permissão para este modelo.',
    404: 'O endereço ou o modelo não existe neste serviço.',
    413: 'O arquivo de áudio ficou grande demais para o serviço.',
    429: 'O serviço pediu para esperar (limite de uso ou créditos acabando).',
  };
  const base = map[status] || (status >= 500 ? 'O serviço está com problema no momento.' : `O serviço respondeu com erro ${status}.`);
  return new CloudError(detail ? `${base} (${detail})` : base, { status, retryable: status === 429 || status >= 500 });
}

// Uma requisição HTTP. `onLine` recebe cada linha de um stream SSE.
function request({ url, method = 'POST', headers = {}, body, signal, timeout = 180000, onLine }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method, headers, timeout }, (res) => {
      const chunks = [];
      let buf = '';
      res.on('data', (d) => {
        if (onLine && res.statusCode === 200) {
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(line.trim()); }
        } else chunks.push(d);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(friendly(res.statusCode, text));
        resolve(text);
      });
    });
    req.on('timeout', () => { req.destroy(new CloudError('O serviço demorou demais para responder.', { retryable: true })); });
    req.on('error', (e) => reject(e instanceof CloudError ? e : new CloudError(netMessage(e), { retryable: true })));
    if (signal) {
      if (signal.aborted) { req.destroy(); return reject(new CloudError('cancelado')); }
      signal.addEventListener('abort', () => req.destroy(new CloudError('cancelado')), { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

function netMessage(e) {
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'Não foi possível alcançar o serviço. Verifique o endereço e a conexão com a internet.';
  if (e.code === 'ECONNREFUSED') return 'O serviço recusou a conexão. Confira o endereço.';
  if (/certificate|self.signed/i.test(e.message || '')) return 'O certificado do serviço não foi aceito.';
  return e.message || 'Falha de rede.';
}

const join = (baseUrl, p) => String(baseUrl || '').replace(/\/+$/, '') + p;
const auth = (cfg) => ({ Authorization: `Bearer ${cfg.apiKey}`, ...(/openrouter/i.test(cfg.baseUrl || '') ? { 'HTTP-Referer': 'https://github.com/minuta-app', 'X-Title': 'Minuta' } : {}) });

// Tenta de novo quando o erro é temporário (limite de uso, instabilidade do serviço).
async function withRetry(fn, { tries = 3, signal, log = () => {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (signal && signal.aborted) throw e;
      if (!e.retryable || i === tries - 1) throw e;
      const wait = 1500 * Math.pow(2, i);
      log(`serviço de IA: ${e.message} — tentando de novo em ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

/** Conversa (chat completions). Com `schema`, pede JSON no formato dado. Com `onToken`, usa streaming. */
async function chat(cfg, { messages, schema, maxTokens = 1500, temperature = 0.3, onToken, signal, log }) {
  const payload = { model: cfg.model, messages, max_tokens: maxTokens, temperature };
  if (schema) payload.response_format = { type: 'json_schema', json_schema: { name: 'resposta', strict: false, schema } };
  if (onToken) payload.stream = true;

  const run = async () => {
    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...auth(cfg) };
    if (!onToken) {
      const text = await request({ url: join(cfg.baseUrl, '/chat/completions'), headers, body, signal });
      return pickContent(JSON.parse(text));
    }
    let out = '';
    await request({ url: join(cfg.baseUrl, '/chat/completions'), headers, body, signal, onLine: (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) { out += t; onToken(t); }
      } catch (_) {}
    } });
    return out;
  };
  const text = await withRetry(run, { signal, log });
  if (!String(text || '').trim()) throw new CloudError('O serviço respondeu vazio.');
  return text;
}

function pickContent(j) {
  const c = j.choices && j.choices[0];
  if (!c) throw new CloudError('Resposta do serviço em formato inesperado.');
  return (c.message && c.message.content) || c.text || '';
}

/** Transcreve um WAV. Devolve { text, segments: [{start, end, text}] } (segments pode vir vazio). */
async function transcribe(cfg, { wav, model, language, prompt, signal, log, fileName = 'audio.wav' }) {
  const boundary = '----minuta' + Math.random().toString(36).slice(2);
  const parts = [];
  const field = (name, value) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  field('model', model || cfg.transcribeModel || 'whisper-1');
  field('response_format', 'verbose_json');
  if (language && language !== 'auto') field('language', language);
  if (prompt) field('prompt', String(prompt).slice(0, 800));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/wav\r\n\r\n`));
  parts.push(wav, Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const text = await withRetry(() => request({
    url: join(cfg.baseUrl, '/audio/transcriptions'),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, ...auth(cfg) },
    body, signal, timeout: 600000,
  }), { signal, log });

  let j; try { j = JSON.parse(text); } catch (_) { return { text: String(text).trim(), segments: [] }; }
  const segments = (j.segments || []).map((s) => ({ start: +(+s.start).toFixed(2), end: +(+s.end).toFixed(2), text: String(s.text || '').trim() })).filter((s) => s.text);
  return { text: String(j.text || '').trim(), segments };
}

/** Lista os modelos do serviço (para o seletor em Ajustes). */
async function models(cfg, { signal } = {}) {
  const text = await request({ url: join(cfg.baseUrl, '/models'), method: 'GET', headers: auth(cfg), signal, timeout: 30000 });
  const j = JSON.parse(text);
  const list = (j.data || j.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return [...new Set(list)].sort();
}

module.exports = { PRESETS, pickModels, CloudError, chat, transcribe, models, withRetry, request, join };
