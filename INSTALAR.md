# Minuta: como instalar

O Minuta grava a reunião (sua voz e o som da call), transcreve, separa quem falou e escreve a ata no seu computador.
Não pede conta, chave de API nem token. A internet só é usada uma vez, para baixar a IA local.

| Sistema | Arquivo | Requisitos |
|---|---|---|
| Windows 10/11 (64 bits) | `Minuta-Setup-1.1.2-x64.exe` | 8 GB de RAM (Light) ou 16 GB (Avançado) |
| Mac com chip Apple (M1, M2, M3, M4) | `Minuta-1.1.2-mac-arm64.zip` | macOS 14.2 ou mais novo para gravar o som da call |
| Mac com Intel | `Minuta-1.1.2-mac-x64.zip` | macOS 14.2 ou mais novo |

> No Mac não existe `.exe`: a versão de Mac é um app (`Minuta.app`) dentro de um `.zip`.

## Windows

1. Abra `Minuta-Setup-1.1.2-x64.exe`.
2. O Windows pode mostrar **"O Windows protegeu o computador"**, porque o instalador não tem assinatura digital paga.
   Clique em **Mais informações → Executar assim mesmo**.
3. Siga o instalador. Não precisa de administrador; ele cria atalhos no menu Iniciar e na área de trabalho.

## Mac

1. Dê dois cliques no `.zip`. Ele vira `Minuta.app`.
2. Arraste o `Minuta.app` para **Aplicativos**.
3. Na primeira vez, o macOS avisa que não consegue verificar o desenvolvedor, porque o app não é notarizado pela Apple.
   Faça assim:
   - Abra **Ajustes do Sistema → Privacidade e Segurança**.
   - Role até a mensagem sobre o Minuta e clique em **Abrir mesmo assim**.
   - Se preferir o Terminal: `xattr -dr com.apple.quarantine /Applications/Minuta.app`
4. Quando o app pedir, permita **Microfone** e **Gravação de áudio do sistema** (ou "Gravação de tela e áudio do
   sistema", conforme a versão do macOS). Sem a segunda permissão, só a sua voz é gravada.

## Primeira abertura (todas as plataformas)

O app mostra 4 passos rápidos:

1. **Boas-vindas.**
2. **Light ou Avançado.** O app recomenda um modo pela memória do computador, e dá para trocar depois em Ajustes.
3. **Teste de áudio.** Fale algo e toque um vídeo: as duas barras devem se mexer.
4. **Seu nome e a pasta das reuniões.** O padrão é `Documentos/Minuta`, e pode ser uma pasta do Drive, OneDrive ou iCloud.

Depois disso o download da IA começa em segundo plano: cerca de 1,6 GB no modo Light e cerca de 3 GB no Avançado.
**Você já pode gravar enquanto baixa.** A ata é escrita quando o download terminar. Depois, tudo funciona sem internet.

| | Light | Avançado |
|---|---|---|
| Grava você + a call | ✔ | ✔ |
| Transcrição local (Parakeet v3) | ✔ | ✔ |
| Ata com template, a partir das suas notas | ✔ (Qwen2.5 1,5B) | ✔ (Qwen3 4B) |
| Projetos, subprojetos, busca e filtros | ✔ | ✔ |
| Separa as vozes (Participante 1, 2, 3…) | | ✔ |
| Clicar num horário e ouvir aquele trecho; notas com horário | | ✔ |
| Perguntas sobre a reunião | | ✔ |

## Usar um serviço de IA no lugar dos modelos locais (opcional)

Por padrão nada sai do seu computador. Se quiser mais qualidade ou mais velocidade, dá para apontar partes do
trabalho para um serviço compatível com a API da OpenAI (OpenAI, OpenRouter, Groq, ou um servidor seu).

Em **Ajustes › Serviços de IA**: escolha o serviço (OpenAI, OpenRouter, Groq, xAI ou um endereço seu, inclusive
Ollama e LM Studio), cole a chave e clique em **Salvar**. O app já busca a lista de modelos do serviço, e o botão
ao lado de cada parte abre o seletor com essa lista — dá para buscar ou digitar um nome que não esteja lá.
Depois use **Testar** e só então ligue a chavinha. Cada parte é independente:

| Parte | O que é enviado | Se desligada |
|---|---|---|
| Transcrição | o áudio da reunião, em blocos | transcreve no seu computador (Parakeet) |
| Ata | a transcrição e as suas notas | escreve no seu computador (Qwen) |
| Perguntas | a transcrição, a cada pergunta | responde no seu computador |

- **Tudo desligado = tudo local**, como antes.
- A chave fica guardada criptografada neste computador, nunca aparece de volta na tela e não vai para o log.
- O botão **Testar** confirma a chave e o modelo antes de você ligar a opção.
- Se o serviço falhar no meio de uma reunião, o Minuta termina com o modelo do computador em vez de perder a gravação.
- Ligando a transcrição ou a ata no serviço, o download do modelo local correspondente deixa de ser necessário.
- **OpenRouter e xAI não transcrevem áudio**: para transcrição use OpenAI, Groq ou a do seu computador — o app
  desabilita a opção sozinho quando o serviço não suporta.
- Trocar de serviço desliga tudo e limpa os modelos, porque a chave e os nomes de modelo de um não valem no outro.

## Uso no dia a dia

1. Clique em **Nova reunião** (`Ctrl/⌘ + N`) e depois em **Gravar**. Também dá para usar o atalho global `Ctrl/⌘ + Shift + R`,
   inclusive com o app minimizado.
2. Anote só o essencial na aba **Notas**. A ata parte dessas notas: o que você escreveu aparece em preto, e o que a IA completou aparece em cinza.
3. Clique em **Encerrar**. Em seguida, o app finaliza a transcrição, separa as vozes e escreve a ata.
4. Para trocar o template, clique no nome do template no topo da reunião. A ata é refeita sem reprocessar o áudio.
5. Para organizar, arraste a reunião para um projeto na barra lateral, ou use o seletor de projeto no topo.

**Avise os participantes de que a reunião está sendo gravada.**

## Onde ficam os arquivos

Cada reunião vira uma pasta em `Documentos/Minuta/Reuniões/` com estes arquivos:
- `audio.wav`: o áudio completo.
- `transcript.json` e `transcricao.txt`: a transcrição.
- `ata.json` e `ata.md`: a ata.
- `meeting.json`: título, projeto e notas.

Os projetos e os templates ficam em `Documentos/Minuta/biblioteca.json`. Os modelos de IA ficam na pasta de dados do app:
- Windows: `%APPDATA%\Minuta\models`
- Mac: `~/Library/Application Support/Minuta/models`

## Problemas comuns

- **Não aparece microfone na lista, ou a gravação sai muda:** em Ajustes, clique em **Diagnóstico de áudio › Testar e copiar**.
  Ele diz exatamente onde trava. No Windows, as duas causas comuns são:
  - **Acesso ao microfone bloqueado:** abra Configurações › Privacidade e segurança › Microfone e ligue
    **Acesso ao microfone** e **Permitir que os aplicativos da área de trabalho acessem o microfone**.
  - **Nenhuma saída de áudio ligada:** sem fone ou caixa de som ativa, o Windows não entrega áudio ao app e a
    gravação fica muda. Ligue uma saída e reabra o Minuta.
- **"Não estou ouvindo o som do computador":**
  - No Mac, libere "Gravação de áudio do sistema" em Privacidade e Segurança e reabra o app.
  - No Windows, confira se o som da call sai pelo dispositivo padrão.
- **A transcrição ficou ruim:** em Ajustes, ligue **Guardar as faixas separadas**. Com isso, o menu da reunião
  passa a ter **Refazer transcrição**, que reprocessa o áudio sem precisar gravar de novo (ocupa mais espaço em disco).
- **A ata demorou:** a IA roda no processador. Uma reunião de 1 hora pode levar alguns minutos, mais no modo Avançado.
- **Download parou:** em Ajustes, clique em **Baixar o que falta**. O download continua de onde parou.
- **Diagnóstico:** em Ajustes, clique em **Abrir arquivo de log**.
