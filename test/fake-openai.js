// Servidor falso compatível com a API da OpenAI, para testar a integração sem chamar um serviço de verdade.
// Uso: const srv = await start({ port: 0 }); srv.url → http://127.0.0.1:PORT/v1
const http = require('http');

const KEY = 'sk-teste-1234567890';

// Monta um objeto que obedece ao schema pedido, com um texto marcador para o teste reconhecer.
function fromSchema(schema, mark) {
  const t = schema.type || (schema.properties ? 'object' : 'string');
  if (t === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(schema.properties || {})) o[k] = fromSchema(v, mark);
    return o;
  }
  if (t === 'array') return [fromSchema(schema.items || { type: 'string' }, mark)];
  if (t === 'number' || t === 'integer') return 1;
  if (t === 'boolean') return true;
  return mark;
}

function readBody(req) {
  return new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
}

function start({ port = 0, mark = 'VEIO-DO-SERVICO', fail = null } = {}) {
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const auth = req.headers.authorization || '';
    calls.push({ url: req.url, method: req.method, auth, bytes: body.length });
    const json = (code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }); res.end(s); };

    if (!auth.startsWith('Bearer ') || auth.slice(7) !== srv.key) return json(401, { error: { message: 'chave inválida' } });
    if (srv.fail) return json(srv.fail, { error: { message: 'falha simulada' } });

    if (req.url.endsWith('/models')) return json(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'whisper-1' }, { id: 'modelo-de-teste' }] });

    if (req.url.endsWith('/audio/transcriptions')) {
      const text = body.toString('latin1');
      const model = (/name="model"\r\n\r\n([^\r]*)/.exec(text) || [])[1] || '';
      srv.lastTranscribe = { model, bytes: body.length, language: (/name="language"\r\n\r\n([^\r]*)/.exec(text) || [])[1] };
      return json(200, {
        text: `${mark} transcrição`,
        segments: [
          { start: 0.5, end: 3.0, text: `${mark} primeira fala` },
          { start: 4.0, end: 7.5, text: `${mark} segunda fala` },
        ],
      });
    }

    if (req.url.endsWith('/chat/completions')) {
      let p = {}; try { p = JSON.parse(body.toString('utf8')); } catch (_) {}
      srv.lastChat = { model: p.model, stream: !!p.stream, hasSchema: !!p.response_format };
      const schema = p.response_format && p.response_format.json_schema && p.response_format.json_schema.schema;
      const content = schema ? JSON.stringify(fromSchema(schema, mark)) : `${mark} resposta`;
      if (!p.stream) return json(200, { choices: [{ message: { role: 'assistant', content } }] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const piece of content.match(/[\s\S]{1,12}/g) || []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    json(404, { error: { message: 'rota desconhecida' } });
  });
  srv.key = KEY; srv.fail = fail; srv.calls = calls;
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => {
    srv.url = `http://127.0.0.1:${srv.address().port}/v1`;
    resolve(srv);
  }));
}

module.exports = { start, KEY };
