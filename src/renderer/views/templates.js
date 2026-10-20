'use strict';
(function (A) {
  const { esc, I, toast } = A;

  function renderTemplates(root) {
    const S = A.state;
    const sel = S.tplSel && S.templates.find((t) => t.id === S.tplSel) ? S.tplSel : S.templates[0].id;
    S.tplSel = sel;
    const t = S.tplDraft && S.tplDraft.id === sel ? S.tplDraft : JSON.parse(JSON.stringify(S.templates.find((x) => x.id === sel)));
    S.tplDraft = t;
    const ro = !!t.builtin;
    root.innerHTML = `<div class="toolbar drag"><div class="crumbs"><span>Templates de ata</span></div><div class="spacer"></div><button class="btn primary sm" id="t-new">${I.plus}Novo template</button></div>
      <div class="scroll"><div class="page wide">
        <h1 class="page-title">Templates de ata</h1><p class="sub">Defina as seções da ata e o que a IA deve escrever em cada uma. Ações (tarefas, responsáveis e prazos) entram sempre.</p>
        <div class="tpl-layout">
          <div class="tpl-list" role="listbox" aria-label="Templates">
            ${S.templates.map((x) => `<button class="nav-item ${x.id === sel ? 'active' : ''}" data-t="${esc(x.id)}" role="option" aria-selected="${x.id === sel}">${I.doc}<span class="label">${esc(x.name)}</span>${x.builtin ? '<span class="count">padrão</span>' : ''}</button>`).join('')}
          </div>
          <div>
            ${ro ? `<div class="banner"><div class="grow"><b>Template padrão</b><small>Os templates padrão não podem ser alterados. Duplique para criar o seu.</small></div><button class="btn sm" id="t-dup">Duplicar e editar</button></div>` : ''}
            <div class="card"><div class="field"><label for="t-name">Nome</label><input class="input" id="t-name" value="${esc(t.name)}" ${ro ? 'disabled' : ''} maxlength="80"></div>
              <div class="field"><label for="t-desc">Quando usar</label><input class="input" id="t-desc" value="${esc(t.description || '')}" ${ro ? 'disabled' : ''} maxlength="200" placeholder="Ex.: reuniões semanais com o cliente"></div></div>
            <h3 style="font:650 13px var(--font-display);color:var(--text-2);margin:18px 0 10px">Seções</h3>
            <div id="t-secs">${t.sections.map((s, i) => `<div class="sec-edit"><div class="top"><input class="input" data-k="title" data-i="${i}" value="${esc(s.title)}" placeholder="Título da seção" ${ro ? 'disabled' : ''} maxlength="80" style="font-weight:600">
              ${ro ? '' : `<button class="icon-btn" data-up="${i}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-down="${i}" aria-label="Descer" ${i === t.sections.length - 1 ? 'disabled' : ''}>↓</button><button class="icon-btn" data-del="${i}" aria-label="Remover seção">${I.trash}</button>`}</div>
              <textarea class="input" data-k="instruction" data-i="${i}" placeholder="O que a IA deve colocar aqui" ${ro ? 'disabled' : ''} maxlength="400">${esc(s.instruction)}</textarea></div>`).join('')}</div>
            ${ro ? '' : `<button class="btn sm" id="t-add">${I.plus}Adicionar seção</button>
              <div class="ata-foot"><button class="btn primary" id="t-save">Salvar template</button>${t.id && !t.id.startsWith('new') ? `<button class="btn danger ghost" id="t-del">${I.trash}Excluir</button>` : ''}</div>`}
          </div>
        </div></div></div>`;
    const $ = (s) => root.querySelector(s);
    root.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { S.tplSel = b.dataset.t; S.tplDraft = null; renderTemplates(root); }));
    const fresh = () => ({ id: 'new-' + Date.now(), name: 'Novo template', description: '', sections: [{ title: 'Resumo', instruction: 'Os pontos principais da conversa.' }] });
    $('#t-new').onclick = () => { const n = fresh(); S.templates.push(n); S.tplSel = n.id; S.tplDraft = n; renderTemplates(root); setTimeout(() => { const i = $('#t-name'); i.focus(); i.select(); }); };
    const dup = $('#t-dup'); if (dup) dup.onclick = () => { const n = { ...JSON.parse(JSON.stringify(t)), id: 'new-' + Date.now(), builtin: false, name: t.name + ' (cópia)' }; S.templates.push(n); S.tplSel = n.id; S.tplDraft = n; renderTemplates(root); };
    if (ro) return;
    const sync = () => { t.name = $('#t-name').value; t.description = $('#t-desc').value; root.querySelectorAll('[data-k]').forEach((x) => { t.sections[+x.dataset.i][x.dataset.k] = x.value; }); };
    root.querySelectorAll('input,textarea').forEach((x) => (x.oninput = sync));
    $('#t-add').onclick = () => { sync(); t.sections.push({ title: '', instruction: '' }); renderTemplates(root); const ins = root.querySelectorAll('[data-k=title]'); ins[ins.length - 1].focus(); };
    root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { sync(); t.sections.splice(+b.dataset.del, 1); renderTemplates(root); }));
    root.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { sync(); const i = +b.dataset.up; [t.sections[i - 1], t.sections[i]] = [t.sections[i], t.sections[i - 1]]; renderTemplates(root); }));
    root.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => { sync(); const i = +b.dataset.down; [t.sections[i + 1], t.sections[i]] = [t.sections[i], t.sections[i + 1]]; renderTemplates(root); }));
    $('#t-save').onclick = async () => {
      sync();
      try {
        const saved = await window.minuta.saveTemplate({ id: t.id.startsWith('new-') ? undefined : t.id, name: t.name, description: t.description, sections: t.sections });
        S.tplDraft = null; S.tplSel = saved.id; await A.refreshLibrary(); toast('Template salvo'); renderTemplates(root);
      } catch (e) { toast(e.message, 'err'); }
    };
    const del = $('#t-del'); if (del) del.onclick = async () => {
      if (!confirm(`Excluir o template "${t.name}"?`)) return;
      await window.minuta.deleteTemplate(t.id); S.tplDraft = null; S.tplSel = null; await A.refreshLibrary(); renderTemplates(root);
    };
  }
  A.renderTemplates = renderTemplates;
})(window.App);
