# Plan — gjc ACP busy-turn fix (Tier 0 + Tier 1) — **PENDING APPROVAL**

Status: **pending approval**. Nothing below has been implemented. Approving executes Tier 0 + Tier 1 exactly as written; refusing leaves this document as the record.

- Fork checkout: `plan/gjc-acp-busy-turn` (off `custom`, rebased on `upstream/main` @ 0.7.0-beta.1)
- Ralplan run: `43609706-b2f7-47f1-a093-26cf966f0aa9`, deliberate mode, 2 consensus passes (Architect CLEAR/APPROVE, Critic OKAY on `stage-03-revision.md`)
- Every anchor was verified against this tree and against gjc 0.15.5 source (`~/.cache/.bun/install/global/node_modules/@gajae-code/coding-agent`, source under `src/`)

## Summary

A gjc agent in ultragoal/goal mode keeps running **agent-initiated** turns after its ACP turn ended. Paseo models the agent as idle, dispatches the next user message as a fresh ACP `session/prompt`, and gjc rejects it with JSON-RPC -32603 `data.code:"busy"`. Root cause is **missing turn state**, not missing steering: Paseo already mints autonomous turn ids for `turn_started` events without a turnId (`agent-manager.ts:455-486`) and already has a steering contract (`steerActiveTurn`); the generic ACP adapter never surfaces gjc's phase truth.

Fix: a fork-only `GjcACPAgentClient`/`GjcACPAgentSession` pair that:

- **Tier 0 (mirror)** — mirrors gjc's `session_info_update._meta.gjcPhase` into `turn_started`/`turn_completed` events **without a turnId** (codex precedent `codex-app-server-agent.ts:5806`), so the manager mints/closes an `autonomous-<uuid>` turn and the agent truthfully shows running; **and overrides `interrupt()`** so an ownerless mirrored turn is genuinely stoppable AND promptly settled. The base `ACPAgentSession.interrupt()` only cancels when `activeForegroundTurnId` is set (`acp-agent.ts:2167-2181`); and even with a cancel, a run the provider never terminalizes settles only through `cancelAgentRunNow`'s timeout path (`INTERRUPT_SESSION_TIMEOUT_MS = 2_000`, `agent-manager.ts:86`, wait at `:2727-2734`, autonomous force-cancel branch at `:2760-2770`). The override cancels, closes the mirror latch, and emits `{type:"turn_canceled", reason:"interrupted"}` with no turnId (codex precedent `codex-app-server-agent.ts:~5831`).
- **Tier 1 (steer)** — `steerActiveTurn` via `extMethod("_gjc/sdk/control", {operation:"turn.steer", input:{text, clientRef}})`, returning `unavailable` on any adapter error — never interrupt, never retry (`docs/providers.md:86`).

Requires a minimal, provider-agnostic, upstreamable-in-principle extension seam in `acp-agent.ts` (seven touch points, enumerated in the ADR rebase checklist).

## Intent Diff

- Before: user message to a busy gjc agent → plain `session/prompt` → -32603 busy → `turn_failed`; agent effectively unusable for the duration of its autonomous loop (observed ~1h, agent `e9d0cdc1`, 2026-08-29).
- After (happy path, steer mode — the mode the app's composer uses for the send this plan targets): the same message → manager sees an active autonomous turn (mirrored) → `steerActiveTurn` → gjc `turn.steer` queues the text into the running turn → canonical user row recorded against the mirrored turn id; no interrupt, no retry.
- After (degraded path, steer reports `unavailable`): `steerOrReplaceActiveTurn` → `{status:"inactive"}` (`agent-manager.ts:2466-2468`) → `startOrReplaceRun` sees `replaceRunning:true` (always, `agent-prompt.ts:292-296`) and `hasInFlightRun` true (the mirror did that) → `replaceAgentRun` → `cancelAgentRunBefore` → `cancelAgentRunNow` → `interruptSession` → **the override sends ACP `session/cancel` for the ownerless turn, closes the mirror latch, and emits `turn_canceled` so the run settles immediately instead of via the 2s timeout force-cancel** → replacement `startTurn` admitted into an idle gjc → message lands, no busy rejection. Stop button during an ownerless turn takes the same `interrupt()` and now stops it promptly.
- After (default interrupt-mode sends — `session.ts:7323` `activeTurnBehavior ?? "interrupt"`): an ownerless turn is **aborted and replaced**, not steered; the Done statement's "lands in that turn" is steer-mode-specific and AC-6a is run in steer mode.
- Unchanged: every non-gjc provider, `GenericACPAgentClient` behavior, app composer (already sends `activeTurnBehavior:"steer"` + `turnId` — `packages/app/src/composer/actions.ts:196-200`), daemon on port 6767 (never restarted).

## Principles

1. **State before steering.** Give Paseo truthful turn state (mirror) first; steering only becomes reachable once `steerOrReplaceActiveTurn` has a non-null `expectedTurnId` (`agent-manager.ts:2443-2446`).
2. **Fork-only, gjc logic never in the shared base.** The only upstream-file edits are provider-agnostic extension seams a maintainer could accept in principle; everything gjc-specific lives in `providers/gjc-acp-agent.ts`.
3. **Never lie, never interrupt, never retry — on the steer path.** `steerActiveTurn` returns `accepted` only on a clean RPC acknowledgement; any error → `unavailable`. Interruption remains exclusively the manager's decision (Stop button, replace path); the `interrupt()` override makes that decision effective AND terminal for ownerless turns. Together this satisfies the steer contract's "adapter owes its interrupt" clause (`docs/providers.md:88`): Paseo's interrupt is ACP `session/cancel` → gjc `turn.abort`, which discards gjc's unread steer queue (`adapter.ts:364-368`).
4. **Mirror is an observer, not an owner — but a terminal observer.** The mirror never fabricates turn ids, never emits while a Paseo foreground turn is open, routes through the base's replay-suppressed delivery path, and terminalizes what it opened when the manager interrupts it (a provider that opens a run must close it, or the manager pays `INTERRUPT_SESSION_TIMEOUT_MS`).
5. **Boring, additive, rebase-tolerant.** Seven tiny touch points in `acp-agent.ts` (six reviewed-clean + one one-word logger widening), one new file, one registry line, tests that copy the existing harness.

## Decision Drivers (top 3)

1. **Reachability of Tier 1 without Tier 0.** With no known turn, `steerOrReplaceActiveTurn` returns `{status:"inactive"}` (`agent-manager.ts:2444`) and no steer is attempted — the mirror is a prerequisite, not a nice-to-have.
2. **Encapsulation cost of the seam.** `ACPAgentSession` keeps `connection`, `sessionId`, `activeForegroundTurnId`, `subscribers`, `pushEvent`, `translateSessionUpdate`, `handleSessionInfoUpdate`, `deliverTranslatedEvents`, `logger` all `private` (`acp-agent.ts:1398`, `:1436-1462`, `:2305`, `:2834`). The chosen seam shape determines rebase pain and upstream plausibility.
3. **Every new piece of visible state must come with its controls — and its settlement.** Making an ownerless turn visible (running state, Stop button, replace eligibility) without making it stoppable AND promptly settleable ships a broken affordance and a 2s tax on every Stop/replace — the `interrupt()` override with terminal event is correctness, not polish.

## Design-question resolutions

1. **Live log evidence is gone.** `~/.paseo/daemon.log` and rotations have zero hits for `-32603`/`busy`/`use turn.steer`/`e9d0cdc1`. Resolution: **acceptance reproduces the failure live** on the dev daemon; no log forensics gate. The original `e9d0cdc1` incident is cited as history only.
2. **Exact `details` string not in gjc 0.15.5 source verbatim.** Mechanism confirmed (`session-runtime.test.ts:4248-4265`: busy `turn.prompt` rejection; Paseo side already covered by `acp-agent.test.ts:3121` "converts background prompt rejections into turn_failed events"). Resolution: **never assert the literal string**; tests assert on mechanism and event shapes.
3. **Tier 0 needs a seam in `acp-agent.ts`.** Resolved by Option 1 below; Architect VERIFIED-CLEAN (no production `ACPAgentSession` subclass exists today; both construction sites `:864`/`:916` are pure instantiation; `GenericACPAgentClient` overrides neither `createSession` nor `resumeSession`).
4. **`agent-manager.ts:2466-2468` unavailable-fallback returns `"inactive"` when the open turn is the mirrored autonomous one.** Corrected mechanism (verified): the caller does NOT fall back to a plain prompt. `sendPromptToAgent` always passes `replaceRunning: true` (`agent-prompt.ts:292-296`); `startOrReplaceRun` (`agent-prompt.ts:65-79`) computes `replaced = replaceRunning && hasInFlightRun(agentId)` — true thanks to the mirror (`agent-manager.ts:862-873`) — and calls `replaceAgentRun` (`agent-manager.ts:2378-2407`) → `cancelAgentRunBefore` → `cancelAgentRunNow` (`:2716-2778`) → `interruptSession` (`:2790-2815`) → `session.interrupt()`. The base interrupt is a silent no-op for an ownerless turn, so pre-fix the subsequent `startTurn` → `connection.prompt()` hit the same -32603 busy rejection. **Resolution:** the degraded path ends in interrupt-and-replace that actually interrupts AND settles (see Intent Diff). "Provider avoids reporting unavailable for agent-initiated turns" is not implementable (the session never learns the manager-minted `autonomous-<uuid>` id), so `unavailable` stays the honest error answer and the manager's replace path does the recovery. Pinned by tests.

## Viable Options — central axis: how `GjcACPAgentClient` gets the access it needs

### Option 1 (CHOSEN): narrow protected extension seams + session subclass

Add to `acp-agent.ts` exactly these provider-agnostic hooks:

1. `export interface ACPAgentSessionOptions` (currently module-private at `:444`) — export so subclass files can type the factory.
2. `ACPAgentClient`: extract `protected createAgentSession(config: AgentSessionConfig, options: ACPAgentSessionOptions): ACPAgentSession` returning `new ACPAgentSession(config, options)`; call it from `createSession` (`:864`) and `resumeSession` (`:916`). No behavior change.
3. `ACPAgentSession.handleSessionInfoUpdate` (`:2834`): `private` → `protected` (virtual hook; subclass calls `super` then reads `update._meta` — the SDK type carries `_meta`, `types.gen.d.ts:2880`).
4. `ACPAgentSession.deliverTranslatedEvents` (`:2305`): `private` → `protected` (the subclass's ONLY emit path — inherits `replayingHistory` suppression, so mirrored turn events cannot leak during history replay).
5. `ACPAgentSession`: add `protected get acpSessionHandle(): { connection: ClientSideConnection; sessionId: string } | null` (null when uninitialized) — used by `steerActiveTurn` and the `interrupt()` override.
6. `ACPAgentSession`: add `protected get foregroundTurnActive(): boolean` (reads `activeForegroundTurnId !== null`) — used by the mirror's silence gate and the interrupt override's no-double-cancel guard.
7. `ACPAgentSession.logger` (`:1398`): `private` → `protected` — **consistency-required, not compile-required** (the subclass could derive its own logger from `options.logger.child()`, but that duplicates the base's child bindings; the widening is one word and symmetric with `ACPAgentClient.logger`, already `protected` at `:798`).

- **Pros:** all gjc logic in the fork file; additive and minimal (each hook is 1–5 lines); mirrors the existing precedent of handing `{connection, sessionId}` to provider code (`createProviderModeWriterContext` `:1873-1889`, `ACPCatalogModelResolverContext` used by kimi `kimi-acp-agent.ts:31-90`); replay suppression and foreground truth are reused, not duplicated; upstreamable in principle (plain subclass extension points). The `interrupt()` override needs **no new seam** — it is a public `AgentSession` interface method built entirely from hooks 5–7 plus the subclass's own latch.
- **Cons:** seven touch points in an upstream file the fork must re-apply on rebase; `protected` is a surface commitment. Mitigation: the ADR enumerates all seven verbatim as the rebase checklist.

### Option 2: blanket `protected` on the private members — INVALIDATED

Widen `connection`, `sessionId`, `activeForegroundTurnId`, `pushEvent`, `translateSessionUpdate`, `handleSessionInfoUpdate` to `protected`. Exposes **mutable** state (`:1448-1451`) to every existing subclass (copilot, cursor, kimi, kiro, trae) with no compile-time guard against clobbering; bypasses `replayingHistory` suppression if the subclass uses `pushEvent` directly; larger diff and rebase surface; weakens the upstream story.

### Option 3: composition — `GjcAgentSession` wraps the generic session — INVALIDATED

The wrapper cannot observe `session_info_update._meta` (dropped inside the private `handleSessionInfoUpdate`), cannot reach `connection`/`sessionId` for `extMethod` or `cancel`, and must forward ~30 `AgentSession` members by hand. Worse rebase exposure than a seam, and it duplicates lifecycle logic the base already owns.

### Option 4: gjc branch inside `GenericACPAgentClient` keyed on `providerId === "gjc"` — INVALIDATED

Pre-resolved decision forbids it (fork-only; no gjc logic in `GenericACPAgentClient`).

### Option 5: Tier 1 only (steer without mirror) — INVALIDATED

Unreachable — `agent-manager.ts:2444` returns `{status:"inactive"}` when `expectedTurnId` is null, so no steer is attempted. This is also the sequencing argument for Tier 0 → Tier 1.

**Sub-choices within Option 1:** override `handleSessionInfoUpdate` rather than adding a new `onSessionInfoMeta` hook (smaller diff, `super` preserves title/updatedAt); override `interrupt()` in `GjcACPAgentSession` rather than changing the base gate at `acp-agent.ts:2179` (the base has no concept of an ownerless turn — that IS gjc-specific state).

## Pre-mortem (deliberate mode)

1. **"The mirror wedges run tracking."** A mirrored turn opens (`turn_started`, no turnId → `trackAutonomousRun` + `openActiveTurn`, `agent-manager.ts:4212-4215`) but never closes — gjc crashed mid-turn, or an idle publication was swallowed — so `hasInFlightRun` stays true forever and `notifyOnFinish` misfires or never fires; every subsequent message takes the replace path (interrupt + fresh turn) instead of steering. _Detection:_ live e2e checks lifecycle returns to idle after the autonomous loop ends and that a mid-loop message steers rather than replaces. _Mitigation:_ gjc publishes idle on every `agent_end` (`modes/acp/acp-agent.ts:2833` → `#emitEndOfTurnUpdates`, guarded by `activePrompt` at `:2940` so late idle can't cross a new working); the mirror is edge-triggered and idempotent; the `interrupt()` override gives the user a manual unwedge (Stop) that settles immediately. _Contingency if it still destabilizes:_ keep busy state private to the provider entirely (drop the mirror) and rely on interrupt-then-send for every busy send — a different design decision, escalate before building. The interrupt half of that fallback now ships structurally; only the drop-the-mirror half remains contingent.
2. **"Phase flapping / event storm."** gjc stamps `working` on **every** `agent_start` (including ownerless, `:2776-2789`); nested or rapid-fire agent runs could churn mirror open/close or fuse many native turns into one long mirrored turn. _Mitigation:_ edge-triggered `#mirrorActive` latch (working opens only when closed; idle closes only when open); double-working and double-idle are unit-tested no-ops; after an interrupt-cleared latch, a stray late `idle` is a no-op and the next genuine `working` re-opens. Worst case the UI shows one longer running turn — cosmetic, within the out-of-scope "timeline rendering of ownerless activity".
3. **"Stop button / degraded path silently does nothing — or stalls."** The mirror makes the agent show `running`, enabling Stop and the replace path — but the base `interrupt()` only cancels when `activeForegroundTurnId` is set (`acp-agent.ts:2167-2181`), and even with a cancel, a run the provider never terminalizes settles only through `cancelAgentRunNow`'s timeout path (2s). _Mitigation (shipped, not contingent):_ the override below. _Explicit trade-off:_ if gjc's turn somehow survived a swallowed cancel, the next prompt can hit busy once — which the replace path recovers from by interrupting again; accepted and documented. Pinned by four unit tests.

## Implementation steps (sized honestly — treat totals as a floor)

1. **Seams in `packages/server/src/server/agent/providers/acp-agent.ts`** (~25 min): the seven Option-1 touch points. No gjc identifiers in this file.
2. **New `packages/server/src/server/agent/providers/gjc-acp-agent.ts`** (~45 min):
   - `export class GjcACPAgentSession extends ACPAgentSession` with `#mirrorActive = false`;
   - `protected override handleSessionInfoUpdate(update)`: `super` first; ignore unless `_meta.gjcPhase` is `"working"`/`"idle"`; return early if `this.foregroundTurnActive`; edge-triggered open → `this.deliverTranslatedEvents([{ type: "turn_started", provider: this.provider }])` (NO turnId key — `agent-manager.ts:456` then mints `autonomous-<uuid>`; `getAgentStreamEventTurnId` `agent-sdk-types.ts:460-462` must see the key absent); close → `[{ type: "turn_completed", provider: this.provider }]` (no turnId — resolves to the active turn at `agent-manager.ts:468-471`);
   - `override async interrupt(): Promise<void>` exactly:

     ```ts
     override async interrupt(): Promise<void> {
       await super.interrupt();
       if (!this.#mirrorActive || this.foregroundTurnActive) return;
       const handle = this.acpSessionHandle;
       this.#mirrorActive = false;
       if (!handle) return;
       try {
         await handle.connection.cancel({ sessionId: handle.sessionId });
       } catch (error) {
         // benign end-of-turn race: gjc already stopped; failing here would
         // degrade the manager's replace path to AgentRunCancellationError
         this.logger.warn({ err: error }, "provider.gjc.mirror_interrupt_cancel_failed");
       }
       this.deliverTranslatedEvents([
         { type: "turn_canceled", provider: this.provider, reason: "interrupted" },
       ]);
     }
     ```

     Latch cleared before the cancel so a throwing cancel cannot leave it dangling; cancel error swallowed because a benign end-of-turn race must not fail the replace path; `turn_canceled` (no turnId, `reason:"interrupted"`) emitted unconditionally after the attempt so `cancelAgentRunNow`'s `run.settledPromise` wait (`agent-manager.ts:2727-2734`) settles immediately instead of via the 2s autonomous force-cancel branch (`:2760-2770`).

   - `async steerActiveTurn(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>`: `const handle = this.acpSessionHandle; if (!handle) return {status:"unavailable"};` flatten prompt (`string` → itself; blocks → text blocks joined `"\n"`; no text → `unavailable`); `clientRef = randomUUID()` (fresh per call — gjc forbids ref reuse for retry); `await handle.connection.extMethod("_gjc/sdk/control", {sessionId: handle.sessionId, operation: "turn.steer", input: {text, clientRef}})` → `{status:"accepted"}`; `catch` → warn log + `{status:"unavailable"}`. The provider never inspects resolved envelopes — it trusts the JSON-RPC success/rejection dichotomy (gjc's adapter converts `{ok:false}` into a thrown error server-side, `sdk/acp/adapter.ts:409-412`, so failures always arrive as rejections). `expectedTurnId` is NOT validated in the provider — sound AND forced: gjc's `turn.steer` takes only `text` + `clientRef` (`host/control/dispatch.ts:219-220`); the manager's admission owns turn ownership (`assertSteerAdmissionOwnsTurn` `:2470-2487`); residual race bounded to a timeline row misattributed to a just-finished turn — accepted. `clearPendingPermissions` is acknowledged but unenforced on the steer path in Tier 1 (auto-accept agents; documented limitation — `super.interrupt()` already resolves pending permissions on the interrupt/replace path).
   - `export class GjcACPAgentClient extends GenericACPAgentClient`: constructor forwarding (kimi template `kimi-acp-agent.ts:85-97`) + `protected override createAgentSession(config, options)` → `new GjcACPAgentSession(config, options)`.

3. **Register in `packages/server/src/server/agent/provider-registry.ts`** (~5 min): import `GjcACPAgentClient` (import block `:34-44`); in `createBaseClient` dispatch (`:793-805`) add `if (providerId === "gjc") return new GjcACPAgentClient(acpOptions);` before the `GenericACPAgentClient` fallback.
4. **Tests** (~70 min — ~17 unit cases incl. two real-pair steers, three integration additions, one registry case): per the test plan below. Red-first where practical (`docs/testing.md` TDD).
5. **Verify** (~10 min): `npm run typecheck`, `npm run lint`, then the targeted vitest runs in Acceptance. `npm run format:files -- <changed files>` before commit.
6. **Live acceptance** (post-implementation, timeboxed ~45 min): e2e procedure below; capture daemon.log excerpts as evidence.

Dependencies: step 1 → 2 → 3 strictly; step 4 depends on 2–3; step 5 gates everything; step 6 gates the Done statement. No app changes. No `packages/protocol` changes (no wire schema touched).

**Sizing statement:** implementation+tests floor ≈ 2h35m (25 + 45 + 5 + 70 + 10) versus the ~2h Tier T2 appetite. The ~35 min overage is correctness-required review scope (terminal-event interrupt override + its tests, call-count assertions, real-pair rejection case, `clientMessageId` integration fix), not gold-plating. No further in-scope trim exists without dropping acceptance coverage; the overage effectively lands in the live-acceptance sitting. **Escalate to the owner if the appetite is hard** — dropping live AC-6 to a follow-up sitting vs extending the appetite is the owner's call, not the executor's.

## Test plan

Harness: copy `acp-agent.test.ts` conventions — `createTestLogger`, direct `new GjcACPAgentSession(config, options)` construction, `asInternals<GjcSessionInternals>` typed casts to seed `sessionId`/`connection` (`acp-agent.test.ts:51`, `:127`, `:2761-2797`), and drive updates through the public `session.sessionUpdate({sessionId, update})` notification entry (`:3305`) so the mirror is exercised at its real call site. Real JSON-RPC pair (`AgentSideConnection`/`ClientSideConnection` over `TransformStream`s, pattern at `:3197-3260`) for the steer round-trip tests. "Never interrupt, never retry" is asserted as call counts, not prose.

**Unit — new `packages/server/src/server/agent/providers/gjc-acp-agent.test.ts` (~17 cases):**

- Mirror opens: idle session + `session_info_update` `_meta {gjcPhase:"working", running:true}` → exactly one `turn_started` with **no `turnId` key** (`expect("turnId" in event).toBe(false)`); title/updatedAt still applied (super behavior intact).
- Mirror closes: subsequent `_meta {gjcPhase:"idle"}` → exactly one `turn_completed`, no `turnId` key.
- Idempotence (×2): `working` twice → one open; `idle` twice / `idle` while closed → nothing.
- Foreground silence: `startTurn` with a pending mocked `connection.prompt`, then `working` → no additional `turn_started`; `idle` → no `turn_completed`; resolving the prompt emits the foreground `turn_completed` **with** its minted `turnId`.
- Replay suppression: `replayingHistory = true` via internals → `working` produces no subscriber events.
- Non-gjc `_meta` / missing `_meta` → no events.
- **Interrupt, mirror open, no foreground:** `interrupt()` → `connection.cancel` called exactly once with `{sessionId}`; exactly one `turn_canceled` emitted with no `turnId` key and `reason:"interrupted"`; latch cleared (a subsequent `idle` `_meta` is a no-op); a subsequent `working` re-opens the mirror.
- **Interrupt, swallow branch:** `connection.cancel` rejects → `interrupt()` resolves (no throw), still emits exactly one `turn_canceled`, latch closed, warn log `provider.gjc.mirror_interrupt_cancel_failed` recorded.
- **Interrupt, foreground turn active:** `startTurn` pending → `interrupt()` → base behavior only (cancel still exactly once — the base's own; no second cancel from the override), foreground turn settles normally, no mirror `turn_canceled`.
- **Interrupt, mirror closed, no foreground:** `interrupt()` → no `connection.cancel` call, no events.
- Steer accepted: mocked `connection.extMethod` resolves → `{status:"accepted"}`; assert exact wire shape `{sessionId, operation:"turn.steer", input:{text, clientRef}}` with `clientRef` non-empty and ≤128 chars (gjc bound: `host/query/handlers.ts:807-813`), text = newline-joined text blocks of the prompt (string passthrough).
- Steer unavailable on ANY error: `extMethod` rejects (JSON-RPC error, timeout, garbage) → `{status:"unavailable"}`; **asserted as call counts:** `expect(extMethod).toHaveBeenCalledTimes(1)` (no retry) and `cancel`/`prompt` call counts at zero (no interrupt, no plain-prompt escape).
- Steer unavailable when uninitialized (no connection/sessionId) and when the prompt has no text blocks (image-only).
- Real-pair steer (success): fake agent answering `_gjc/sdk/control` with an ok envelope → `{status:"accepted"}`.
- Real-pair steer (rejection): the fake agent-side handler **THROWS a `RequestError`-shaped error** — it must NOT resolve `{ok:false}`, because a resolved envelope does not reject over JSON-RPC and the provider would (correctly) report `accepted`. On the real wire, gjc's adapter unwraps `{ok:false}` into a thrown `AcpSdkAdapterError` server-side (`sdk/acp/adapter.ts:409-412`), which crosses JSON-RPC as an error response → client-side rejection → `unavailable`. Test comment states: **the provider never inspects resolved envelopes; it trusts the RPC success/rejection dichotomy.**

**Integration — extend `packages/server/src/server/agent/agent-manager.test.ts` (existing `SteeringTestSession` harness at `:560`, `:731`):**

- Session fake emits `turn_started` with no turnId → manager mints autonomous id, `lifecycle:"running"`, `hasInFlightRun` true; terminal no-turnId event closes it and returns lifecycle idle (bounds pre-mortem 1).
- Autonomous steer accepted: pass `runOptions.clientMessageId` (precedent `agent-manager.test.ts:977`) — required because `recordAcceptedSteer` early-returns without it (`agent-manager.ts:2561-2563`) — then `steerOrReplaceActiveTurn` → `{status:"steered"}` and the canonical user row records `turnId === <autonomous id>`.
- Steer `unavailable` + mirrored autonomous turn open: result is `{status:"inactive"}` (pins DQ4's entry condition); then via the `sendPromptToAgent`/`startAgentRun` path with `replaceRunning: true`: the fake session's `interrupt()` **is called**, it emits its no-turnId `turn_canceled` (as the real override does), the run settles **without the 2s timeout force-cancel branch**, `replaceAgentRun` completes, and a replacement turn starts with **no busy-shaped `turn_failed`**.

**Registry — extend `packages/server/src/server/agent/provider-registry.test.ts`:** derived provider with `extends:"acp"`, `providerId:"gjc"` dispatches to `GjcACPAgentClient` (client construction only; no process spawn), mirroring the existing cursor/kimi dispatch assertions.

**E2E / live (acceptance):** on the **dev daemon only** (`npm run dev`, `.dev/paseo-home`; NEVER port 6767): register the gjc custom provider (copy the verified block from `~/.paseo/config.json` → `agents.providers.gjc`: command `[/Users/ctaylor/.local/bin/gjc, acp]`, env `GJC_ACP_PERMISSION_MODE=auto`, `GJC_ACP_ABORT_SCOPE=owned`); create a scratch agent `gjc/zai/glm-5.3`, `modeId: default`, `thinkingOptionId: high`, auto-accept on; start a goal/ultragoal objective that produces back-to-back agent-initiated turns; while it runs: (a) in **steer mode**, send a second message → lands as a steer in the running turn (no -32603), canonical user row inside the mirrored turn; (b) press Stop during another ownerless turn → the gjc turn actually aborts AND the run settles promptly (no ~2s stall); (c) after the loop ends → lifecycle idle. Baseline (pre-fix) busy reproduction recommended once for the evidence trail.

**Observability:** named log sites in the new file — `provider.gjc.phase_mirror` (debug, mirror open/close), `provider.gjc.steer_unavailable` (warn, with `toDiagnosticErrorMessage`), `provider.gjc.mirror_interrupt` (debug, override cancels an ownerless turn), `provider.gjc.mirror_interrupt_cancel_failed` (warn, swallow branch). Verify live by grepping `.dev/paseo-home/daemon.log`. The `-32603`-absence grep is **corroborating only** — the positive signals (steer acceptance, canonical row, `mirror_interrupt` + return to idle) carry the acceptance.

## In scope / out of scope

**In scope:** `providers/gjc-acp-agent.ts` (new: mirror + `interrupt()` override with terminal event + `steerActiveTurn`), the seven minimal seams in `providers/acp-agent.ts`, one dispatch line in `provider-registry.ts`, targeted tests in `providers/gjc-acp-agent.test.ts` (new), `agent-manager.test.ts`, `provider-registry.test.ts`, live dev-daemon acceptance (steer + Stop + lifecycle), four named log sites.

**Out of scope — non-goals (verbatim from the brief):** modelling agent-initiated turns properly in Paseo's lifecycle (timeline rendering of ownerless activity, notifyOnFinish semantics, get_agent_status reporting); raising gjc's `sdk.promptDeadlineMs`; the 256 KiB ACP prompt-size limit; the deployment/release mechanism (a separate plan owns that). Additionally out: any app change, any `packages/protocol` change, `turn.steer_status` reconciliation queries (follow-up observability), non-auto-accept permission clearing, catch-and-resend around the steer/turn-completion race (explicit Tier 1 non-goal — see Risks), changing the base `interrupt()` gate in `acp-agent.ts` (the override is gjc-scoped by design), and touching the production daemon on port 6767.

## File-level changes

| File                                                               | Change                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/agent/providers/acp-agent.ts`          | Export `ACPAgentSessionOptions`; extract `protected createAgentSession` (used at `:864`, `:916`); `handleSessionInfoUpdate` `:2834`, `deliverTranslatedEvents` `:2305`, `logger` `:1398` private→protected; add `protected get acpSessionHandle` and `protected get foregroundTurnActive` |
| `packages/server/src/server/agent/providers/gjc-acp-agent.ts`      | NEW — `GjcACPAgentSession` (phase mirror + `interrupt()` override emitting `turn_canceled` + `steerActiveTurn`) and `GjcACPAgentClient` (factory override)                                                                                                                                |
| `packages/server/src/server/agent/provider-registry.ts`            | Import + `providerId === "gjc"` dispatch before generic fallback (`:793-805`)                                                                                                                                                                                                             |
| `packages/server/src/server/agent/providers/gjc-acp-agent.test.ts` | NEW — ~17 unit cases per test plan incl. four interrupt cases and call-count assertions                                                                                                                                                                                                   |
| `packages/server/src/server/agent/agent-manager.test.ts`           | Autonomous-turn steer admission (with `clientMessageId`), DQ4 `inactive` pin, degraded replace path (interrupt called, prompt settlement, no busy `turn_failed`)                                                                                                                          |
| `packages/server/src/server/agent/provider-registry.test.ts`       | gjc dispatch assertion                                                                                                                                                                                                                                                                    |

## Acceptance criteria

Done statement: _"Sending a message to a gjc agent that is running its own turn lands in that turn instead of failing with busy — proved live against a wedged ultragoal session and pinned by ACP provider tests"_ — steer-mode-specific (default interrupt-mode sends abort-and-replace ownerless turns via the same override; `session.ts:7323`). Concretely:

1. `npx vitest run packages/server/src/server/agent/providers/gjc-acp-agent.test.ts --bail=1` — green; covers mirror open/close/idempotence/foreground-silence/replay, steer accepted/unavailable-on-any-error with asserted call counts (`extMethod` exactly 1; `cancel`/`prompt` 0), the four `interrupt()` cases, and both real-pair steers.
2. `npx vitest run packages/server/src/server/agent/providers/acp-agent.test.ts --bail=1` — still green (seams are behavior-neutral for existing providers).
3. `npx vitest run packages/server/src/server/agent/provider-registry.test.ts --bail=1` — green incl. new gjc dispatch case.
4. `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1` — green incl. autonomous-steer with `clientMessageId`, the DQ4 `inactive` pin, and the degraded path.
5. `npm run typecheck` and `npm run lint` clean.
6. Live (dev daemon): while a goal-mode gjc agent runs an agent-initiated turn, (a) a steer-mode sent message produces a `turn.steer` control and NO -32603 busy rejection; (b) Stop during an ownerless turn aborts it and the run settles promptly — no ~2s stall; (c) after the autonomous loop ends the agent returns to idle (run tracking unwedged). Evidence excerpt captured.

## Verification

- Targeted tests: the four `npx vitest run <file> --bail=1` invocations above (never the full suite; repo rule).
- `npm run typecheck && npm run lint`; `npm run build:server` first if cross-package declaration staleness appears.
- Live: dev-daemon procedure in the test plan; grep `.dev/paseo-home/daemon.log` for the four named log sites; `-32603` absence is corroborating.
- Never restart the port-6767 daemon; never re-run suites another agent reported green.

## Escalation / risk gate

- Live run-tracking destabilization beyond what the interrupt override cures → STOP and escalate: dropping the mirror entirely is a different design decision requiring review, not an executor improvisation.
- `extMethod` / interrupt-cancel / emitted `turn_canceled` misbehaving against real gjc 0.15.5 beyond the specified contracts → capture the envelope and route to review; no retries, no envelope inspection.
- Owner rejects the ~2h35m floor → the scope decision (drop live AC-6 to a follow-up sitting vs extend appetite) is the owner's, not the executor's.
- Any change to objective/scope/non-goals routes back through a planner revision before implementation.

## Risks and mitigations

| Risk                                                                                                             | Likelihood         | Mitigation                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mirror destabilizes run tracking (`hasInFlightRun`, `notifyOnFinish`)                                            | Medium             | Edge-triggered idempotent mirror; gjc idle on every `agent_end`; interrupt override gives a prompt manual unwedge; live check AC-6c; drop-the-mirror contingency behind an escalation gate                                                                                                  |
| Stop/replace stalls ~2s or silently no-ops for ownerless turns                                                   | Fixed by this plan | Override cancels once, clears the latch before the cancel, swallows cancel errors, and emits no-turnId `turn_canceled` so the run settles without the force-cancel branch; four unit tests + integration + live AC-6b                                                                       |
| Swallowed cancel leaves a surviving gjc turn → next prompt busy once                                             | Low                | Accepted trade-off (documented): the replace path recovers by interrupting again; no retry on the steer path by contract                                                                                                                                                                    |
| Double-cancel when foreground turn and mirror race                                                               | Low                | Ordering: `super.interrupt()` first; override cancels only if `#mirrorActive && !foregroundTurnActive`; unit test pins single cancel in both states                                                                                                                                         |
| Daemon restart mid-ownerless-turn produces one busy `turn_failed` before self-heal                               | Low                | gjc publishes only an unconditional idle on load/resume bootstrap (`modes/acp/acp-agent.ts:3517-3522`) — the mirror is NOT re-seeded from a surviving busy turn; the first post-restart prompt may hit busy once and the replace path recovers; known behavior, no stronger seeding claimed |
| Steer races a completing mirrored turn → user sees `Active turn changed before steering could be delivered` once | Low                | Known behavior of the manager's ownership assertions (`agent-manager.ts:2431-2433`, `:2471-2487`); surfaces as an error the user can resend; catch-and-resend is an explicit non-goal                                                                                                       |
| `expectedTurnId` non-validation in the provider                                                                  | Accepted           | Forced: gjc `turn.steer` takes only `text`+`clientRef`; manager admission owns ownership; residual bounded to timeline row misattribution                                                                                                                                                   |
| Rebase drift on the seven `acp-agent.ts` touch points                                                            | Medium             | Additive-only, no gjc identifiers in the base; ADR enumerates the checklist                                                                                                                                                                                                                 |
| `clientRef` conflicts on app-level resends                                                                       | Low                | Fresh `randomUUID()` per steer call; never reuse refs                                                                                                                                                                                                                                       |
| Foreground turn + concurrent ownerless turn overlap                                                              | Very low           | gjc is single-root-turn (busy mechanism) — an ownerless turn cannot start while the foreground prompt runs                                                                                                                                                                                  |
| Image-bearing steers lose non-text content                                                                       | Accepted           | Text-block flattening only; images are out of the steer input contract; noted as limitation                                                                                                                                                                                                 |
| `clearPendingPermissions` unenforced on the steer path                                                           | Accepted           | Target agent runs auto-accept; the interrupt/replace path resolves permissions via `super.interrupt()`; follow-up for non-auto-accept gjc agents                                                                                                                                            |

## Intent Reconciliation

Resolved during the run and embedded in this plan (baseline: `stage-01-intent.md`):

1. **A seam in `acp-agent.ts` is required, not optional.** `GjcACPAgentClient extends GenericACPAgentClient` cannot observe `_meta`, emit events, or reach `connection`/`sessionId` — all private. The pre-resolved "no gjc logic in `GenericACPAgentClient`" rule is honoured: the seam carries no gjc identifiers.
2. **Corrected degraded-path mechanism (material correction to Planner pass 1).** The degraded path was never a plain prompt: it is `replaceAgentRun` → `interruptSession` → `session.interrupt()`, which the base makes a no-op for ownerless turns. The `interrupt()` override (with its terminal event, added after review) closes both the degraded path and the Stop button.
3. **Live log evidence for the 2026-08-29 incident is gone** — acceptance reproduces live, matching the Done statement's "proved live".
4. **Tests never assert the literal busy string** — mechanism and event shapes only.
5. **Appetite deviation** (floor 2h35m vs ~2h) is correctness-required review scope, documented above with an owner-escalation gate; flagged here so the approval decision is made with it visible.
6. No deep-interview specs exist for this run; the release-channel brief and the 2026-08-29 handover were cross-checked — no conflicts. All five pre-resolved decisions honoured; none re-opened.

## ADR — gjc ownerless-turn mirroring and steering in a fork-only ACP provider

**Decision.** Add a fork-only `gjc-acp-agent.ts` (`GjcACPAgentClient` + `GjcACPAgentSession`) that mirrors gjc's `session_info_update._meta.gjcPhase` into turnId-less `turn_started`/`turn_completed` events, overrides `interrupt()` to cancel-and-terminalize ownerless turns, and implements `steerActiveTurn` over the `_gjc/sdk/control` extension method (`turn.steer`). Enable it with seven provider-agnostic protected seams in the shared `acp-agent.ts` and one dispatch line in `provider-registry.ts`. No gjc logic enters `GenericACPAgentClient` or any shared base.

**Drivers.** (1) Steering is unreachable without turn state — `steerOrReplaceActiveTurn` returns `inactive` when no turn is known. (2) gjc already publishes the truth (`_meta.gjcPhase` on every `agent_start`/`agent_end`, ownerless included); Paseo ignores it. (3) Visible state without controls is a defect: a mirrored "running" agent must be stoppable and promptly settleable, or the fix trades a busy error for a broken Stop button and a 2s replace stall.

**Alternatives considered.** Blanket `protected` on the private members (rejected: exposes mutable state to every existing subclass and bypasses replay suppression); composition/wrapping (rejected: cannot observe `_meta` or reach `connection`; ~30 forwarded members); a gjc branch inside `GenericACPAgentClient` (rejected: violates the fork-only pre-resolved decision); Tier 1 only (rejected: unreachable without the mirror); changing the base `interrupt()` gate to know about ownerless turns (rejected: the base has no such concept — that state is provider-specific by nature).

**Why chosen.** Smallest rebase surface that keeps every gjc decision in one fork file; reuses the base's replay suppression, foreground tracking, and delivery path rather than duplicating them; each seam is a shape an upstream maintainer could accept on its own merits.

**Consequences.**

- The fork carries seven one-line-ish touch points in `acp-agent.ts` as a standing rebase checklist (below). Conflicts are mechanical to re-derive.
- Ownerless gjc turns become first-class Paseo runs: the agent shows running, Stop works, sends steer instead of failing, and the steer-unavailable degraded path degrades to interrupt-and-replace rather than busy.
- Known accepted edges (documented in Risks): one busy `turn_failed` possible after a daemon restart mid-ownerless-turn or after a swallowed cancel race; one `Active turn changed…` error possible when a steer races turn completion; image-only prompts cannot steer.

**Rebase checklist — the seven `acp-agent.ts` touch points (verify each after every rebase onto upstream/main):**

1. `ACPAgentSessionOptions` exported (`:444`).
2. `ACPAgentClient.createAgentSession(config, options)` extracted as `protected`; called from `createSession` (`:864`) and `resumeSession` (`:916`).
3. `ACPAgentSession.handleSessionInfoUpdate` `protected` (`:2834`).
4. `ACPAgentSession.deliverTranslatedEvents` `protected` (`:2305`).
5. `ACPAgentSession.acpSessionHandle` getter present.
6. `ACPAgentSession.foregroundTurnActive` getter present.
7. `ACPAgentSession.logger` `protected` (`:1398`).

**Follow-ups (explicitly not in this plan).** `turn.steer_status` reconciliation observability; `clearPendingPermissions` enforcement for non-auto-accept gjc agents; proper lifecycle modelling of ownerless activity (timeline rendering, notifyOnFinish, get_agent_status) — all listed in the brief's OUT OF SCOPE and owned elsewhere; the release/deployment channel is a separate plan.

---

_Consensus record: Planner pass 1 (`stage-01-planner.md`) → intent reconciliation (`stage-01-intent.md`) → revision 2 (`stage-02-revision.md`) → Architect WATCH/COMMENT + Critic ITERATE (`stage-02-_.md`) → revision 3 (`stage-03-revision.md`) → Architect CLEAR/APPROVE (`stage-03-architect.md`) + Critic OKAY (`stage-03-critic.md`) → final intent verification (`stage-04-post-interview.md`) → this plan.\*
