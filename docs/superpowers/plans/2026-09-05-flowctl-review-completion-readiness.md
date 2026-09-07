# FlowCTL Review Completion and Readiness Propagation v0 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Evoluir o Protocol para v0.2 e fazer o Control Plane aceitar task.review.approve, concluir Tasks em review e reconciliar globalmente a readiness do DAG de forma atômica.

Architecture: O Protocol continua sendo a fonte dos contratos compartilhados. O Core permanece congelado e é a única autoridade para transições e readiness; o Control Plane valida o envelope, prepara um candidate CoreState usando a fachada pública do Core, gera Events e substitui seu estado privado uma única vez.

Tech Stack: TypeScript strict, pnpm workspace, Node node:test, NodeNext/ESM, @flowctl/protocol, @flowctl/core e @flowctl/control-plane.

Spec: docs/superpowers/specs/2026-09-05-flowctl-review-completion-readiness-design.md

## Global Constraints

- PROTOCOL_VERSION passa de "0.1" para "0.2" como fonte única.
- FlowctlCommand recebe task.review.approve com payload exatamente { taskId: string }.
- task.completed passa a carregar exatamente { taskId: string }.
- @flowctl/core não terá alterações em source, testes ou documentação comportamental.
- Readiness será calculada exclusivamente por advanceReadyTasks.
- Approval não consulta, cria, recupera ou remove Lease e não usa assignedWorkerId como autoridade.
- Actor é proveniência causal, não autorização; não haverá Verifier, roles, authentication ou permission checks.
- CommandProcessingResult.events contém apenas Events do dispatch atual; getEventLogSnapshot contém o histórico acumulado.
- Approval e readiness são atômicos; falhas de now ou nextEventId não substituem CoreState, Event Log ou Lease map.
- Todos os Events de um dispatch usam um timestamp e Actor causal; task.completed precede todos os task.ready do dispatch.
- Não serão adicionados version negotiation, migration layer, runtime schemas, Zod ou outra validação runtime.
- Não serão implementados Scheduler, auto-claim, Workers reais, adapters, Lease expiry, persistence, networking, UI, Desktop, Overlay, Planner, LLM, Intent Layer, review rejection ou GraphMutation application.
- Cada task que introduz comportamento terá RED real, GREEN mínimo, typecheck e self-review; tasks de prova/regressão podem passar imediatamente e não exigem produção artificial.
- A suíte dos Incrementos #1–#3 deve permanecer coberta; nenhum teste anterior será removido.

## File map

- packages/protocol/src/version.ts: fonte única de PROTOCOL_VERSION.
- packages/protocol/src/command.ts: FlowctlCommand com task.review.approve.
- packages/protocol/src/event.ts: FlowctlEvent com o payload final de task.completed.
- packages/protocol/test/protocol.test.ts: versão, narrowing, envelopes e rejeição de payload antigo.
- docs/protocol-v0.md: documentação pública do contrato v0.2.
- packages/control-plane/src/dispatch.ts: precedência global e roteamento.
- packages/control-plane/src/review-approve.ts: validação, staging, transição, readiness e Events.
- packages/control-plane/test/control-plane.test.ts: fixtures, approval, readiness, atomicidade, cópias defensivas e E2E.
- README.md: status conciso do Control Plane.
- packages/core/**: explicitamente não tocado.

---

### Task 1: Migrar os contratos públicos para Protocol v0.2

Files:
- Modify: packages/protocol/src/version.ts
- Modify: packages/protocol/src/command.ts
- Modify: packages/protocol/src/event.ts
- Modify: packages/protocol/test/protocol.test.ts
- Modify: packages/control-plane/test/control-plane.test.ts, somente fixtures/narrowing/literal protocolVersion
- Modify: docs/protocol-v0.md

Interfaces:
- Consumes: contratos v0.1 e fixtures atuais.
- Produces: PROTOCOL_VERSION === "0.2", novo discriminante e payload final de completed.

- [ ] Step 1: Escrever os testes RED de contrato

Adicionar ao teste Protocol um Command e um Event:

~~~ts
const approval: FlowctlCommand = {
  id: "C-REVIEW-1",
  protocolVersion: "0.2",
  timestamp: "2026-09-05T00:00:00.000Z",
  projectId: "P1",
  actor,
  type: "task.review.approve",
  payload: { taskId: "A" }
};

const completed: FlowctlEvent = {
  id: "EV-COMPLETED-1",
  protocolVersion: "0.2",
  timestamp: "2026-09-05T00:00:00.000Z",
  projectId: "P1",
  actor,
  type: "task.completed",
  payload: { taskId: "A" }
};

// @ts-expect-error v0.2 não aceita metadata de execução no completed.
const legacyCompleted: FlowctlEvent = {
  ...completed,
  payload: { taskId: "A", workerId: "W1", leaseId: "L1" }
};
void approval;
void completed;
void legacyCompleted;
~~~

Adicionar task.review.approve ao switch de FlowctlCommand e alterar o narrowing de task.completed para somente taskId. Atualizar as assertions de versão para "0.2".

- [ ] Step 2: Confirmar RED

Run: pnpm --filter @flowctl/protocol build:test

Expected: FAIL porque a fonte ainda não tem o discriminante, a versão ainda é "0.1" e completed ainda exige workerId/leaseId.

- [ ] Step 3: Implementar a migração mínima

Em version.ts:

~~~ts
export const PROTOCOL_VERSION = "0.2" as const;
~~~

Em command.ts, acrescentar:

~~~ts
| (CommandEnvelope & {
    type: "task.review.approve";
    payload: { taskId: string };
  })
~~~

Em event.ts, substituir task.completed por:

~~~ts
| (EventEnvelope & {
    type: "task.completed";
    payload: { taskId: string };
  })
~~~

Não alterar package metadata; a versão declarativa do protocolo é independente de package.json.

- [ ] Step 4: Atualizar fixtures no mesmo ciclo

Trocar todos os protocolVersion: "0.1" tipados nos testes para "0.2". Atualizar os helpers de narrowing do Control Plane para incluir o novo Command e para tratar completed somente com taskId. Não adicionar ainda o Command à lista de Commands suportados em dispatch.ts.

Atualizar docs/protocol-v0.md com v0.2, task.review.approve, o novo payload de completed e a ausência de negotiation/runtime schemas.

Executar uma auditoria repository-wide sem substituição cega:

~~~bash
rg 'protocolVersion:\s*"0\.1"|PROTOCOL_VERSION.*0\.1|Protocol v0\.1|Protocol 0\.1'
~~~

Revisar cada ocorrência e classificá-la como fixture/contrato que deve migrar, documento histórico deliberadamente preservado ou ocorrência irrelevante. Nenhuma referência operacional acidental a v0.1 pode permanecer.

- [ ] Step 5: GREEN e regressão

Run: pnpm --filter @flowctl/protocol test
Run: pnpm typecheck
Run: pnpm test

Expected: PASS. O novo Command ainda ser unsupported no Control Plane é esperado até a Task 2.

- [ ] Step 6: Self-review e commit

Confirmar que não houve alteração em packages/core nem comportamento do Control Plane.

~~~bash
git add packages/protocol/src/version.ts packages/protocol/src/command.ts packages/protocol/src/event.ts packages/protocol/test/protocol.test.ts packages/control-plane/test/control-plane.test.ts docs/protocol-v0.md
git commit -m "feat(protocol): evolve to v0.2 review approval contract"
~~~

---

### Task 2: Implementar o vertical slice atômico de review approval

Files:
- Create: packages/control-plane/src/review-approve.ts
- Modify: packages/control-plane/src/dispatch.ts
- Modify: packages/control-plane/test/control-plane.test.ts

Interfaces:
- Consumes: Extract<FlowctlCommand, { type: "task.review.approve" }>, getCanonicalTask, isTaskTransitionAllowed, recreateCoreState, applyTaskTransition, copyActor, copyEvents, readControlPlaneState e replaceControlPlaneState.
- Produces: dispatchReviewApprovalCommand(controlPlane, command): CommandProcessingResult.

- [ ] Step 1: Escrever o RED de dispatch e rejeições

Criar este fixture:

~~~ts
function makeReviewApprovalCommand(
  overrides: { id?: string; projectId?: string; taskId?: string; actor?: Actor } = {}
): Extract<FlowctlCommand, { type: "task.review.approve" }> {
  return {
    id: overrides.id ?? "RA1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId: overrides.projectId ?? "P1",
    actor: overrides.actor ?? makeActor({ type: "user", id: "reviewer" }),
    type: "task.review.approve",
    payload: { taskId: overrides.taskId ?? "A" }
  };
}
~~~

Adicionar testes para: Task ausente; pending/ready/running; completed com from/to completed; project mismatch; unsupported + wrong project; own-key regression para toString/constructor/__proto__; approval em review sem Lease e com assignedWorkerId.

Adicionar também o milestone mínimo no mesmo RED:

~~~text
A = review
B = pending
C = pending
D = pending

approve A

A = completed
B = ready
C = ready
D = pending
~~~

O result deve conter exatamente task.completed(A), task.ready(B) e task.ready(C), nessa ordem. O teste garante que não existe uma versão funcional intermediária de approval que conclua A sem reconciliar readiness.

Cada falha compara Graph snapshot e Event Log antes/depois.

- [ ] Step 2: Confirmar RED

Run: pnpm --filter @flowctl/control-plane test

Expected: approval ainda retorna UNSUPPORTED_COMMAND.

- [ ] Step 3: Implementar suporte e validação

Estender SupportedCommand, isSupportedCommand e o switch de dispatch.ts. Preservar a precedência project mismatch -> unsupported command -> validação específica.

Em review-approve.ts, resolver com getCanonicalTask, validar isTaskTransitionAllowed(status, "completed") e retornar INVALID_TASK_TRANSITION antes do staging. A aceitação deve ser implementada como um vertical slice completo; não retornar sucesso parcial com A completed e B/C ainda pending.

- [ ] Step 4: Implementar candidate, completion e readiness no mesmo ciclo

Usar somente a fachada pública do Core via recreateCoreState:

~~~ts
const currentState = readControlPlaneState(controlPlane);
const taskGraph = getCoreTaskGraphSnapshot(currentState.coreState);
const task = getCanonicalTask(taskGraph, command.payload.taskId);
const candidateCoreState = recreateCoreState(currentState.coreState);
const candidateState: ControlPlaneState = {
  projectId: currentState.projectId,
  coreState: candidateCoreState,
  activeLeaseByTaskId: new Map(
    [...currentState.activeLeaseByTaskId].map(([id, lease]) => [id, copyLease(lease)])
  ),
  eventLog: copyEvents(currentState.eventLog),
  options: currentState.options
};
const timestamp = currentState.options.now();
const transition = applyTaskTransition(candidateCoreState, task.id, "completed", timestamp);
const promotedTaskIds = advanceReadyTasks(candidateCoreState, timestamp);
~~~

Se a transição falhar depois da pre-validação, lançar erro de invariante. Approval não consulta nem modifica activeLeaseByTaskId.

Construir TODOS os IDs antes de qualquer commit e construir em memória, na ordem, task.completed e todos os task.ready retornados pelo Core:

~~~ts
const eventIds = [
  currentState.options.nextEventId(),
  ...promotedTaskIds.map(() => currentState.options.nextEventId())
];

const stagedEvents: FlowctlEvent[] = [
  {
    id: eventIds[0],
    protocolVersion: command.protocolVersion,
    timestamp,
    projectId: command.projectId,
    actor: copyActor(command.actor),
    type: "task.completed",
    payload: { taskId: command.payload.taskId }
  },
  ...promotedTaskIds.map((taskId, index) => ({
    id: eventIds[index + 1],
    protocolVersion: command.protocolVersion,
    timestamp,
    projectId: command.projectId,
    actor: copyActor(command.actor),
    type: "task.ready" as const,
    payload: { taskId }
  }))
];
~~~

Acrescentar cópias de stagedEvents ao candidate Event Log, substituir ControlPlaneState uma única vez e retornar cópias defensivas. Com zero promoted IDs, o resultado contém somente task.completed. A Task 2 já termina com a semântica final do Command.

- [ ] Step 5: GREEN e typecheck

Run: pnpm --filter @flowctl/control-plane test
Run: pnpm typecheck

Expected: PASS com a suíte anterior, as rejeições, o approval sem Lease e o milestone mínimo completo de completion + readiness.

- [ ] Step 6: Self-review e commit

Confirmar ausência de lookup por assignedWorkerId, ausência de lease.created no approval e inexistência de qualquer commit funcional intermediário sem readiness.

~~~bash
git add packages/control-plane/src/dispatch.ts packages/control-plane/src/review-approve.ts packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): approve reviewed tasks"
~~~

---

### Task 3: Provar reconciliação global e progressão do DAG

Files:
- Modify: packages/control-plane/test/control-plane.test.ts
- Modify: packages/control-plane/src/review-approve.ts somente se os testes revelarem um defeito na implementação completa da Task 2; nesse caso, fazer o ajuste mínimo, sem criar produção adicional para justificar a task

Interfaces:
- Consumes: o vertical slice completo da Task 2 e as APIs públicas atuais do Control Plane.
- Produces: provas adversariais de reconciliação global, ordering determinístico, zero/múltiplas promoções e progressão completa do DAG.

- [ ] Step 1: Escrever os testes de expansão e prova

Adicionar testes para:

1. Fixture global A review, B pending depende de A, X pending com dependencies já completas: approval promove B e X, provando que a reconciliação não fica limitada a dependentes diretas.
2. Approval que não encontra pending elegível produz somente task.completed.
3. Múltiplos ready Events seguem exatamente a ordem devolvida pelo Core.
4. Todos os Events compartilham timestamp/Actor/projectId/protocolVersion e têm IDs distintos.
5. result.events contém apenas o dispatch atual e getEventLogSnapshot acumula.
6. O E2E explícito usa claim/start/complete/approve para A, B e C no DAG:

~~~text
        A
       / \
      B   C
       \ /
        D
~~~

Verificar A completed -> B/C ready -> D pending, B completed -> C ready -> D pending, C completed -> D ready. Não executar D nem auto-claim.

- [ ] Step 2: Confirmar RED

Run: pnpm --filter @flowctl/control-plane test -- --test-name-pattern='readiness|DAG|approval'

Expected: PASS se a implementação geral da Task 2 estiver correta. Se algum teste falhar, o resultado é um finding concreto sobre a Task 2 e autoriza somente o ajuste mínimo necessário no handler existente.

- [ ] Step 3: Corrigir apenas defeitos comprovados, se houver

Não adicionar readiness, traversal ou nova abstração nesta task. Se houver defeito, reproduzi-lo com o teste correspondente, aplicar a menor correção em review-approve.ts e repetir o teste focal, typecheck e suíte completa.

- [ ] Step 4: GREEN, typecheck e regressão

Run: pnpm --filter @flowctl/control-plane test
Run: pnpm typecheck
Run: pnpm test

Expected: PASS; progressão depende apenas de Commands explícitos e readiness do Core.

- [ ] Step 5: Self-review e commit somente se houver alteração

Confirmar que packages/core não foi alterado e que a Task não introduziu produção adicional. Se os testes já passarem e nenhum arquivo precisar mudar, registrar a auditoria e não criar commit vazio. Se houver correção mínima, usar:

~~~bash
git add packages/control-plane/src/review-approve.ts packages/control-plane/test/control-plane.test.ts
git commit -m "test(review): prove global readiness propagation"
~~~

---

### Task 4: Provar atomicidade e boundaries defensivos do approval

Files:
- Modify: packages/control-plane/test/control-plane.test.ts
- Modify: packages/control-plane/src/review-approve.ts somente se for necessário preservar o staging local até todos os IDs serem gerados

Interfaces:
- Consumes: createControlPlane, dispatchCommand, getTaskGraphSnapshot, getEventLogSnapshot, now e nextEventId injetáveis.
- Produces: provas black-box de que falhas antes do commit não vazam mutação.

- [ ] Step 1: Testes de falha de staging

Testar now() lançando antes dos Events e nextEventId() lançando depois do primeiro ID de uma operação que também produz ready Events. Em ambos, comparar Graph e Event Log antes/depois. Verificar que Leases existentes permanecem semanticamente iguais e que approval não cria/remove Lease.

- [ ] Step 2: Testes de cópia defensiva

Depois de approval aceito, mutar command.actor.id/type, result.events[0].actor, payload retornado, array e objetos de getEventLogSnapshot. Obter novo Graph snapshot e verificar que Event Log, Events anteriores e Graph permanecem intactos.

- [ ] Step 3: Confirmar RED e GREEN focal

Run: pnpm --filter @flowctl/control-plane test -- --test-name-pattern='atomic|failure|defensive|mutation|snapshot'

Expected: qualquer vazamento falha antes do ajuste; a implementação final passa sem expor ControlPlaneState, CoreState interno ou activeLeaseByTaskId.

- [ ] Step 4: Revisar commit único

O handler deve seguir exatamente:

~~~text
project validation
-> command support
-> own-key task lookup
-> review -> completed validation
-> candidate por snapshot público
-> um timestamp
-> applyTaskTransition
-> advanceReadyTasks com o mesmo timestamp
-> todos os Event IDs
-> todos os Events e candidate Log
-> replaceControlPlaneState uma vez
~~~

Não usar structuredClone em CoreState, inspecionar internals ou chamar createCoreState com objeto que não seja snapshot público. Falhas de infraestrutura ou de invariante não podem gerar partial commit.

- [ ] Step 5: Suíte e typecheck

Run: pnpm test
Run: pnpm typecheck

Expected: PASS preservando os testes dos Incrementos #1–#3.

- [ ] Step 6: Self-review e commit

~~~bash
git add packages/control-plane/src/review-approve.ts packages/control-plane/test/control-plane.test.ts
git commit -m "test(control-plane): lock approval atomicity boundaries"
~~~

---

### Task 5: Consolidar regressão e fachada pública

Files:
- Modify: packages/control-plane/test/control-plane.test.ts
- Modify: packages/protocol/test/protocol.test.ts somente para completar exhaustive narrowing

Interfaces:
- Consumes: APIs públicas de Protocol/Core/Control Plane.
- Produces: matriz explícita de acceptance criteria e compatibilidade anterior.

- [ ] Step 1: Auditar a matriz de testes

Confirmar testes para: versão v0.2 e import compilado; narrowing novo e rejeição do payload antigo; precedence project/unsupported; missing Task e own-key; todos os from/to inválidos; approval sem Lease e sem assignedWorkerId; completed antes de ready; timestamp/Actor/project/version/IDs; zero/múltiplos ready; global reconciliation; result atual versus Log acumulado; falhas now/nextEventId; cópias defensivas; E2E A -> B/C -> D.

- [ ] Step 2: Rodar regressão

Run: pnpm test
Expected: os 108 testes anteriores continuam passando e a contagem final é registrada sem fixar um número que ainda não existe.

Run: pnpm typecheck
Expected: PASS sem alterações em packages/core.

- [ ] Step 3: Revisar a fachada

Confirmar que packages/control-plane/src/index.ts exporta somente createControlPlane, getTaskGraphSnapshot, dispatchCommand, getEventLogSnapshot e os tipos previstos. review-approve.ts, handlers, staging helpers, ControlPlaneState e activeLeaseByTaskId não são públicos.

- [ ] Step 4: Self-review e commit condicional

Se a auditoria identificar lacuna real, escrever o teste faltante, confirmar RED quando aplicável, completar a cobertura, rodar a suíte e criar o commit:

~~~bash
git add packages/control-plane/test/control-plane.test.ts packages/protocol/test/protocol.test.ts
git commit -m "test(review): cover completion readiness regression matrix"
~~~

Se todos os acceptance tests já estiverem presentes e nenhum arquivo precisar mudar, registrar o resultado da auditoria e não criar commit vazio.

---

### Task 6: Documentação e validação final em checkout limpo

Files:
- Modify: README.md
- Modify: docs/protocol-v0.md somente se necessário após Task 1
- No changes: packages/core/**

Interfaces:
- Consumes: build final e exports compilados de Protocol/Control Plane.
- Produces: documentação honesta, validação sem dist/dist-test stale e relatório de escopo.

- [ ] Step 1: Atualizar README

Documentar Protocol v0.2, Core v0 e Control Plane v0 com task.claim, Lease authority, task.start, task.complete -> review, task.review.approve, review -> completed, Events, Event Log in-memory e readiness via Core.

Deixar explícito que ainda não existem review rejection/rework, Scheduler, Workers/adapters reais, heartbeat/expiry/recovery, persistence/networking, UI/Desktop/Overlay, Planner/LLM/Intent Layer, Verifier ou GraphMutation application.

- [ ] Step 2: Validar o checkout atual

Run: pnpm test
Run: pnpm typecheck
Run: pnpm build
Run: git diff --check origin/main..HEAD

Confirmar também que git diff --name-only origin/main..HEAD -- packages/core produz saída vazia e que Protocol só contém a migração v0.2.

- [ ] Step 3: Validar archive limpo

Usar um archive do commit final, que não inclui dist ou dist-test ignorados:

~~~bash
clean_dir="$(mktemp -d /tmp/flowctl-review-clean.XXXXXX)"
git archive --format=tar HEAD | tar -xf - -C "$clean_dir"
cd "$clean_dir"
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
node --input-type=module -e 'const protocol = await import("@flowctl/protocol"); if (protocol.PROTOCOL_VERSION !== "0.2") throw new Error("Wrong protocol version"); const api = await import("@flowctl/control-plane"); for (const name of ["createControlPlane", "getTaskGraphSnapshot", "dispatchCommand", "getEventLogSnapshot"]) { if (typeof api[name] !== "function") throw new Error("Missing public export"); } console.log("clean public imports passed");'
~~~

Registrar o diretório temporário e eliminar somente esse diretório depois de guardar os resultados.

- [ ] Step 4: Smoke check público no workspace

Após pnpm build:

~~~bash
node --input-type=module -e 'const protocol = await import("@flowctl/protocol"); if (protocol.PROTOCOL_VERSION !== "0.2") throw new Error("Missing Protocol v0.2"); const api = await import("@flowctl/control-plane"); for (const name of ["createControlPlane", "getTaskGraphSnapshot", "dispatchCommand", "getEventLogSnapshot"]) { if (typeof api[name] !== "function") throw new Error("Missing public export"); } console.log("public imports passed");'
~~~

- [ ] Step 5: Scope check

Run:

~~~bash
git status --short --branch
git diff --check origin/main..HEAD
git diff --name-only origin/main..HEAD -- packages/core
git diff --name-only origin/main..HEAD -- packages/protocol
git ls-files | grep -E '(^|/)\\.superpowers/|task-[0-9]+-report|final-fix-report|review-.*\\.diff|progress\\.md' || true
~~~

Confirmar diff vazio do Core, ausência de artefatos SDD e somente documentos públicos, Protocol v0.2 e Control Plane do Incremento #4 no branch.

- [ ] Step 6: Self-review e commit documental

Revisar a implementação contra a spec e confirmar que nenhum subsystem fora do escopo entrou no diff. Se README foi alterado:

~~~bash
git add README.md docs/protocol-v0.md
git commit -m "docs(review): document completion readiness status"
~~~

Se docs/protocol-v0.md já estiver no commit da Task 1, adicionar somente README. Não criar commit vazio.

## Interfaces entre tasks

O fluxo final deve ser:

~~~text
FlowctlCommand v0.2
  -> dispatchCommand
  -> dispatchReviewApprovalCommand
  -> getTaskGraphSnapshot(current CoreState)
  -> createCoreState(snapshot) candidate
  -> applyTaskTransition(candidate, taskId, "completed", timestamp)
  -> advanceReadyTasks(candidate, timestamp)
  -> [task.completed, task.ready*]
  -> replaceControlPlaneState uma vez
~~~

O sucesso permanece { ok: true; events: readonly FlowctlEvent[] }. As rejeições usam PROJECT_MISMATCH, UNSUPPORTED_COMMAND, TASK_NOT_FOUND e INVALID_TASK_TRANSITION. Não criar códigos para autorização ou estados duplicados.

## Estratégia TDD consolidada

1. Task 1 começa com RED de versão, discriminante e payload antigo.
2. Task 2 começa com RED de dispatch e milestone porque o Command ainda é unsupported e não existe approval completo.
3. Task 3 adiciona provas de expansão depois do vertical slice; elas devem passar sem produção nova ou revelar um defeito concreto para correção mínima.
4. Task 4 começa com testes adversariais de atomicidade e cópia defensiva.
5. Task 5 fecha a matriz de regressão sem remover cobertura anterior.
6. Cada GREEN é seguido por typecheck, self-review e commit isolado.
7. Refactors só ocorrem depois do comportamento correspondente estar verde.

## Rulings adicionais

- package metadata permanece 0.1.0; PROTOCOL_VERSION é a versão do contrato.
- task.completed usa o Actor do approval; worker/Lease permanecem nos Events anteriores.
- Approval em review não exige Lease ativa; a Lease já terminou em task.complete.
- Ready Events usam a ordem exata devolvida pelo Core.
- advanceReadyTasks recebe o mesmo timestamp da transição para completed.
- Falhas esperadas são unions; falhas de infraestrutura/invariante não geram estado parcial.
- O checkout limpo usa archive para não depender de artefatos compilados ignorados.

## Incompatibilidades e ambiguidades

- A incompatibilidade v0.1 -> v0.2 é deliberada: novo Command e novo payload de completed; não haverá camada de compatibilidade.
- Não há incompatibilidade conhecida entre as APIs congeladas do Core e o fluxo.
- Não há ambiguidades bloqueantes. Se a implementação descobrir necessidade de alterar Core, deve parar e registrar finding.

## Checklist de self-review do plano

- [x] Cada seção comportamental da spec tem task.
- [x] Migração v0.1 -> v0.2 atualiza fixtures no mesmo ciclo e termina verde.
- [x] Task 2 é um vertical slice completo e não expõe approval sem readiness.
- [x] Task 3 prova/expande comportamento existente, sem justificar produção artificial.
- [x] A auditoria repository-wide de referências operacionais v0.1 está incluída.
- [x] Nenhum arquivo de packages/core está em Files de implementação.
- [x] Nenhum payload antigo de completed permanece após Task 1.
- [x] Approval não usa Lease nem assignedWorkerId.
- [x] Readiness vem exclusivamente de advanceReadyTasks.
- [x] Reconciliação global fora de descendentes diretos tem teste explícito.
- [x] Event ordering, atomicidade e cópias defensivas têm testes.
- [x] E2E A -> B/C -> D está coberto.
- [x] Cada task tem arquivos, interfaces, RED/GREEN e commit.
- [x] Task 5 não exige commit vazio quando a auditoria não encontra lacunas.
- [x] Checkout limpo não depende de dist/dist-test stale.
- [x] Nenhum subsystem fora do escopo foi planejado.

## Handoff

Executar somente após revisão do usuário. A execução deve começar com branch criada a partir do HEAD atual, usando superpowers:subagent-driven-development, subagente fresco por task, revisão de conformidade após cada task e sem push, PR ou merge durante a implementação.
