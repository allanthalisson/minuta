'use strict';
(function (A) {
  const { esc, I, toast } = A;

  function renderOnboarding() {
    const S = A.state;
    const rec = S.totalMemGB && S.totalMemGB >= 15 ? 'advanced' : 'light';
    const O = S.onb = S.onb || { step: 0, mode: rec, name: S.settings.userName || '', dir: S.settings.rootDir };
    const ov = document.getElementById('overlay');
    const steps = 4;
    const dots = `<div class="dots" aria-hidden="true">${Array.from({ length: steps }, (_, i) => `<i class="${i === O.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const mac = S.platform === 'darwin';
    let body = '';
    if (O.step === 0) body = `
      <div class="onb-logo">${I.logo}</div>
      <h1>Suas reuniões, anotadas no seu computador.</h1>
      <p class="lead">O Minuta grava a call, transcreve e escreve a ata, sem robô na reunião e sem enviar nada para a nuvem.</p>
      <div class="points">
        <div class="point"><span class="i">${I.shield}</span><div><b>Privado de verdade</b><span>Áudio, transcrição e ata ficam numa pasta sua. Sem conta, sem chave de API.</span></div></div>
        <div class="point"><span class="i">${I.edit}</span><div><b>Você anota o essencial, a IA completa</b><span>Suas notas viram a base da ata; o resto vem da conversa.</span></div></div>
        <div class="point"><span class="i">${I.folder}</span><div><b>Tudo organizado</b><span>Projetos e subprojetos, busca, filtros por data e templates de ata.</span></div></div>
      </div>`;
    if (O.step === 1) body = `
      <h1>Como você quer usar?</h1>
      <p class="lead">Dá para trocar depois em Ajustes. ${S.totalMemGB ? `Seu computador tem ${S.totalMemGB} GB de memória: recomendamos o modo <b>${rec === 'advanced' ? 'Avançado' : 'Light'}</b>.` : ''}</p>
      ${A.modeCards(O.mode)}`;
    if (O.step === 2) body = `
      <h1>Vamos testar o áudio</h1>
      <p class="lead">Fale algo e toque um vídeo ou música. As duas barras devem se mexer.</p>
      <div class="test-grid">
        <div class="test-row"><span>${I.mic}</span><div><b>Seu microfone</b><div class="bar"><i id="o-mic" style="width:0"></i></div></div><span class="st" id="o-mic-st">aguardando</span></div>
        <div class="test-row"><span>${I.speaker}</span><div><b>Som do computador</b> <span class="help" style="color:var(--text-3);font-size:12px">(as vozes da call)</span><div class="bar"><i id="o-sys" style="width:0"></i></div></div><span class="st" id="o-sys-st">aguardando</span></div>
      </div>
      <p class="hint" id="o-hint">${mac ? 'No Mac, o sistema pode pedir permissão para o microfone e para "gravação de áudio do sistema". Clique em Permitir.' : (S.platform === 'win32' ? 'O Windows pode pedir permissão para o microfone.' : 'O sistema pode pedir permissão para o microfone.')}</p>
      <div class="filters"><button class="btn" id="o-test">${I.play}Começar teste</button>${mac ? '<button class="btn ghost" id="o-priv">Abrir Privacidade e Segurança</button>' : ''}</div>`;
    if (O.step === 3) body = `
      <h1>Últimos detalhes</h1>
      <p class="lead">Ao continuar, o Minuta baixa a IA local (${A.MODE_INFO[O.mode].size}) do GitHub e do Hugging Face. Você já pode gravar enquanto isso.</p>
      <div class="card">
        <div class="field"><div><label for="o-name">Seu nome</label><div class="help">Aparece na transcrição no lugar de "Você"</div></div><input class="input" id="o-name" value="${esc(O.name)}" maxlength="60" placeholder="Ex.: Allan"></div>
        <div class="field"><div><label>Pasta das reuniões</label><div class="help">Pode ser uma pasta sincronizada (Drive, OneDrive, iCloud)</div></div><div style="display:flex;gap:8px;align-items:center;min-width:0"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)">${esc(O.dir)}</span><button class="btn sm" id="o-dir">Alterar…</button></div></div>
      </div>
      <p class="hint">Gravar conversas exige o consentimento dos participantes. O Minuta lembra você disso ao começar cada gravação.</p>`;

    ov.innerHTML = `<div class="onb" role="dialog" aria-modal="true" aria-label="Configuração inicial"><div class="onb-card">${body}
      <div class="onb-foot">${dots}${O.step > 0 ? '<button class="btn ghost" id="o-back">Voltar</button>' : ''}
      <button class="btn primary lg" id="o-next">${O.step === 0 ? 'Começar' : O.step === 3 ? 'Concluir e começar a usar' : O.step === 2 ? (O.tested ? 'Continuar' : 'Pular teste') : 'Continuar'}</button></div></div></div>`;
    const $ = (s) => ov.querySelector(s);
    const back = $('#o-back'); if (back) back.onclick = () => { stopTest(); O.step--; renderOnboarding(); };
    $('#o-next').onclick = async () => {
      if (O.step === 3) return finish();
      stopTest(); O.step++; renderOnboarding();
    };
    ov.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { O.mode = b.dataset.mode; renderOnboarding(); }));
    const t = $('#o-test'); if (t) t.onclick = startTest;
    const p = $('#o-priv'); if (p) p.onclick = () => window.minuta.openPrivacy('screen');
    const nm = $('#o-name'); if (nm) { nm.oninput = () => (O.name = nm.value); setTimeout(() => nm.focus(), 50); }
    const dr = $('#o-dir'); if (dr) dr.onclick = async () => { const d = await window.minuta.chooseFolder(); if (d) { O.dir = d; renderOnboarding(); } };
    setTimeout(() => $('#o-next').focus(), 30);
  }

  // Botão do teste: mostra "Abrindo…" enquanto o microfone abre (no Windows isso pode levar alguns segundos).
  function testBtn(label, disabled) {
    const b = document.getElementById('o-test'); if (!b) return;
    b.disabled = !!disabled; b.innerHTML = `${I.play}${label}`;
  }
  function micError(e) {
    if (e && e.name === 'NotAllowedError') return 'O sistema não liberou o microfone. Libere nos ajustes de privacidade e tente de novo.';
    if (e && e.name === 'NotFoundError') return 'Nenhum microfone encontrado. Conecte um e tente de novo.';
    return 'Não foi possível abrir o microfone: ' + ((e && e.message) || e);
  }

  async function startTest() {
    const S = A.state, O = S.onb; if (!O || O.opening) return; // clique repetido enquanto abre: ignora
    stopTest();
    const R = new A.Recorder(); O.test = R; O.opening = R; testBtn('Abrindo…', true);
    const seen = { mic: false, sys: false }; let ok = false;
    try {
      const mic = await window.minuta.mediaAccess('microphone').catch(() => 'granted');
      if (O.test !== R) return; // o teste foi cancelado (Voltar/Continuar) enquanto esperava
      if (mic === 'denied') { O.test = null; toast('O microfone está bloqueado. Libere nos ajustes do sistema.', 'err'); window.minuta.openPrivacy('microphone'); return; }
      await R.open({ micDeviceId: 'default', onLevel: (track, v) => {
        const b = document.getElementById('o-' + track); if (b) b.style.width = Math.min(100, Math.sqrt(v) * 140) + '%';
        if (v > 0.02 && !seen[track]) { seen[track] = true; const s = document.getElementById(`o-${track}-st`); if (s) { s.textContent = 'funcionando ✓'; s.classList.add('ok'); } O.tested = true; const n = document.getElementById('o-next'); if (n) n.textContent = 'Continuar'; }
      } });
      if (O.test !== R) return;
      ok = true;
      // Se nada chega em ~3s, o problema não é "ficar quieto": o áudio não está sendo entregue ao app.
      setTimeout(() => {
        if (O.test !== R || R.seen.mic) return;
        const h = document.getElementById('o-hint');
        const st = document.getElementById('o-mic-st'); if (st) st.textContent = 'sem áudio';
        if (h) h.textContent = S.platform === 'win32'
          ? 'O Windows não está entregando áudio ao Minuta. Confira se há uma saída de áudio ligada (fone ou caixa de som) e se "Permitir que os aplicativos da área de trabalho acessem o microfone" está ligado nas configurações de privacidade.'
          : 'Nenhum áudio está chegando. Confira as permissões do microfone e a saída de áudio do sistema.';
        try { window.minuta.logUi('teste de áudio: nenhum bloco do microfone em 3s'); } catch (_) {}
      }, 3000);
      if (!R.hasSys) { const s = document.getElementById('o-sys-st'); if (s) s.textContent = 'sem acesso'; const h = document.getElementById('o-hint'); if (h) h.textContent = S.platform === 'darwin' ? 'Permita "Gravação de áudio do sistema" (ou "Gravação de tela e áudio do sistema") para o Minuta em Privacidade e Segurança e reabra o app. Enquanto isso, só o microfone é gravado.' : 'Não foi possível acessar o som do computador. O microfone continua funcionando.'; }
    } catch (e) {
      if (!e.cancelled && O.test === R) { O.test = null; await R.close(); toast(micError(e), 'err'); }
    } finally {
      if (O.opening === R) O.opening = null;
      if (O.test === R || !O.test) testBtn(ok ? 'Testar de novo' : 'Começar teste', false);
    }
  }
  function stopTest() { const O = A.state.onb; if (O) { O.opening = null; if (O.test) { O.test.close(); O.test = null; } } }

  async function finish() {
    const S = A.state, O = S.onb; stopTest();
    try {
      S.settings = await window.minuta.saveSettings({ mode: O.mode, userName: O.name, rootDir: O.dir, onboarded: true });
      document.getElementById('overlay').innerHTML = ''; S.onb = null;
      await A.refreshAll(); A.go({ view: 'home' });
    } catch (e) { toast(e.message, 'err'); }
  }

  A.renderOnboarding = renderOnboarding;
})(window.App);
