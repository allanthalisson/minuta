// Teste de ponta a ponta da interface + motor (Electron real, Linux/xvfb).
// Uso: xvfb-run -a node test/e2e.js
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
const so = require('sherpa-onnx-node');
const fake = require('./fake-openai');
const fakeRelease = require('./fake-release');
const UD = process.env.UD || '/tmp/mud';
const SHOTS = path.join(__dirname, 'shots');
const pcm = (f) => { const w = so.readWave(path.join(__dirname, 'fixtures', f)); const a = new Int16Array(w.samples.length); for (let i = 0; i < a.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(w.samples[i] * 32767))); return Array.from(a); };
let ok = 0, fail = 0;
// Espera até a condição valer (ou estourar o tempo) — evita ler o estado anterior ao job.
const until = async (win, fn, arg, timeout = 180000) => { try { await win.waitForFunction(fn, arg, { timeout, polling: 500 }); return true; } catch (_) { return false; } };
const check = (c, msg) => { if (c) { ok++; console.log('  ok  ' + msg); } else { fail++; console.log('  FALHA  ' + msg); } };

(async () => {
  try { fs.writeFileSync(path.join(UD, 'minuta.log'), ''); } catch (_) {} // o log desta execução começa limpo
  const app = await _electron.launch({
    executablePath: process.env.PACKAGED || require('electron'), args: [...(process.env.PACKAGED ? [] : [path.join(__dirname, '..')]), '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, MINUTA_USER_DATA: UD, HOME: UD + '/home' },
  });
  const win = await app.firstWindow();
  win.on('console', (m) => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
  win.on('pageerror', (e) => { fail++; console.log('[pageerror]', e.message); });
  await win.setViewportSize({ width: 1180, height: 780 });
  const shot = async (n) => { await win.waitForTimeout(250); await win.screenshot({ path: path.join(SHOTS, n + '.png') }); };

  // Onboarding
  await win.waitForSelector('.onb', { timeout: 15000 });
  await shot('01-onboarding-boas-vindas'); check(true, 'onboarding aparece na primeira abertura');
  await win.click('#o-next'); await win.waitForSelector('[data-mode=advanced]');
  await win.click('[data-mode=advanced]'); await shot('02-onboarding-modo');
  await win.click('#o-next'); await win.waitForSelector('#o-test');
  // Regressão: clicar várias vezes em "Começar teste" enquanto o microfone ainda abre (no Windows demora) não pode gerar erro
  await win.evaluate(() => {
    window.__errs = [];
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { const t = n.textContent || ''; if (/Não foi possível|bloqueado|não liberou/.test(t)) window.__errs.push(t); }))).observe(document.body, { childList: true, subtree: true });
    const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__gum = g;
    navigator.mediaDevices.getUserMedia = async (c) => { await new Promise((r) => setTimeout(r, 1200)); return g(c); };
  });
  for (let i = 0; i < 3; i++) { await win.evaluate(() => document.getElementById('o-test').click()); await win.waitForTimeout(350); }
  await win.waitForTimeout(3000);
  check((await win.evaluate(() => window.__errs)).length === 0, 'cliques repetidos no teste com microfone lento não geram erro');
  check(/funcionando/.test(await win.textContent('#o-mic-st')), 'o teste funciona depois dos cliques repetidos');
  await win.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__gum; });
  await win.click('#o-back'); await win.waitForSelector('[data-mode=advanced]'); await win.click('#o-next'); await win.waitForSelector('#o-test'); // tela de áudio "limpa"
  await win.click('#o-test'); await win.waitForTimeout(1500); await shot('03-onboarding-audio');
  const micOk = await win.textContent('#o-mic-st'); check(/funcionando/.test(micOk), 'teste de microfone mostra sinal (dispositivo falso): ' + micOk);
  await win.click('#o-next'); await win.waitForSelector('#o-name');
  await win.evaluate(() => window.minuta.saveSettings({ keepTracks: true }));
  await win.fill('#o-name', 'Allan'); await shot('04-onboarding-final');
  await win.click('#o-next'); await win.waitForSelector('.onb', { state: 'detached' });
  await win.waitForSelector('.empty'); await shot('05-inicio-vazio'); check(true, 'onboarding conclui e mostra a tela inicial');

  // Projetos
  await win.evaluate(async () => { const p = await window.minuta.createProject({ name: 'Cliente Acme' }); await window.minuta.createProject({ name: 'Onboarding', parentId: p.id }); await window.minuta.createProject({ name: 'Interno' }); await App.refreshLibrary(); App.state.expanded.add(p.id); App.renderSidebar(); });
  check((await win.$$('[data-project]')).length === 3, 'projetos e subprojeto aparecem na barra lateral');

  // Reunião: grava via IPC com as faixas sintéticas (o motor real transcreve ao vivo)
  const mic = pcm('mic.wav'), sys = pcm('sys.wav');
  const pid = await win.evaluate(() => App.state.projects.find((p) => p.name === 'Onboarding').id);
  const id = await win.evaluate(async (pid) => { const { meeting } = await window.minuta.createMeeting({ projectId: pid }); await App.refreshMeetings(); App.go({ view: 'meeting', id: meeting.id }); return meeting.id; }, pid);
  await win.waitForSelector('#n-text'); await shot('06-reuniao-nova');
  await win.evaluate(async ({ id, mic, sys }) => {
    await window.minuta.startRecording(id);
    App.state.recordingId = id; App.recorder = { seconds: 0, paused: false, pause() {} }; App.cur.rec = {}; App.cur.meeting.status = 'recording';
    const CH = 4096;
    for (let i = 0; i < mic.length; i += CH) {
      window.minuta.sendChunk(id, 'mic', new Int16Array(mic.slice(i, i + CH)).buffer);
      window.minuta.sendChunk(id, 'sys', new Int16Array(sys.slice(i, i + CH)).buffer);
      App.recorder.seconds = i / 16000;
      if (i % (CH * 8) === 0) await new Promise((r) => setTimeout(r, 20));
    }
  }, { id, mic, sys });
  await win.fill('#n-text', '# Lançamento\n- nova data do lançamento\n- jurídico: termos de uso');
  await win.waitForTimeout(3000);
  await win.click('[data-tab=transcript]');
  await win.waitForFunction(() => document.querySelectorAll('.tr-line').length >= 3, null, { timeout: 60000 }).catch(() => {});
  await shot('07-gravando-transcricao-ao-vivo');
  const live = await win.$$eval('.tr-line', (l) => l.map((x) => +x.dataset.start));
  check(live.length >= 3, 'transcrição ao vivo durante a gravação: ' + live.length + ' falas');
  check(live.every((v, i) => i === 0 || v >= live[i - 1]), 'falas ao vivo em ordem de tempo: ' + live.join(', '));
  await win.click('[data-tab=notes]');
  await win.evaluate(async (id) => { App.state.recordingId = null; App.recorder = null; await window.minuta.stopRecording(id); }, id);
  await win.waitForFunction((id) => { const m = App.state.allMeetings.find((x) => x.id === id); return m && (m.status === 'done' || m.status === 'error'); }, id, { timeout: 240000, polling: 500 });
  await win.waitForTimeout(800);
  const st = await win.evaluate((id) => App.state.allMeetings.find((x) => x.id === id), id);
  check(st.status === 'done', 'processamento termina (status=' + st.status + (st.error ? ', erro=' + st.error : '') + ')');
  await win.click('[data-tab=ata]'); await win.waitForTimeout(400); await shot('08-ata');
  check(await win.$('.ata'), 'ata aparece');
  check(await win.$('.dock input[type=range]'), 'player de áudio aparece');
  await win.click('[data-tab=transcript]'); await win.waitForTimeout(400); await shot('09-transcricao-vozes');
  const spk = await win.$$eval('.tr-who', (l) => [...new Set(l.map((x) => x.textContent))]);
  check(spk.includes('Allan') && spk.includes('Participante 1') && spk.includes('Participante 2'), 'transcrição separa vozes: ' + spk.join(', '));
  check((await win.$$('button.tr-time')).length > 0, 'horários clicáveis (modo Avançado)');
  await win.click('[data-tab=notes]'); await win.waitForTimeout(300); await shot('10-notas-com-horario');
  check((await win.$$('#n-gut button')).length > 0, 'notas guardam o horário (gutter)');
  const root = await win.evaluate(() => App.state.settings.rootDir);
  const dir = path.join(root, 'Reuniões', fs.readdirSync(path.join(root, 'Reuniões'))[0]);
  const fl = fs.readdirSync(dir); check(['audio.wav', 'transcript.json', 'ata.json', 'ata.md', 'transcricao.txt', 'meeting.json'].every((f) => fl.includes(f)), 'arquivos salvos na pasta: ' + fl.join(', '));
  check(fl.includes('mic.pcm.bak'), 'faixas separadas guardadas quando a opção está ligada');

  // Lista, filtros e busca
  await win.evaluate(() => App.go({ view: 'home' })); await win.waitForSelector('.row'); await shot('11-lista');
  await win.fill('#h-q', 'jurídico'); await win.waitForTimeout(700);
  check((await win.$$('.row')).length === 1, 'busca encontra pela transcrição/notas');
  await win.fill('#h-q', 'xyzinexistente'); await win.waitForTimeout(700);
  check((await win.$$('.row')).length === 0, 'busca sem resultado mostra estado vazio'); await shot('12-busca-vazia');
  await win.evaluate(() => App.go({ view: 'project', projectId: App.state.projects.find((p) => p.name === 'Cliente Acme').id }));
  await win.waitForSelector('.row'); check((await win.$$('.row')).length === 1, 'projeto pai inclui reuniões dos subprojetos'); await shot('13-projeto');
  await win.evaluate(() => App.go({ view: 'project', projectId: App.state.projects.find((p) => p.name === 'Interno').id })); await win.waitForTimeout(500);
  check((await win.$$('.row')).length === 0, 'outro projeto não mostra a reunião');
  await win.evaluate(() => App.go({ view: 'home', period: 'today' })); await win.waitForTimeout(500);
  check((await win.$$('.row')).length === 1, 'filtro de período "Hoje"');
  await win.evaluate(() => App.go({ view: 'home', period: 'custom', from: '2020-01-01', to: '2020-12-31' })); await win.waitForTimeout(500);
  check((await win.$$('.row')).length === 0, 'filtro de datas personalizado');

  // Templates
  await win.evaluate(() => App.go({ view: 'templates' })); await win.waitForSelector('#t-new'); await shot('14-templates');
  await win.click('#t-new'); await win.fill('#t-name', 'Comitê semanal');
  await win.fill('[data-k=title][data-i="0"]', 'Indicadores'); await win.click('#t-add'); await win.fill('[data-k=title][data-i="1"]', 'Riscos'); await win.fill('[data-k=instruction][data-i="1"]', 'Riscos e mitigação');
  await win.click('#t-save'); await win.waitForTimeout(500); await shot('15-template-editado');
  const tpls = await win.evaluate(() => App.state.templates.map((t) => t.name)); check(tpls.includes('Comitê semanal'), 'template criado e salvo');

  // Refazer ata com o novo template
  await win.evaluate((id) => App.go({ view: 'meeting', id }), id); await win.waitForSelector('#m-tpl');
  const tplId = await win.evaluate(() => App.state.templates.find((t) => t.name === 'Comitê semanal').id);
  await win.evaluate(({ id, tplId }) => window.minuta.regenerate(id, tplId), { id, tplId });
  await win.waitForFunction((id) => { const m = App.state.allMeetings.find((x) => x.id === id); return m && m.status === 'done'; }, id, { timeout: 120000, polling: 500 });
  await win.waitForTimeout(800);
  const secs = await win.$$eval('.ata h3', (l) => l.map((x) => x.textContent)); check(secs.includes('Indicadores') || secs.includes('Riscos') || secs.includes('Suas notas'), 'ata refeita com o template novo: ' + secs.join(', '));

  // Refazer transcrição a partir das faixas guardadas
  const before = await win.evaluate(async (id) => (await window.minuta.getMeeting(id)).transcript.segments.length, id);
  await win.evaluate(async (id) => { await window.minuta.retranscribe(id); }, id);
  await win.waitForFunction(async (id) => (await window.minuta.getMeeting(id)).meeting.status === 'done', id, { timeout: 420000 });
  const after = await win.evaluate(async (id) => (await window.minuta.getMeeting(id)).transcript.segments, id);
  check(after.length >= 3 && Math.abs(after.length - before) <= 3, `refazer transcrição funciona (${before} → ${after.length} falas)`);
  check(after.every((s, i) => i === 0 || s.start >= after[i - 1].start), 'transcrição refeita sai em ordem de tempo');

  // ---- Serviço de IA opcional (contra um servidor falso compatível com OpenAI) ----
  const srv = await fake.start({});
  await win.evaluate(() => App.go({ view: 'settings' })); await win.waitForSelector('[data-prov="custom"]');
  await win.click('[data-prov="custom"]'); await win.waitForSelector('#ai-url');
  await win.fill('#ai-url', srv.url); await win.evaluate(() => document.getElementById('ai-url').dispatchEvent(new Event('change')));
  await win.waitForTimeout(500);
  await win.fill('#ai-key', fake.KEY); await win.click('#ai-save'); await win.waitForTimeout(1200);
  check((await win.evaluate(() => window.minuta.aiGet())).hasKey === true, 'chave de API é guardada');
  const exposed = await win.evaluate(async () => JSON.stringify([await window.minuta.info(), await window.minuta.aiGet()]));
  check(!exposed.includes(fake.KEY), 'a chave nunca é devolvida para a interface');
  check(!fs.readFileSync(path.join(UD, 'settings.json'), 'utf8').includes(fake.KEY), 'a chave não fica no settings.json');
  check(!fs.readFileSync(path.join(UD, 'minuta.log'), 'utf8').includes(fake.KEY), 'a chave não aparece no log');

  // a lista do serviço é buscada sozinha e aparece no seletor de modelo
  await win.click('[data-pick="ata"]'); await win.waitForSelector('.pop.pick');
  const picked = await win.$$eval('.pick-list button', (l) => l.map((b) => b.textContent.replace('✓', '').trim()));
  check(picked.includes('gpt-4o-mini') && picked.includes('modelo-de-teste'), 'o seletor traz os modelos do serviço: ' + picked.join(', '));
  check(!picked.includes('whisper-1'), 'modelos de áudio ficam fora do seletor da ata');
  await win.click('.pick-list button:has-text("gpt-4o-mini")'); await win.waitForTimeout(700);
  check((await win.textContent('[data-pick="ata"]')).includes('gpt-4o-mini'), 'o modelo escolhido aparece no botão');

  await win.click('[data-pick="transcribe"]'); await win.waitForSelector('.pop.pick');
  const audio = await win.$$eval('.pick-list button', (l) => l.map((b) => b.textContent.replace('✓', '').trim()));
  check(audio.includes('whisper-1') && !audio.includes('gpt-4o-mini'), 'o seletor de transcrição só mostra áudio: ' + audio.join(', '));
  await win.click('.pick-list button:has-text("whisper-1")'); await win.waitForTimeout(700);

  await win.click('[data-pick="chat"]'); await win.waitForSelector('.pop.pick');
  await win.fill('.pop.pick .input', 'gpt-4o-mini'); await win.waitForTimeout(250);
  await win.click('.pick-list button'); await win.waitForTimeout(700);
  check((await win.textContent('[data-pick="chat"]')).includes('gpt-4o-mini'), 'a busca dentro do seletor funciona');

  for (const f of ['ata', 'chat', 'transcribe']) {
    await win.click(`[data-ai-test="${f}"]`); await win.waitForTimeout(1400);
    check(!/erro|falha|recusad/i.test(await win.textContent('#ai-msg')), `teste de conexão para "${f}": ` + (await win.textContent('#ai-msg')).trim().slice(0, 60));
  }
  check(!(await win.evaluate(() => window.minuta.aiGet())).active.length, 'nada é enviado enquanto as chaves estão desligadas');

  // Ata pelo serviço
  await win.evaluate(() => document.querySelector('[data-feat="ata"]').click()); await win.waitForTimeout(900);
  check((await win.evaluate(() => window.minuta.aiGet())).active.join() === 'ata', 'ligar só a ata ativa só a ata');
  await win.evaluate(async (id) => { await window.minuta.regenerate(id); }, id);
  check(await until(win, async (id) => { const g = await window.minuta.getMeeting(id); return g.meeting.status === 'done' && JSON.stringify(g.ata).includes('VEIO-DO-SERVICO'); }, id),
    'a ata foi escrita pelo serviço escolhido');

  // Pergunta pelo serviço
  await win.evaluate(() => document.querySelector('[data-feat="chat"]').click()); await win.waitForTimeout(900);
  const answer = await win.evaluate(async (id) => window.minuta.ask(id, 'o que ficou decidido?', []), id);
  check(String(answer).includes('VEIO-DO-SERVICO'), 'a pergunta foi respondida pelo serviço escolhido');

  // Transcrição pelo serviço (usa as faixas guardadas)
  await win.evaluate(() => document.querySelector('[data-feat="transcribe"]').click()); await win.waitForTimeout(900);
  await win.evaluate(async (id) => { await window.minuta.retranscribe(id); }, id);
  const trOk = await until(win, async (id) => { const g = await window.minuta.getMeeting(id); return g.meeting.status === 'done' && g.transcript.segments.some((x) => /VEIO-DO-SERVICO/.test(x.text)); }, id, 300000);
  const trCloud = await win.evaluate(async (id) => (await window.minuta.getMeeting(id)).transcript.segments, id);
  check(trOk, 'a transcrição veio do serviço escolhido');
  check(trCloud.some((x) => x.speaker === 'Allan') && trCloud.some((x) => x.speaker !== 'Allan'), 'faixas separadas continuam separando quem falou');
  check(trCloud.every((x, i) => i === 0 || x.start >= trCloud[i - 1].start), 'transcrição do serviço sai em ordem de tempo');

  // Serviço fora do ar: cai para o modelo do computador em vez de perder a reunião
  srv.fail = 500;
  await win.evaluate(async (id) => { await window.minuta.regenerate(id); }, id);
  check(await until(win, async (id) => { const g = await window.minuta.getMeeting(id); return g.meeting.status === 'done' && !JSON.stringify(g.ata).includes('VEIO-DO-SERVICO'); }, id, 420000),
    'serviço fora do ar: a ata é feita pelo modelo do computador');
  srv.fail = null;

  // Regressão: trocar de serviço não pode manter o endereço do serviço anterior
  const urls = await win.evaluate(async () => {
    const a = await window.minuta.aiSave({ provider: 'openrouter' });
    const b = await window.minuta.aiSave({ provider: 'openai' });
    return [a.url, b.url];
  });
  check(/openrouter/.test(urls[0]) && /api\.openai\.com/.test(urls[1]), 'cada serviço usa o próprio endereço: ' + urls.join(' → '));
  await win.evaluate(async (url) => { await window.minuta.aiSave({ provider: 'custom', baseUrl: url, models: { transcribe: 'whisper-1', ata: 'gpt-4o-mini', chat: 'gpt-4o-mini' } }); }, srv.url);

  // Desligar tudo volta ao modelo do computador
  await win.evaluate(async () => { await window.minuta.aiSave({ features: { transcribe: false, ata: false, chat: false } }); });
  check(!(await win.evaluate(() => window.minuta.aiGet())).active.length, 'desligar tudo volta a usar os modelos do computador');
  await win.evaluate(() => App.refreshInfo());
  srv.close();

  // Ajustes
  await win.evaluate(() => App.go({ view: 'settings' })); await win.waitForSelector('.modes'); await shot('16-ajustes');
  check(true, 'tela de ajustes abre');
  check(await win.isChecked('#s-keep'), 'ajustes mostram a opção de guardar as faixas ligada');
  await win.uncheck('#s-keep'); await win.waitForTimeout(300);
  check((await win.evaluate(() => window.minuta.info())).settings.keepTracks === false, 'desligar a opção é salvo');
  check((await win.$$('#s-mic option')).length >= 2, 'ajustes lista os microfones do sistema: ' + (await win.$$eval('#s-mic option', (l) => l.map((o) => o.textContent).join(', '))));
  check(/Fake|Saída|saída/.test(await win.textContent('.card:has(#s-mic)')), 'ajustes mostra a saída de áudio');
  // Diagnóstico de áudio: mede se o áudio realmente chega (é o que falta quando a gravação sai muda)
  await win.click('#s-diag'); await win.waitForSelector('#s-diag-out:not([style*="display: none"])', { timeout: 30000 });
  const diag = await win.textContent('#s-diag-out pre');
  check(/Áudio do microfone chegando: sim/.test(diag), 'diagnóstico confirma áudio do microfone chegando');
  check(/Permissão de microfone|Sistema:/.test(diag) && /Som do computador: ok/.test(diag), 'diagnóstico traz permissões e som do computador');
  await shot('16b-diagnostico');
  // Áudio servido com Range (para navegar no áudio)
  const au = await win.evaluate(async (id) => { const a = new Audio(`minuta-media://audio/${id}.wav`); await new Promise((r, j) => { a.onloadedmetadata = r; a.onerror = () => j(new Error('erro de mídia')); }); a.currentTime = 30; await new Promise((r) => { a.onseeked = r; }); return { d: Math.round(a.duration), t: Math.round(a.currentTime) }; }, id).catch((e) => ({ err: e.message }));
  check(au.d === 45 && au.t === 30, 'áudio carrega e permite pular para um ponto: ' + JSON.stringify(au));
  const notesSaved = await win.evaluate(async (id) => (await window.minuta.getMeeting(id)).meeting.notes, id);
  check(/jurídico/.test(notesSaved), 'notas continuam salvas depois do processamento');

  await app.close();

  // ---- Atualização pelo GitHub (contra um servidor de release falso) ----
  fs.writeFileSync(path.join(UD, 'fake.AppImage'), 'x');
  const rel = await fakeRelease.start({ version: '9.9.9', notes: 'Correções no áudio e na ata.' });
  const app2 = await _electron.launch({
    executablePath: process.env.PACKAGED || require('electron'), args: [...(process.env.PACKAGED ? [] : [path.join(__dirname, '..')]), '--no-sandbox'],
    // APPIMAGE só para o electron-updater aceitar rodar no Linux deste teste; no Windows e no Mac não é preciso.
    env: { ...process.env, MINUTA_USER_DATA: UD, HOME: UD + '/home', MINUTA_UPDATE_FEED: rel.url, APPIMAGE: path.join(UD, 'fake.AppImage') },
  });
  const w2 = await app2.firstWindow();
  w2.on('pageerror', (e) => { fail++; console.log('[pageerror]', e.message); });
  await w2.setViewportSize({ width: 1180, height: 800 });
  await w2.waitForTimeout(2500);
  const upd = await w2.evaluate(() => window.minuta.updateCheck());
  check(upd.status === 'available' && upd.version === '9.9.9', 'encontra a versão nova no servidor de releases: ' + JSON.stringify({ s: upd.status, v: upd.version }));
  check(/releases\/tag\/v9\.9\.9$/.test(upd.url || ''), 'aponta para a página do release: ' + upd.url);
  check(rel.hits.some((h) => /latest.*\.yml/.test(h)), 'leu o arquivo de versões: ' + rel.hits.join(', '));

  await w2.waitForSelector('.upd-pop', { timeout: 10000 });
  const pop = await w2.textContent('.upd-pop');
  check(/9\.9\.9/.test(pop) && /Correções no áudio/.test(pop), 'o popup mostra a versão e as novidades');
  await w2.screenshot({ path: path.join(SHOTS, '17-atualizacao.png') });

  // a tela de Ajustes também mostra, e "Procurar" funciona
  await w2.evaluate(() => App.go({ view: 'settings' })); await w2.waitForSelector('#upd-card');
  check(/9\.9\.9/.test(await w2.textContent('#upd-card')), 'Ajustes mostram a versão nova');
  check(await w2.isChecked('#s-auto'), 'o aviso automático vem ligado');

  // dispensar esconde o popup
  await w2.evaluate(() => document.querySelector('.upd-x').click()); await w2.waitForTimeout(400);
  check(!(await w2.$('.upd-pop')), 'dispensar fecha o popup');

  // sem versão nova, nada aparece
  rel.yml = rel.yml.replace('version: 9.9.9', 'version: 0.0.1');
  const none = await w2.evaluate(() => window.minuta.updateCheck());
  check(none.status === 'none', 'versão igual ou menor não vira aviso: ' + none.status);
  await w2.waitForTimeout(300);
  check(!(await w2.$('.upd-pop')), 'nenhum popup quando já está atualizado');

  await app2.close(); rel.close();

  console.log(`\n${ok} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
