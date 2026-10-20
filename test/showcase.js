// Gera capturas de tela com uma ata de EXEMPLO (escrita à mão) só para mostrar o layout.
const { _electron } = require('playwright-core');
const path = require('path'), fs = require('fs');
const UD = '/tmp/mud', OUT = path.join(__dirname, 'shots');
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'], env: { ...process.env, MINUTA_USER_DATA: UD, HOME: UD + '/home' } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1240, height: 800 });
  await win.waitForFunction(() => window.App && App.state.allMeetings);
  const id = await win.evaluate(() => App.state.allMeetings[0].id);
  const root = await win.evaluate(() => App.state.settings.rootDir);
  const dir = path.join(root, 'Reuniões', fs.readdirSync(path.join(root, 'Reuniões'))[0]);
  const ata = {
    titulo: 'Planejamento do lançamento do app', resumo: 'O time revisou o cronograma e decidiu adiar o lançamento para 29 de novembro, porque a integração de pagamentos ainda não foi testada. O orçamento de marketing fica para a próxima reunião.',
    secoes: [
      { titulo: 'Resumo', itens: [{ texto: 'A data de 15 de novembro foi considerada apertada pelo time.', seu: false, ref: 5 }, { texto: 'Nova data do lançamento: 29 de novembro.', seu: true, ref: 16 }] },
      { titulo: 'Decisões', itens: [{ texto: 'Lançamento adiado para 29 de novembro.', seu: true, ref: 16 }] },
      { titulo: 'Pontos em aberto', itens: [{ texto: 'Jurídico precisa confirmar os termos de uso antes do lançamento.', seu: true, ref: 36 }, { texto: 'Orçamento de marketing será definido na próxima reunião.', seu: false, ref: 31 }] },
    ],
    acoes: [{ tarefa: 'Atualizar o cronograma', responsavel: 'Participante 1', prazo: 'sexta-feira', ref: 21 }, { tarefa: 'Testar a integração de pagamentos', responsavel: 'Participante 2', prazo: 'próxima quarta', ref: 26 }, { tarefa: 'Confirmar termos de uso com o jurídico', responsavel: 'Allan', prazo: '—', ref: 36 }],
    templateId: 'auto', generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'ata.json'), JSON.stringify(ata));
  await win.evaluate(async (id) => {
    await window.minuta.updateMeeting(id, { title: 'Planejamento do lançamento do app', templateId: 'auto', speakers: { 'Participante 1': 'Ana', 'Participante 2': 'Bruno' } });
    for (const [t, d] of [['1:1 com a Marina', 1], ['Daily do time de produto', 0], ['Entrevista — dev front-end', 3]]) { const { meeting } = await window.minuta.createMeeting({ title: t }); }
    await App.refreshMeetings();
  }, id);
  const shot = async (n, dark) => { await win.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await win.waitForTimeout(400); await win.screenshot({ path: path.join(OUT, n + '.png') }); };
  await win.evaluate((id) => App.go({ view: 'meeting', id }), id); await win.waitForSelector('.ata');
  await shot('exemplo-ata'); await shot('exemplo-ata-escuro', true);
  await win.click('[data-tab=transcript]'); await shot('exemplo-transcricao');
  await win.evaluate(() => App.go({ view: 'home' })); await win.waitForSelector('.row'); await shot('exemplo-lista');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
