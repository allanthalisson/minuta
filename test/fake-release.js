// Servidor falso de releases para testar a atualização sem publicar nada.
// Serve o latest*.yml que o electron-updater procura e o "instalador" correspondente.
const http = require('http');
const crypto = require('crypto');

function start({ port = 0, version = '9.9.9', notes = 'Correções no áudio e na ata.' } = {}) {
  const file = `Minuta-Setup-${version}-x64.exe`;
  const body = Buffer.from('instalador de mentira ' + version);
  const sha512 = crypto.createHash('sha512').update(body).digest('base64');
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${body.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    `releaseNotes: "${notes.replace(/"/g, '\\"')}"`,
  ].join('\n');

  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    srv.hits.push(url);
    if (/\/latest(-mac|-linux)?\.yml$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'text/yaml', 'Content-Length': Buffer.byteLength(srv.yml) });
      return res.end(srv.yml);
    }
    if (url.endsWith(file)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404); res.end('não encontrado');
  });
  srv.yml = yml; srv.hits = []; srv.version = version;
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => {
    srv.url = `http://127.0.0.1:${srv.address().port}/`;
    resolve(srv);
  }));
}

module.exports = { start };
