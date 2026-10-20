import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const { getLlama } = await import('node-llama-cpp');
const { Engine } = require('../src/engine/core.js');
const { BUILTIN_TEMPLATES } = require('../src/shared/templates.js');
const fs = require('fs');
const dir = process.argv[2];
const tr = JSON.parse(fs.readFileSync(dir + '/transcript.json', 'utf8'));
const eng = new Engine({ modelsDir: '/tmp/mud/models', log: console.log, getLlama, llmOverride: process.env.LLM || null });
const t0 = Date.now();
const ata = await eng.ata({ segs: tr.segments, names: {}, notes: '# Lançamento\n- nova data\n- jurídico: termos de uso', template: BUILTIN_TEMPLATES[0], mode: process.argv[3] || 'light', lang: 'auto', withRefs: true,
  meta: { title: '', date: '20/10/2026', userName: 'Allan' }, progress: (s, f) => process.stdout.write(`\r${s} ${(f * 100).toFixed(0)}%   `) });
console.log('\nms', Date.now() - t0); console.log(JSON.stringify(ata, null, 1).slice(0, 1500));
process.exit(0);
