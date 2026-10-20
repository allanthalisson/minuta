// Depois de empacotar: grava ícone e informações de versão no Minuta.exe (sem Wine), e ajusta permissões no Mac.
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const pe = R.NtExecutable.from(data, { ignoreCert: true });
  const res = R.NtExecutableResource.from(pe);
  const iconFile = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const ids = groups.length ? groups.map((g) => g.id) : [1];
  for (const id of ids) {
    R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, groups.length ? groups.find((g) => g.id === id).lang : 1033, iconFile.icons.map((i) => i.data));
  }
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0, 1033); vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Minuta', ProductName: 'Minuta', CompanyName: 'Minuta', LegalCopyright: 'Minuta', OriginalFilename: 'Minuta.exe', InternalName: 'Minuta' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • ícone e versão gravados em', path.basename(exe));
};
