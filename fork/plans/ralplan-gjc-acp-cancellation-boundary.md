# Plan — GJC ACP busy-turn and cancellation-boundary fix — **PENDING APPROVAL**

Status: **pending fresh Architect/Critic review and owner approval**. This is Ralplan Planner revision 2. It is planning-only; nothing in this document has been implemented.

- Primary evidence: `specs/gjc-acp-foreground-turn-trace.md`.
- Prior plan retained for history: `fork/plans/ralplan-gjc-acp-busy-turn.md`.
- Source baseline inspected: Paseo current checkout and installed `@gajae-code/coding-agent` 0.15.5 source.
- There is no matching `specs/*-spec.md`, so this plan has no FR/SC identifiers. The evidence trace is the authoritative incident record.

## Outcome

Keep the useful parts of the original plan—GJC ownerless-turn phase mirroring and `turn.steer` support—but replace both unsafe cancellation paths with a durable session stop boundary:

1. A foreground ACP stop installs a fence before sending `session/cancel`. A replacement may be staged, but it cannot reserve or send a prompt until the original foreground prompt reaches an authoritative terminal event and every session-scoped cancel write issued for that stop has settled successfully.
2. An ownerless GJC stop uses `_gjc/sdk/control` `turn.abort` in terminal mode. The ownerless stop opens only after both:
   - a validated terminal-safe abort result for the configured scope; and
   - a post-stop authoritative `gjcPhase:"idle"` observation.
     These facts may arrive in either order. Neither fact alone terminalizes the mirror or admits a successor.
3. Foreground and ownerless replacements use one atomic admission-and-reservation helper. Nothing belonging to the successor—no event, user echo, generated turn id, or prompt—is observable before all stop gates are satisfied and the foreground slot is synchronously reserved.
4. A named 10-second fail-closed admission deadline rejects the queued replacement without sending a prompt and leaves the session stopping. It is not a readiness timeout and does not manufacture terminal state.

The manager may still force-settle its own run bookkeeping after two seconds. That no longer authorizes the adapter to send the successor. Adapter readiness is independent and fail-closed.

The plan does **not** raise Paseo's two-second manager timeout or GJC's five-second prompt window.

## Evidence and causal finding

The production sequence in `specs/gjc-acp-foreground-turn-trace.md` is:

1. Paseo sends ACP cancellation.
2. `ACPAgentSession.interrupt()` returns when the cancellation notification has been written.
3. Two seconds later, `AgentManager` force-settles its manager-owned run state.
4. GJC can keep the original `session/prompt` pending for up to five seconds.
5. The manager immediately starts the replacement.
6. `ACPAgentSession.startTurn()` still has its own `activeForegroundTurnId` and throws `A foreground turn is already active`.

The log timing—2,004 ms followed by force cancellation and the foreground exception one millisecond later—matches that mechanism. “Cancellation acknowledged” is inaccurate because ACP cancellation is a notification: completion establishes write settlement, not provider processing or prompt terminalization.

The configuration follows Paseo's custom ACP provider contract. Stale GJC code, duplicate daemons, and UI-only state have been ruled out.

The existing plan does not resolve this foreground race. Its GJC `interrupt()` override defers to the base while `foregroundTurnActive`, and the base waits only for `connection.cancel()`. Its ownerless path also repeats the same category of mistake by clearing the mirror and emitting a synthetic terminal immediately after a cancel attempt, before GJC has proven the turn stopped.

## Intent reconciliation

The original intent remains:

- Reflect GJC ownerless activity so Paseo can steer a running autonomous turn.
- Make Stop and interrupt-and-replace effective for those ownerless turns.
- Keep GJC-specific behavior in a fork-only provider subclass.
- Leave the app, protocol, and other providers unchanged.

New evidence changes the implementation constraints:

- A cancellation notification is not terminal evidence.
- Manager settlement is not adapter settlement.
- Replacement safety belongs at the ACP session admission boundary, not in UI state or a larger manager timeout.
- Direct `turn.abort` is GJC-specific and is used only for a mirrored ownerless turn. A foreground ACP prompt continues to use `session/cancel`.
- The mirror must use a stable provider-minted autonomous turn id. Delayed id-less terminal events can otherwise be resolved by the manager against a replacement turn.

## RALPLAN decision drivers

1. **No prompt crosses an unresolved stop.** The old prompt must be terminal or fenced at the adapter before a successor is committed.
2. **Cancellation is session-scoped.** A late cancel write on the same ordered ACP connection must never be able to target a successor.
3. **No synthetic provider truth.** Notification write, manager timeout, and an unvalidated control response do not prove GJC is idle.
4. **Admission is atomic.** A concurrent direct start must still throw; only the one successor staged behind an installed stop may wait.
5. **Failure is closed and bounded.** Waiting cannot be infinite, but deadline expiry cannot make the session ready.
6. **GJC launch semantics are preserved.** The adapter honors the configured abort scope rather than hard-coding production's `owned` value.
7. **Changes remain local and reviewable.** Generic ACP owns the session stop fence; GJC owns ownerless phase/control semantics.

## Options considered

### Chosen: generic ACP stop fence plus GJC ownerless proof gate

Install a generic stop boundary before foreground cancellation, gate admission on authoritative prompt terminalization plus the session cancel ledger, and add a GJC ownerless two-fact gate. This matches the existing OpenCode stop-boundary design in `docs/providers.md` and `opencode-agent.ts` while preserving ACP-specific transport semantics.

### Rejected: increase the manager timeout above five seconds

This reduces the observed frequency but still treats elapsed time as provider settlement. It also bakes a GJC prompt deadline into generic manager behavior.

### Rejected: clear `activeForegroundTurnId` when `interrupt()` returns

That recreates the race: `cancel` return means write completion only. It permits a late session-scoped cancel or late original terminal to cross the successor.

### Rejected: close the ownerless mirror immediately after `turn.abort` returns

An outer JSON-RPC success can contain an unsafe or malformed terminal result. Even a safe terminal result is insufficient without a post-stop authoritative idle observation.

### Rejected: move all gating into `AgentManager`

The manager does not own ACP prompt/cancel ordering or GJC control-response validation. It may force-settle its public run without knowing whether the provider session can accept a new prompt.

### Rejected: serialize every `startTurn` call

That would silently queue programming errors. A direct concurrent start that is not the registered successor of a stop continues to throw `A foreground turn is already active`.

## Detailed design

### 1. Generic ACP session stop state

Replace the foreground-only boolean implication around `activeForegroundTurnId` with explicit internal admission state:

- `idle` — no foreground turn and no unresolved stop;
- `reserved` — a successor has atomically acquired the foreground slot but has not yet called `connection.prompt`;
- `running` — a foreground prompt is active;
- `stopping` — an immutable stop boundary is installed for a foreground or provider-owned ownerless turn.

The state may remain implemented with narrow fields rather than a public enum, but invariants and transitions must be named in comments and tests.

Each stop has immutable identity:

- `stopId` — stable for the lifetime of the stop;
- `stoppedTurnId` — explicit id of the foreground or mirrored ownerless turn;
- `sessionId` and live connection identity captured at installation;
- stop kind, `foreground` or `gjc-ownerless`;
- terminal proof state;
- cancellation/control attempt revision state.

Do not reuse the successor token or an attempt number as stop identity.

Install the foreground stop synchronously before the first `session/cancel` write. This closes admission before any asynchronous cancellation work begins.

### 2. Session-scoped ACP cancel ledger

Foreground interrupt, replacement, repeated Stop, and permission denial route through the same stop-boundary operation. For the current immutable stop:

- `cancelIssuedRevision` increments for each write attempt.
- Every issued `connection.cancel({sessionId})` promise is tracked on the captured ordered live connection.
- `cancelSettledRevision` and per-attempt outcomes are recorded.
- Admission requires all issued revisions to have settled and the newest revision to have written successfully.
- A newer successful retry may recover an older rejected write only after all older and newer writes have settled; no unresolved older write can trail behind the successor.
- If the newest attempt rejects, the session remains stopping.
- If the connection/session identity changes, the old stop cannot admit a successor on the new identity.

`interrupt()` may return after the current notification write settles, preserving the current interface. It must not clear the stop or imply readiness.

Retries aggregate only on the same ordered live connection and same stop identity. A retry on a different connection/session is not recovery; close/recreate the session.

### 3. Authoritative foreground terminal

`finishTurn(turnId, terminalEvent)` records terminal proof against the stopped foreground turn only when the explicit turn id and captured session/connection identity match.

It must:

- settle the old foreground turn for adapter purposes;
- retain the stopping boundary while cancel writes remain unresolved or failed;
- prevent any late terminal from clearing a reserved/running successor;
- make duplicate terminals idempotent;
- preserve ordinary terminal event delivery exactly once.

The replacement gate opens only when both conditions hold:

1. authoritative terminal proof for `stoppedTurnId`; and
2. the cancel ledger is fully settled with a successful newest write.

If the prompt terminal arrives before cancel settlement, wait for cancel settlement. If cancel settlement arrives first, wait for terminal. No timeout, manager event, or inferred idle substitutes for either.

### 4. One staged successor and independent invalidation

A stop may own at most one staged successor:

- `successorToken` identifies that queued request.
- A second `startTurn` while the first successor is queued throws the existing foreground-active error.
- A direct concurrent `startTurn` while running, reserved, or stopping without the current successor token also throws.
- Manager cancellation of the staged replacement invalidates `successorToken` and rejects that waiter. It does not mutate `stopId` or masquerade as a retry of the stopped turn.
- A repeated Stop against the same manager-addressable run keeps `stopId` stable, invalidates any currently staged successor, and may increment the cancel/control attempt revision.
- Supersession/close cleans up the successor deadline and listeners separately from stop-state cleanup.

This separates three concepts that must never be conflated:

1. immutable stop identity;
2. retry/attempt revision;
3. queued-successor invalidation token.

### 5. Bounded fail-closed admission deadline

Add `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS = 10_000`, following `OPENCODE_PENDING_ABORT_START_TIMEOUT_MS`.

The deadline starts when a successor is staged behind a stop, not when Stop is pressed. It bounds the caller's wait; it is not a provider-readiness timeout.

On expiry:

- reject only that queued `startTurn`;
- send no `session/prompt`;
- allocate/emit no successor turn event or user echo;
- log which required facts remain unresolved;
- invalidate and clean the successor token, timer, and listeners;
- leave the session in `stopping`.

A later valid terminal/fence may make a future manager-addressable request admissible, but expiry itself never advances state. If manager state has already force-settled and no addressable run remains, close/recreate is the supported recovery.

### 6. Atomic admission and foreground reservation

Add a protected base helper, named in implementation as `startTurnWithAdmission` or an equivalent narrow API, used by both ordinary ACP and GJC:

1. Register the sole successor token if this call is the stop's staged replacement.
2. Await the generic stop gate and any provider gate within the 10-second admission deadline.
3. In one synchronous commit section, recheck:
   - the session is not closed;
   - connection and session identities still match;
   - the immutable stop identity is unchanged;
   - all required cancel revisions are settled and safe;
   - terminal proof still belongs to the stopped turn;
   - provider-specific gate identity/proof is still current;
   - the successor token is still valid and still belongs to this call;
   - no foreground reservation/running turn exists.
4. Synchronously transition to `reserved`.
5. Only after reservation, allocate the new turn id and execute existing start-side effects in their current relative order: flush/coalescer work, `turn_started`, canonical user echo, and `connection.prompt`.
6. Transition `reserved` to `running` at the defined point and roll back only the new reservation on a send failure; never reopen an unresolved old stop.

There must be no `await` between the final recheck and reservation. No event, echo, id allocation, or prompt occurs before the commit.

This helper must be generic; no `gjc` identifier enters the base class.

### 7. Close and permission denial

`close()`:

- marks the session closed before asynchronous teardown;
- prevents new reservations;
- performs existing connection/process teardown;
- rejects all admission waiters after teardown begins/finishes as appropriate;
- clears timers/listeners and invalidates successor tokens;
- ignores late cancel settlements, control results, phase updates, and terminals after close;
- emits no stale synthetic terminal.

Permission denial uses the same foreground stop boundary before sending ACP cancellation. A denied prompt cannot admit a replacement until the same terminal-plus-cancel conditions are met.

### 8. GJC ownerless mirror identity and phase tracking

Retain the proposed `GjcACPAgentSession` subclass and `GjcACPAgentClient` factory/registry dispatch, but change the mirror contract:

- On an eligible `gjcPhase:"working"` edge outside a foreground turn, mint a stable provider-side id such as `gjc-autonomous-<uuid>`.
- Emit `turn_started` with that explicit id.
- Retain the id through natural completion, Stop, retries, and successor staging.
- Emit the matching `turn_completed` or `turn_canceled` with that exact id only after authoritative completion requirements are met.
- Do not use a no-turnId terminal for mirrored activity.

Explicit ids prevent `AgentManager` from resolving the mirror's delayed terminal against a replacement. They do not correlate raw GJC phase edges. `gjcPhase` carries no turn id, so the adapter must not claim it can identify an arbitrary stale idle from another native turn.

Track:

- current GJC phase;
- monotonic local phase revision;
- revision at which the ownerless stop was installed;
- the first eligible idle revision after installation;
- whether a later `working` invalidated that idle observation.

An idle is eligible only if observed after the stop boundary on the same live session. If `working` occurs after an eligible idle but before release, invalidate the idle fact and require another post-stop idle. Duplicate same-phase updates remain edge-idempotent.

Natural ownerless completion, where no stop is installed, may close the explicit mirror on the ordinary working→idle edge. The two-fact gate applies to an ownerless turn that is being aborted/replaced.

### 9. Preserve configured GJC abort scope

`ACPAgentSession` already stores `launchEnv` from `ACPAgentSessionOptions`. Add a narrow protected read-only lookup, for example `protected getLaunchEnv(name: string): string | undefined`; do not expose the mutable environment object.

Resolve `GJC_ACP_ABORT_SCOPE` once for the GJC session:

- absent or exactly `"turn"` → `turn`;
- exactly `"owned"` → `owned`;
- any other non-empty value → fail closed during session construction/initialization with a diagnostic configuration error.

This deliberately refuses a typo rather than silently changing cancellation semantics. Production's configured `owned` value is preserved; the GJC default remains `turn`.

The ownerless abort request is:

`extMethod("_gjc/sdk/control", { sessionId, operation: "turn.abort", input: { mode: "terminal", scope, idempotencyKey } })`.

Use the configured scope exactly. Derive a bounded idempotency key from immutable `stopId` plus cancel-attempt revision. Retries of one transport attempt do not invent a new stop; an intentional new abort attempt increments only the attempt revision.

Foreground turns do not call this extension. They continue to use ACP `session/cancel` and the generic stop fence.

### 10. Exact GJC 0.15.5 terminal result validation

The GJC ACP adapter unwraps the outer session response and throws when the outer response has `ok:false`. The returned `terminalAbort` value is still untrusted and must be validated as an object.

Common requirements:

- non-null, non-array object;
- `ok === true`;
- `selection` exactly equals the requested `turn` or `owned` scope;
- no unknown/ambiguous terminal disposition is accepted.

Conservative validation matrix:

| Returned terminal result                                                                                           | `turn` scope                 | `owned` scope                    | Gate effect                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `turn:"stopped"`, `ownedWork:"left_running"`, `automaticDelivery:"enabled"`, `resumeOnOwnedCompletion:true`        | terminal-safe                | reject: selection/shape mismatch | Record abort-success fact; still wait for eligible idle                                                   |
| `turn:"stopped"`, `ownedWork:"stopped"`, `automaticDelivery:"none"`, `resumeOnOwnedCompletion:false`               | reject: scope/shape mismatch | terminal-safe                    | Record abort-success fact; still wait for eligible idle                                                   |
| `turn:"no_active_turn"` and `terminal:"terminal_no_effect"`                                                        | conditionally terminal-safe  | conditionally terminal-safe      | Record conditional success, but release only when the separately observed current post-stop phase is idle |
| `turn:"uncertain"`                                                                                                 | reject                       | reject                           | Remain stopping; no terminal                                                                              |
| `turn:"no_effect"`, even with `terminal:"terminal_no_effect"`                                                      | reject                       | reject                           | Remain stopping; no terminal                                                                              |
| `turn:"no_store"`                                                                                                  | reject                       | reject                           | Remain stopping; no terminal                                                                              |
| `ok:false`, missing fields, wrong types, wrong `selection`, unsafe auxiliary values, or unknown future disposition | reject                       | reject                           | Remain stopping; no terminal                                                                              |
| transport/outer-response rejection                                                                                 | reject                       | reject                           | Remain stopping; no terminal                                                                              |

Allow documented replay metadata as extra fields, but do not weaken the required safe fields. In particular, reject `owned` `stopped` results whose `ownedWork` is `uncertain`.

For `no_active_turn/terminal_no_effect`, the result is never independently sufficient. It is safe only in conjunction with the separately observed eligible idle for the same installed stop and unchanged session. An idle that raced before the response may satisfy that second fact if it was observed after stop installation and has not been invalidated by a later working edge.

### 11. Ownerless stop: two facts, either order

For a mirrored ownerless turn:

1. Install immutable stop identity and phase-revision boundary.
2. Enter `stopping` and stage/invalidate successors using the generic mechanics.
3. Send the terminal `turn.abort` request.
4. Validate the returned terminal result against the configured scope and matrix.
5. Independently observe GJC phase updates.
6. Only when both a safe control result and current eligible post-stop idle are present:
   - emit exactly one `turn_canceled` with the mirror's explicit turn id;
   - mark the provider gate terminal/fenced;
   - allow the generic admission helper to attempt its final atomic commit.

Permitted orders:

- success response, then idle;
- idle, then success response.

Failure behavior:

- success without idle remains stopping;
- idle before malformed/failed/ambiguous result remains stopping;
- failed result followed by idle remains stopping;
- idle followed by `working` invalidates idle and remains stopping;
- late success/failure after close does nothing;
- no branch emits a terminal merely because the control request settled.

### 12. Repeated Stop and recovery scope

Repeated Stop is idempotent with respect to the stopped turn:

- same manager-addressable run/session → same `stopId` and stopped turn id;
- invalidate a staged successor with its separate token;
- issue a new cancel/control attempt revision if policy calls for retry;
- retain all prior ledger entries and wait for the newest safe result plus all older writes to settle.

The guarantee is intentionally narrow. After `AgentManager` force-settles its run, an unchanged manager may return `not_running` and may no longer call the session's interrupt path. This plan does not claim repeated Stop can recover such a session. If the adapter remains stopping and no manager-addressable run exists, close/recreate the session is recovery.

No new manager capability is added solely to extend retry reachability.

### 13. Steering

Retain `GjcACPAgentSession.steerActiveTurn`:

- flatten supported text input;
- call `_gjc/sdk/control` with `operation:"turn.steer"` and a fresh `clientRef`;
- return `accepted` only on clean RPC completion;
- return `unavailable` on transport/provider failure;
- never interrupt or retry from the steer method.

The manager's active-turn ownership checks continue to guard steering. Explicit mirror ids improve event ownership; they do not add a GJC-native steer target because GJC `turn.steer` does not accept Paseo's turn id.

### 14. Manager behavior and logs

Do not change `INTERRUPT_SESSION_TIMEOUT_MS` or make manager force settlement wait for provider readiness.

After two seconds the manager may still force-settle facts it owns. A staged replacement subsequently waits inside adapter admission. The existing manager test in which no terminal event is delivered remains valid only because that fixture's fake provider is already terminal/fenced at the adapter when `interrupt()` returns. Rename/comment the fixture to make that contract explicit.

Manager logs may state only manager-owned facts:

- interrupt requested/returned/rejected;
- manager settlement wait timed out;
- manager run force-settled;
- replacement `startTurn` invoked/resolved/rejected.

They must not claim the ACP adapter is ready or remains gated. Correlation comes from shared session/turn/stop identifiers across manager and provider logs.

Replace “cancellation acknowledged” wording with “cancellation notification write settled” or an equivalent exact statement.

## Implementation plan

### Step 1 — Generic ACP stop boundary

Edit `packages/server/src/server/agent/providers/acp-agent.ts`:

- Export `ACPAgentSessionOptions` for the subclass factory.
- Retain/extract `ACPAgentClient.createAgentSession(...)` for GJC construction.
- Add protected, provider-neutral accessors for the session handle, foreground state, event delivery, logger, and one-key read-only launch-env lookup.
- Add immutable stop records, cancel-attempt ledger, staged-successor token, and close cleanup.
- Install a foreground stop before `connection.cancel` in interrupt and permission-denial paths.
- Make `finishTurn` prove terminal ownership without clearing a successor.
- Implement the 10-second admission deadline and atomic `startTurnWithAdmission`/reservation helper.
- Route ordinary `startTurn` through that helper without changing no-stop behavior.
- Preserve direct-concurrent-start rejection.

No GJC names or response shapes enter this file.

### Step 2 — Safe GJC provider

Add `packages/server/src/server/agent/providers/gjc-acp-agent.ts`:

- `GjcACPAgentClient` creates `GjcACPAgentSession`.
- Mirror working/idle with a stable explicit autonomous turn id.
- Track phase revisions and post-stop idle eligibility.
- Resolve and validate `GJC_ACP_ABORT_SCOPE`.
- For foreground interrupt, delegate to the generic `session/cancel` boundary.
- For ownerless interrupt, install the stop and issue terminal `turn.abort`.
- Validate the complete GJC 0.15.5 terminal result matrix.
- Release ownerless stop only on validated response plus eligible idle, either order.
- Keep `turn.steer` behavior from the original plan.

### Step 3 — Provider dispatch

Edit `packages/server/src/server/agent/provider-registry.ts` so a custom ACP provider with `providerId:"gjc"` uses `GjcACPAgentClient` before the generic ACP fallback. Add the matching registry assertion.

### Step 4 — Manager wording and contract fixtures

Edit `packages/server/src/server/agent/agent-manager.ts` only where needed to:

- correct notification/manager-settlement log wording;
- include manager-owned session/turn/stop correlation fields that are already available;
- avoid claims about adapter readiness.

Update `packages/server/src/server/agent/agent-manager.test.ts` fixtures/comments and add replace/cancel race coverage. Do not add a manager-owned readiness state or increase timeouts.

### Step 5 — Documentation

Integrate the stop-boundary rule into the existing Cancellation section of `docs/agent-lifecycle.md`:

- manager settlement and provider/session readiness are independent;
- replacement can be staged after manager force settlement but cannot cross the adapter stop fence.

Update the session-scoped cancellation boundary in `docs/providers.md`:

- install the stop before sending cancellation;
- wait for authoritative terminal plus all ordered cancel writes;
- provider-specific ownerless aborts may add stricter proof;
- admission deadlines reject waiters without creating readiness;
- use OpenCode as the existing precedent and ACP/GJC as the second implementation.

Do not append duplicate lifecycle prose elsewhere.

## File-level change map

| File                                                               | Planned change                                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/agent/providers/acp-agent.ts`          | Generic stop/fence, cancel ledger, successor token, 10-second fail-closed admission, atomic reservation, protected extension seams, launch-env lookup, close/permission integration |
| `packages/server/src/server/agent/providers/gjc-acp-agent.ts`      | New fork-only GJC session/client: explicit ownerless mirror id, phase revisions, configured scope, terminal-result validation, two-fact ownerless stop, steering                    |
| `packages/server/src/server/agent/providers/acp-agent.test.ts`     | Foreground stop-boundary, cancellation-ledger, admission, deadline, permission, and close unit tests                                                                                |
| `packages/server/src/server/agent/providers/gjc-acp-agent.test.ts` | New GJC phase/control/scope/order/retry/steer unit and integration tests                                                                                                            |
| `packages/server/src/server/agent/provider-registry.ts`            | GJC custom-provider dispatch                                                                                                                                                        |
| `packages/server/src/server/agent/provider-registry.test.ts`       | Dispatch/default-generic assertions                                                                                                                                                 |
| `packages/server/src/server/agent/agent-manager.ts`                | Accurate manager-owned cancellation logs only                                                                                                                                       |
| `packages/server/src/server/agent/agent-manager.test.ts`           | Production-timing replace race, staged-replacement Stop, force-settlement contract clarification                                                                                    |
| `docs/agent-lifecycle.md`                                          | Cancellation ownership and replacement boundary                                                                                                                                     |
| `docs/providers.md`                                                | Session-scoped cancellation/admission contract and OpenCode precedent                                                                                                               |

No `packages/app` or `packages/protocol` change is planned.

## Test plan

Use fake timers/deferred promises where timing is relevant. Tests assert events, call order, turn ids, connection identity, and prompt call count—not sleep-based timing alone.

### Generic ACP unit tests — `acp-agent.test.ts`

1. Foreground cancel write settles before prompt terminal: replacement remains staged and `prompt` call count stays zero.
2. Prompt terminal arrives before cancel write settlement: replacement remains staged until the write settles.
3. Both facts arrive in either order: exactly one successor reserves and sends.
4. Cancel write rejects: no successor prompt, no synthetic terminal, state remains stopping.
5. First cancel rejects, retry succeeds while first is settled: release only after newest success and terminal.
6. Newest retry rejects after an older success: remain stopping.
7. Multiple ordered cancel writes: no prompt until all issued promises settle; no late cancel can target successor.
8. Direct concurrent start while running throws immediately.
9. Second start while one successor is staged throws; it does not replace the registered waiter.
10. Final-gate race: close/session/connection/stop identity changes before commit; no reservation/event/echo/prompt.
11. Atomic commit: once gates are satisfied only one caller reserves, with no asynchronous gap before ownership.
12. Admission deadline at 10 seconds: waiter rejects, prompt/event/echo counts remain zero, unresolved stop remains.
13. Terminal arrives after deadline: no expired waiter resurrects; a later supported request can be evaluated independently.
14. Manager invalidates a staged successor: token rejects/cleans up while stop id remains unchanged.
15. Repeated Stop invalidates the staged replacement and retries the same stop with a new attempt revision.
16. Close while waiting: teardown occurs, waiter rejects, timers/listeners clear, late cancel/terminal cannot emit or start.
17. Permission denial installs the same boundary and prevents a replacement crossing the denied prompt.
18. Terminal for an old explicit turn cannot clear or terminalize a reserved/running successor.
19. Session/connection replacement prevents old cancel settlements from opening the new session.

### GJC unit tests — `gjc-acp-agent.test.ts`

Mirror:

1. Ownerless working mints one stable explicit `gjc-autonomous-*` id.
2. Duplicate working is idempotent.
3. Natural idle closes exactly that id once.
4. Foreground working/idle does not open a competing ownerless mirror.
5. Replay suppression remains intact.

Scope:

6. Missing `GJC_ACP_ABORT_SCOPE` sends `scope:"turn"`.
7. Explicit `turn` sends `turn`.
8. Explicit `owned` sends `owned`.
9. Invalid configured value fails closed before control/prompt activity.

Control-result validation:

10. `turn`-scope safe `stopped/left_running/enabled/resume=true` accepted as one fact.
11. `owned`-scope safe `stopped/stopped/none/resume=false` accepted as one fact.
12. Exact selection mismatch rejected.
13. `ownedWork:"uncertain"` rejected.
14. `no_active_turn + terminal_no_effect` is conditional and never releases without eligible idle.
15. `uncertain`, `no_effect`, `no_store`, unknown disposition, `ok:false`, malformed object, and transport rejection each remain stopping and emit no terminal.

Order and phase:

16. Safe success before idle: no terminal/prompt until idle; then exact-id canceled event and successor.
17. Idle before safe success: no terminal/prompt until response; then release.
18. Idle before failed/malformed/ambiguous response: no terminal and no prompt after failure.
19. Failed response before idle: later idle still does not release.
20. Eligible idle followed by working before success invalidates idle; success still waits for a later idle.
21. Idle observed before stop installation is not eligible.
22. Late response/idle after close is ignored and cannot emit a stale terminal.
23. A delayed explicit-id terminal cannot be attributed to the successor.

Retry/successor:

24. Repeated ownerless Stop retains stop/turn id, increments attempt revision/idempotency key, and invalidates staged successor separately.
25. Success on retry still requires current eligible idle.
26. Staged-replacement Stop sends no replacement prompt.
27. Ownerless admission deadline rejects with unresolved response flag.
28. Ownerless admission deadline rejects with unresolved idle flag.
29. Foreground GJC stop calls ACP `cancel` only, never direct terminal control.
30. Ownerless GJC stop calls terminal control only, not a synthetic ACP cancel.

Steering:

31. Text steer sends one `turn.steer` with a fresh client ref and returns accepted.
32. Error/non-text path returns unavailable and never interrupts/retries/prompts.

### Manager integration tests — `agent-manager.test.ts`

1. **1,500/5,000 ms reproduction:** GJC/fake original prompt terminalizes at 5,000 ms; manager has not yet force-settled at 1,500 ms; replacement prompt is zero.
2. **2,000/5,000 ms production race:** manager force-settles at two seconds while original prompt remains pending until five seconds; manager invokes replacement, but adapter stages it and sends no prompt at/after two seconds.
3. When original terminal and all cancel writes settle at five seconds, the single staged replacement sends once and no `A foreground turn is already active` or busy failure occurs.
4. Cancel write settles at once but original terminal is delayed: notification completion does not release.
5. Original terminal arrives but cancel write is delayed/rejected: manager settlement does not release.
6. Stop while replacement is staged invalidates the successor; eventual terminal sends no replacement.
7. Ten-second admission expiry surfaces a bounded replacement error; manager does not report adapter readiness and prompt count remains zero.
8. Existing “no terminal event” replace fixture remains green with an explicit assertion/comment that the fake provider is already terminal/fenced at adapter level when interrupt returns.
9. Manager returns `not_running` after its force settlement; test/document that recovery then requires session close/recreate rather than promising a repeated-Stop retry.
10. Logs correlate manager and provider via session/turn/stop ids without manager claiming gate state.

### Provider registry tests

1. `providerId:"gjc"` plus `extends:"acp"` constructs `GjcACPAgentClient`.
2. Other custom ACP providers continue through `GenericACPAgentClient`.

### Live E2E acceptance

Run only against the development daemon/home; never restart or target port 6767.

Use the documented custom provider with valid `GJC_ACP_ABORT_SCOPE=owned` and a scratch GJC 0.15.5 session:

1. Reproduce an autonomous working turn and confirm the explicit mirror id and steer delivery.
2. Start a foreground prompt, request replacement, and capture that the manager's two-second force settlement occurs without a replacement `session/prompt`.
3. Confirm replacement sends only after the original GJC prompt terminal and all cancellation writes settle.
4. During an ownerless turn, press Stop and capture the terminal abort result plus post-stop idle in either observed order; confirm exact-id terminal and no two-second synthetic closure.
5. Exercise one unresolved ownerless abort in a disposable session; confirm the ten-second admission deadline rejects the replacement and sends no prompt.
6. Close the disposable session and confirm no late terminal/event/prompt.
7. Confirm final lifecycle returns idle and no `-32603 busy` or foreground-turn exception occurs. Absence is corroborating; positive gate/release logs are the primary proof.

## Observability

Add structured provider logs at state transitions, without prompt contents:

- `provider.acp.stop_installed` — sessionId, stopId, stoppedTurnId, kind, connection identity.
- `provider.acp.cancel_attempt_started` / `_settled` — stopId, revision, outcome.
- `provider.acp.stop_terminal_observed` — stopId, explicit turn id.
- `provider.acp.successor_staged` / `_invalidated` — stopId, successor token/reason.
- `provider.acp.admission_released` — stopId, successor token, satisfied gate names.
- `provider.acp.admission_deadline` — stopId, successor token, unresolved terminal/cancel/provider-idle/provider-result flags.
- `provider.gjc.phase_edge` — sessionId, phase, phase revision, mirror turn id, stopId when present.
- `provider.gjc.abort_attempt` / `_result` — stopId, revision, configured scope, normalized disposition, validation result; no raw sensitive payload.
- `provider.gjc.ownerless_stop_released` — stopId, explicit mirror id, result revision, idle phase revision.

Event order in logs is intentionally a partial order:

- control success may precede or follow idle;
- prompt terminal may precede or follow cancel write settlement.

Release logs must name both facts. Do not log “acknowledged” for a cancellation notification. Do not claim raw phase edges are natively correlated to a GJC turn.

Manager logs remain limited to facts it owns and carry available correlation ids. The evidence trace can then distinguish:

`manager force-settled` → `replacement start invoked` → `adapter successor staged` → later `adapter admission released`

without suggesting force settlement opened the adapter gate.

## Pre-mortem

| Failure mode                                                              | Early signal                                                                           | Prevention / containment                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Late cancel write reaches successor                                       | Replacement prompt appears before every cancel promise settles                         | Session cancel ledger, same-connection aggregation, atomic reservation           |
| Original terminal clears successor                                        | Terminal event id differs from stopped id, or successor slot becomes idle unexpectedly | Explicit ids and identity-checked `finishTurn`                                   |
| Ownerless control response is treated as proof despite unsafe disposition | `uncertain`/`no_effect` appears before a synthetic terminal                            | Conservative exact validation matrix; no terminal on failure                     |
| Idle from before the stop opens the gate                                  | stop installs while cached phase is idle                                               | Require post-install phase revision; invalidate on later working                 |
| Idle arrives before failed result and accidentally releases               | terminal/prompt emitted after response rejection                                       | Two-fact latch; failure never satisfies result fact                              |
| Deadline becomes a readiness signal                                       | prompt occurs exactly at 10 seconds                                                    | Deadline only rejects waiter and leaves stop intact                              |
| Two successors pass the gate                                              | duplicate turn_started/prompt                                                          | Single successor token and synchronous reserved transition                       |
| Repeated Stop mutates stop identity                                       | old promises release new stop or staged request survives                               | Separate stop id, attempt revision, successor token                              |
| Manager log claims provider ready                                         | support trace repeats “acknowledged” ambiguity                                         | Manager/provider ownership-specific log vocabulary                               |
| Close leaks waiters or late events                                        | post-close terminal or prompt                                                          | closed-first teardown, waiter rejection, listener/timer cleanup, identity guards |
| Invalid abort scope silently changes semantics                            | production intended owned but control sends turn                                       | exact launch-env resolution and fail-closed invalid configuration                |
| Manager force settlement makes retry unreachable                          | repeated Stop returns not_running                                                      | narrow guarantee; close/recreate recovery, no false retry promise                |

## Acceptance criteria

1. The 2,004 ms production sequence is pinned: manager force settlement cannot cause a replacement prompt while the original ACP prompt is unresolved.
2. A foreground replacement sends only after the original explicit terminal and every session-scoped cancel write for the stop are terminally settled with the newest successful.
3. Direct concurrent starts still throw; only one registered successor waits.
4. Admission/reservation is atomic and performs no successor side effect before commit.
5. The 10-second deadline rejects without sending, does not open readiness, and cleans the successor waiter.
6. Ownerless GJC Stop emits a terminal only after both an exact safe `turn.abort` result for the configured scope and an eligible post-stop idle, in either order.
7. Failed, malformed, ambiguous, mismatched-scope, and transport-rejected abort results remain stopping and emit no terminal.
8. GJC uses `owned` only when configured and otherwise honors valid `turn` default; invalid values fail closed.
9. Foreground GJC cancellation remains ACP `session/cancel`; direct terminal control is ownerless-only.
10. Repeated Stop separates stable stop identity, attempt revision, and successor invalidation.
11. Close/permission-denial paths use the same boundary and leak no waiters or stale terminal events.
12. Manager logs only manager facts; adapter logs state the actual admission proof with correlatable ids.
13. Existing generic providers and the manager's already-fenced no-terminal fixture remain behaviorally unchanged.
14. Ownerless steering and natural mirror completion from the original plan remain green.

## Verification commands

Run only changed targeted test files:

`npx vitest run packages/server/src/server/agent/providers/acp-agent.test.ts --bail=1`

`npx vitest run packages/server/src/server/agent/providers/gjc-acp-agent.test.ts --bail=1`

`npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1`

`npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1`

Then:

`npm run build:server` if generated cross-workspace declarations are stale.

`npm run typecheck`

`npm run lint`

`npm run format:check`

Do not run the full suite locally. Do not restart the production daemon on port 6767.

## Scope

In scope:

- Generic ACP session stop/admission correctness.
- GJC-specific ownerless mirror, terminal abort validation, scope handling, and steering.
- Manager-owned log wording and correlation.
- Targeted unit, integration, live E2E, and documentation changes.

Out of scope:

- Raising cancellation or prompt timeouts.
- App/UI changes.
- Protocol schema changes.
- A manager capability to resurrect a force-settled run solely for retry.
- General lifecycle modeling of every provider's autonomous work.
- GJC `turn.steer_status` reconciliation.
- Release/deployment work.

## RALPLAN-DR — adapter-owned stop boundary

**Decision.** Install a generic ACP session stop fence before cancellation and make successor admission depend on authoritative adapter-owned proof. Foreground ACP requires the original prompt terminal plus settlement of all session-scoped cancel writes. GJC ownerless abort requires a validated terminal-safe `turn.abort` result for the configured scope plus a post-stop authoritative idle. Admission is bounded for callers by a 10-second fail-closed deadline and committed through one atomic reservation helper.

**Context.** Paseo's manager and provider adapter own different state. The manager's two-second force settlement is a UI/lifecycle recovery mechanism; ACP notification completion only proves transport write. GJC's original prompt can remain active for five seconds, so treating either fact as provider readiness allows a replacement to collide with the old foreground slot. The prior ownerless synthetic terminal had the same unsound assumption.

**Consequences.**

- Replacement latency follows provider terminal truth, not the manager timeout.
- A broken provider may leave the session stopping; the staged call fails after 10 seconds and recovery is close/recreate when the manager can no longer address the run.
- Generic ACP gains explicit stop/admission state and protected extension seams.
- GJC ownerless state requires two independent facts and an explicit mirror turn id.
- No late cancel or old terminal can target/misattribute a committed successor.

**Rejected alternatives.** Larger timeouts, manager-only gating, clearing active state after notification write, ownerless synthetic terminalization, hard-coded `owned` scope, and globally queued concurrent starts.

**Rebase checklist.**

1. Verify `startTurn` still has no side effects before admission reservation.
2. Verify `interrupt` installs the stop before `cancel`.
3. Verify `finishTurn` checks stopped turn and connection/session identity.
4. Verify every cancel write participates in the session ledger.
5. Verify GJC terminal result shapes against the installed supported GJC version when upgrading.
6. Verify OpenCode's 10-second precedent and provider docs remain aligned.
7. Re-run the 2,000/5,000 ms reproduction and both ownerless order permutations.

## Unresolved decisions and escalation gates

No implementation-blocking product decision remains in Planner revision 2.

The response matrix is deliberately conservative. If implementation discovers that GJC 0.15.5 emits a different successful terminal shape than the inspected source, stop and return to review with the captured non-sensitive result; do not broaden acceptance ad hoc.

If failing invalid `GJC_ACP_ABORT_SCOPE` at initialization conflicts with an established launch-config convention, return to review. Do not silently fall back while this plan is pending.

If generic ACP cannot expose an atomic provider-gate commit without widening mutable internals, return to architecture review rather than duplicating start-side effects in GJC.

## Consensus trail

- Original Ralplan: approved the mirror/steer design, but lacked the newly evidenced foreground cancellation race.
- Evidence review: `specs/gjc-acp-foreground-turn-trace.md` established that cancel notification completion and manager force settlement are not provider terminalization.
- Planner revision 1: replaced synthetic foreground/ownerless settlement with adapter-level gates.
- Architect review of revision 1: **WATCH**. Required exact two-fact ownerless proof, configured-scope preservation, terminal-result matrix, named fail-closed deadline, atomic reservation, identity separation, narrow retry claims, and ownership-correct observability.
- Planner revision 2: incorporates every WATCH item and the 1,500/5,000 ms plus 2,000/5,000 ms reproductions above.
- Current gate: **pending fresh Architect/Critic review and owner approval**.

---

_Recovered from the crashed `gpt-5.6-sol` codex review session (paseo agent `af7d7232-89b5-4e9b-8abe-c7534d6a2126`, codex thread `01a0511a-a68f-7172-a167-785d4b52e136`), which ended on a provider usage limit before it could write this file. The draft existed only at `/tmp/ralplan-gjc-acp-cancel-planner-draft.md`. No source file has been edited by the Planner pass._
