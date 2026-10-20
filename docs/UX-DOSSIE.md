# Dossiê de UX: Minuta (engenharia reversa + especificação)

**Projeto:** Minuta, um app desktop (Windows e macOS) que grava reuniões, transcreve, separa vozes e escreve a ata, tudo localmente
**Data da investigação:** 20/10/2026 · **Modo:** profundo + implementação · **Skill:** ux-reverse-engineering

---

## 1. Diagnóstico contextual

**JTBD:** "Quando estou numa call, quero prestar atenção na conversa e sair dela com uma ata confiável, organizada por projeto, sem configurar nada."

**O que o usuário pediu, de forma explícita**
- Instalador `.exe`. No macOS, o equivalente é `.app`/`.dmg`, porque `.exe` não roda no Mac.
- Onboarding com escolha entre **Light** e **Avançado**.
- Light: gravar, transcrever e gerar a ata com uma IA leve.
- Avançado: separa vozes, permite ir a um ponto da gravação e anotar durante a reunião, com a ata partindo das anotações.
- Interface no estilo dos apps de Mac, lembrando o Granola.
- Projetos e subprojetos; filtros por nome, data e projeto.
- Templates de ata definidos pelo usuário.
- **Fricção mínima:** nada de API key nem conta. As integrações anteriores com Claude e Hugging Face ficam de fora.

**O que é suposição (rotulado)**
- Usuário único e local, com reuniões em pt-BR na maior parte.
- Notebook comum, sem GPU dedicada (8–16 GB de RAM).
- Reuniões de 15 a 90 minutos, pelo Meet, Zoom ou Teams.

**Restrições técnicas verificadas (20/10/2026)**
- Áudio do sistema no Electron: `setDisplayMediaRequestHandler` com `audio: 'loopback'`.
  - No Windows é suportado.
  - No macOS, desde o Electron 39 o Chromium usa a CoreAudio Tap API (macOS 14.2+) e exige `NSAudioCaptureUsageDescription` no Info.plist. Sem essa chave, o stream sai mudo sem erro. ([desktopCapturer docs](https://electronjs.org/docs/api/desktop-capturer), [session docs](https://www.electronjs.org/docs/latest/api/session))
- Transcrição, VAD e embeddings de voz rodam localmente com `sherpa-onnx-node` 1.13.8, que tem binários prontos para win-x64, darwin-arm64 e darwin-x64. Os modelos vêm de releases públicas no GitHub, sem token.
- A IA da ata roda localmente com `node-llama-cpp` 3.22.2, que tem binários prontos para Windows (CPU e Vulkan) e Mac (Metal e x64). Os modelos GGUF Apache-2.0 são baixados do Hugging Face sem login: Qwen2.5-1.5B-Instruct e Qwen3-4B-Instruct-2507.

**Jornada atual (versão anterior entregue nesta conversa)**
- Fluxo: abrir um servidor local → abrir o navegador → escolher a aba e marcar "compartilhar áudio" → gravar → configurar chave de API → receber a ata.
- Cinco pontos de fricção: servidor, navegador, seletor de aba, chave de API e token do Hugging Face.

**Oportunidades priorizadas** (impacto × alcance × confiança ÷ esforço)
1. **Gravar em 1 clique, sem seletor nem chaves.** É a fricção mais citada e trava a ativação.
2. **A ata nasce das suas notas.** O usuário confia mais no que reconhece como seu, e a revisão fica rápida.
3. **Reencontrar decisões depois**, com projetos, filtros e o salto até o trecho exato. É isso que traz o usuário de volta.

## 2. Descoberta de referências

| Produto | Por que é comparável | Evidência/data | Mecanismo candidato | Transferibilidade | Risco |
|---|---|---|---|---|---|
| Granola | Bloco de notas + áudio do sistema, sem bot | [TechCrunch 22/05/2024](https://techcrunch.com/2024/05/22/granola-debuts-an-ai-notepad-for-meetings), [Zapier 30/07/2025](https://www.zapier.com/blog/granola-ai) | Notas do usuário "enriquecidas" pela transcrição; texto do usuário em preto e da IA em cinza; templates; pastas; chat | Alta (o núcleo da experiência) | Copiar a identidade visual; depende de nuvem (aqui é local) |
| Meetily | Local-first, Whisper/Parakeet + LLM local | [DEV, 02/08/2026](https://dev.to/creeta/meetily-runs-whisper-and-ollama-locally-no-cloud-no-bot-2cl3) | Instalador nativo; escolha do motor no primeiro uso; bandeja; templates | Alta para a parte técnica | Exige Ollama separado; diarização paga; é contrarreferência de fricção |
| Apple Voice Memos / Notas | Padrão de app de Mac | Conhecimento prévio (inferido, sem fonte consultada) | Barra lateral translúcida, lista por data, conteúdo em foco | Média | Não verificado nesta sessão |

**Descartados:** Otter e Fireflies (bot entra na call, o que o usuário quer evitar) e Notion AI Meeting Notes (exige conta e nuvem).

## 3. Desmontagem

### Granola
- **Gatilho:** criar a nota antes ou durante a call (documentado). A integração com calendário também é documentada, mas fica fora do escopo aqui.
- **Durante a reunião:** o usuário digita notas livres. Linhas com `#` orientam tópicos (documentado, TechCrunch).
- **Depois:** o botão **Enhance notes** junta notas e transcrição (documentado, Zapier). O texto da IA aparece em cinza e o do usuário em preto (documentado, TechCrunch).
- **Templates:** seletor "Change template", com padrão "Auto" e opções como 1:1, Stand-Up, Weekly e personalizados (documentado, Zapier).
- **Verificação:** passar o mouse num resumo mostra o trecho da transcrição de onde ele veio (documentado).
- **Organização:** pastas, e perguntas feitas sobre uma pasta inteira (documentado).
- **Desconhecido:** o algoritmo de fusão de notas e transcrição, e as métricas de eficácia.

### Meetily (contrarreferência de fricção)
- O usuário escolhe o motor de transcrição e precisa conectar o Ollama, que deve estar rodando antes. Permissões no primeiro uso (documentado, DEV 2026).
- A diarização é beta e paga, então a versão gratuita entrega transcrição sem falantes (documentado).
- **Lição:** não pedir para o usuário instalar nem "conectar" outro programa. Tudo vem embutido.

## 4. Princípios transferíveis (sem marca)
1. **"Você escreve o essencial, a máquina completa."** As notas do usuário são o esqueleto da ata, e a transcrição preenche o resto. A diferença entre o que é seu e o que é da IA fica visível. *Necessidade atendida:* controle e confiança.
2. **"Prova a um clique."** Cada afirmação da ata leva ao trecho e ao áudio. *Necessidade atendida:* segurança para compartilhar.
3. **"Comece sem configurar."** O setup acontece em segundo plano, e o usuário já pode gravar enquanto os modelos baixam. *Necessidade atendida:* economia de tempo.
4. **"Lugar de cada coisa."** Projetos em árvore, filtros combináveis e lista por data. *Necessidade atendida:* previsibilidade.

**Por que não imitar diretamente:**
- A cor, a tipografia e os textos do Granola são identidade dele.
- O Granola depende de nuvem e de um LLM grande. Um modelo local de 1,5–4B erra mais, então a interface precisa deixar ver e corrigir a fonte (transcrição clicável, regerar com outro template).

## 5. Proposta adaptada

### Alternativas avaliadas
- **A. Granola-like completo:** editor rico e chat sobre todas as reuniões. É caro e o LLM local fica lento com muito contexto.
- **B. (escolhida) Bloco de notas + ata por template + transcrição clicável.** O chat entra só no Avançado, sobre a reunião aberta.
- **C. (MVP mínimo)** Gravar → transcrição → resumo fixo. É pouco diferenciado.

### Mapa de telas
```
Instalador (.exe / .app)
  └─ Onboarding (1ª abertura, 4 passos)
       1 Boas-vindas ("Tudo fica no seu computador. Sem conta, sem chave.")
       2 Escolha do modo: [Light ~1,6 GB] [Avançado ~3 GB] — recomenda pelo tamanho da RAM
       3 Teste de áudio: medidor do microfone + medidor do som do computador (toque um vídeo)
          └ macOS: explica a permissão "Gravação de áudio do sistema" e abre os Ajustes
       4 Seu nome + pasta das reuniões → [Começar]  (os downloads continuam em segundo plano)
  └─ Janela principal
       ├ Barra lateral (translúcida no Mac)
       │   [● Nova reunião ⌘N]  Busca ⌘K
       │   Início · Todas as reuniões
       │   PROJETOS ▸ Cliente X ▸ Onboarding  (+ / renomear / mover / excluir)
       │   Templates · Ajustes · [estado dos modelos ▓▓▓░ 62%]
       ├ Início / Lista: chips de filtro [Projeto ▾][Período ▾][Busca], grupos Hoje/Ontem/Esta semana/Mais antigas
       └ Reunião
           cabeçalho: título editável · data · duração · [Projeto ▾] · [Template ▾]
           abas: Ata | Notas | Transcrição
           barra inferior: gravação (●00:12:31 ▁▃▅ medidor · Pausar · Encerrar) → depois player (▶ 00:03:10 ─●── 1x)
  └─ Templates: lista + editor (nome, quando usar, seções [título + instrução])
  └─ Ajustes: modo, nome, pasta, idioma, microfone, atalho global, bandeja, abrir no login
```

### Fluxo principal: reunião
`idle → [Nova reunião ou ⌘⇧R global] → recording`
- Ao gravar:
  - Captura o microfone e o som do sistema, sem seletor.
  - A transcrição roda **ao vivo** em segundo plano, por trechos de fala.
  - As notas do usuário são salvas a cada tecla. No Avançado, cada linha guarda o horário em que foi escrita.
- `recording → [Encerrar] → processing`
  - Etapas visíveis: Finalizando a transcrição → Separando vozes (Avançado) → Escrevendo a ata.
  - Cada etapa mostra progresso e pode ser cancelada.
- `processing → done`: a aba Ata abre automaticamente.
  - Itens que vieram das notas do usuário aparecem em preto; complementos da IA em cinza.
  - Ações em lista com responsável e prazo.
  - Cada item tem um ícone de "fonte" que abre a transcrição no ponto citado (Avançado).
- `done → [Template ▾ / Regerar]`: regera a ata sem reprocessar o áudio.

### Tabela de estados

| Estado | Condição | UI | Ação | Próximo |
|---|---|---|---|---|
| models_missing | Modelos ainda baixando | Faixa "Baixando modelos, 62%. Você já pode gravar." | Gravar mesmo assim | recording (o processamento fica na fila) |
| idle | App aberto | Início com a lista e o botão Nova reunião | ⌘N | recording |
| recording | Captura ativa | Barra vermelha discreta, medidores, cronômetro, aviso de consentimento uma vez | Pausar / Encerrar | paused / processing |
| no_system_audio | Loopback sem sinal por 20 s | Aviso: "Não estou ouvindo o som do computador" + Como resolver | Continuar só com o microfone | recording |
| processing | Pós-gravação | Lista de etapas com progresso | Cancelar | done / error |
| error | Falha no modelo, disco ou memória | Mensagem clara + "Tentar de novo" (a transcrição já salva é mantida) | Tentar de novo | processing |
| empty | Nenhuma reunião | Ilustração simples + "Grave sua primeira reunião" + atalho | ⌘N | recording |
| done | Ata pronta | Ata / Notas / Transcrição + player | Regerar, exportar, mover de projeto | done |

### Regras
- **Consentimento:** na primeira gravação de cada reunião aparece o lembrete "Avise os participantes que você está gravando". Ele pode ser dispensado, mas nunca é escondido nas configurações.
- **Privacidade:**
  - Nenhuma rede além dos downloads de modelos, que vão ao GitHub e ao Hugging Face e aparecem explicitamente no onboarding.
  - Sem telemetria.
  - Áudio e texto ficam na pasta escolhida pelo usuário.
- **Light × Avançado:** o usuário troca de modo em Ajustes a qualquer momento. O app baixa só o que faltar.
- **Projetos:** árvore com profundidade livre. Ao excluir um projeto, as reuniões vão para "Sem projeto", nunca são apagadas junto.
- **Filtros:** combináveis (texto em título, notas, ata e transcrição + projeto, incluindo subprojetos + período). Ficam visíveis em chips que se removem com um clique.
- **Templates:** os embutidos são somente leitura, mas podem ser duplicados. Os do usuário são editáveis, com seções de título e instrução. "Automático" escolhe as seções padrão.

### Acessibilidade
- Tudo é operável por teclado:
  - ⌘/Ctrl+N: nova reunião.
  - ⌘/Ctrl+K: busca.
  - Espaço: tocar ou pausar o player, fora do editor.
  - ⌘/Ctrl+⇧+R: gravação global.
- Foco visível em todos os elementos.
- Rótulos ARIA nos botões de ícone.
- Contraste AA nos dois temas (claro e escuro, seguindo o sistema).
- O estado de gravação usa texto + ícone + cor, não só cor.
- Respeita `prefers-reduced-motion`.

## 6. Experimento e métricas (uso pessoal, sem telemetria)
- **Métrica norteadora (local, visível em Ajustes → Estatísticas):** % de reuniões gravadas com ata gerada sem erro.
- **Guardrails:**
  - Tempo de processamento ≤ 0,5× a duração da reunião no modo Light.
  - Nenhuma perda de áudio, verificada pelo tamanho do arquivo × duração.
- **Hipótese falsificável:** com notas do usuário como base, a ata precisa de menos edição. Para medir, comparar quantos caracteres o usuário edita na ata, com e sem notas, nas primeiras 10 reuniões.

## 7. Limitações e decisões abertas
- **Não verificado:**
  - A qualidade da transcrição e da diarização com vozes reais. Os testes usaram vozes sintéticas em pt-BR.
  - A qualidade da ata com os modelos reais (Qwen), que não puderam ser baixados neste ambiente.
  - O loopback no macOS em hardware real.
- **Modelos pequenos (1,5B–4B):** erram mais que modelos de nuvem. A mitigação é mostrar a fonte de cada item, permitir regerar e editar a ata.
- **Sem assinatura de código:** o Windows mostra o SmartScreen e o macOS exige "Abrir mesmo assim". Um certificado resolve isso.

## Ledger de evidências (resumo)
| ID | Afirmação | Status | Fonte | Data fonte | Confiança |
|---|---|---|---|---|---|
| E1 | Granola: IA em cinza e usuário em preto; links para a transcrição | documentado | TechCrunch | 22/05/2024 | média (pode ter mudado) |
| E2 | Granola: Enhance notes, templates (Auto/1:1/Stand-Up/Weekly), pastas, chat por pasta | documentado | Zapier | 30/07/2025 | média |
| E3 | Meetily: escolha do motor + Ollama no setup; diarização paga | documentado | DEV | 02/08/2026 | média |
| E4 | Electron: loopback no Mac via CoreAudio Tap, exige Info.plist | documentado | electronjs.org | consultado em 20/10/2026 | alta |
| E5 | Parakeet v3 int8 transcreveu o teste em pt-BR melhor que o Whisper base | observado (teste local, vozes sintéticas) | test/bench-asr.js | 20/10/2026 | média |
| E6 | Embeddings 3D-Speaker separaram os 2 falantes do teste (cos ≥0,79 × ≤0,22) | observado (sintético) | test/bench-emb.js | 20/10/2026 | média |
