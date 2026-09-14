# Plan — GJC ACP busy-turn and cancellation-boundary fix — **PENDING APPROVAL**

- Ralplan run: `eaf1316d-e0b0-4308-b41f-12459b91c414` (deliberate mode), stage `final`, stage_n 8 — consensus complete. The consensus artifact is iteration 3 (`stage-05-revision.md`, sha `07004e6d…`); this final adds only header/status, Intent Reconciliation, consensus-trail, and byte-count bookkeeping. Roles: Planner `Planner-GjcAcpCancel`, Architect `Architect-GjcAcpCancel`, Critic `Critic-GjcAcpCancel` (all same-session persisted, resumed per pass).
- Status: **PENDING APPROVAL — consensus complete (Architect CLEAR/APPROVE and Critic OKAY, both at pass 3); pending owner approval only**. This is planning-only; nothing in this document has been implemented.
- Provenance: iteration 1 adopted the recovered "Planner revision 2" draft (712 lines, `fork/plans/ralplan-gjc-acp-cancellation-boundary.md`) as this run's initial Planner artifact after factual verification. Iteration 2 incorporated the pass-1 reviews — Architect stage-02 (`stage-02-architect.md`, sha `afe3f4d4…`, **WATCH / REQUEST_CHANGES**: A1 major + A2–A6 minors) and Critic stage-02 (`stage-02-critic.md`, sha `74c39357…`, **OKAY**: C1–C4 minors, none required; C4 absorbed into A6). Iteration 3 (this artifact) fixes only the two self-contradictions the Critic found in the iteration-2 delta (C5, C6) after pass-2 returned Architect **CLEAR/APPROVE** (`stage-04-architect.md`, sha `ab582723…`) and Critic **OKAY** (`stage-04-critic.md`, sha `31c3e777…`). Section structure is unchanged; reviewers can delta-check that nothing else changed. No pre-resolved decision is re-opened; no scope is added.
- Final gate: pass-3 reviews returned Architect **CLEAR / APPROVE** (`stage-06-architect.md`, sha `9be781f7…` — C5/C6 resolved, delta purity confirmed by exact full-file diff, no new findings) and Critic **OKAY** (`stage-06-critic.md`, sha `4bfb76bf…` — C5/C6 resolved, rule-5 counter-review clean, no new findings). Consensus closed on iteration 3 of 5; post-interview reconciliation (`stage-07-post-interview.md`, sha `3383ae85…`) is reconciled-clean.
- Primary evidence: `specs/gjc-acp-foreground-turn-trace.md`.
- Superseded prior plan retained for history: `fork/plans/ralplan-gjc-acp-busy-turn.md` — its mirror/steer design survives in this plan; its cancellation design does not.
- Archived prior-run consensus trail: `~/.paseo-fork/ralplan-receipts/plan-gjc-acp-busy-turn/` (stages 01–05) and `~/.paseo-fork/ralplan-receipts/plan-fork-release-channel/`.
- Source baseline inspected: Paseo checkout at `/Users/ctaylor/repos/paseo`; installed `@gajae-code/coding-agent` 0.15.5 at `/Users/ctaylor/.cache/.bun/install/global/node_modules/@gajae-code/coding-agent/`.
- There is no matching `specs/*-spec.md`, so this plan has no FR/SC identifiers. The evidence trace is the authoritative incident record.
- Stage byte-counts (`wc -c .gjc/_session-eaf1316d-e0b0-4308-b41f-12459b91c414/plans/ralplan/eaf1316d-e0b0-4308-b41f-12459b91c414/*`, post-final): planner 60871 · intent 3304 · architect-p1 20087 · critic-p1 12913 · revision-2 76634 · architect-p2 8166 · critic-p2 9807 · revision-3 78416 · architect-p3 5094 · critic-p3 5432 · post-interview 2628 · final 80996 · pending-approval 80996 · index 3800 · total 449144. Draft-side (planner+intent+revisions) 219225 vs review-side (architect+critic+post-interview) 64127 bytes.

## Factual verification (adoption pass, 2026-08-30; anchors re-verified for iteration 2)

Every load-bearing code claim was spot-checked against the current checkout and the installed GJC 0.15.5 source. Results:

- `packages/server/src/server/agent/providers/acp-agent.ts`: `startTurn` foreground guard `A foreground turn is already active` at :1616-1617; `interrupt()` awaits only `connection.cancel({sessionId})` when `activeForegroundTurnId` is set (:2164-2180); `activeForegroundTurnId` set at :1623 and cleared in `finishTurn` at :2942; `ACPAgentSessionOptions` (non-exported, :444) carries `launchEnv?: Record<string,string>` (:473), stored `private readonly` on the session (:1426, assigned :1485) — a protected read-only one-key lookup is feasible exactly as designed.
- `packages/server/src/server/agent/agent-manager.ts`: `INTERRUPT_SESSION_TIMEOUT_MS = 2_000` (:86); the two-second force-settlement plus synthetic `turn_canceled` dispatch (:2728-2746 and the autonomous branch :2760-2770); `startPendingForegroundTurn` (:2148); `interruptSession` wraps `session.interrupt()` in the 2s `interruptSessionMs` budget (:2790-2812). All as claimed.
- `packages/server/src/server/agent/providers/opencode-agent.ts`: `OPENCODE_PENDING_ABORT_START_TIMEOUT_MS = 10_000` (:168), used with `observeProviderStopBoundary` (:3585) — the named 10-second admission-deadline precedent is real.
- `packages/server/src/server/agent/provider-registry.ts`: custom-ACP dispatch lives in the `createBaseClient` closure for `override.extends === "acp"` (:784-806), with per-`providerId` client checks (cursor/kimi/kiro/traecli) before the `GenericACPAgentClient` fallback (:805) — the `providerId:"gjc"` hook goes exactly there, before the fallback, as Step 3 states.
- Installed GJC 0.15.5: `CANCEL_SETTLEMENT_GRACE_MS = 5_000` (`src/modes/acp/acp-agent.ts:89`); `_gjc/sdk/control` extension method recognized and dispatched (`src/modes/acp/acp-agent.ts:1953-1990`); terminal `turn.abort` validated strictly in `src/sdk/host/control/dispatch.ts` (`invokeAbort`, :194-208); `turn.steer` takes `{text, clientRef?}` (`dispatch.ts:219-220`); `gjcPhase` `working`/`idle` edges ride `session_info_update._meta` (`src/modes/acp/acp-agent.ts:2784, 2880, 2958, 3519`); `turn.abort` is wrapped in `SESSION_ABORT_TIMEOUT_MS = DEFAULT_SDK_REQUEST_TIMEOUT_MS = 10_000` (`src/sdk/session-reconnect.ts:87`, applied at `src/sdk/acp/adapter.ts:397`) and the terminal wait uses `graceMs: 10_000` (`src/sdk/host/session-runtime.ts:2714-2716`).
- Terminal-result matrix vs installed source (`src/sdk/host/session-runtime.ts`, `terminalAbort`): every field and disposition the matrix encodes is emitted exactly as encoded — `turn:"stopped"` with `turn`-scope `ownedWork:"left_running"/automaticDelivery:"enabled"/resumeOnOwnedCompletion:true` (:2841-2842, replay :2108) and `owned`-scope `ownedWork:"stopped"/none/false` (:2843-2847); replayed `owned` `stopped` may carry `ownedWork:"uncertain"` (:2104, :2169) — which the matrix already rejects; `turn:"no_active_turn"` + `terminal:"terminal_no_effect"` (:2458-2463, :2529-2534, replay :2111-2117); `turn:"no_effect"` + `terminal_no_effect` (:2622-2625); `turn:"uncertain"` with `reason` (:2137-2153, :2633-2639, :2662-2668, :2730-2736, :2771-2777); `turn:"no_store"` + `terminal_no_effect` (:2041-2046); `selection` always equals the requested scope; documented replay envelope `{responseState, responsePayloadHash, terminalPublished}` present on retries. **No matrix correction was required — installed shapes match.**
- Permission/exit paths (verified for iteration-2 finding A1/A3/A5): `respondToPermission` sends `connection.cancel` on deny+interrupt with no `activeForegroundTurnId` check (:2147-2149); permission requests raised outside a foreground turn are queued in `pendingPermissions` with `turnId: null` (:2258-2266); the process/stderr exit handler synthesizes `turn_failed` for `activeForegroundTurnId` (:2502-2510); a rejected `connection.prompt` settles the turn through `finishTurn({type:"turn_failed"})` (:1640-1647).
- Docs integration points exist: `docs/providers.md` "Session-scoped cancellation needs a stop boundary inside the provider" (:527-533, the OpenCode precedent) and `docs/agent-lifecycle.md` `### Cancellation` (:36-47).
- Test targets named in the verification commands all exist (`acp-agent.test.ts`, `agent-manager.test.ts`, `provider-registry.test.ts`); `gjc-acp-agent.ts`/`.test.ts` do not exist yet, matching the new-file plan.

Three factual corrections were applied to the recovered draft in iteration 1 (unchanged in this revision):

1. **§9 / Step 2 — terminal idempotency key facts.** The key is mandatory for terminal mode (a `{mode:"terminal"}` control without a nonempty key of at most 128 UTF-8 bytes is rejected by `invokeAbort`), and on the `_gjc/sdk/control` extension path it must ride inside `input` because the ACP-side `sdkControl` forwards only `{operation, input}` and the SDK adapter hoists `confirm`/`idempotencyKey` out of `input` into the control envelope (installed `src/sdk/acp/adapter.ts:374-391, 494-496`) — matching GJC's own internal `cancel()` (:364-365). The draft's wire shape was correct; it now states the requirement and bound explicitly.
2. **§10 preamble — failure surfaces.** The installed SDK adapter throws `AcpSdkAdapterError` on an underlying error envelope (`src/sdk/acp/adapter.ts:412-416`), while the ACP-side `extMethod` converts handler failures for recognized `_gjc/*` methods into resolved `{ok:false, error:{code,message}}` payloads (`src/modes/acp/acp-agent.ts:1985-1989`). Paseo must therefore reject on BOTH a resolved `{ok:false}` envelope and a transport/JSON-RPC rejection; the matrix rows already encode this, and the preamble now says so precisely.
3. **Step 1 / Step 2 — session-construction seam must cover both construction paths.** `ACPAgentClient.createSession` (:859) and `resumeSession` (:895) each construct `ACPAgentSession` directly; a seam covering only new sessions would silently hand resumed GJC sessions the generic class, losing mirror/control semantics.

Pass-2 anchor re-verification (iteration 2, C3): `launchEnv` corrected :471→:473 and `resumeSession` corrected :892→:895. The `finishTurn` clear (:2942) and `turn.steer` (`dispatch.ts:219-220`) anchors were re-checked against current source and are correct exactly as cited in iteration 1 — the Critic's proposed replacements for those two (`:2941`, `:218-219`) anchor the preceding statement/case label respectively and are themselves off by one; no change made. All newly cited anchors for findings A1/A2/A3/A5/A6 were verified this pass and are listed above.

No verification check contradicted any pre-resolved decision; no escalation is raised on that axis.

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

Post-consensus reconciliation (final): the pre-consensus intent receipt (`stage-01-intent.md`, sha `b7033704…`) recorded `material-open-items: none` against the dispatcher contract's seven pre-resolved decisions. Consensus introduced no new material item: all twelve review findings (A1–A6, C1–C6) were resolved inside revisions, no reviewer escalated against any pre-resolved decision, and post-interview verification (`stage-07-post-interview.md`, sha `3383ae85…`) is reconciled-clean with nothing deferred to the user. The seven pre-resolved decisions are retained verbatim as binding intent.

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

Foreground interrupt, replacement, repeated Stop, and close-during-stopping route through the same stop-boundary operation; permission denial (deny+interrupt via `respondToPermission`) routes through the §7 stop-kind router, whose no-stop-able-turn branch installs no stop and suppresses the cancel write entirely. For the current immutable stop:

- `cancelIssuedRevision` increments for each write attempt.
- Every issued `connection.cancel({sessionId})` promise is tracked on the captured ordered live connection.
- `cancelSettledRevision` and per-attempt outcomes are recorded.
- Admission requires all issued revisions to have settled and the newest revision to have written successfully.
- A newer successful retry may recover an older rejected write only after all older and newer writes have settled; no unresolved older write can trail behind the successor.
- If the newest attempt rejects, the session remains stopping.
- If the connection/session identity changes, the old stop cannot admit a successor on the new identity.

`interrupt()` may return after the current notification write settles, preserving the current interface. It must not clear the stop or imply readiness.

Retries aggregate only on the same ordered live connection and same stop identity. A retry on a different connection/session is not recovery; close/recreate the session.

**Unplanned transport/process death during `stopping`** (iteration 2, A3): settle every in-flight ledger write as failed at the moment the death is observed. Writes tracked on the captured ordered connection are never-landable once that connection/process is gone, and the existing exit handler already synthesizes the foreground terminal (`turn_failed` for `activeForegroundTurnId`, acp-agent.ts:2502-2510), so the ledger supplies the matching write-side settlement. The newest revision is then failed, the gate stays closed, and a staged successor rejects immediately instead of burning the 10-second deadline against an unusable session. This is chosen over accepting the 10-second burn: it is strictly faster for the caller, requires only the already-captured connection identity, and still cannot manufacture readiness. Recovery is close/recreate.

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

Add `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS = 10_000`, following `OPENCODE_PENDING_ABORT_START_TIMEOUT_MS` (verified at `opencode-agent.ts:168`).

The deadline starts when a successor is staged behind a stop, not when Stop is pressed. It bounds the caller's wait; it is not a provider-readiness timeout.

On expiry:

- reject only that queued `startTurn`;
- send no `session/prompt`;
- allocate/emit no successor turn event or user echo;
- log which required facts remain unresolved;
- invalidate and clean the successor token, timer, and listeners;
- leave the session in `stopping`.

A later valid terminal/fence may make a future manager-addressable request admissible, but expiry itself never advances state. If manager state has already force-settled and no addressable run remains, close/recreate is the supported recovery.

**Relationship to GJC's own abort budgets** (iteration 2, A2): the value deliberately equals GJC's budgets rather than sitting safely above them — installed 0.15.5 wraps `turn.abort` in `SESSION_ABORT_TIMEOUT_MS = DEFAULT_SDK_REQUEST_TIMEOUT_MS = 10_000` (`sdk/session-reconnect.ts:87`, applied at `sdk/acp/adapter.ts:397`) and its terminal wait uses `graceMs: 10_000` (`session-runtime.ts:2714-2716`). A slow-but-healthy abort can therefore consume the budget and expire the deadline — that is the designed outcome, not a defect: the deadline bounds only the caller's wait, and expiry never manufactures readiness (recovery is a later manager-addressable request or close/recreate). OpenCode remains the precedent for magnitude and fail-closed semantics; unlike OpenCode's status-polling gate, ACP's control round trip happens inside the window. **Deadline anchor (plan-level choice, recorded for review):** the deadline anchors when the successor is staged, not when the stop is installed — staging is when the caller's wait begins, and anchoring at installation would silently subtract cancel/abort latency from the caller-visible budget and couple it to the manager's flow order (the manager stages roughly two seconds after Stop). This paragraph documents the anchor inside pre-resolved decision 1; no timeout is raised.

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
6. Transition `reserved` to `running` at the defined point and roll back only the new reservation on a send failure; never reopen an unresolved old stop. On a send failure the rolled-back successor still receives its own `turn_failed` terminal, preserving today's behavior (acp-agent.ts:1640-1647); pinned by Generic test 20.

There must be no `await` between the final recheck and reservation. No event, echo, id allocation, or prompt occurs before the commit.

This helper must be generic; no `gjc` identifier enters the base class.

### 7. Close and permission denial

`close()`:

- marks the session closed before asynchronous teardown;
- prevents new reservations;
- performs existing connection/process teardown;
- settles any outstanding stop-ledger writes as failed and rejects all admission waiters with that reason, so teardown never leaves a waiter burning the deadline against a dead session (§2);
- clears timers/listeners and invalidates successor tokens;
- ignores late cancel settlements, control results, phase updates, and terminals after close;
- emits no stale synthetic terminal.

**Permission denial — stop-kind router** (iteration 2, A1). The deny+interrupt entry point is `respondToPermission` (acp-agent.ts:2147-2149 sends `connection.cancel` today with no foreground check; permission requests raised outside a foreground turn are queued with `turnId: null`, :2258-2266). Route it by kind:

- **Foreground turn active** → install the generic foreground stop with `stoppedTurnId = activeForegroundTurnId` and send the cancel through the session ledger (§2). A denied prompt cannot admit a replacement until the same terminal-plus-cancel conditions are met.
- **No foreground turn, GJC ownerless mirror open** (GJC subclass only) → route to the GJC ownerless stop (§11): `stoppedTurnId` is the mirror's explicit id; the two-fact gate applies unchanged.
- **No stop-able turn** — no foreground turn and no open mirror, including deny-after-terminal-end (the permission's turn already terminalized) → **suppress the cancel write entirely**: emit the permission resolution event, install no stop, leave admission state unchanged, and log the suppression with the correlation ids.

The no-stop-able-turn case suppresses rather than installing a vacuous stop: §1 requires an explicit `stoppedTurnId`, which does not exist here; a session-scoped cancel could kill an unrelated provider-owned run the adapter cannot identify (`gjcPhase` carries no turn id); and a vacuous terminal proof would manufacture provider truth (driver 3). Suppression cannot wedge — nothing is fenced, so nothing can remain `stopping`, and the manager's own settlement continues to govern its run bookkeeping exactly as today.

### 8. GJC ownerless mirror identity and phase tracking

Retain the proposed `GjcACPAgentSession` subclass and `GjcACPAgentClient` factory/registry dispatch, but change the mirror contract:

- On an eligible `gjcPhase:"working"` edge outside a foreground turn, mint a stable provider-side id such as `gjc-autonomous-<uuid>`.
- Emit `turn_started` with that explicit id.
- Retain the id through natural completion, Stop, retries, and successor staging.
- Emit the matching `turn_completed` or `turn_canceled` with that exact id only after authoritative completion requirements are met.
- Do not use a no-turnId terminal for mirrored activity.

Explicit ids prevent `AgentManager` from resolving the mirror's delayed terminal against a replacement. They do not correlate raw GJC phase edges. `gjcPhase` carries no turn id, so the adapter must not claim it can identify an arbitrary stale idle from another native turn.

**Replay suppression** (iteration 2, C1; named for GJC unit test 5): the mirror is edge-triggered on actual `working↔idle` transitions — a repeated or replayed `session_info_update` carrying the same `_meta.gjcPhase` (no transition) neither opens nor closes the mirror, and mirror events route through the base session's existing duplicate-event suppression on delivery.

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

Use the configured scope exactly. The idempotency key is mandatory, not optional: installed GJC 0.15.5 rejects every `{mode:"terminal"}` control whose key is missing, empty, or longer than 128 UTF-8 bytes (`host/control/dispatch.ts`, `invokeAbort`). Derive it from immutable `stopId` plus cancel-attempt revision — a uuid-plus-revision form fits the 128-byte bound with margin. On this extension path the key rides inside `input` by design: the ACP-side `sdkControl` forwards only `{operation, input}`, and the SDK adapter hoists `confirm`/`idempotencyKey` out of `input` into the control envelope (`sdk/acp/adapter.ts`), exactly matching GJC's own internal `cancel()`. Retries of one transport attempt do not invent a new stop and reuse the key; an intentional new abort attempt increments only the attempt revision and derives a new key.

Foreground turns do not call this extension. They continue to use ACP `session/cancel` and the generic stop fence. Ownerless `interrupt()` return timing is specified in §11 (issue-and-return); it does not affect scope resolution.

### 10. Exact GJC 0.15.5 terminal result validation

Installed 0.15.5 presents two failure surfaces for this call: the SDK session adapter throws `AcpSdkAdapterError` when the underlying session response carries an error envelope (`sdk/acp/adapter.ts`), and the ACP-side `extMethod` converts handler failures for recognized `_gjc/*` methods into resolved `{ok:false, error:{code,message}}` payloads rather than JSON-RPC errors (`modes/acp/acp-agent.ts`). Paseo therefore rejects on a resolved `{ok:false}` envelope of any shape and on any transport/JSON-RPC rejection, and treats everything else as untrusted. The returned `terminalAbort` value — the `result` of the inner `{ok:true}` control response — is still untrusted and must be validated as an object.

Common requirements:

- non-null, non-array object;
- `ok === true`;
- `selection` exactly equals the requested `turn` or `owned` scope;
- no unknown/ambiguous terminal disposition is accepted.

Conservative validation matrix (verified field-for-field against the installed `session-runtime.ts` `terminalAbort` implementation; no correction was required):

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

Allow documented replay metadata as extra fields, but do not weaken the required safe fields. In particular, reject `owned` `stopped` results whose `ownedWork` is `uncertain` — the installed replay path can genuinely produce that combination.

For `no_active_turn/terminal_no_effect`, the result is never independently sufficient. It is safe only in conjunction with the separately observed eligible idle for the same installed stop and unchanged session. An idle that raced before the response may satisfy that second fact if it was observed after stop installation and has not been invalidated by a later working edge.

### 11. Ownerless stop: two facts, either order

For a mirrored ownerless turn:

1. Install immutable stop identity and phase-revision boundary.
2. Enter `stopping` and stage/invalidate successors using the generic mechanics.
3. Send the terminal `turn.abort` request.
4. Validate the returned terminal result against the configured scope and matrix.
5. Independently observe GJC phase updates.
6. Only when both a safe control result and current eligible post-stop idle are present:
   - emit exactly one terminal with the mirror's explicit turn id — its kind picked by the validated abort disposition per the terminal-reason precedence paragraph below (`turn_canceled` for a validated `stopped`; `turn_completed` for `no_active_turn`/`terminal_no_effect`);
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

**Ownerless `interrupt()` return timing** (iteration 2, A6+C4): issue-and-return. `interrupt()` installs the stop, writes the `turn.abort` request, and returns once the request write is dispatched — it does not await the response or its validation. This mirrors §2's generic contract (return after the write settles; never imply readiness) and keeps the manager's two-second interrupt budget (`agent-manager.ts:2790-2812`) from being consumed by a provider response that can legitimately take the full ten-second abort budget. The response promise is tracked on the stop, validated against §10 whenever it arrives (either order), and the staged successor's 10-second admission deadline bounds the caller-visible total. A rejection arriving after `interrupt()` has returned is logged against the stop and never terminalizes anything.

**Terminal-reason precedence when natural completion races an installed stop** (iteration 2, A4): the validated abort disposition picks the mirror's final event; the idle edge supplies only the second fact and never overrides the disposition. A validated `stopped` result means the abort genuinely stopped the turn → `turn_canceled` with the explicit mirror id, even if the eligible idle was observed first. A `no_active_turn`/`terminal_no_effect` result means nothing was left to stop → the turn had already completed naturally, so release emits `turn_completed` with the same explicit id (the post-stop idle that made the release eligible is that natural completion edge). The mirror emits exactly one terminal by this rule, and it is final.

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

- Export `ACPAgentSessionOptions` for the subclass factory (it is module-private today).
- Extract a protected session-construction seam covering both existing construction paths — `ACPAgentClient.createSession` (:859) and `resumeSession` (:895) each construct `ACPAgentSession` directly today — so a subclass factory (the GJC `createAgentSession` override) supplies the session class for new and resumed sessions alike. A seam covering only `createSession` would silently hand resumed GJC sessions the generic class.
- Add protected, provider-neutral accessors for the session handle, foreground state, event delivery, logger, and one-key read-only launch-env lookup.
- Add immutable stop records, cancel-attempt ledger (including the transport/process-death settle-as-failed rule, §2), staged-successor token, and close cleanup.
- Install a foreground stop before `connection.cancel` in the interrupt path, and route the permission-deny entry point (`respondToPermission`) through the §7 stop-kind router: foreground fence, GJC ownerless stop via the subclass, or suppressed cancel write when no stop-able turn exists.
- Make `finishTurn` prove terminal ownership without clearing a successor.
- Implement the 10-second admission deadline (anchored at successor staging, §5) and atomic `startTurnWithAdmission`/reservation helper.
- Route ordinary `startTurn` through that helper without changing no-stop behavior.
- Preserve direct-concurrent-start rejection.

No GJC names or response shapes enter this file.

### Step 2 — Safe GJC provider

Add `packages/server/src/server/agent/providers/gjc-acp-agent.ts`:

- `GjcACPAgentClient` creates `GjcACPAgentSession` for both new and resumed sessions, via the extracted construction seam.
- Mirror working/idle with a stable explicit autonomous turn id (edge-triggered, replay-suppressed per §8).
- Track phase revisions and post-stop idle eligibility.
- Resolve and validate `GJC_ACP_ABORT_SCOPE`.
- For foreground interrupt, delegate to the generic `session/cancel` boundary.
- For ownerless interrupt, install the stop and issue terminal `turn.abort` with the mandatory bounded idempotency key, returning after the request write (issue-and-return, §11).
- Route deny+interrupt during an open ownerless mirror to the ownerless stop; let the generic no-stop-able-turn branch suppress the cancel write (§7).
- Validate the complete GJC 0.15.5 terminal result matrix.
- Release ownerless stop only on validated response plus eligible idle, either order, with the §11 terminal-reason precedence.
- Keep `turn.steer` behavior from the original plan.

### Step 3 — Provider dispatch

Edit `packages/server/src/server/agent/provider-registry.ts` so a custom ACP provider with `providerId:"gjc"` uses `GjcACPAgentClient` before the generic ACP fallback (dispatch chain at :784-806). Add the matching registry assertion.

### Step 4 — Manager wording and contract fixtures

Edit `packages/server/src/server/agent/agent-manager.ts` only where needed to:

- correct notification/manager-settlement log wording;
- include manager-owned session/turn/stop correlation fields that are already available;
- avoid claims about adapter readiness.

Update `packages/server/src/server/agent/agent-manager.test.ts` fixtures/comments and add replace/cancel race coverage. Do not add a manager-owned readiness state or increase timeouts.

### Step 5 — Documentation

Integrate the stop-boundary rule into the existing Cancellation section of `docs/agent-lifecycle.md`:

- manager settlement and provider/session readiness are independent;
- replacement can be staged after manager force settlement but cannot cross the adapter stop fence;
- the 10-second admission deadline equals GJC's own abort budget and anchors at successor staging, so expiry under a slow-but-healthy abort is the documented fail-closed outcome (§5).

Update the session-scoped cancellation boundary in `docs/providers.md`:

- install the stop before sending cancellation;
- wait for authoritative terminal plus all ordered cancel writes;
- provider-specific ownerless aborts may add stricter proof;
- admission deadlines reject waiters without creating readiness;
- use OpenCode as the existing precedent and ACP/GJC as the second implementation.

Do not append duplicate lifecycle prose elsewhere.

## File-level change map

| File                                                               | Planned change                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/agent/providers/acp-agent.ts`          | Generic stop/fence, cancel ledger (incl. settle-as-failed on transport death), deny-entry stop-kind router, successor token, 10-second fail-closed admission anchored at staging, atomic reservation, protected extension seams (incl. construction seam covering create+resume), launch-env lookup, close/permission integration |
| `packages/server/src/server/agent/providers/gjc-acp-agent.ts`      | New fork-only GJC session/client: explicit ownerless mirror id, phase revisions, configured scope, mandatory bounded idempotency key, terminal-result validation, two-fact ownerless stop with reason precedence and issue-and-return interrupt, steering                                                                         |
| `packages/server/src/server/agent/providers/acp-agent.test.ts`     | Foreground stop-boundary, cancellation-ledger, admission, deadline, permission router, rollback, and close unit tests                                                                                                                                                                                                             |
| `packages/server/src/server/agent/providers/gjc-acp-agent.test.ts` | New GJC phase/control/scope/order/retry/steer/deny unit and integration tests                                                                                                                                                                                                                                                     |
| `packages/server/src/server/agent/provider-registry.ts`            | GJC custom-provider dispatch before the generic fallback                                                                                                                                                                                                                                                                          |
| `packages/server/src/server/agent/provider-registry.test.ts`       | Dispatch/default-generic assertions                                                                                                                                                                                                                                                                                               |
| `packages/server/src/server/agent/agent-manager.ts`                | Accurate manager-owned cancellation logs only                                                                                                                                                                                                                                                                                     |
| `packages/server/src/server/agent/agent-manager.test.ts`           | Production-timing replace race, staged-replacement Stop, force-settlement contract clarification, provider-log correlation assertions                                                                                                                                                                                             |
| `docs/agent-lifecycle.md`                                          | Cancellation ownership, replacement boundary, deadline anchor/budget note                                                                                                                                                                                                                                                         |
| `docs/providers.md`                                                | Session-scoped cancellation/admission contract and OpenCode precedent                                                                                                                                                                                                                                                             |

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
17. Permission denial installs the same boundary and prevents a replacement crossing the denied prompt (foreground branch of the §7 router).
18. Terminal for an old explicit turn cannot clear or terminalize a reserved/running successor.
19. Session/connection replacement prevents old cancel settlements from opening the new session.
20. Reservation rollback on prompt-send failure (iteration 2, A5): successor commits, `connection.prompt` rejects, the new reservation rolls back without reopening the resolved stop, and the successor still receives its `turn_failed` terminal (pins current behavior at acp-agent.ts:1640-1647).
21. Transport/process death during stopping (iteration 2, A3): in-flight ledger writes settle as failed, the staged successor rejects immediately (no 10-second burn), and no synthetic readiness appears.
22. Deny+interrupt with no stop-able turn (iteration 2, A1): cancel write suppressed, permission resolution still emitted, admission state unchanged, no `stopping` remains.

### GJC unit tests — `gjc-acp-agent.test.ts`

Mirror:

1. Ownerless working mints one stable explicit `gjc-autonomous-*` id.
2. Duplicate working is idempotent.
3. Natural idle closes exactly that id once.
4. Foreground working/idle does not open a competing ownerless mirror.
5. Replay suppression remains intact (per the §8 definition: a same-phase replayed `session_info_update` neither opens nor closes the mirror and duplicate delivery is suppressed).

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
24. Natural completion racing an installed stop (iteration 2, A4): `no_active_turn` after a post-stop natural idle releases with `turn_completed` (exact id); validated `stopped` arriving after an idle releases with `turn_canceled`; exactly one terminal either way.

Retry/successor:

25. Repeated ownerless Stop retains stop/turn id, increments attempt revision/idempotency key, and invalidates staged successor separately.
26. Success on retry still requires current eligible idle.
27. Staged-replacement Stop sends no replacement prompt.
28. Ownerless admission deadline rejects with unresolved response flag.
29. Ownerless admission deadline rejects with unresolved idle flag.
30. Foreground GJC stop calls ACP `cancel` only, never direct terminal control.
31. Ownerless GJC stop calls terminal control only, not a synthetic ACP cancel; the wire shape carries `idempotencyKey` inside `input` and the key is nonempty and ≤128 UTF-8 bytes.
32. Ownerless `interrupt()` returns after the request write, before the response resolves (issue-and-return, §11): interrupt resolves promptly, the response is validated later, and a late rejection never terminalizes.
33. Deny+interrupt during an open ownerless mirror routes to the ownerless stop kind (two-fact release, exact-id terminal); deny+interrupt with no stop-able turn, including deny-after-terminal-end, suppresses the cancel write and leaves no permanent `stopping` (iteration 2, A1/A5).

Steering:

34. Text steer sends one `turn.steer` with a fresh client ref and returns accepted.
35. Error/non-text path returns unavailable and never interrupts/retries/prompts.

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

### Log-event assertions (iteration 2, C2)

The designed `provider.acp.*` / `provider.gjc.*` events are asserted by folding minimal checks into existing tests (no new test files):

- Generic tests 1–3 assert `provider.acp.stop_installed` (stop id, stopped turn id, kind, connection identity), `provider.acp.cancel_attempt_started`/`_settled` (revision, outcome), and `provider.acp.admission_released` naming the satisfied gate facts.
- Generic tests 12–15 assert `provider.acp.admission_deadline` names the unresolved fact flags, and `provider.acp.successor_staged`/`_invalidated` carries the token and reason.
- GJC tests 16 and 24 assert `provider.gjc.ownerless_stop_released` names both facts (result revision and idle phase revision) and `provider.gjc.phase_edge` carries the mirror turn id; GJC test 15 asserts `provider.gjc.abort_attempt_result` records the normalized disposition and validation verdict with no raw payload.
- Manager test 10 extends to assert cross-correlation: the manager's force-settlement and replacement-invocation log lines share the session/turn/stop ids emitted by `provider.acp.stop_installed` and `provider.acp.successor_staged` in the same replace flow.

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
- `provider.gjc.ownerless_stop_released` — stopId, explicit mirror id, result revision, idle phase revision, terminal reason (completed vs canceled per §11 precedence).
- `provider.acp.deny_cancel_suppressed` — sessionId, permission request id, correlation ids; emitted only by the §7 no-stop-able-turn branch.

Event order in logs is intentionally a partial order:

- control success may precede or follow idle;
- prompt terminal may precede or follow cancel write settlement.

Release logs must name both facts. Do not log “acknowledged” for a cancellation notification. Do not claim raw phase edges are natively correlated to a GJC turn.

Manager logs remain limited to facts it owns and carry available correlation ids. The evidence trace can then distinguish:

`manager force-settled` → `replacement start invoked` → `adapter successor staged` → later `adapter admission released`

without suggesting force settlement opened the adapter gate.

## Pre-mortem

| Failure mode                                                              | Early signal                                                                                | Prevention / containment                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Late cancel write reaches successor                                       | Replacement prompt appears before every cancel promise settles                              | Session cancel ledger, same-connection aggregation, atomic reservation                                    |
| Original terminal clears successor                                        | Terminal event id differs from stopped id, or successor slot becomes idle unexpectedly      | Explicit ids and identity-checked `finishTurn`                                                            |
| Ownerless control response is treated as proof despite unsafe disposition | `uncertain`/`no_effect` appears before a synthetic terminal                                 | Conservative exact validation matrix; no terminal on failure                                              |
| Idle from before the stop opens the gate                                  | stop installs while cached phase is idle                                                    | Require post-install phase revision; invalidate on later working                                          |
| Idle arrives before failed result and accidentally releases               | terminal/prompt emitted after response rejection                                            | Two-fact latch; failure never satisfies result fact                                                       |
| Deadline becomes a readiness signal                                       | prompt occurs exactly at 10 seconds                                                         | Deadline only rejects waiter and leaves stop intact                                                       |
| Two successors pass the gate                                              | duplicate turn_started/prompt                                                               | Single successor token and synchronous reserved transition                                                |
| Repeated Stop mutates stop identity                                       | old promises release new stop or staged request survives                                    | Separate stop id, attempt revision, successor token                                                       |
| Manager log claims provider ready                                         | support trace repeats “acknowledged” ambiguity                                              | Manager/provider ownership-specific log vocabulary                                                        |
| Close leaks waiters or late events                                        | post-close terminal or prompt                                                               | closed-first teardown, settle-as-failed ledger, waiter rejection, listener/timer cleanup, identity guards |
| Invalid abort scope silently changes semantics                            | production intended owned but control sends turn                                            | exact launch-env resolution and fail-closed invalid configuration                                         |
| Manager force settlement makes retry unreachable                          | repeated Stop returns not_running                                                           | narrow guarantee; close/recreate recovery, no false retry promise                                         |
| Deny+interrupt with no stop-able turn wedges or kills an unrelated run    | deny during ownerless idle or after terminal end leaves `stopping`, or a stray cancel lands | §7 stop-kind router with suppressed cancel and `deny_cancel_suppressed` log                               |
| Reservation rollback reopens the old stop                                 | successor prompt-send failure un-fences the resolved stop                                   | §6 item 6: roll back only the new reservation; successor keeps its own `turn_failed` (test 20)            |
| Transport death burns the admission deadline                              | staged successor waits 10 s against a dead session                                          | §2 settle-as-failed on observed death; immediate fail-closed rejection (test 21)                          |
| Natural completion misreported as canceled (or vice versa)                | `turn_canceled` emitted for a turn that completed, or duplicate terminals                   | §11 disposition-picks-reason precedence; exactly one final terminal (test 24)                             |

## Acceptance criteria

1. The 2,004 ms production sequence is pinned: manager force settlement cannot cause a replacement prompt while the original ACP prompt is unresolved.
2. A foreground replacement sends only after the original explicit terminal and every session-scoped cancel write for the stop are terminally settled with the newest successful.
3. Direct concurrent starts still throw; only one registered successor waits.
4. Admission/reservation is atomic and performs no successor side effect before commit.
5. The 10-second deadline (anchored at successor staging, §5) rejects without sending, does not open readiness, and cleans the successor waiter.
6. Ownerless GJC Stop emits a terminal only after both an exact safe `turn.abort` result for the configured scope and an eligible post-stop idle, in either order; the validated disposition picks the terminal reason (§11).
7. Failed, malformed, ambiguous, mismatched-scope, and transport-rejected abort results remain stopping and emit no terminal.
8. GJC uses `owned` only when configured and otherwise honors valid `turn` default; invalid values fail closed.
9. Foreground GJC cancellation remains ACP `session/cancel`; direct terminal control is ownerless-only.
10. Repeated Stop separates stable stop identity, attempt revision, and successor invalidation.
11. Close/permission-denial paths use the same boundary and leak no waiters or stale terminal events; the deny entry point routes by stop kind (§7) and never wedges or cancels blindly.
12. Manager logs only manager facts; adapter logs state the actual admission proof with correlatable ids, and the designed provider events are asserted by named tests.
13. Existing generic providers and the manager's already-fenced no-terminal fixture remain behaviorally unchanged.
14. Ownerless steering and natural mirror completion from the original plan remain green.
15. Transport/process death during stopping settles in-flight writes as failed and rejects staged successors immediately (§2, Generic 21).
16. A failed successor prompt-send rolls back only the new reservation and still delivers the successor's own `turn_failed` (§6 item 6, Generic 20).
17. Ownerless `interrupt()` returns after the `turn.abort` request write, never awaiting or implying response validation (§11, GJC 32).

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

**Decision.** Install a generic ACP session stop fence before cancellation and make successor admission depend on authoritative adapter-owned proof. Foreground ACP requires the original prompt terminal plus settlement of all session-scoped cancel writes. GJC ownerless abort requires a validated terminal-safe `turn.abort` result for the configured scope plus a post-stop authoritative idle. Admission is bounded for callers by a 10-second fail-closed deadline (anchored at successor staging) and committed through one atomic reservation helper. The permission-deny entry point routes by stop kind, suppressing the cancel write when no stop-able turn exists.

**Context.** Paseo's manager and provider adapter own different state. The manager's two-second force settlement is a UI/lifecycle recovery mechanism; ACP notification completion only proves transport write. GJC's original prompt can remain active for five seconds, so treating either fact as provider readiness allows a replacement to collide with the old foreground slot. The prior ownerless synthetic terminal had the same unsound assumption.

**Consequences.**

- Replacement latency follows provider terminal truth, not the manager timeout.
- A broken provider may leave the session stopping; the staged call fails after 10 seconds and recovery is close/recreate when the manager can no longer address the run.
- Generic ACP gains explicit stop/admission state and protected extension seams.
- GJC ownerless state requires two independent facts and an explicit mirror turn id.
- No late cancel or old terminal can target/misattribute a committed successor.
- The 10-second caller deadline equals GJC's own abort budget by design; a slow-but-healthy abort can expire it, and that expiry is the documented fail-closed outcome, never readiness.

**Rejected alternatives.** Larger timeouts, manager-only gating, clearing active state after notification write, ownerless synthetic terminalization, hard-coded `owned` scope, globally queued concurrent starts, and a vacuous terminal proof for stop-less denies.

**Rebase checklist.**

1. Verify `startTurn` still has no side effects before admission reservation.
2. Verify `interrupt` installs the stop before `cancel`.
3. Verify `finishTurn` checks stopped turn and connection/session identity.
4. Verify every cancel write participates in the session ledger, including the deny entry point and settle-as-failed on transport death.
5. Verify GJC terminal result shapes against the installed supported GJC version when upgrading — including the mandatory ≤128-byte terminal idempotency key, the `sdkControl` input-hoisting of `idempotencyKey`, and the extMethod `{ok:false}` resolved-envelope failure surface.
6. Verify OpenCode's 10-second precedent and provider docs remain aligned, and that the GJC abort-budget equality note in §5 still holds.
7. Re-run the 2,000/5,000 ms reproduction and both ownerless order permutations.
8. Verify the §7 deny router still covers foreground, ownerless-mirror, and no-stop-able-turn cases against any change to `respondToPermission`.

## Unresolved decisions and escalation gates

No implementation-blocking product decision remains in Planner revision 2, and iteration 2 resolves every pass-1 finding without opening a new one.

The response matrix is deliberately conservative. If implementation discovers that GJC 0.15.5 emits a different successful terminal shape than the inspected source, stop and return to review with the captured non-sensitive result; do not broaden acceptance ad hoc.

If failing invalid `GJC_ACP_ABORT_SCOPE` at initialization conflicts with an established launch-config convention, return to review. Do not silently fall back while this plan is pending.

If generic ACP cannot expose an atomic provider-gate commit without widening mutable internals, return to architecture review rather than duplicating start-side effects in GJC.

## Consensus trail

- **Iteration 1 (stage planner 1, sha `62988f07…`):** the recovered revision-2 draft (`fork/plans/ralplan-gjc-acp-cancellation-boundary.md`, 712 lines) was adopted as this run's initial Planner artifact after a bounded factual verification pass against the current checkout and installed GJC 0.15.5. Three factual corrections were applied (mandatory ≤128-byte terminal idempotency key and its in-`input` placement on the extension path; the two `_gjc/sdk/control` failure surfaces; the session-construction seam covering `createSession` and `resumeSession`). The terminal-result matrix required no correction.
- **Pass-1 reviews (stage 02):** Architect `stage-02-architect.md` (sha `afe3f4d4…`) returned **WATCH / REQUEST_CHANGES** — A1 major (permission-deny stop kind unspecified) plus minors A2–A6; explicitly “no blocker findings” and “not BLOCK”; no pre-resolved decision challenged. Critic `stage-02-critic.md` (sha `74c39357…`) returned **OKAY** with minors C1–C4 and no required changes; C4 was folded into A6 by the orchestrator.
- **Iteration 2 (stage revision 3, sha `3c169f3a…`):** resolved all nine findings additively — A1 §7 stop-kind router for the deny entry point (+`respondToPermission` in §2's participant list, Step 1/2 wiring, Generic 22, GJC 33, `deny_cancel_suppressed` log); A2 §5 names the GJC abort-budget equality (`SESSION_ABORT_TIMEOUT_MS`/`graceMs` both 10_000) and records the staging anchor as a plan-level choice (+ Step 5 docs line); A3 §2 settles in-flight ledger writes as failed on observed transport/process death (+ §7 close bullet, Generic 21); A4 §11 terminal-reason precedence (validated disposition picks the reason; GJC 24); A5 Generic 20 (reservation rollback) and GJC 33 (ownerless deny); A6+C4 §11 issue-and-return ownerless `interrupt()` timing (+ GJC 32, AC 17); C1 §8 replay-suppression definition; C2 named log-event assertions mapped to existing tests (+ AC 12); C3 anchor fixes (`launchEnv` :473, `resumeSession` :895; the other two proposed anchors were re-verified as already correct and left unchanged). Section structure is unchanged for delta-only pass-2 review.
- **Pass-2 reviews (stage 04):** Architect `stage-04-architect.md` (sha `ab582723…`) returned **CLEAR / APPROVE**; Critic `stage-04-critic.md` (sha `31c3e777…`) returned **OKAY** with exactly two non-gating minors (C5, C6), both self-contradictions introduced by the iteration-2 delta.
- **Iteration 3 (this harmonization revision, stage revision 5):** fixes only C5 and C6 with sentence-level edits and nothing else — C5: §11 step 6 now emits "exactly one terminal" whose kind is picked by the validated abort disposition per the terminal-reason precedence paragraph (previously an unconditional `turn_canceled`, which contradicted AC 6 / GJC test 24); C6: §2's participant sentence now routes permission denial through the §7 stop-kind router, whose no-stop-able-turn branch installs no stop and suppresses the cancel write (previously "through the same stop-boundary operation", which contradicted §7/Step 1). No renumbering, no new tests, no scope change, nothing else touched.
- **Inherited history (prior sessions; not re-run in this run):**
  - Original Ralplan approval of the mirror/steer design (`fork/plans/ralplan-gjc-acp-busy-turn.md`; archived receipts under `~/.paseo-fork/ralplan-receipts/plan-gjc-acp-busy-turn/`, stages 01–05).
  - Evidence review: `specs/gjc-acp-foreground-turn-trace.md` established that cancel notification completion and manager force settlement are not provider terminalization.
  - Planner revision 1: replaced synthetic foreground/ownerless settlement with adapter-level gates.
  - Architect review of revision 1: **WATCH**. Required exact two-fact ownerless proof, configured-scope preservation, terminal-result matrix, named fail-closed deadline, atomic reservation, identity separation, narrow retry claims, and ownership-correct observability.
  - Planner revision 2: incorporated every WATCH item and the 1,500/5,000 ms plus 2,000/5,000 ms reproductions; its session crashed before any review of revision 2 could run.
- **Critic coverage:** no Critic pass ran on the pre-crash revisions; this run's pass-1 Critic review (stage 02) is the first and returned OKAY with no required changes; the pass-2 Critic review (stage 04) returned OKAY with two non-gating harmonization minors, both fixed in iteration 3.
- **Pass-3 reviews (stage 06):** Architect `stage-06-architect.md` (sha `9be781f7…`) returned **CLEAR / APPROVE** — both C5/C6 edits verified against the unchanged precedence paragraph and §7 router, delta purity confirmed by exact full-file diff (10 insertions / 8 deletions / 5 hunks: the two normative edits plus header bookkeeping only), no new findings. Critic `stage-06-critic.md` (sha `4bfb76bf…`) returned **OKAY** — C5/C6 resolved, rule-5 counter-review clean, delta purity independently corroborated, no new findings.
- Current gate: **consensus complete — Architect CLEAR/APPROVE and Critic OKAY at pass 3 against iteration 3 (sha `07004e6d…`); persisted as final and pending owner approval. No execution admission: planning-only run, autoHandoff off.**

---

_Provenance: the revision-2 draft was recovered from the crashed `gpt-5.6-sol` codex review session (paseo agent `af7d7232-89b5-4e9b-8abe-c7534d6a2126`, codex thread `01a0511a-a68f-7172-a167-785d4b52e136`), which ended on a provider usage limit before it could write its file; the draft existed only at `/tmp/ralplan-gjc-acp-cancel-planner-draft.md` and was then preserved at `fork/plans/ralplan-gjc-acp-cancellation-boundary.md`. Run `eaf1316d` adopted it after factual verification (iteration 1), revised it under pass-1 review (iteration 2), and harmonized it under pass-2 review (iteration 3). No source file has been edited by any Planner pass._
