'use strict';
(function (A) {
  const { esc, I, toast, GB } = A;

  A.MODE_INFO = {
    light: { name: 'Light', tag: 'Rápido e leve', size: '≈ 1,6 GB', items: ['Grava você e a call', 'Transcrição no seu computador', 'Ata com IA leve (Qwen 1.5B)', 'Bom em notebooks com 8 GB de RAM'] },
    advanced: { name: 'Avançado', tag: 'Mais completo', size: '≈ 3 GB', items: ['Tudo do Light', 'Separa as vozes: Participante 1, 2, 3…', 'Clique no horário e ouça o trecho; notas com horário', 'Ata com IA maior (Qwen 4B) e perguntas sobre a reunião', 'Recomendado: 16 GB de RAM'] },
  };
  A.modeCards = (sel) => `<div class="modes" role="radiogroup" aria-label="Modo">${['light', 'advanced'].map((k) => { const m = A.MODE_INFO[k]; return `<button class="mode ${sel === k ? 'on' : ''}" role="radio" aria-checked="${sel === k}" data-mode="${k}"><h4>${m.name}<span class="badge">${m.tag}</span></h4><ul>${m.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><span class="size">Download único: ${m.size} · depois funciona sem internet</span></button>`; }).join('')}</div>`;

  const FEATURES = [
    { k: 'transcribe', label: 'Transcrição', help: 'Envia o áudio da reunião, em blocos' },
    { k: 'ata', label: 'Ata', help: 'Envia a transcrição e as suas notas' },
    { k: 'chat', label: 'Perguntas sobre a reunião', help: 'Envia a transcrição a cada pergunta' },
  ];
  const aiState = () => A.state.ai || { provider: 'openai', features: {}, models: {}, presets: {} };
  const preset = () => (aiState().presets || {})[aiState().provider] || {};

  // Modelos que o serviço realmente oferece, buscados uma vez por serviço.
  const fetched = {};
  async function loadModels(rerender) {
    const ai = aiState(); const p = ai.provider;
    if (!ai.hasKey || fetched[p] !== undefined) return;
    fetched[p] = null; // marca "buscando" para não repetir
    try { fetched[p] = await window.minuta.aiModels({ provider: p, baseUrl: ai.baseUrl }); }
    catch (_) { fetched[p] = []; }
    rerender();
  }

  function optionsFor(k) {
    const ai = aiState(), p = ai.provider;
    const sug = ((preset().suggest || {})[k] || []);
    const all = fetched[p] || [];
    const usable = all.filter((m) => (k === 'transcribe' ? /whisper|transcri|stt|voxtral|scribe/i.test(m) : !/embed|moderation|tts|audio|whisper|transcri|image|dall-e|rerank|guard|speech/i.test(m)));
    const rest = usable.filter((m) => !sug.includes(m));
    return { sug, rest, loading: fetched[p] === null };
  }

  // Lista de modelos: sugestões do serviço escolhido em cima, o resto do catálogo embaixo, com busca.
  function modelPicker(anchor, k, current, onPick) {
    const { sug, rest, loading } = optionsFor(k);
    const pop = A.h('<div class="pop pick" role="dialog" aria-label="Escolher modelo"></div>');
    const search = A.h('<input class="input sm" placeholder="Buscar ou digitar um modelo…" spellcheck="false" autocomplete="off">');
    search.value = '';
    const list = A.h('<div class="pick-list"></div>');
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const f = (arr) => arr.filter((m) => m.toLowerCase().includes(q));
      list.innerHTML = '';
      const group = (title, arr) => {
        if (!arr.length) return;
        list.appendChild(A.h(`<div class="grp">${esc(title)}</div>`));
        for (const m of arr) {
          const b = A.h(`<button class="${m === current ? 'on' : ''}"><span>${esc(m)}</span>${m === current ? '<span class="ck">✓</span>' : ''}</button>`);
          b.addEventListener('click', () => { A.closePop(); onPick(m); });
          list.appendChild(b);
        }
      };
      group(sug.length ? 'Sugeridos para ' + (preset().label || 'este serviço') : '', f(sug));
      group(rest.length ? 'Disponíveis no serviço' : '', f(rest));
      if (loading) list.appendChild(A.h('<div class="grp">buscando a lista do serviço…</div>'));
      if (!sug.length && !rest.length && !loading) list.appendChild(A.h(`<div class="grp">${aiState().hasKey ? 'O serviço não devolveu uma lista. Digite o nome do modelo.' : 'Salve a chave para ver os modelos do serviço, ou digite o nome.'}</div>`));
      if (q && !f(sug).length && !f(rest).length) {
        const b = A.h(`<button class="use"><span>Usar “${esc(search.value.trim())}”</span></button>`);
        b.addEventListener('click', () => { A.closePop(); onPick(search.value.trim()); });
        list.appendChild(b);
      }
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = list.querySelector('button');
      if (first) first.click(); else if (search.value.trim()) { A.closePop(); onPick(search.value.trim()); }
    });
    pop.appendChild(search); pop.appendChild(list); draw();
    A.openPopup(pop, anchor);
    setTimeout(() => search.focus(), 10);
  }

  function aiCard() {
    const ai = aiState(), presets = ai.presets || {}, p = preset();
    const on = FEATURES.filter((f) => (ai.features || {})[f.k]).map((f) => f.label);
    return `<div class="card" id="ai-card"><h3>Serviços de IA <span class="badge">opcional</span></h3>
      <div class="ai-top">
        <p class="help">Por padrão tudo roda no seu computador, sem conta e sem chave. Ligando uma parte aqui,
        <b>ela deixa de rodar local</b> e passa a ser feita pelo serviço escolhido, que vê o áudio ou a transcrição.</p>
        ${on.length
          ? `<p class="help ai-live">Enviando para ${esc(p.label || 'o serviço')}: <b>${esc(on.join(', '))}</b>.</p>`
          : '<p class="help ai-off">Tudo desligado: nada sai do seu computador.</p>'}
        <div class="chips" role="radiogroup" aria-label="Serviço">
          ${Object.entries(presets).map(([k, v]) => `<button class="chip ${ai.provider === k ? 'on' : ''}" role="radio" aria-checked="${ai.provider === k}" data-prov="${k}">
            <b>${esc(v.label)}</b><span>${esc(v.hint || '')}</span></button>`).join('')}
        </div>
      </div>
      ${ai.provider === 'custom' ? `<div class="field"><div><label for="ai-url">Endereço</label><div class="help">Ex.: http://localhost:11434/v1</div></div><input class="input" id="ai-url" value="${esc(ai.baseUrl || '')}" placeholder="https://..."></div>` : ''}
      <div class="field"><div><label for="ai-key">Chave de API</label>
        <div class="help">${ai.hasKey ? 'Guardada criptografada neste computador' : 'Fica criptografada neste computador e nunca é mostrada de volta'}${p.keyUrl ? ` · <a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer">onde pegar a chave</a>` : ''}${p.keyPrefix ? ` · começa com <code>${esc(p.keyPrefix)}</code>` : ''}</div></div>
        <div class="ai-key">${ai.hasKey ? '<span class="ok-tag">guardada ✓</span>' : ''}
          <input class="input" id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="${ai.hasKey ? 'trocar a chave…' : 'cole a chave aqui'}">
          <button class="btn sm" id="ai-save">Salvar</button>${ai.hasKey ? '<button class="btn sm ghost" id="ai-del">Remover</button>' : ''}</div></div>
      ${FEATURES.map((f) => {
        const model = (ai.models || {})[f.k] || '';
        const blocked = f.k === 'transcribe' && p.transcribes === false;
        const active = !!(ai.features || {})[f.k];
        return `<div class="field ai-feat ${active ? 'on' : ''}"><div><label>${f.label}</label>
          <div class="help">${blocked ? `${esc(p.label || 'Este serviço')} não transcreve áudio — isso continua no seu computador.` : f.help}</div></div>
          <div class="ai-row">
            <button class="btn sm pickbtn ${model ? '' : 'empty'}" data-pick="${f.k}" ${blocked ? 'disabled' : ''}>${esc(model || 'escolher modelo')}<span class="caret">▾</span></button>
            <button class="btn sm ghost" data-ai-test="${f.k}" ${blocked || !model ? 'disabled' : ''}>Testar</button>
            <label class="switch"><input type="checkbox" data-feat="${f.k}" ${active ? 'checked' : ''} ${blocked ? 'disabled' : ''}><i></i></label>
          </div></div>`;
      }).join('')}
      <div class="field ai-msg" id="ai-msg" style="display:none"><div class="help"></div></div>
    </div>`;
  }

  function bindAi(root) {
    const S = A.state, $ = (q) => root.querySelector(q);
    const redraw = () => { const el = root.querySelector('#ai-card'); if (!el) return; el.outerHTML = aiCard(); bindAi(root); };
    const msg = (text, bad) => { const b = root.querySelector('#ai-msg'); if (!b) return; b.style.display = ''; const d = b.querySelector('.help'); d.textContent = text; d.classList.toggle('bad', !!bad); };
    const save = async (patch) => {
      try { S.ai = await window.minuta.aiSave(patch); await A.refreshInfo(); redraw(); return true; }
      catch (e) { msg(e.message, true); return false; }
    };
    loadModels(redraw);

    root.querySelectorAll('[data-prov]').forEach((b) => (b.onclick = () => {
      if (b.dataset.prov === aiState().provider) return;
      // Trocar de serviço desliga tudo: chave e modelos do serviço anterior não valem aqui.
      save({ provider: b.dataset.prov, features: { transcribe: false, ata: false, chat: false }, models: { transcribe: '', ata: '', chat: '' } });
    }));
    const url = $('#ai-url'); if (url) url.onchange = () => save({ baseUrl: url.value.trim() });
    $('#ai-save').onclick = async () => {
      const k = $('#ai-key').value.trim();
      if (!k) return msg('Cole a chave antes de salvar.', true);
      const pre = preset().keyPrefix;
      if (pre && !k.startsWith(pre)) return msg(`Esta não parece uma chave do ${preset().label}: elas começam com "${pre}".`, true);
      delete fetched[aiState().provider];
      if (await save({ apiKey: k })) { msg('Chave guardada neste computador.'); }
    };
    const del = $('#ai-del'); if (del) del.onclick = async () => { S.ai = await window.minuta.aiClearKey(); await A.refreshInfo(); redraw(); toast('Chave removida.'); };

    root.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.pick;
      modelPicker(b, k, (aiState().models || {})[k] || '', (m) => save({ models: { [k]: m } }));
    }));
    root.querySelectorAll('[data-feat]').forEach((c) => (c.onchange = async (e) => {
      const k = e.target.dataset.feat;
      if (e.target.checked && !((aiState().models || {})[k] || '')) { e.target.checked = false; return msg('Escolha o modelo antes de ligar.', true); }
      await save({ features: { [k]: e.target.checked } });
    }));
    root.querySelectorAll('[data-ai-test]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.aiTest, old = b.textContent;
      b.disabled = true; b.textContent = 'Testando…';
      try { msg(await window.minuta.aiTest({ provider: aiState().provider, baseUrl: aiState().baseUrl, models: aiState().models }, k)); }
      catch (e) { msg(e.message, true); }
      finally { b.disabled = false; b.textContent = old; }
    }));
  }

  async function renderSettings(root) {
    const S = A.state, st = S.settings, md = S.models || {};
    const keep = root.querySelector('.scroll'); const top = keep ? keep.scrollTop : 0;
    let mics = [], outs = [], micNote = '';
    try {
      const sys = await window.minuta.mediaAccess('microphone').catch(() => 'granted');
      if (sys === 'denied' || sys === 'restricted') {
        micNote = S.platform === 'win32'
          ? 'O Windows está bloqueando o microfone para aplicativos de área de trabalho. Clique em "Microfone" abaixo e ligue "Acesso ao microfone" e "Permitir que os aplicativos da área de trabalho acessem o microfone".'
          : 'O sistema está bloqueando o microfone. Use o botão "Microfone" abaixo para liberar.';
      } else {
        // Sem permissão já concedida, o Chromium devolve a lista vazia ou sem nomes.
        // Abrir o microfone por um instante libera a lista completa.
        try { const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }); tmp.getTracks().forEach((t) => t.stop()); }
        catch (e) { micNote = e.name === 'NotFoundError' ? 'Nenhum microfone encontrado no computador.' : 'Não foi possível abrir o microfone (' + e.name + ').'; }
      }
      const ds = await navigator.mediaDevices.enumerateDevices();
      mics = ds.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
      outs = ds.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications');
      if (!micNote && !mics.length) micNote = 'Nenhum microfone encontrado.';
      if (!micNote && !outs.length) micNote = 'Nenhuma saída de áudio ativa. Sem uma saída ligada, o Windows não entrega áudio ao app e a gravação sai muda. Ligue uma caixa de som ou um fone.';
    } catch (e) { micNote = 'Falha ao listar os dispositivos: ' + e.message; }
    const items = (md.items || []).map((i) => `<li>${esc(i.label)} — ${i.installed ? '<span style="color:var(--ok)">pronto</span>' : '<span style="color:var(--text-3)">falta baixar</span>'} <span class="help">(${GB(i.size)})</span></li>`).join('');
    root.innerHTML = `<div class="toolbar drag"><div class="crumbs"><span>Ajustes</span></div></div>
      <div class="scroll"><div class="page">
        <h1 class="page-title">Ajustes</h1><p class="sub">Tudo fica no seu computador. Sem conta, sem chave, sem envio de áudio para a internet.</p>
        ${A.downloadBanner()}
        <div class="card"><h3>Modo</h3><div style="padding:14px 16px">${A.modeCards(st.mode)}
          <ul style="margin:14px 0 0;padding-left:18px;color:var(--text-2);font-size:13px">${items}</ul>
          <div class="filters" style="margin:12px 0 0">${md.ready ? '' : '<button class="btn sm primary" id="s-dl">Baixar o que falta</button>'}<button class="btn sm ghost" id="s-rm">Remover modelos do outro modo</button></div></div></div>
        <div class="card"><h3>Geral</h3>
          <div class="field"><div><label for="s-name">Seu nome</label><div class="help">Como você aparece na transcrição e na ata</div></div><input class="input" id="s-name" value="${esc(st.userName)}" maxlength="60" placeholder="Você"></div>
          <div class="field"><div><label>Pasta das reuniões</label><div class="help">Áudio, transcrição e ata de cada reunião</div></div><div style="display:flex;gap:8px;align-items:center;min-width:0"><span class="selectable" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)">${esc(st.rootDir)}</span><button class="btn sm" id="s-dir">Alterar…</button></div></div>
          <div class="field"><div><label for="s-lang">Idioma da ata</label><div class="help">A transcrição detecta o idioma sozinha</div></div><select class="select" id="s-lang">${[['auto', 'Automático (o da reunião)'], ['pt', 'Português'], ['en', 'English'], ['es', 'Español']].map(([v, l]) => `<option value="${v}" ${st.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="card"><h3>Gravação</h3>
          <div class="field"><label for="s-mic">Microfone</label><select class="select" id="s-mic"><option value="default">Padrão do sistema</option>${mics.filter((d) => d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}" ${st.micDeviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Microfone')}</option>`).join('')}</select></div>
          <div class="field"><div><label>Saída de áudio</label><div class="help">A call precisa sair por aqui para o Minuta ouvir os participantes</div></div><span style="color:var(--text-2);font-size:13px;text-align:right">${outs.length ? esc(outs.map((d) => d.label || 'Saída de áudio').join(', ')) : 'nenhuma encontrada'}</span></div>
          ${micNote ? `<div class="field"><div><label style="color:var(--warn,#b45309)">Atenção</label><div class="help">${esc(micNote)}</div></div><button class="btn sm" id="s-fix">Abrir permissões</button></div>` : ''}
          <div class="field"><div><label>Atalho para gravar</label><div class="help">Funciona com o app em segundo plano</div></div><div style="display:flex;gap:8px;align-items:center"><span class="kbd" id="s-sc" style="font-size:12.5px;padding:5px 8px">${esc(A.shortcutLabel())}</span><button class="btn sm" id="s-scb">Alterar</button></div></div>
          <div class="field"><div><label for="s-keep">Guardar as faixas separadas</label><div class="help">Ocupa mais espaço, mas permite refazer a transcrição depois (menu da reunião)</div></div><label class="switch"><input type="checkbox" id="s-keep" ${st.keepTracks ? 'checked' : ''}><i></i></label></div>
          <div class="field"><div><label for="s-consent">Lembrete de consentimento</label><div class="help">Avisa para você informar os participantes ao começar</div></div><label class="switch"><input type="checkbox" id="s-consent" ${st.consentReminder ? 'checked' : ''}><i></i></label></div>
          ${S.platform === 'linux' ? '' : `<div class="field"><div><label for="s-login">Abrir ao iniciar o computador</label><div class="help">Fica discreto na barra de menus / bandeja</div></div><label class="switch"><input type="checkbox" id="s-login" ${st.launchAtLogin ? 'checked' : ''}><i></i></label></div>`}
          <div class="field"><div><label>Permissões</label><div class="help">Microfone e som do computador</div></div><div style="display:flex;gap:8px"><button class="btn sm" id="s-pm">Microfone</button><button class="btn sm" id="s-ps">Som do computador</button></div></div>
        </div>
        ${aiCard()}
        <div class="card"><h3>Sobre</h3>
          <div class="field"><label>Versão</label><span>Minuta ${esc(S.version)} · ${esc(S.platform)}</span></div>
          <div class="field"><div><label>Privacidade</label></div><span class="help" style="font-size:13px;color:var(--text-2)">A internet só é usada para baixar os modelos (GitHub e Hugging Face). Sem telemetria. Excluir uma reunião apaga os arquivos dela.</span></div>
          <div class="field"><div><label>Diagnóstico de áudio</label><div class="help">Testa microfone, saída e som do computador e copia o resultado</div></div><div style="display:flex;gap:8px"><button class="btn sm" id="s-diag">Testar e copiar</button><button class="btn sm" id="s-log">Abrir log</button></div></div>
          ${A.updateCard()}
          <div class="field" id="s-diag-out" style="display:none"><pre class="selectable" style="white-space:pre-wrap;font-size:12px;color:var(--text-2);margin:0;width:100%"></pre></div>
        </div>
      </div></div>`;
    const sc = root.querySelector('.scroll'); if (sc && top) sc.scrollTop = top; // a tela não volta ao topo
    const $ = (s) => root.querySelector(s);
    const save = async (p) => { try { S.settings = await window.minuta.saveSettings(p); } catch (e) { toast(e.message, 'err'); } };
    root.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.mode === st.mode) return;
      await save({ mode: b.dataset.mode }); await A.refreshInfo(); renderSettings(root); A.renderSidebar();
      toast(b.dataset.mode === 'advanced' ? 'Modo Avançado: baixando o que falta. As próximas reuniões já usam o novo modo.' : 'Modo Light ativado.');
    }));
    const dl = $('#s-dl'); if (dl) dl.onclick = () => window.minuta.downloadModels(st.mode);
    $('#s-rm').onclick = async () => { const r = await window.minuta.removeUnusedModels(); toast(r.length ? 'Modelos removidos.' : 'Não havia nada para remover.'); await A.refreshInfo(); renderSettings(root); };
    $('#s-name').onchange = (e) => save({ userName: e.target.value });
    $('#s-dir').onclick = async () => { const d = await window.minuta.chooseFolder(); if (d) { await save({ rootDir: d }); await A.refreshAll(); renderSettings(root); } };
    $('#s-lang').onchange = (e) => save({ language: e.target.value });
    $('#s-mic').onchange = (e) => save({ micDeviceId: e.target.value });
    $('#s-consent').onchange = (e) => save({ consentReminder: e.target.checked });
    $('#s-keep').onchange = (e) => save({ keepTracks: e.target.checked });
    const lg = $('#s-login'); if (lg) lg.onchange = (e) => save({ launchAtLogin: e.target.checked });
    $('#s-pm').onclick = () => window.minuta.openPrivacy('microphone');
    $('#s-ps').onclick = () => window.minuta.openPrivacy('screen');
    bindAi(root);
    A.bindUpdate(root);
    $('#s-log').onclick = () => window.minuta.openLog();
    const fx = $('#s-fix'); if (fx) fx.onclick = () => window.minuta.openPrivacy('microphone');
    $('#s-diag').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Testando…';
      try {
        const txt = await A.audioDiag();
        const box = $('#s-diag-out'); box.style.display = ''; box.querySelector('pre').textContent = txt;
        try { await navigator.clipboard.writeText(txt); toast('Diagnóstico copiado. Pode colar na conversa.'); }
        catch (_) { toast('Diagnóstico pronto abaixo (selecione e copie).'); }
      } catch (err) { toast('O diagnóstico falhou: ' + err.message, 'err'); }
      finally { b.disabled = false; b.textContent = 'Testar e copiar'; }
    };
    $('#s-scb').onclick = () => {
      const k = $('#s-sc'); k.textContent = 'Pressione as teclas…';
      const onKey = async (e) => {
        e.preventDefault();
        if (e.key === 'Escape') { done(); return; }
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        const parts = [];
        if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift');
        if (parts.length === 0) { k.textContent = 'Use ⌘/Ctrl com outra tecla'; return; }
        const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key;
        await save({ shortcut: [...parts, key].join('+') }); done();
      };
      const done = () => { window.removeEventListener('keydown', onKey, true); k.textContent = A.shortcutLabel(); };
      window.addEventListener('keydown', onKey, true);
    };
  }

  A.shortcutLabel = () => {
    const s = (A.state.settings.shortcut || '').split('+'), mac = A.state.platform === 'darwin';
    return s.map((p) => (p === 'CommandOrControl' ? (mac ? '⌘' : 'Ctrl') : p === 'Shift' ? (mac ? '⇧' : 'Shift') : p === 'Alt' ? (mac ? '⌥' : 'Alt') : p)).join(mac ? '' : '+');
  };

  // Faixa de download (aparece em várias telas)
  A.downloadBanner = () => `<div data-dlb>${dlInner()}</div>`;
  function dlInner() {
    const md = A.state.models; if (!md || !A.state.settings.onboarded) return '';
    const d = md.download || {};
    if (d.active) { const p = d.total ? (100 * d.received) / d.total : 0; return `<div class="banner"><div class="grow"><b>Preparando a IA local… ${Math.round(p)}%</b><small>Baixando ${esc(d.label || 'modelos')}. Você já pode gravar: a ata sai quando terminar.</small><div class="bar"><i style="width:${p.toFixed(1)}%"></i></div></div><button class="btn sm ghost" data-dl-cancel>Pausar</button></div>`; }
    if (d.error) return `<div class="banner err"><div class="grow"><b>O download dos modelos parou.</b><small>${esc(d.error)}</small></div><button class="btn sm" data-dl-retry>Tentar de novo</button></div>`;
    if (!md.ready) return `<div class="banner warn"><div class="grow"><b>Faltam modelos para o modo ${A.state.settings.mode === 'advanced' ? 'Avançado' : 'Light'}.</b><small>${GB(md.missing || 0)} para baixar. Depois tudo funciona sem internet.</small></div><button class="btn sm primary" data-dl-retry>Baixar agora</button></div>`;
    return '';
  }
  A.bindDownloadBanner = (root) => {
    root.querySelectorAll('[data-dl-cancel]').forEach((b) => (b.onclick = () => window.minuta.cancelDownload()));
    root.querySelectorAll('[data-dl-retry]').forEach((b) => (b.onclick = () => { A.state.models.download = { active: true, received: 0, total: 1, label: 'modelos' }; window.minuta.downloadModels(A.state.settings.mode); A.rerender(); }));
  };

  A.renderSettings = renderSettings;
})(window.App);
