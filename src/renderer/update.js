'use strict';
/* Aviso de versão nova: um popup discreto no canto e a seção de Ajustes. */
(function (A) {
  const { esc, I, toast } = A;
  const st = () => A.state.update || { status: 'idle', canAutoInstall: false };

  function label(u) {
    if (u.status === 'checking') return 'Procurando atualizações…';
    if (u.status === 'downloading') return `Baixando… ${u.percent || 0}%`;
    if (u.status === 'ready') return 'Atualização pronta para instalar';
    if (u.status === 'available') return `Minuta ${u.version} disponível`;
    if (u.status === 'none') return 'Você está na versão mais recente';
    if (u.status === 'error') return u.error || 'Não foi possível verificar';
    return '';
  }

  // Popup do canto: só aparece quando há versão nova e o usuário não dispensou.
  function renderUpdatePopup() {
    const box = document.getElementById('updbox'); if (!box) return;
    const u = st();
    const show = !u.dismissed && ['available', 'downloading', 'ready'].includes(u.status);
    if (!show) { box.innerHTML = ''; return; }
    const act = u.status === 'ready' ? 'Reiniciar e instalar' : u.canAutoInstall ? 'Atualizar' : 'Baixar';
    box.innerHTML = `<div class="upd-pop" role="dialog" aria-label="Atualização disponível">
      <div class="upd-head"><b>Minuta ${esc(u.version || '')}</b>
        <button class="btn ghost sm upd-x" aria-label="Fechar">${I.x}</button></div>
      ${u.notes ? `<p class="upd-notes">${esc(u.notes)}</p>` : ''}
      ${u.status === 'downloading' ? `<div class="bar"><i style="width:${u.percent || 0}%"></i></div><span class="upd-sub">Baixando… ${u.percent || 0}%</span>`
        : `<div class="upd-acts"><button class="btn sm primary upd-go">${act}</button>
           <button class="btn sm ghost upd-page">Ver novidades</button></div>`}
      ${!u.canAutoInstall && u.status !== 'downloading' ? `<span class="upd-sub">${A.state.platform === 'darwin' ? 'No Mac a instalação é manual' : 'A instalação é manual'}: o download abre no navegador.</span>` : ''}
    </div>`;
    box.querySelector('.upd-x').onclick = () => window.minuta.updateDismiss();
    const page = box.querySelector('.upd-page'); if (page) page.onclick = () => window.minuta.updateOpenPage();
    const go = box.querySelector('.upd-go');
    if (go) go.onclick = async () => {
      try { if (u.status === 'ready') await window.minuta.updateInstall(); else await window.minuta.updateDownload(); }
      catch (e) { toast(e.message, 'err'); }
    };
  }

  // Bloco em Ajustes › Sobre.
  function updateCard() {
    const u = st(), S = A.state;
    const busy = u.status === 'checking' || u.status === 'downloading';
    const act = u.status === 'ready' ? 'Reiniciar e instalar' : u.status === 'available' ? (u.canAutoInstall ? 'Atualizar agora' : 'Baixar') : '';
    return `<div class="field" id="upd-card"><div><label>Atualizações</label>
        <div class="help">${esc(label(u) || `Minuta ${S.version} · as novas versões vêm dos releases do GitHub`)}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${act ? `<button class="btn sm primary" id="upd-go2">${act}</button>` : ''}
        <button class="btn sm" id="upd-check" ${busy ? 'disabled' : ''}>${busy ? 'Aguarde…' : 'Procurar'}</button>
      </div></div>
    <div class="field"><div><label for="s-auto">Avisar quando houver versão nova</label>
        <div class="help">Verifica ao abrir o app e a cada 6 horas</div></div>
      <label class="switch"><input type="checkbox" id="s-auto" ${S.settings.autoUpdate !== false ? 'checked' : ''}><i></i></label></div>`;
  }

  function bindUpdate(root) {
    const $ = (q) => root.querySelector(q);
    const c = $('#upd-check'); if (c) c.onclick = async () => { try { A.state.update = await window.minuta.updateCheck(); } catch (e) { toast(e.message, 'err'); } A.renderUpdateCard(); };
    const g = $('#upd-go2'); if (g) g.onclick = async () => {
      try { if (st().status === 'ready') await window.minuta.updateInstall(); else await window.minuta.updateDownload(); }
      catch (e) { toast(e.message, 'err'); }
    };
    const a = $('#s-auto'); if (a) a.onchange = async (e) => { A.state.settings = await window.minuta.saveSettings({ autoUpdate: e.target.checked }); };
  }

  // Redesenha só o bloco de atualização, sem mexer no resto da tela.
  A.renderUpdateCard = () => {
    const el = document.getElementById('upd-card'); if (!el) return;
    const holder = el.parentElement;
    const next = el.nextElementSibling; // o campo do "avisar automaticamente"
    el.outerHTML = updateCard();
    if (next && next.querySelector('#s-auto')) next.remove();
    bindUpdate(holder);
  };
  A.renderUpdatePopup = renderUpdatePopup;
  A.updateCard = updateCard;
  A.bindUpdate = bindUpdate;
})(window.App);
