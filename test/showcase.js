// Gera as capturas de tela do README em docs/img.
// A transcrição mostrada é saída real do motor (vozes sintéticas); a ata é um EXEMPLO escrito à mão,
// só para mostrar o layout — está dito assim no README.
// Uso: xvfb-run -a node test/showcase.js   (precisa de uma reunião já processada em MINUTA_USER_DATA)
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
const fakeRelease = require('./fake-release');
const UD = process.env.UD || '/tmp/mud';
const OUT = path.join(__dirname, '..', 'docs', 'img');

const ATA = {
  titulo: 'Planejamento do lançamento do app',
  resumo: 'O time revisou o cronograma e decidiu adiar o lançamento para 29 de novembro, porque a integração de pagamentos ainda não foi testada. O orçamento de marketing fica para a próxima reunião.',
  secoes: [
    { titulo: 'Resumo', itens: [{ texto: 'A data de 15 de novembro foi considerada apertada pelo time.', seu: false, ref: 5 }, { texto: 'Nova data do lançamento: 29 de novembro.', seu: true, ref: 16 }] },
    { titulo: 'Decisões', itens: [{ texto: 'Lançamento adiado para 29 de novembro.', seu: true, ref: 16 }] },
    { titulo: 'Pontos em aberto', itens: [{ texto: 'Jurídico precisa confirmar os termos de uso antes do lançamento.', seu: true, ref: 36 }, { texto: 'Orçamento de marketing será definido na próxima reunião.', seu: false, ref: 31 }] },
  ],
  acoes: [
    { tarefa: 'Atualizar o cronograma', responsavel: 'Ana', prazo: 'sexta-feira', ref: 21 },
    { tarefa: 'Testar a integração de pagamentos', responsavel: 'Bruno', prazo: 'próxima quarta', ref: 26 },
    { tarefa: 'Confirmar termos de uso com o jurídico', responsavel: 'Allan', prazo: '—', ref: 36 },
  ],
  templateId: 'auto', generatedAt: new Date().toISOString(),
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // A reunião vem dos testes e pode ter ficado com erro (motor sem memória na máquina de teste).
  // Para o print, ela precisa estar como uma reunião normal, já concluída.
  {
    const st = JSON.parse(fs.readFileSync(path.join(UD, 'settings.json'), 'utf8'));
    const mdir = path.join(st.rootDir, 'Reuniões');
    for (const d of fs.readdirSync(mdir)) {
      const f = path.join(mdir, d, 'meeting.json');
      if (!fs.existsSync(f) || !fs.existsSync(path.join(mdir, d, 'transcript.json'))) continue;
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      Object.assign(m, { status: 'done', stage: null, error: null, progress: 1, hasAta: true });
      fs.writeFileSync(f, JSON.stringify(m, null, 2));
    }
  }
  const rel = await fakeRelease.start({ version: '1.2.0', notes: 'Transcrição mais precisa e ata mais rápida.' });
  fs.writeFileSync(path.join(UD, 'fake.AppImage'), 'x');
  const app = await _electron.launch({
    executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'],
    env: { ...process.env, MINUTA_USER_DATA: UD, HOME: UD + '/home', MINUTA_UPDATE_FEED: rel.url, APPIMAGE: path.join(UD, 'fake.AppImage') },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1240, height: 880 });
  await win.waitForFunction(() => window.App && App.state.allMeetings);
  const shot = async (n, dark = false) => {
    await win.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(OUT, n + '.png') });
    console.log('  ' + n + '.png');
  };

  const root = await win.evaluate(() => App.state.settings.rootDir);
  const mdir = path.join(root, 'Reuniões');
  const folder = fs.readdirSync(mdir).find((d) => fs.existsSync(path.join(mdir, d, 'transcript.json')));
  if (!folder) throw new Error('nenhuma reunião processada em ' + mdir + ' — rode o e2e antes');
  fs.writeFileSync(path.join(mdir, folder, 'ata.json'), JSON.stringify(ATA));
  const id = await win.evaluate((f) => (App.state.allMeetings.find((m) => f.includes(m.id.slice(0, 4))) || App.state.allMeetings[0]).id, folder);

  await win.evaluate(async (id) => {
    await window.minuta.updateMeeting(id, { title: 'Planejamento do lançamento do app', templateId: 'auto', speakers: { 'Participante 1': 'Ana', 'Participante 2': 'Bruno' } });
    const lib = await window.minuta.library();
    if (!lib.projects.length) {
      const p = await window.minuta.createProject({ name: 'Cliente Acme' });
      await window.minuta.createProject({ name: 'Onboarding', parentId: p.id });
      await window.minuta.createProject({ name: 'Interno' });
      await window.minuta.updateMeeting(id, { projectId: p.id });
    }
    for (const t of ['1:1 com a Marina', 'Daily do time de produto', 'Entrevista — dev front-end']) {
      if (!App.state.allMeetings.some((m) => m.title === t)) await window.minuta.createMeeting({ title: t });
    }
    await App.refreshAll();
  }, id);

  // 1. lista de reuniões
  await win.evaluate(() => App.go({ view: 'home' })); await win.waitForSelector('.row');
  await shot('01-lista');

  // 2. ata (clara e escura)
  await win.evaluate((id) => App.go({ view: 'meeting', id }), id); await win.waitForSelector('.ata');
  await shot('02-ata'); await shot('03-ata-escuro', true);

  // 3. transcrição com vozes separadas e horários clicáveis (saída real do motor)
  await win.click('[data-tab=transcript]'); await win.waitForTimeout(400);
  await shot('04-transcricao');

  // 4. notas
  await win.click('[data-tab=notes]'); await win.waitForSelector('#n-text');
  await win.fill('#n-text', '# Lançamento\n- nova data: 29 de novembro\n- jurídico precisa ver os termos de uso\n- orçamento de marketing fica para depois');
  await win.waitForTimeout(600);
  await shot('05-notas');

  // 5. templates
  await win.evaluate(() => App.go({ view: 'templates' })); await win.waitForSelector('.tpl-layout');
  await shot('06-templates');

  // 6. serviços de IA opcionais
  await win.evaluate(() => App.go({ view: 'settings' })); await win.waitForSelector('[data-prov="openai"]');
  await win.evaluate(() => { const el = document.querySelector('#ai-card'); el.scrollIntoView({ block: 'center' }); });
  await win.waitForTimeout(400);
  await shot('07-servicos-de-ia');

  // 7. aviso de versão nova
  await win.evaluate(() => App.go({ view: 'home' })); await win.waitForSelector('.row');
  await win.evaluate(() => window.minuta.updateCheck());
  await win.waitForSelector('.upd-pop', { timeout: 10000 });
  await shot('08-atualizacao');

  await app.close(); rel.close();
  console.log('\nprints em docs/img');
})().catch((e) => { console.error(e); process.exit(1); });
