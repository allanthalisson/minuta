// Gera o latest-mac.yml a partir dos .zip que realmente publicamos.
// Uso: node build/make-latest-mac.js [pasta]  (padrão: dist/)
// O electron-builder gera um para o zip dele, mas nós reempacotamos o .app (para preservar os links
// simbólicos da assinatura), então o hash dele não serviria.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dist = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'dist');
const version = require('../package.json').version;
// aceita os dois nomes: o do electron-builder (Minuta-1.0.0-arm64.zip) e o nosso (Minuta-1.0.0-mac-arm64.zip)
const files = fs.readdirSync(dist).filter((f) => /^Minuta-.*(arm64|x64)\.zip$/.test(f)).sort();
if (!files.length) { console.error('nenhum .zip de Mac em dist/'); process.exit(1); }
const entry = (f) => {
  const b = fs.readFileSync(path.join(dist, f));
  return `  - url: ${f}\n    sha512: ${crypto.createHash('sha512').update(b).digest('base64')}\n    size: ${b.length}`;
};
const first = files.find((f) => f.includes('arm64')) || files[0];
const body = fs.readFileSync(path.join(dist, first));
const yml = [
  `version: ${version}`,
  'files:',
  ...files.map(entry),
  `path: ${first}`,
  `sha512: ${crypto.createHash('sha512').update(body).digest('base64')}`,
  `releaseDate: '${new Date().toISOString()}'`,
  '',
].join('\n');
fs.writeFileSync(path.join(dist, 'latest-mac.yml'), yml);
console.log('latest-mac.yml gerado para', files.join(', '));
