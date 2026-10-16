<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-dark.png">
    <img alt="FlowCTL: um grafo ao vivo do que o Claude Code está fazendo" src="docs/media/logo-light.png" width="560">
  </picture>
</h1>

<p align="center">
  <a href="README.md">English</a> · <b>Português</b>
</p>

<p align="center">
  O que o Claude Code está fazendo, o que vem a seguir e quando ele precisa de você,<br>
  numa pequena janela flutuante no seu Mac ou PC com Windows.
</p>

<p align="center">
  <a href="https://flowctl.vercel.app"><b>Site</b></a> ·
  <a href="#instalação"><b>Instalação</b></a> ·
  <a href="#recursos"><b>Recursos</b></a> ·
  <a href="LICENSE"><b>Licença MIT</b></a>
</p>

<p align="center">
  <img alt="Um pedido ao Claude Code vira um grafo: o plano chega uma etapa por vez, as etapas ficam azuis enquanto rodam e verdes quando terminam, e dois subagentes se ramificam" src="docs/media/graph.gif" width="800">
</p>

## Por quê

Você pede algo ao Claude Code e vai fazer outra coisa enquanto ele trabalha.
Você acha que ele está trabalhando. Mas ele pode ter parado há um tempo para te
perguntar algo, e você só descobre quando volta. E, quando está trabalhando,
uma sessão longa é uma parede de texto: para saber o que ele está fazendo, o
que falta e se ele precisa de você, é preciso rolar para trás e ler. Com
algumas sessões abertas em terminais diferentes, você acaba conferindo uma por
uma.

O FlowCTL desenha a sessão. O plano do agente vira um grafo: um nó por etapa,
setas para o que depende do quê, cores para onde cada etapa está. Ele flutua
sobre as outras janelas, então uma olhada diz como o trabalho está indo e se
alguma sessão precisa de você, sem sair do que você está fazendo.

| Cor      | Significado                                       |
| -------- | ------------------------------------------------- |
| branco   | pendente                                          |
| azul     | em andamento                                      |
| amarelo  | precisa de você: um pedido de permissão ou uma pergunta |
| vermelho | falhando: um erro de ferramenta faz a etapa piscar, erros seguidos a deixam vermelha |
| verde    | concluída                                         |
| esmaecida, tracejada | pulada: a vez terminou sem ela começar (fica fora da contagem) |

## Recursos

Os clipes vêm do vídeo de lançamento, que acrescenta legendas e alguns
destaques próprios (os anéis em volta da janela e do grafo, as etiquetas dos
prompts); todo o resto é o app como ele roda.

### O plano como um grafo

As etapas que o agente declara (pelas ferramentas de tarefas do Claude Code ou
pela ferramenta FlowPlan do próprio FlowCTL), com suas dependências. Etapas que
rodam em paralelo ficam lado a lado. Os subagentes saem da etapa que os
iniciou, ou formam sua própria linha do tempo quando o agente os usa sem um
plano. A câmera acompanha o trabalho enquanto a sessão roda e mostra o grafo
inteiro quando ela descansa; arraste para mover, use pinça ou role para dar
zoom.

### Erros piscam em vermelho

Um erro de ferramenta faz a etapa piscar em vermelho; erros seguidos a deixam
vermelha, então você vê o agente contornando um problema, ou travado nele.
Passe o mouse sobre um nó para ver do que ele trata, quanto tempo levou e o
que resultou; clique nele para trazer a aba do terminal para frente.

<p align="center">
  <img alt="O teste de um subagente falha duas vezes: o nó pisca em vermelho e segue; o hover mostra o resumo dele" src="docs/media/error.gif" width="800">
</p>

### Amarelo é com você

Um pedido de permissão ou uma pergunta deixa a etapa amarela, o ícone da barra
de menus (ou da bandeja) pisca e um som curto toca. A janela fica por cima do
que você estiver fazendo, e um clique leva você ao terminal que está
esperando.

<p align="center">
  <img alt="Enquanto um vídeo toca, uma etapa fica amarela num pedido de permissão para rm -rf; um clique nela traz o terminal para frente para responder" src="docs/media/yellow.gif" width="800">
</p>

### Terminou? Você vai saber

A última etapa fica verde e a vez termina: uma olhada na janela diz que o
trabalho acabou, sem rolar o terminal para trás.

<p align="center">
  <img alt="A etapa do pull request fica verde, o terminal avisa que o PR foi aberto e o grafo inteiro está verde" src="docs/media/done.gif" width="800">
</p>

### Cada prompt aumenta o grafo

Cada novo pedido continua o mesmo grafo para a direita, então uma sessão se lê
como uma história só. E cada sessão aberta ganha uma página: `‹ 1/3 ›` alterna
entre elas, e quando a página na tela está parada, a janela passa para a
sessão que começa a trabalhar ou precisa de você.

<p align="center">
  <img alt="Um segundo prompt é digitado e enviado; as etapas dele crescem no mesmo grafo, logo depois da última etapa do primeiro prompt" src="docs/media/prompt.gif" width="800">
</p>

### Do seu jeito

Tudo fica no ícone da barra de menus (ou da bandeja): dois visuais (pixel art
com sons 8-bit, ou smooth com tons limpos), com som ou em silêncio, tema,
tamanho, opacidade e onde a janela fica: arraste para qualquer lugar.

<p align="center">
  <img alt="Na barra de menus: Look em Smooth, Sound em Off, e a janela arrastada para o canto de baixo" src="docs/media/settings.gif" width="800">
</p>

### Fora do caminho quando você não precisa

Depois de cinco minutos sem nada rodando, a janela some até uma sessão voltar
a trabalhar (Hide When Idle). Antes disso, entra a animação de ocioso: depois
de um minuto, os nós saem do grafo e formam uma figura que gira devagar. As
duas vêm ligadas e podem ser desligadas no menu.

<p align="center">
  <img alt="A janela volta da barra de menus e os nós formam uma figura que gira devagar" src="docs/media/dream.gif" width="800">
</p>

## Instalação

Requisitos: macOS 13 ou mais novo, ou Windows 10 ou 11 (64 bits), e Claude
Code 2.1.295 ou mais novo. O FlowCTL tem duas partes, as duas instaladas de
dentro de uma sessão do Claude Code:

```
/plugin install flowctl --marketplace MarcoFilho1/FlowCTL
/flowctl init
```

1. **O plugin.** A primeira linha adiciona este repositório como marketplace
   de plugins (responda `y`) e instala o plugin. Escolha o escopo **user** para
   ele funcionar em todos os projetos. O plugin acompanha a sessão e monta o
   grafo.
2. **O app do overlay.** `/flowctl init` baixa o app da mesma versão nos GitHub
   Releases deste repositório, confere o SHA-256 e a assinatura, instala (sem
   senha de administrador) e abre: em `~/Applications` no Mac, em
   `%LOCALAPPDATA%\Programs\FlowCTL` com um atalho no menu Iniciar no Windows.
   O app é a janela flutuante e o ícone da barra de menus (ou da bandeja).

## No dia a dia

**Você instala uma vez.** Não precisa rodar nenhum dos dois comandos de novo
ao abrir uma sessão nova:

- Toda sessão do Claude Code que você inicia carrega o plugin sozinha.
- Quando uma sessão começa, o plugin abre o overlay se ele ainda não estiver
  aberto. Várias sessões dividem uma janela, uma página cada.
- A janela aparece quando uma sessão começa a trabalhar e some depois de cinco
  minutos sem nada rodando. Feche com **×** e ela fica fechada até você
  reabrir pelo ícone da barra de menus (ou da bandeja).

**Sessões que já estavam abertas** quando você instalou o plugin: rode
`/reload-plugins` em cada uma para carregá-lo. A instrução que pede ao agente
para declarar um plano só chega a partir da próxima sessão, então reinicie
essas sessões com `claude --continue` para manter a conversa e ter o plano
também.

**Como o grafo cresce?** Cada prompt acrescenta algo a ele. Um trabalho de
três etapas ou mais aparece como o plano que o agente declara (o FlowCTL pede
isso a ele; você pode desligar esse pedido nas opções do plugin); uma pergunta
rápida ou uma correção de um comando só acrescenta um nó, com o nome do seu
prompt. A sessão se lê da esquerda para a direita, um prompt depois do outro.

**Atualizando.** Quando sair uma versão nova, atualize o plugin pelo `/plugin`
(ou `claude plugin update flowctl@flowctl`) e rode `/reload-plugins`: o início
da próxima sessão atualiza o app também, com o mesmo download e as mesmas
verificações do `/flowctl init`. Dá para desligar isso nas opções do plugin e
rodar o `/flowctl init` você mesmo.

## Comandos e opções

| Comando | O que faz |
| ------- | --------- |
| `/flowctl init` | Instala ou atualiza o app do overlay para a versão do plugin; abre o app se ele já estiver instalado |
| `/flowctl init --force` | Instala de novo |
| `/flowctl init --from-source` | Compila a partir do código da tag em vez de baixar (só macOS; precisa de pnpm, Node 22 e Swift) |
| `/flowctl uninstall` | Fecha e remove o app (o plugin é removido pelo `/plugin`) |

O **ícone da barra de menus** abre um painel no estilo da Central de
Controle: mostrar ou esconder o overlay, suas sessões (clique numa para trazer
o terminal dela para frente), o visual, o tema (automático, escuro, claro), o
tamanho (pequeno, médio, grande) e o som, e botões para sempre por cima,
animação de ocioso, mostrar automaticamente e esconder quando ocioso.
**Ajustes…** guarda tudo isso, mais opacidade e mostrar subagentes. No Windows, no estilo do próprio Windows 11:
o clique esquerdo no ícone da bandeja abre um painel como as Configurações
Rápidas (botões, controle de opacidade, visual, tema, tamanho e som, suas
sessões), e Configurações abre uma página como as Configurações do Windows; o
clique direito abre um menu curto.

As **opções do plugin** (`/plugin`, depois flowctl):

| Opção | Padrão | |
| ----- | ------ | - |
| Open the overlay | ligado | Abre o app quando uma sessão começa, se ele estiver instalado |
| Update the overlay | ligado | Atualiza o app no início de uma sessão quando ele está mais antigo que o plugin |
| Ask the agent to declare its plan | ligado | Sem isso, o grafo costuma ter um nó só |
| Errors before red | 3 | Erros de ferramenta seguidos que deixam a etapa atual vermelha |
| Record events | desligado | Guarda os eventos da sessão em `~/.flowctl/recordings`, para relatar bugs |

## Privacidade

Tudo fica no seu computador. O plugin entrega cada grafo ao app por um socket
local (`~/.flowctl/overlay.sock`; no Windows, `127.0.0.1` com um token de
`~/.flowctl/overlay.json`) e guarda o mais recente de cada sessão em
`~/.flowctl/sessions`. Um grafo contém títulos, status e tempos das etapas, um
resumo curto do que uma etapa ou um subagente respondeu e a primeira linha de
um erro de ferramenta; nunca seus prompts, o conteúdo dos arquivos ou a saída
completa dos comandos. Nada é enviado para lugar nenhum: a única chamada de
rede é o `/flowctl init` baixando o app do GitHub.

## Como funciona

```
Sessão do Claude Code ──hooks──▶ plugin (mod/) ──snapshot──▶ app do overlay (apps/overlay*)
  tarefas, subagentes,            monta o grafo,              uma janela flutuante que
  pedidos de permissão            organiza o layout           desenha o grafo (apps/viewer)
```

O plugin é um [mod do Claude Code](https://code.claude.com/docs/en/plugins/mods/overview):
ele observa os eventos da sessão (ferramentas de tarefas, subagentes,
verificações de permissão, erros de ferramenta) e nunca muda o que o agente
faz, fora o pedido opcional para declarar um plano. O app é um painel nativo
(Swift no macOS, Tauri no Windows) com uma pequena web view; o grafo é
desenhado pelo viewer, uma página React empacotada dentro do app.

## Próximos passos

- **Linux.** O plugin, o viewer e o app do Windows (Tauri) já rodam lá; o
  próximo passo é empacotar.
- Suas ideias: abra uma issue.

## Desenvolvimento

```
mod/             o plugin do Claude Code
  hooks/         módulo de hooks: register.ts
  graph/         lógica do grafo, TypeScript puro sem imports
  live/          o que o plugin mostra e faz: status line, rebuild, /flowctl
  tests/         testes do plugin, rodados pelo `claude plugin test`
  types-vendor/  tipos da API do Claude Code, versionados para o CI
apps/viewer/     o grafo, uma página React (Vite, arquivo único)
apps/overlay/    o app do macOS (SwiftPM, sem precisar do Xcode)
apps/overlay-tauri/  o app do Windows (Tauri, Rust); veja o README dele
tests/           testes unitários do mod/, rodados com node --test
fixtures/        sessões gravadas, reproduzidas pelos testes e pelo viewer
scripts/         install-overlay.sh compila e instala o app a partir do código
docs/            roadmap, notas de design e as mídias do README
```

Requer Node 22.6+, pnpm, Claude Code 2.1.295+ e, para o app, Swift (as Command
Line Tools bastam).

```sh
pnpm install
pnpm typecheck   # tsc no plugin e nos testes
pnpm test        # testes unitários
pnpm validate    # claude plugin validate + claude plugin test
pnpm viewer:test # testes do viewer

claude --plugin-dir ./mod              # uma sessão com o plugin desta pasta, com hot reload
pnpm viewer:dev                        # o viewer no navegador; ?fixture=all reproduz as gravações
scripts/install-overlay.sh --open      # compila o app e instala
```

Não rode `--plugin-dir` junto com uma cópia instalada do plugin: a sessão
carregaria o plugin duas vezes.

**Publicando uma versão.** Coloque a mesma versão em
`mod/.claude-plugin/plugin.json`, em `MOD_VERSION` no `mod/live/install.ts`, em
`apps/overlay/Resources/Info.plist` e em `apps/overlay-tauri/src-tauri/`
(`tauri.conf.json` e `Cargo.toml`), e faça push de uma tag `vX.Y.Z`. O workflow
de Release compila o app do macOS para Apple silicon e Intel e o app do
Windows para x64, e publica `FlowCTL-X.Y.Z-macos.zip` e
`FlowCTL-X.Y.Z-windows-x64.zip` com seus SHA-256, que o `/flowctl init` baixa.
Para testar uma build antes da tag, sirva um zip e o `.sha256` dele em
`<base>/vX.Y.Z/` e inicie a sessão com `FLOWCTL_RELEASE_BASE=<base>`.

Depois de atualizar o Claude Code, atualize `mod/types-vendor/claude-code.d.ts`
a partir de `mod/.claude-plugin/types/claude-code/index.d.ts` (escrito toda vez
que uma sessão carrega o mod) e aumente `CLAUDE_CODE_VERSION` no CI.

## Licença

[MIT](LICENSE)
