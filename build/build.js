// Gera os instaladores a partir de uma pasta stage.
// Uso: node build/build.js win32 x64   (gera dist/Minuta-Setup-<v>-x64.exe — funciona no Linux, sem Wine)
//      node build/build.js darwin arm64 (no macOS gera .dmg; no Linux gera só o .zip do app)
const path = require('path');
const fs = require('fs');
const [os = 'win32', cpu = 'x64'] = process.argv.slice(2);
const stage = path.join(__dirname, `stage-${os}-${cpu}`);
if (!fs.existsSync(stage)) throw new Error(`rode antes: node build/stage.js ${os} ${cpu}`);

// O electron-builder gera o desinstalador do NSIS rodando o instalador (precisa de Wine fora do Windows).
// Ele já tem um leitor em JavaScript que extrai o desinstalador sem executar nada (usado no macOS); usamos o mesmo aqui.
if (process.platform !== 'win32') {
  const mv = require('app-builder-lib/out/util/macosVersion');
  const orig = mv.isMacOsCatalina;
  mv.isMacOsCatalina = () => true;
  if (process.platform === 'darwin') mv.isMacOsCatalina = orig;
}

const builder = require('electron-builder');
const config = require(path.join(stage, 'build', 'electron-builder.config.js'));
config.afterPack = require('./afterPack.js').default;
// Mantém o provedor do GitHub na configuração: é o que faz o electron-builder gerar o latest.yml
// (sem ele o app não tem como descobrir que existe versão nova). Publicar continua sendo manual.
config.publish = [{ provider: 'github', owner: 'allanthalisson', repo: 'minuta', releaseType: 'release' }];
if (os === 'darwin' && process.platform !== 'darwin') {
  // sem macOS: dá para gerar o .zip do app (sem .dmg e sem assinatura Apple)
  config.mac.target = [{ target: 'zip', arch: [cpu] }];
  config.mac.hardenedRuntime = false;
  config.mac.identity = null;
}
// sem certificado da Apple: assinatura ad-hoc (o app roda; o macOS pede "Abrir mesmo assim" na primeira vez)
if (os === 'darwin' && process.platform === 'darwin' && !process.env.CSC_LINK && !process.env.CSC_NAME) config.mac.identity = '-';

const targets = os === 'win32' ? builder.Platform.WINDOWS.createTarget(['nsis'], builder.Arch[cpu])
  : os === 'darwin' ? builder.Platform.MAC.createTarget(config.mac.target.map((t) => t.target), builder.Arch[cpu])
  : builder.Platform.LINUX.createTarget(['dir'], builder.Arch[cpu]);
if (os === 'darwin') config.mac.target = config.mac.target.map((t) => ({ ...t, arch: [cpu] }));

builder.build({ projectDir: stage, targets, config, publish: 'never' })
  .then((files) => { console.log('\nGerado:'); for (const f of files) if (!/\.blockmap$|\.7z$|\.yml$/.test(f)) console.log('  ' + f + '  (' + Math.round(fs.statSync(f).size / 1e6) + ' MB)'); })
  .catch((e) => { console.error(e); process.exit(1); });
