# Roadmap: FlowCTL v2, grafo ao vivo do agente

> Guia de desenvolvimento do recomeço até o **MVP: um overlay flutuante
> funcionando**.
> Base técnica: Claude Code **v2.1.295**. A API de mods foi conferida nos tipos
> gerados (`claude-code.d.ts`); os tipos valem mais que a documentação.
> O código antigo (orquestrador) está na tag **`v0-orchestrator`**.

---

## 1. O produto

Uma camada **somente leitura** que mostra, em grafo, o que o Claude Code está
fazendo e o que vem a seguir. Ela não muda o jeito do agente planejar: só
desenha as escolhas que ele já faz.

- **Nó** = uma task do agente. **Aresta** = dependência (`blockedBy`).
- Nós sem dependência pendente aparecem lado a lado (podem rodar em paralelo).
- Subagentes aparecem como ramos próprios.
- O grafo atualiza ao vivo e se reorganiza quando surgem tasks novas.

| Cor      | Estado                             | Origem                     |
| -------- | ---------------------------------- | -------------------------- |
| branco   | pendente                           | task `pending`             |
| azul     | em andamento                       | task `in_progress`         |
| amarelo  | precisa de input ou permissão sua  | sobreposto pelos eventos   |
| vermelho | erro sem recuperação               | sobreposto pelos eventos   |
| verde    | concluída                          | task `completed`           |

**Requisitos fixos**
1. Funciona só com `claude` no terminal, sem VS Code.
2. Sem LLM no caminho: todo o estado vem de eventos do Claude Code.
3. Um observador nunca recusa a realidade. Qualquer sequência de eventos gera
   um grafo, mesmo que inconsistente; inconsistências viram avisos, não erros.

**Definição de MVP (v0.1.0):** numa sessão real de `claude` no terminal, com o
mod instalado, uma janela flutuante sempre visível (macOS) mostra o grafo da
sessão com as 5 cores, atualizando em menos de 500 ms, sem nenhuma ação
manual depois da instalação.

**Fora do MVP:** Windows/Linux, interação que comande o agente pelo overlay,
histórico entre sessões, VS Code, `claude -p`.

---

## 2. Arquitetura

```
┌──────────────── processo do Claude Code ────────────────┐
│  mod/ (plugin)                                          │
│   hooks/register.ts ── eventos ──► graph/ (TS puro)     │
│        │                            reduce → Snapshot   │
│        ├─► status line + toasts                         │
│        └─► bridge ─┬─ POST $.http.fetch(socketPath) ─┐  │  plano A (< 50 ms)
│                    └─ $.fs.write snapshot ───────┐   │  │  fallback/recuperação
└──────────────────────────────────────────────────│───│──┘
                     ~/.flowctl/sessions/<id>.json ▼   ▼ ~/.flowctl/overlay.sock
┌──────────────── apps/overlay (macOS) ─────────────────────┐
│  Swift: NSPanel flutuante + WKWebView                     │
│   └─ apps/viewer (bundle estático) desenha o Snapshot     │
└───────────────────────────────────────────────────────────┘
```

**Decisões e porquês**
- **`mod/graph/` é a fonte única da lógica** (modelo, reducer, regras de cor,
  layout). TS puro, **sem dependências, sem imports de fora de `mod/` e sem
  `import()`**, porque um mod só importa arquivos do próprio plugin. O viewer
  (build Vite, fora do mod) importa `types`, `layout` e `status` por caminho
  relativo. Padronizar a extensão dos imports (confirmar com
  `claude plugin validate` qual o engine aceita).
- **O layout é calculado no mod** e vai pronto no snapshot (rank/ordem de cada
  nó). O viewer só desenha.
- **Transporte, plano A: socket Unix.** O overlay escuta
  `~/.flowctl/overlay.sock` e o mod faz `POST` do snapshot com
  `$.http.fetch(url, { socketPath })`. Latência abaixo de 50 ms, sem escrita
  parcial, sem FSEvents. O POST funciona também como teste de vida do overlay.
- **Fallback: arquivo** `~/.flowctl/sessions/<sessionId>.json`, para o overlay
  aberto depois da sessão recuperar o estado. `$.fs` só tem
  `read/write/list/exists/stat` (sem delete, rename nem append), então o
  arquivo leva `seq`, o leitor descarta JSON inválido, e a faxina de arquivos
  velhos é feita pelo overlay.
- **Nada pesado no caminho do evento**: hooks em `tool.call` têm orçamento de
  tempo, então `reduce` é O(evento) e POST/escrita são fire-and-forget com
  debounce.
- **Overlay em Swift + WKWebView**, não Tauri: só macOS no MVP; `NSPanel` com
  `.floating` + `canJoinAllSpaces` é o comportamento exato desejado.
- **O overlay é um consumidor burro**: não interpreta eventos, só desenha
  snapshots. Toda a regra fica testável em `mod/graph/`.
- **Terminal**: no MVP só status line + toasts (baratos). O pane `/grafo`
  com o grafo no terminal fica para depois do MVP, já que o produto é o overlay.

### Estrutura do repositório (v2)

```
FlowCTL/
├─ mod/                         # plugin do Claude Code
│  ├─ .claude-plugin/plugin.json
│  ├─ hooks/hooks.json          # { "modules": ["./register.ts"] }
│  ├─ hooks/register.ts         # liga eventos → graph → UI/bridge
│  ├─ graph/                    # TS puro, sem deps
│  │  ├─ types.ts  reduce.ts  status.ts  layout.ts  cycles.ts
│  ├─ ui/                       # status line, toasts (pane pós-MVP)
│  ├─ bridge/                   # snapshot → socket/arquivo, abre o overlay
│  ├─ types/index.d.ts          # contrato de $.state
│  ├─ types-vendor/             # cópia versionada dos tipos do Claude Code (CI)
│  ├─ .claude-plugin/types/     # gerado pelo engine a cada load (.gitignore)
│  └─ tests/*.test.ts           # claude plugin test (kit claude-code/testing)
├─ tests/graph/                 # testes puros de mod/graph (node --test)
├─ fixtures/                    # sessões reais gravadas (JSONL)
├─ apps/viewer/                 # React + SVG, build estático
├─ apps/overlay/                # Swift (Xcode/SwiftPM)
├─ docs/
└─ .github/workflows/ci.yml
```

---

## 3. Modelo de dados

```ts
type NodeStatus = "pending" | "running" | "needs_you" | "error" | "done";

interface GraphNode {
  id: string;              // taskId do Claude, ou "agent:<agentId>", ou "turn:<n>"
  kind: "task" | "agent" | "turn";
  title: string;           // subject / description do Agent
  activeForm?: string;     // texto do spinner
  status: NodeStatus;
  baseStatus: "pending" | "in_progress" | "completed" | "deleted";
  overlay?: { kind: "permission" | "question" | "error"; detail: string; since: number };
  agentId?: string;        // dono (undefined = agente principal)
  blockedBy: string[];
  inferredEdges?: boolean; // ligado em sequência por falta de deps declaradas
}

interface Snapshot {
  schema: 1;
  seq: number;             // cresce a cada escrita
  sessionId: string;
  cwd: string;
  updatedAt: number;
  sessionState: "working" | "waiting_you" | "idle" | "ended";
  nodes: GraphNode[];
  layout: Record<string, { rank: number; order: number }>;
  warnings: string[];      // ciclos, ids desconhecidos etc.
}
```

`reduce(state, event) → state` é **puro e determinístico**: o mesmo log de
eventos gera sempre o mesmo snapshot. É isso que permite testar tudo com
fixtures.

---

## 4. Mapa evento → grafo

| Precisa de | Evento no mod | Regra |
| --- | --- | --- |
| Criar nó | `tool.call` `TaskCreate` | id vem do resultado (`task.id`); `subject`, `activeForm`. Confirmação: `classic.TaskCreated`. |
| Status | `tool.call` `TaskUpdate.status` | `deleted` remove o nó (some com fade no viewer). |
| Arestas | `TaskUpdate.addBlockedBy` / `addBlocks` | Declaradas = linha sólida. |
| Reconciliar | resultado de `TaskList` / `TaskGet` | Corrige deps e status que o mod perdeu (ex.: reload). |
| Fallback | `TodoWrite` (`newTodos`) | Lista sem ids: id = hash do `content`; arestas em sequência, tracejadas. Só aparece com flag ou Bedrock/Vertex. |
| Subagente | `tool.call` `Agent` + `$.agent.list()` | Nó `agent:<agentId>` (id vem do resultado). `$.agent.list()` traz `{ status, parentId, description }`: `parentId` dá a árvore de subagentes. Consultado no `turn.complete` e num `$.clock.every` leve enquanto houver subagente vivo. |
| Fim de subagente | `classic.SubagentStop`; status `completed`/`failed`/`killed` no `$.agent.list()` | Done, ou error se `failed`. (`AgentStatus` é campo, não evento.) |
| Amarelo: permissão | **`classic.PermissionRequest`** (`tool_name`, `tool_input`) | Gatilho primário. Marca a task `in_progress` do agente dono; sem task, marca a sessão. Limpa quando o `tool.call` correspondente termina, em `classic.PermissionDenied` ou no `prompt.submit`. `tool.check` = `ask` é só pista: em auto mode o "ask" pode ir para o classificador, não para você. Notification `permission_prompt` chega ~6 s depois e só reconcilia. |
| Amarelo: pergunta | `tool.call` `AskUserQuestion` | Gatilho primário; limpa quando o resultado traz `answers`. Notifications `agent_needs_input` / `elicitation_*` reconciliam. |
| Sessão esperando | Notification `idle_prompt` | `sessionState = "waiting_you"` (cabeçalho do overlay, não um nó). |
| Vermelho | `turn.complete` com `reason: "error"` ou `"refusal"` e task `in_progress`; subagente `failed`; `classic.StopFailure`; ≥ N `isError` seguidos na mesma task | N configurável (`userConfig`, padrão 3). `reason: "aborted"` (Esc do usuário) **não** é erro: a task volta a pendente. Volta a azul se a task progredir com sucesso. |
| Sem tasks | `turn.start` / `turn.complete` | Nó implícito `turn:<n>` ("Turno atual") para o grafo nunca ficar vazio. |
| Sessão retomada | `session.start` após `--resume` / `/clear` | Reconstrói pelo `TaskList`; caso de teste obrigatório. |

---

## 5. Fases até o MVP

Cada fase é **uma branch `feat/*` + PR**, com CI verde antes do merge.
Estimativas para uma pessoa com o Claude ajudando, já com folga de ~35% (a
API de mods é early access e muda entre versões).

### Fase 0: Recomeço do repositório (1 dia)
**Objetivo:** repositório limpo para a v2.
- [ ] Remover `packages/`, `apps/playground/`, `docs/superpowers/`, `docs/protocol-v0.md` e o workspace pnpm antigo (tudo preservado em `v0-orchestrator`).
- [ ] Esqueleto do mod **escrito à mão** (`claude plugin init` gera outro tipo de plugin):
  - `.claude-plugin/plugin.json`;
  - `hooks/hooks.json` = `{ "modules": ["./register.ts"] }`;
  - `hooks/register.ts` exportando `register(on, options)`.
- [ ] `.gitignore`: `mod/.claude-plugin/types/` (gerado a cada load com `--plugin-dir`).
- [ ] `mod/types-vendor/`: cópia versionada do `claude-code.d.ts` + o `tsconfig` do cabeçalho dele, para o CI checar tipos sem uma sessão do Claude.
- [ ] Copiar para `mod/graph/cycles.ts` a detecção de ciclo do v0, adaptada e sem imports.
- [ ] **Verificar se `claude plugin validate/test` roda headless e sem login.** Se sim, entram no CI. Se não, o CI roda `tsc` + testes de `mod/graph` com `node --test --experimental-strip-types`, e `plugin validate/test` fica como checagem local obrigatória antes do PR.
- [ ] README novo (visão + `claude --plugin-dir ./mod`).

**Pronto quando:** `claude --plugin-dir ./mod` carrega o mod sem erros e o CI está verde.

### Fase 1: Spikes e gate (3 dias)
Os dois maiores riscos são validados antes de qualquer código definitivo.

**1a. Eventos e fixtures (2 dias)**
- [ ] `recorder`: grava cada evento da seção 4 em `~/.flowctl/recordings/<sessionId>/rec-0001.jsonl`, `rec-0002.jsonl`… Um arquivo por bloco de N eventos, porque `$.fs` não tem append e reescrever um arquivo só seria O(n²) e esbarra no limite de leitura de 4 MiB.
- [ ] Gravar sessões reais:
  - (a) tarefa grande (refactor de 3+ arquivos);
  - (b) subagentes em paralelo;
  - (c) permissão pedida e negada, **com e sem auto mode**;
  - (d) `AskUserQuestion`;
  - (e) erro de ferramenta repetido;
  - (f) pedido curto;
  - (g) `--resume` e `/clear`;
  - (h) Esc no meio de um turno.
- [ ] Copiar as gravações (anonimizadas) para `fixtures/` e documentar o formato real em `docs/events.md`.
- [ ] Responder:
  - `classic.PermissionRequest` dispara antes ou depois do classificador do auto mode?
  - `TaskCreate` dentro de um subagente cai na mesma lista de tasks (com `owner`) ou numa separada?
  - `$.fs.write` fora do cwd funciona sem prompt?
  - `turn.complete.reason` chega como os tipos dizem?

**1b. Spike do overlay (1 dia)**
- [ ] App Swift mínimo:
  - `NSPanel` flutuante não ativável;
  - `WKWebView` com `loadFileURL(_:allowingReadAccessTo:)` mostrando um HTML estático;
  - servidor HTTP mínimo em `~/.flowctl/overlay.sock`.
- [ ] Do mod, `$.http.fetch("http://overlay/snapshot", { method: "POST", socketPath, body })` chega ao app e o HTML atualiza.
- [ ] Medir a latência evento → pixel.

**Gate de decisão: DECIDIDO (out/2026), ver `docs/events.md`:**
- **Fonte do plano, híbrida:**
  - se `TaskCreate` existe na sessão (`$.tool.list()` no `session.start`), o mod lê as tasks nativas;
  - se não existe, o mod registra a própria ferramenta de plano (`$.tool.register`, ex.: `FlowPlan` com nós, `blockedBy` e status), que alimenta o mesmo reducer;
  - nunca as duas ao mesmo tempo, para o agente não receber duas listas.
- **`nudgeTasks` desligado por padrão** (`userConfig`). Quem quiser o grafo sempre preenchido liga.
- Consequência: o nó implícito de turno é o caminho **normal** quando não há plano, não uma exceção.

### Fase 2: Motor do grafo em TS puro (5 dias)
**Objetivo:** `mod/graph/` completo e testado só com fixtures, sem UI. Ao fim,
o formato do `Snapshot` fica **congelado** (`schema: 1`).
- [ ] `types.ts`: modelo da seção 3, ajustado ao que a Fase 1 revelou.
- [ ] `reduce.ts`: todas as regras da seção 4; O(evento); nunca lança erro; avisos em `warnings`.
- [ ] `status.ts`: precedência de cores (error > needs_you > running > pending > done), limpeza do amarelo, regra do vermelho com N configurável, Esc ≠ erro.
- [ ] `layout.ts`: layout em camadas (Sugiyama simples):
  - rank = maior distância até uma raiz;
  - ordem dentro da camada = barycenter em 2–3 passes;
  - **estabilidade**: um nó existente não troca de camada/ordem sem necessidade;
  - ciclos quebrados pela aresta mais nova, que fica marcada.
- [ ] Testes:
  - replay de cada fixture gera um snapshot igual ao salvo (golden files);
  - eventos fora de ordem, ids desconhecidos e sessão retomada não quebram nada;
  - layout de 50 nós em < 5 ms.

**Pronto quando:** todos os fixtures geram o golden esperado e o CI está verde.

### Fase 3: Mod ao vivo + bridge (3 dias)
**Objetivo:** o mod roda o motor numa sessão real e publica o estado.
- [ ] `register.ts` liga os eventos ao `reduce`; estado em `$.state`.
- [ ] Status line (`$.ui.status`): `◆ 3/7 · 1 aguardando você`.
- [ ] Toast (`$.ui.toast`) quando um nó fica amarelo ou vermelho.
- [ ] `bridge/socket.ts`: `POST` do snapshot com debounce de 100 ms, fire-and-forget; falha silenciosa se o overlay não estiver aberto.
- [ ] `bridge/file.ts`: grava `~/.flowctl/sessions/<sessionId>.json` (fallback), com `seq` crescente.
- [ ] `session.end`: envia `sessionState: "ended"`.
- [ ] `bridge/open.ts`: no `session.start`, se o POST de teste falhar e `autoOpenOverlay` estiver ligado, `$.process.run(["open", "-g", "-a", "FlowCTL"])` (one-shot; não usar `spawn`, que morre no reload do mod).
- [ ] Teste: replay de fixture gera POSTs/arquivos com `seq` crescente e JSON válido.

**Pronto quando:** numa sessão real, `cat ~/.flowctl/sessions/*.json` mostra o grafo mudando, e a status line acompanha.

### Fase 4: Viewer web (5–6 dias)
**Objetivo:** o desenho do grafo, desenvolvido no navegador antes de ir para o
overlay. Pode começar em paralelo com a Fase 3 assim que o `Snapshot` congelar.
- [ ] `apps/viewer`: Vite + React + **SVG próprio** (o layout vem pronto; nada de Cytoscape no MVP).
- [ ] Importa `mod/graph/{types,status,layout}.ts` por caminho relativo.
- [ ] Desenho:
  - nós como cartões com as 5 cores;
  - arestas em curva Bézier (sólidas = declaradas, tracejadas = inferidas);
  - clusters de subagente com moldura;
  - nó amarelo pulsando;
  - transições animadas de posição e cor (300 ms).
- [ ] Ajuste automático à janela; scroll/zoom só acima de 30 nós.
- [ ] Cabeçalho: pasta do projeto, estado da sessão, contadores. Várias sessões = abas.
- [ ] Entrada plugável:
  - modo dev: `?fixture=<nome>` reproduz um fixture com controle de velocidade;
  - modo overlay: `window.flowctl.push(snapshot)`, chamado pelo Swift.
- [ ] Testes: Vitest + Testing Library com os golden snapshots.
- [ ] `pnpm build` gera um bundle estático (`dist/`).

**Pronto quando:** todos os fixtures ficam legíveis e bonitos no navegador, em tema claro e escuro.

### Fase 5: Overlay nativo macOS (7–8 dias)
**Objetivo:** a janela flutuante, evoluída a partir do spike 1b.
- [ ] `apps/overlay`: SwiftPM/Xcode, sem ícone no Dock (`LSUIElement`).
- [ ] `NSPanel`:
  - não ativável;
  - `level = .floating`;
  - `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`;
  - translúcido (`NSVisualEffectView`), cantos arredondados.
- [ ] `WKWebView` carrega o bundle do viewer embutido no app.
- [ ] Servidor no socket `~/.flowctl/overlay.sock` recebe snapshots e chama `window.flowctl.push`; descarta `seq` antigo.
- [ ] Ao abrir, lê `~/.flowctl/sessions/*.json` para recuperar sessões em andamento.
- [ ] Faxina: apaga snapshots `ended` ou com mais de 24 h (o mod não consegue apagar).
- [ ] Menu bar: mostrar/ocultar, opacidade, encerrar. Posição e tamanho lembrados (`UserDefaults`).
- [ ] Some sozinho quando não há sessão ativa (configurável).
- [ ] `scripts/install-overlay.sh`: build, assinatura ad-hoc, copia para `/Applications`.

**Pronto quando:** abrindo `claude` em qualquer terminal, o overlay aparece sozinho e acompanha o grafo com menos de 500 ms de atraso.

### Fase 6: Endurecimento e lançamento do MVP (4 dias)
- [ ] Teste de ponta a ponta manual com as 8 sessões da Fase 1 (checklist em `docs/qa-mvp.md`).
- [ ] Duas sessões de `claude` ao mesmo tempo = duas abas.
- [ ] Reload do mod no meio da sessão: reconstrói o estado pelo `TaskList` (sem nós fantasmas).
- [ ] Desempenho: 50 nós e 20 eventos/s sem atrasar o terminal.
- [ ] Distribuição:
  - `.claude-plugin/marketplace.json` na raiz;
  - README com `/plugin install flowctl-graph --marketplace MarcoFilho1/FlowCTL`;
  - overlay em GitHub Release (`.zip`).
- [ ] Gatekeeper: documentar `xattr -dr com.apple.quarantine /Applications/FlowCTL.app` para o MVP. Notarização (Apple Developer, US$ 99/ano) fica para depois.
- [ ] Tag **`v0.1.0`** = MVP.

### Depois do MVP (não bloqueia)
- **Clique no nó amarelo leva à sessão**: clicar num nó que pede input/permissão traz para a frente o terminal daquela sessão. Precisa de um spike:
  - o mod envia no snapshot a identidade do terminal (`TERM_PROGRAM`, tty, `TERM_SESSION_ID`/`ITERM_SESSION_ID`, pid);
  - o overlay ativa o app e a aba certa (AppleScript no Terminal/iTerm, por tty);
  - Maestri e VS Code precisam de investigação própria;
  - o overlay deixa de ser só leitura (passa a receber cliques, mas ainda não comanda o agente).
- Pane `/grafo` no terminal (Box/Text ou `Raster`) para quem não quer o overlay.
- Clique no nó do overlay → detalhes (description, último erro).
- Windows/Linux (Tauri ou WPF).

---

## 6. Linha do tempo

| Fase | Entrega | Dias | Acumulado |
| --- | --- | --- | --- |
| 0 | Repositório limpo + CI | 1 | 1 |
| 1 | Fixtures reais + spike do overlay + gate | 3 | 4 |
| 2 | Motor do grafo (Snapshot congelado) | 5 | 9 |
| 3 | Mod ao vivo + bridge | 3 | 12 |
| 4 | Viewer web | 5–6 | ~18 |
| 5 | Overlay macOS | 7–8 | ~26 |
| 6 | MVP v0.1.0 | 4 | ~30 |
| — | Reserva para quebra de API | 2–3 | **~33 dias úteis** |

Com dois agentes, as fases 3 e 4 andam em paralelo depois da Fase 2,
economizando cerca de 3 dias.

---

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Ferramentas de task desligadas por padrão nos modelos atuais (ver `docs/events.md` §1) e possivelmente em extinção | Grafo vazio | Gate da Fase 1: ligar `CLAUDE_CODE_ENABLE_TODO_TOOLS`, ou o mod registrar a própria ferramenta de plano (`$.tool.register`); detectar no `session.start` com `$.tool.list()` e avisar |
| O agente não cria tasks sem ser pedido (fixture 02) | Grafo vazio | `nudgeTasks` via `prompt.compose`; nó implícito de turno como caminho normal, não exceção |
| Deps raramente declaradas | Grafo vira lista | Arestas inferidas tracejadas; `nudgeTasks` pede `addBlockedBy` |
| Amarelo falso em auto mode | Ruído | `classic.PermissionRequest` como gatilho, não `tool.check`; validar na Fase 1 |
| Socket Unix não funcionar | Latência maior | Arquivo + FSEvents como plano B (já existe como fallback) |
| `$.fs.write` fora do cwd bloqueado por política | Fallback quebra | Validar na Fase 1; socket não depende dele |
| API de mods muda entre versões | Mod quebra | Versão mínima fixa, `types-vendor` regenerado a cada upgrade, reserva de dias |
| `claude plugin test` não roda no CI | Menos garantia | Testes puros de `mod/graph` com `node --test`; `plugin test` local antes do PR |
| Hooks lentos atrasam o Claude | Experiência ruim | `reduce` O(evento); I/O fire-and-forget com debounce |
| Gatekeeper bloqueia o app baixado | Instalação falha | `xattr` documentado; notarização depois |
| Vermelho com falso positivo | Ruído | Esc ≠ erro; limiar configurável; calibrar com fixtures |
| Pane não aparece no chat do VS Code nem em `claude -p` | Limite conhecido | É o que o overlay resolve |

---

## 8. Convenções de desenvolvimento
- Uma branch `feat/<fase>-<assunto>` por entrega, PR, revisão, merge.
- Toda regra nova em `mod/graph/` precisa de um teste com fixture.
- Mudança no formato do `Snapshot` sobe `schema` e atualiza viewer e overlay no mesmo PR.
- Os tipos gerados do Claude Code valem mais que a documentação.
