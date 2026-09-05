# FlowCTL Review Completion and Readiness Propagation v0

Status: Architectural specification for Incremento #4.

## 1. Objective and milestone

Incremento #4 é o primeiro slice em que o FlowCTL demonstra progressão
operacional real de um DAG após a execução de uma Task.

O fluxo existente termina em review:

~~~text
task.claim
→ task.start
→ task.complete
→ review
~~~

Este incremento adiciona aprovação explícita:

~~~text
review
→ task.review.approve
→ completed
→ global readiness reconciliation
→ pending Tasks elegíveis tornam-se ready
~~~

Milestone mínimo:

~~~text
A = review
B = pending
C = pending
D = pending

task.review.approve(A)

A = completed
B = ready
C = ready
D = pending
~~~

Events:

~~~text
task.completed(A)
task.ready(B)
task.ready(C)
~~~

A operação deve ser atômica e determinística.

## 2. Current architectural context

A arquitetura atual é:

~~~text
@flowctl/protocol
        ↓
@flowctl/core
        ↓
@flowctl/control-plane
~~~

Protocol contém os contratos compartilhados.

Core é a autoridade determinística sobre validação estrutural, hierarquia,
dependências, ciclos, readiness, lifecycle, CoreState opaco, snapshots,
transições contextuais e advanceReadyTasks.

Control Plane possui CoreState privado, active Lease map privado, Event Log
append-only in-memory, dispatch de Commands, candidate CoreState, atomicidade
síncrona, dependências injetáveis e cópias defensivas.

O fluxo atual é:

~~~text
ready
→ claimed + Lease
→ running
→ review
~~~

task.complete representa submissão para review, não conclusão definitiva.

## 3. Package boundaries

O incremento mantém estes limites:

~~~text
@flowctl/protocol
  Protocol v0.2
  novo task.review.approve
  payload corrigido de task.completed

@flowctl/core
  sem alterações

@flowctl/control-plane
  approval handling
  review -> completed
  readiness reconciliation
  task.completed e task.ready
~~~

Não será criado @flowctl/verifier.

## 4. Protocol v0.2 evolution

A alteração de contrato compartilhado exige:

~~~text
PROTOCOL_VERSION: "0.1" → "0.2"
~~~

A fonte única passa a ser:

~~~typescript
export const PROTOCOL_VERSION = "0.2" as const;
~~~

Envelopes de Commands e Events passam a referenciar o literal "0.2".

Não serão implementados version negotiation, compatibility layer, migration
framework ou runtime schema validation.

A versão declarativa do protocolo é distinta da versão de package metadata.

## 5. task.review.approve

FlowctlCommand recebe:

~~~typescript
{
  type: "task.review.approve";
  payload: {
    taskId: string;
  };
}
~~~

O Command usa o CommandEnvelope existente.

Não será criada API paralela como approveTaskReview.

Não será reutilizado task.complete para approval.

As semânticas são:

~~~text
task.complete
running -> review

task.review.approve
review -> completed
~~~

## 6. task.completed semantics

O payload de task.completed será exatamente:

~~~typescript
{
  taskId: string;
}
~~~

Não haverá workerId, leaseId, Lease artificial ou recuperação de Lease
histórica.

A separação é:

~~~text
execution provenance
  task.review_requested e Events anteriores

review approval provenance
  actor do task.review.approve

completed state fact
  task.completed { taskId }
~~~

A Lease é authority de execução e termina quando a Task passa de running para
review. task.completed representa somente o fato definitivo de estado.

## 7. Actor provenance

Actor continua representando quem originou causalmente o Command ou Event.

Os ActorTypes atuais continuam suficientes:

- system;
- worker;
- user.

Qualquer um pode originar task.review.approve neste nível arquitetural.

Isso não define autorização de produto. Não serão implementados authentication,
roles, reviewer authorization, Verifier identity, Worker Registry ou permission
checks.

Não será adicionado ActorType = verifier.

O Actor de task.completed será o Actor causal do approval Command. Events
task.ready produzidos pelo mesmo dispatch preservam esse Actor causal.

## 8. Control Plane approval flow

O dispatch segue:

1. validar projectId;
2. verificar se o Command é suportado;
3. resolver a Task pela chave canônica do Core graph;
4. validar review -> completed;
5. preparar o candidate;
6. reconciliar readiness;
7. preparar Events e Event Log;
8. substituir o estado privado uma única vez.

A Task usa own-key semantics. task.id não é chave alternativa.

Approval não exige Lease, não cria Lease, não consulta Lease histórica, não
consulta assignedWorkerId e não altera activeLeaseByTaskId.

Execution authority e review completion authority são distintas.

## 9. Core reuse and candidate state

Serão reutilizadas somente APIs públicas existentes:

- getTaskGraphSnapshot;
- createCoreState;
- applyTaskTransition;
- advanceReadyTasks.

Staging:

1. obter snapshot defensivo do CoreState atual;
2. criar candidate CoreState com createCoreState(snapshot);
3. aplicar review -> completed somente no candidate;
4. chamar advanceReadyTasks(candidate, timestamp);
5. preparar Events;
6. substituir o estado privado no commit.

O handle opaco CoreState nunca será clonado, inspecionado ou reconstruído por
internals.

Nenhuma regra de lifecycle, dependência ou readiness será duplicada no
Control Plane.

## 10. Global readiness reconciliation

Após review -> completed, o Control Plane executa:

~~~typescript
advanceReadyTasks(candidateCoreState, timestamp)
~~~

A reconciliação é global. Pode promover qualquer Task pending atualmente
elegível segundo o Core, mesmo que não seja descendente direta da Task
aprovada.

Semântica:

> Um review approval aceito conclui a Task aprovada e reconcilia todas as
> Tasks pending atualmente elegíveis segundo o Core.

Os IDs retornados por advanceReadyTasks são exatamente os IDs que receberão
task.ready nesse dispatch.

O Control Plane não percorre descendentes, calcula dependências, implementa
readiness própria, calcula delta manual ou reordena os IDs retornados.

## 11. Atomicity

Approval, completion, readiness reconciliation e Events formam uma operação
atômica.

~~~text
project validation
↓
command support
↓
canonical task lookup
↓
transition validation
↓
candidate CoreState
↓
single dispatch timestamp
↓
review -> completed
↓
advanceReadyTasks
↓
promotedTaskIds
↓
generate all Event IDs
↓
construct task.completed + task.ready*
↓
prepare Event Log
↓
single private-state replacement
~~~

Mutação do candidate antes da geração de Event IDs é permitida porque o
candidate ainda não é observável.

Falhas de clock ou geração de ID antes do commit descartam o candidate e
preservam CoreState, Event Log e active Lease map.

## 12. Event generation and deterministic ordering

Para uma aprovação que promove B e C:

~~~text
task.completed(A)
task.ready(B)
task.ready(C)
~~~

Ordem fixa:

1. um task.completed;
2. zero ou mais task.ready, exatamente na ordem determinística retornada
   por advanceReadyTasks.

Não usar locale, ordem incidental de Map ou ordenação própria.

Todos os Events do dispatch:

- usam o mesmo timestamp;
- possuem IDs distintos;
- preservam actor;
- preservam projectId;
- preservam protocolVersion.

CommandProcessingResult.events contém somente Events do dispatch atual.
getEventLogSnapshot continua retornando o histórico acumulado, defensivo e
append-only.

## 13. Rejection precedence

Para task.review.approve:

~~~text
PROJECT_MISMATCH
↓
UNSUPPORTED_COMMAND
↓
TASK_NOT_FOUND
↓
INVALID_TASK_TRANSITION
↓
preparation/staging
~~~

Task já completed retorna INVALID_TASK_TRANSITION com from = completed e
to = completed.

Não serão adicionados TASK_ALREADY_COMPLETED, TASK_NOT_IN_REVIEW ou
REVIEW_APPROVAL_UNAUTHORIZED.

Expected rejection não altera CoreState, Lease state ou Event Log e não emite
Event.

Falhas de clock, ID ou configuração são programming/configuration failures,
não novas branches de erro de domínio.

## 14. Lease independence

Review approval:

- não exige Lease;
- não cria Lease;
- não consulta activeLeaseByTaskId;
- não procura Lease histórica;
- não usa assignedWorkerId;
- não altera o active Lease map.

No fluxo normal, a Lease já foi removida quando task.complete executou
running -> review.

## 15. Public API impact

A fachada pública de Control Plane permanece:

- createControlPlane;
- getTaskGraphSnapshot;
- dispatchCommand;
- getEventLogSnapshot.

Nenhuma API paralela de approval será adicionada.

dispatchCommand passa a aceitar task.review.approve.

CommandProcessingResult não precisa de novo erro de autorização.

Core mantém sua superfície pública sem alterações.

Protocol expande FlowctlCommand e altera o payload público de task.completed.

## 16. Minimum milestone

Partindo de:

~~~text
A = review
B = pending
C = pending
D = pending
~~~

executar task.review.approve(A).

Resultado:

~~~text
A = completed
B = ready
C = ready
D = pending
~~~

Events:

~~~text
task.completed(A)
task.ready(B)
task.ready(C)
~~~

Não são emitidos Events de Lease ou review rejection.

## 17. Full A → B/C → D acceptance scenario

DAG:

~~~text
        A
       / \
      B   C
       \ /
        D
~~~

Estado inicial:

~~~text
A = ready
B = pending
C = pending
D = pending
~~~

A executa claim, start, complete e approve. Resultado:

~~~text
A = completed
B = ready
C = ready
D = pending
~~~

B executa claim, start, complete e approve. Resultado:

~~~text
A = completed
B = completed
C = ready
D = pending
~~~

C executa claim, start, complete e approve. Resultado:

~~~text
A = completed
B = completed
C = completed
D = ready
~~~

D não precisa ser executada.

Esse cenário prova progressão real do DAG sem Scheduler, auto-claim, fila ou
paralelismo.

## 18. Tests and acceptance criteria

Protocol tests devem provar:

1. PROTOCOL_VERSION é "0.2";
2. task.review.approve faz narrowing por type;
3. task.completed aceita exatamente { taskId };
4. Commands e Events continuam exhaustivamente discriminados;
5. envelopes usam o literal correto.

Core tests não devem ser alterados.

Control Plane tests devem provar:

1. task.review.approve é suportado;
2. Task ausente retorna TASK_NOT_FOUND;
3. status diferente de review retorna INVALID_TASK_TRANSITION;
4. Task completed retorna INVALID_TASK_TRANSITION com from = completed e
   to = completed;
5. approval não exige Lease;
6. approval não cria nem altera Lease;
7. assignedWorkerId não é consultado;
8. A review -> completed promove B/C para ready;
9. task.completed precede task.ready*;
10. IDs e timestamps são determinísticos e injetáveis;
11. actor, projectId e protocolVersion são preservados;
12. result.events contém somente Events do approval atual;
13. Event Log preserva o histórico acumulado;
14. snapshots, Events e resultados são defensivamente copiados;
15. falhas de clock ou Event ID não geram partial commit;
16. Command unsupported de outro projeto retorna PROJECT_MISMATCH;
17. rejeições não adicionam Events;
18. cenário A → B/C → D termina com D em ready;
19. approval não emite Events de Lease;
20. inicialização não promove readiness fora do approval dispatch.

Os testes devem usar tipos do Protocol e as fachadas públicas do Core e
Control Plane.

## 19. Explicitly out of scope

Este incremento não implementa:

- review rejection;
- rework;
- retry policy;
- reviewer authorization;
- authentication;
- Verifier real;
- LLM verification;
- automated test verification;
- scoring ou confidence;
- múltiplos reviewers;
- quorum;
- Scheduler;
- auto-claim;
- worker queues;
- priority ou fairness;
- real Workers;
- adapters;
- heartbeat;
- Lease expiry ou recovery;
- persistence;
- Event Store;
- database;
- HTTP/WebSocket/SSE;
- UI, Desktop ou Overlay;
- Planner;
- GraphMutation application.

## 20. Risks and future decisions

Decisões futuras incluem:

- identidade e autorização real do reviewer;
- Verifier automático;
- review rejection e rework;
- retry e idempotência de approval;
- deduplicação de Commands;
- múltiplos reviewers e quorum;
- feedback de review;
- Lease expiry e recovery;
- Scheduler e auto-claim;
- persistence e distribuição;
- compatibilidade entre versões de Protocol.

Actor como provenance não deve ser interpretado como autorização de produto.

A reconciliação global depende do contrato público atual de
advanceReadyTasks. Se no futuro for necessário reconciliar apenas uma
subárvore, isso deverá ser uma decisão explícita do Core, não uma regra
duplicada no Control Plane.

## 21. Architectural invariants

1. PROTOCOL_VERSION é "0.2" e é a fonte única da versão.
2. task.review.approve é a única intenção de approval.
3. task.complete nunca representa approval.
4. task.completed possui somente { taskId }.
5. Actor representa provenance, não authorization.
6. Nenhum novo ActorType é introduzido.
7. Core permanece sem alterações.
8. Review approval não usa, cria ou recupera Lease.
9. assignedWorkerId não é autoridade.
10. review -> completed ocorre somente em candidate CoreState.
11. Readiness é reconciliada exclusivamente por advanceReadyTasks.
12. Control Plane não percorre descendentes nem duplica dependency logic.
13. task.completed precede todos os task.ready.
14. Todos os Events do dispatch usam um timestamp.
15. Event IDs são distintos e determinísticos sob dependências injetadas.
16. O commit privado substitui o estado somente após toda a preparação.
17. Rejeições esperadas não produzem mutação nem Events.
18. CommandProcessingResult.events contém somente Events do dispatch atual.
19. Event Log permanece acumulado, defensivo e append-only.
20. Nenhum Scheduler, Verifier ou infraestrutura externa é introduzido.
