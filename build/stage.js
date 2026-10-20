// Monta uma pasta "stage" com o app + dependências de produção para um sistema/arquitetura alvo.
// Uso: node build/stage.js win32 x64   |   node build/stage.js darwin arm64
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [os = 'win32', cpu = 'x64'] = process.argv.slice(2);
const root = path.join(__dirname, '..');
const stage = path.join(root, 'build', `stage-${os}-${cpu}`);
const pkg = require('../package.json');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const d of ['src', 'assets']) fs.cpSync(path.join(root, d), path.join(stage, d), { recursive: true });
fs.mkdirSync(path.join(stage, 'build'));
for (const f of ['afterPack.js', 'entitlements.mac.plist', 'electron-builder.config.js']) fs.copyFileSync(path.join(__dirname, f), path.join(stage, 'build', f));
const stagePkg = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, license: pkg.license, main: pkg.main, dependencies: pkg.dependencies, devDependencies: { electron: pkg.devDependencies.electron } };
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagePkg, null, 2));

// Instala só as dependências de produção, com os binários nativos do sistema alvo (não os desta máquina)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${os}`, `--cpu=${cpu}`], { cwd: stage, stdio: 'inherit' });

// confere os binários nativos esperados
const want = os === 'linux' ? ['sherpa-onnx-linux-x64', '@node-llama-cpp/linux-x64'] : os === 'win32' ? ['sherpa-onnx-win-x64', '@node-llama-cpp/win-x64'] : cpu === 'arm64' ? ['sherpa-onnx-darwin-arm64', '@node-llama-cpp/mac-arm64-metal'] : ['sherpa-onnx-darwin-x64', '@node-llama-cpp/mac-x64'];
for (const w of want) if (!fs.existsSync(path.join(stage, 'node_modules', w))) throw new Error('faltou o binário nativo ' + w);
// remove pacotes de outras plataformas que o npm tenha trazido
const nm = path.join(stage, 'node_modules');
for (const d of fs.readdirSync(nm)) if (/^sherpa-onnx-(linux|darwin|win)/.test(d) && !want.includes(d)) fs.rmSync(path.join(nm, d), { recursive: true, force: true });
const nl = path.join(nm, '@node-llama-cpp');
if (fs.existsSync(nl)) for (const d of fs.readdirSync(nl)) {
  const keep = os === 'linux' ? ['linux-x64'] : os === 'win32' ? ['win-x64', 'win-x64-vulkan'] : cpu === 'arm64' ? ['mac-arm64-metal'] : ['mac-x64'];
  if (!keep.includes(d)) fs.rmSync(path.join(nl, d), { recursive: true, force: true });
}
console.log('stage pronto:', stage);
