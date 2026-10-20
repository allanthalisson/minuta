// Testa o download real dos modelos hospedados no GitHub (VAD + vozes) e a extração .tar.bz2 com retomada.
const fs = require('fs'), os = require('os'), path = require('path');
const M = require('../src/main/models');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minuta-dl-'));
  let last = null;
  const d = new M.Downloader({ dir, onProgress: (s) => (last = s), log: console.log });
  for (const k of ['vad', 'spk']) await d.downloadOne(k, M.CATALOG[k], () => {});
  console.log('vad', fs.statSync(path.join(dir, 'silero_vad.onnx')).size === M.CATALOG.vad.size ? 'ok' : 'tamanho errado');
  console.log('spk', fs.statSync(path.join(dir, 'speaker-3dspeaker.onnx')).size === 39593761 ? 'ok' : 'tamanho errado');
  // extração tar.bz2 + retomada (simula um .part interrompido)
  const fake = { label: 'teste tar.bz2', dir: 'seg', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2', size: 6958444, archive: 'tar.bz2', keep: ['model.int8.onnx', 'LICENSE'] };
  const part = path.join(dir, 'x.download.part');
  const res = await fetch(fake.url, { headers: { Range: 'bytes=0-999999' } });
  fs.writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  console.log('parcial', fs.statSync(part).size);
  await d.downloadOne('x', fake, () => {});
  console.log('extraído', fs.readdirSync(path.join(dir, 'seg')).join(','), fs.existsSync(part) ? '(.part ficou!)' : '(.part removido)');
  console.log('status light', JSON.stringify(M.status(dir, 'light').items.map((i) => [i.key, i.installed])));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
