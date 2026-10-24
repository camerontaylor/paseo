# Review — GJC ACP cancellation boundary vs the finalized plan

- Reviewed branch: `ultragoal-prep/acp-cancellation-boundary` at `acc60db36` (rebased onto `custom` at `54c7d08b4`).
- Plan under review: `fork/plans/ralplan-gjc-acp-cancellation-boundary.md` — the finalized consensus text (ralplan run `eaf1316d`, iteration 3).
- Method: full read of `acp-agent.ts`, `gjc-acp-agent.ts`, `provider-registry.ts`, the four test files, both docs, and the `custom..HEAD` diffs; targeted test runs per the repo rules; typecheck, lint, format:check. Review only — no implementation, plan, or docs files were modified.
- Context: the implementation was written against the plan's revision 2 (commit `57f69e56a`). The finalized text adds iteration-2 fixes (A1–A6, C1–C4) and iteration-3 harmonization (C5, C6) that postdate it. This review measures the code against the **finalized** text.

## Verdict table

| #   | Requirement                                                                                                                    | Verdict           | One-line basis                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Permission-denial routing through the §7 stop-kind router; no-stop-able-turn branch suppresses the cancel write                | **PARTIAL**       | Foreground and suppress branches exist; the GJC ownerless-mirror branch is missing and the suppression is silent (no `deny_cancel_suppressed`)                                     |
| 2   | A3 — unplanned transport/process death during `stopping` settles in-flight writes failed and rejects the successor immediately | **GAP**           | No settle-as-failed path exists; the exit handler only synthesizes the terminal, so a staged successor burns the full 10 s                                                         |
| 3   | Terminal idempotency key: mandatory, nonempty, ≤128 UTF-8 bytes, rides inside `input`                                          | **IMPLEMENTED**   | `` `${stopId}:${revision}` `` inside `input`; structurally ≤ ~45 bytes; asserted by tests                                                                                          |
| 4   | Dual failure surfaces: reject resolved `{ok:false}` **and** transport/JSON-RPC rejection                                       | **IMPLEMENTED**   | `ok !== true` reject in the validator; `transport_rejected` verdict in the extMethod catch; both test-asserted                                                                     |
| 5   | §10 terminal-result matrix disposition table                                                                                   | **IMPLEMENTED**\* | Field-for-field match in `validateGjcTerminalAbortResult` + unit tests; \*the release _reason_ mapping (A4) is missing — see item 7                                                |
| 6   | G004 docs commitments                                                                                                          | **PARTIAL**       | Request-completion contract, exact reject condition, 2 s force settlement, stop fence, per-provider obligations all present; the §5 deadline-anchor/budget-equality line is absent |
| 7   | General conformance sweep for finalized-plan requirements absent from revision 2                                               | **PARTIAL**       | Seam, deadline anchor, replay suppression, rollback, steering, manager/registry steps all in; A4 precedence, A6 issue-and-return, A3, and three named tests are out                |

**Merge blocker independent of the plan:** commit `8b6b06913` (the rebase of G003) left a diff3 base marker in `agent-manager.test.ts:10463` and dropped the closing `});` of the test above it. The file does not parse: the entire manager suite (11,146 lines, including all ten new plan tests) cannot run, `npm run lint` fails with 1 error, and `npm run format:check` fails. Typecheck stays green only because the tsgo program excludes test files. Details and the verified one-line fix under "Additional findings".

## Verification runs

| Command                            | Result                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `vitest acp-agent.test.ts`         | 117/117 passed                                                           |
| `vitest gjc-acp-agent.test.ts`     | 39/39 passed                                                             |
| `vitest provider-registry.test.ts` | 51/51 passed                                                             |
| `vitest agent-manager.test.ts`     | **failed to collect** — conflict marker at `agent-manager.test.ts:10463` |
| `npm run typecheck`                | passed (test files excluded from the tsgo program — hides the marker)    |
| `npm run lint`                     | **failed** — 1 error, the same conflict marker                           |
| `npm run format:check`             | **failed** — the same conflict marker                                    |

## Detailed evidence

### 1. Permission-denial routing — PARTIAL

The deny+interrupt entry point is `respondToPermission` (`packages/server/src/server/agent/providers/acp-agent.ts:2762-2764`), which calls `stopForegroundTurn({reason: "permission-denied"})`. The routing then happens implicitly inside `stopForegroundTurn` (`acp-agent.ts:2156-2183`):

- **Foreground branch — implemented.** With `activeForegroundTurnId` set and no existing stop, it installs the stop synchronously (`installStop`, `acp-agent.ts:2177-2182`) and issues the first ledger cancel write before returning. `permission_resolved` is emitted before routing (`acp-agent.ts:2751-2757`), and a replacement stages behind the fence exactly as for Stop. Generic test 17 ("routes a permission denial through the same boundary before cancelling", `acp-agent.test.ts:4384` region) passes.
- **No-stop-able-turn branch — implemented in effect, silently.** No foreground turn and no installed stop returns without a cancel write and without installing a stop (`acp-agent.ts:2169-2176`), leaving admission state untouched — no `stopping` can remain. The comment there cites "AC13" for the deliberate delta from the old always-cancel behavior, which matches finalized §7 branch 3. Two shortfalls against the finalized text:
  - The `provider.acp.deny_cancel_suppressed` log event (plan §7 and Observability: "emitted only by the §7 no-stop-able-turn branch", with permission request id and correlation ids) does not exist anywhere — `rg deny_cancel_suppressed` has no hits.
  - Generic test 22 (deny with no stop-able turn: cancel suppressed, resolution still emitted, admission unchanged, no `stopping`) is absent; the generic suite stops at test 19 plus a seams test.
- **GJC ownerless-mirror branch — GAP.** Finalized §7 branch 2 requires: no foreground turn + open GJC mirror → route to the GJC ownerless stop with `stoppedTurnId` = the mirror's explicit id, two-fact gate unchanged. `GjcACPAgentSession` overrides `sessionUpdate`, `initializeResumedSession`, `interrupt`, `close`, `steerActiveTurn`, and the two gate hooks (`gjc-acp-agent.ts:283-415`) — it does **not** override `respondToPermission` or `stopForegroundTurn`, and contains no "deny" handling at all. So deny+interrupt during an open mirror falls into the base suppress branch: no ownerless stop is installed, the mirror keeps running, nothing is cancelled, and the two-fact release never happens. GJC test 33 (both the mirror branch and the suppress branch) is absent from `gjc-acp-agent.test.ts` (its suite ends at test 32; the file has zero `respondToPermission`/permission tests).

Note the implementation's own doc comment on `stopForegroundTurn` still reads "Interrupt, permission denial, and a repeated Stop all land here" (`acp-agent.ts:2149-2155`) — the revision-2 framing that iteration 3's C6 fix replaced with the router framing.

### 2. A3 — transport/process death during `stopping` — GAP

The finalized §2 (iteration 2, A3) requires: on observed transport/process death, settle every in-flight ledger write as failed, the newest revision fails, the gate stays closed, and a staged successor **rejects immediately** instead of burning the 10-second admission deadline.

There is no such path. Searches for settle-as-failed/death handling across `acp-agent.ts` and `gjc-acp-agent.ts` return nothing. The process exit handler (`acp-agent.ts:3125-3140`) synthesizes `turn_failed` for `activeForegroundTurnId` — which during `stopping` is the stopped turn, so `finishTurn` records terminal proof (`acp-agent.ts:3591-3609`) — but nothing marks the in-flight `cancelAttempts` entry settled. `isCancelLedgerSatisfied` requires every attempt settled with the newest successful (`acp-agent.ts:2023-2033`), so:

- If the dead transport leaves the `connection.cancel` promise pending forever, the ledger never satisfies and the staged successor waits the full `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS` before `expireStagedSuccessor` rejects it (`acp-agent.ts:1918-1948`).
- Even if the transport rejects pending requests on close (settling the attempt as `rejected`), `evaluateStopGate` still won't release (newest rejected), and nothing rejects the waiter early — the 10-second burn the plan explicitly chose against still happens.

Generic test 21 (death during stopping: writes settle failed, successor rejects immediately, no synthetic readiness) is absent. The related §7 close bullet is satisfied in effect but not in letter: `close()` drops the stop record and rejects the waiter via `invalidateStagedSuccessor(stop, "closed")` (`acp-agent.ts:2806-2813`) rather than settling ledger writes as failed — the record is unreachable afterwards, so the waiter outcome matches, but only the close path gets that treatment, never unplanned death without close.

### 3. Terminal idempotency key — IMPLEMENTED

`issueTerminalAbort` derives the key as `` `${stop.stopId}:${revision}` `` (`gjc-acp-agent.ts:540`) — a UUID (36 chars) plus a colon plus decimal revision, nonempty and structurally ≤ ~45 UTF-8 bytes, well inside the 128-byte bound, exactly the "uuid-plus-revision form" §9 prescribes. It rides inside `input` with `mode` and `scope`: `input: { mode: "terminal", scope: this.abortScope, idempotencyKey }` (`gjc-acp-agent.ts:548-552`). Retries of one attempt reuse the key; a new attempt bumps `attemptRevision` and derives a new one (`gjc-acp-agent.ts:538-540`).

Tests assert the key is present inside `input` for both scopes (`gjc-acp-agent.test.ts:456,472,488`), that it changes with the attempt revision, and that it decomposes as `stopId:revision` with a stable stop id across repeated Stop (`gjc-acp-agent.test.ts:934-940`). The explicit "nonempty and ≤128 UTF-8 bytes" assertion from plan GJC test 31 is not present — the bound holds by construction, but nothing pins it.

### 4. Dual failure surfaces — IMPLEMENTED

- Resolved `{ok:false}` envelope: `validateGjcTerminalAbortResult` rejects anything with `result.ok !== true` (`gjc-acp-agent.ts:129-135`), covering the ACP-side extMethod conversion of handler failures into resolved `{ok:false, error:{code,message}}` payloads.
- Transport/JSON-RPC rejection: the `extMethod` call is wrapped; a throw records a `transport_rejected` reject verdict and rethrows (`gjc-acp-agent.ts:553-566`), so the stop stays installed and only a newer successful attempt can satisfy the result fact.

GJC test 15 asserts both surfaces stay stopping and emit no terminal (`gjc-acp-agent.test.ts:644-714`, with `transport_rejected` asserted at :709 and `ok:false` in the same case list). This matches factual correction 2 exactly.

### 5. §10 terminal-result matrix — IMPLEMENTED (validation), with the release-reason mapping missing

`validateGjcTerminalAbortResult` (`gjc-acp-agent.ts:118-187`) checked row by row against the finalized table:

| Matrix row                                                                           | Code                                                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| non-null, non-array object                                                           | `isRecord` gate, `gjc-acp-agent.ts:122-128`                                                                                             |
| `ok === true`                                                                        | `:129-135`                                                                                                                              |
| `selection` exactly equals requested scope (either scope, always)                    | `:136-142`; cross-scope test at `gjc-acp-agent.test.ts:573`                                                                             |
| `turn:"stopped"` + turn-scope `left_running`/`enabled`/`resume:true` → terminal-safe | `:147-156` (safe only when all three match)                                                                                             |
| `turn:"stopped"` + owned-scope `stopped`/`none`/`false` → terminal-safe              | `:152-156`                                                                                                                              |
| `owned` `stopped` with `ownedWork:"uncertain"` → reject                              | falls through to `stopped_shape_mismatch`, `:156-161`; test at `gjc-acp-agent.test.ts:596`                                              |
| `no_active_turn` + `terminal_no_effect` → conditional, never sufficient alone        | `:164-172`; `conditional` satisfies the result fact but `unresolvedGjcStopFacts` still requires `gjc.idle` (`:422-436`); test at `:619` |
| `uncertain` / `no_effect` / `no_store` → reject                                      | `:174-180`; tests at `:644` and `:1325`                                                                                                 |
| unknown disposition / missing fields / wrong types → reject                          | `:182-186`                                                                                                                              |
| documented replay metadata as extra fields → allowed, fields not weakened            | comment `:113-117`; extras ignored by the explicit checks                                                                               |
| transport/outer rejection → reject                                                   | see item 4                                                                                                                              |

The one matrix-adjacent shortfall is not in validation but in what the disposition means for the emitted terminal: §11's terminal-reason precedence says a validated `stopped` → `turn_canceled` while `no_active_turn`/`terminal_no_effect` (natural completion racing the stop) → `turn_completed`. `maybeReleaseOwnerlessStop` emits `turn_canceled` unconditionally (`gjc-acp-agent.ts:614-619`) — the pre-iteration-3 behavior that C5 was filed against. See item 7.

### 6. G004 docs commitments — PARTIAL

`docs/agent-lifecycle.md` Cancellation section:

- Request-completion contract: "resolves when the provider completes the cancellation request… completing the request does not by itself prove the old turn stopped" (`docs/agent-lifecycle.md:38-41`) ✓
- Exact reject condition: "It rejects when the request fails, in which case the provider may still own the turn" (`:41-42`) ✓
- Manager's two-second force settlement and ownership split: "The manager force-settles its captured run two seconds after an accepted interrupt… Manager settlement and provider readiness are independent facts with different owners" (`:43-47`) ✓
- Adapter stop fence and the per-provider handoff: "waits behind the adapter's stop fence, which opens only when the provider proves the old prompt terminal and every session-scoped cancellation write for the stop has settled", linking `docs/providers.md` (`:47-51`) ✓

`docs/providers.md`:

- Fence before the first cancellation write, including the permission-denial install (`docs/providers.md:530`) ✓
- Two-fact gate (authoritative terminal naming the stopped turn + settled ledger, newest successful) (`:532`) ✓
- Provider-specific stricter proof with GJC as the example, matrix delegated to the fork plan (`:533`) ✓
- Admission deadline rejects without creating readiness, OpenCode precedent + `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS` (`:534`) ✓

Missing: plan Step 5's third agent-lifecycle bullet — "the 10-second admission deadline equals GJC's own abort budget and anchors at successor staging, so expiry under a slow-but-healthy abort is the documented fail-closed outcome (§5)". Neither doc states the anchor-at-staging choice or the budget-equality rationale; `docs/providers.md:534` names the constant and the fail-closed semantics only. Also note `docs/providers.md:530` says ACP installs the fence "on permission denial" — accurate for the foreground branch, but once the §7 router's GJC branch is added (item 1) that sentence should say the deny entry routes by stop kind.

### 7. General conformance sweep — PARTIAL

Implemented finalized-plan requirements that revision 2 lacked or that the plan's factual corrections added:

- **Construction seam covering both paths (factual correction 3):** `createAgentSession` seam at `acp-agent.ts:900-905`, called from `createSession` (`:864`) and `resumeSession` (`:928`); `ACPAgentSessionOptions` exported (`:444`); `GjcACPAgentClient.createAgentSession` overrides it (`gjc-acp-agent.ts:250-258`). Resumed GJC sessions get the GJC class. ✓
- **Deadline anchored at successor staging (§5):** the timer is armed in `stageAdmission` (`acp-agent.ts:1885-1888`), not at install. Constant `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS = 10_000` (`:1412`). ✓
- **Replay suppression (C1):** phase observation is edge-triggered — a same-phase `session_info_update` is skipped before the revision moves (`gjc-acp-agent.ts:457-460`), and phase edges during the resume/replay window are ignored entirely (`:294-301`, `:450`). Tests 2 and 5 cover the two halves. ✓
- **Reservation rollback on send failure (A5):** `rollbackReservation` restores only the new reservation and reinstates the stop (`acp-agent.ts:2091-2101`); the failed successor still gets its own `turn_failed` (`:1842-1852`). Code complete; Generic test 20 absent. ✓ code / ✗ test
- **Registry dispatch (Step 3):** `providerId === "gjc"` before the generic fallback (`provider-registry.ts:806-811`), with dispatch and default-generic assertions in `provider-registry.test.ts:784` region. ✓
- **Manager wording and fixtures (Step 4):** all "acknowledged" log wording replaced with manager-owned statements; `interruptAcknowledged` renamed `interruptReturned` (`agent-manager.ts:2857-2861`); `agent.replace.start_turn_invoked/_resolved/_rejected` bracket the replacement call with sessionId/turnId correlation (`agent-manager.ts:2265-2294`); `INTERRUPT_SESSION_TIMEOUT_MS` untouched at 2,000 (`agent-manager.ts:92`); manager integration tests 1–7, 9, 10 plus the test-8 fixture comment are present and (pre-rebase) were the bulk of the suite. ✓
- **Steering (§13):** flatten, single `turn.steer` with fresh `clientRef`, `accepted` only on clean completion (`accepted !== true` refused), `unavailable` on transport failure or non-text, never interrupts or retries (`gjc-acp-agent.ts:374-407`). ✓
- **Scope handling (§9):** resolve once in the constructor, fail closed on any other non-empty value, provider env + per-create launch env merge with per-create winning (`gjc-acp-agent.ts:48-62, 231-242, 272-277`). ✓

Finalized requirements **not** implemented (all postdate revision 2):

1. **Terminal-reason precedence (A4, §11, C5; GJC test 24; AC 6).** `maybeReleaseOwnerlessStop` always emits `turn_canceled` (`gjc-acp-agent.ts:614-619`). A `no_active_turn`/`terminal_no_effect` release (the turn completed naturally before the abort landed) must emit `turn_completed` with the same explicit id; the validated disposition picks the reason. Exactly one terminal either way is already guaranteed (`terminalDelivered`, `acp-agent.ts:3604-3607`) — only the kind is wrong for the conditional case. GJC test 24 in the plan's numbering is missing (the implementation's test 24 is the plan's test 25).
2. **Issue-and-return ownerless `interrupt()` (A6+C4, §11; GJC test 32; AC 17).** `interrupt()` awaits `issueTerminalAbort`, which awaits the full `extMethod` response (`gjc-acp-agent.ts:361, 548`). The finalized contract: return once the request write is dispatched; track the response promise on the stop; validate whenever it lands; a late rejection is logged and never terminalizes. Concrete user-visible consequence today: GJC's abort can legitimately take up to its own 10-second budget, the manager's `interruptSession` wait (`agent-manager.ts:2931-2967`) is far shorter, `interruptReturned` becomes false, and `cancelAgentRun` returns `refused` (`agent-manager.ts:2865-2867`) — a Stop that should have succeeded is reported as failed while the abort is still healthily in flight.
3. **A3 settle-as-failed (item 2 above).**
4. **§7 router GJC branch + `deny_cancel_suppressed` (item 1 above).**
5. **Named tests absent:** Generic 20, 21, 22; GJC 24 (precedence), 32 (issue-and-return), 33 (deny routing). The generic suite also asserts none of the `provider.acp.*` events (zero matches in `acp-agent.test.ts`); the C2 log-event assertions exist only in GJC tests (7 sites) and manager test 10's correlation chain.
6. **Event-name delta:** the abort-result event is `provider.gjc.abort_result` (`gjc-acp-agent.ts:590`); the plan names it `provider.gjc.abort_attempt_result`. Cosmetic.
7. **Docs:** the §5 deadline-anchor/budget line (item 6 above).

## Additional findings

1. **Merge blocker — committed conflict marker in `agent-manager.test.ts`.** Line 10463 is `||||||| parent of 6d9d68590 (fix(server): manager-owned cancellation logs and replace-race fixtures)` and the `});` that closed the preceding test ("a timed-out side question aborts the provider instead of leaving it running", custom's side-conversations suite) was dropped. The rebase of G003 onto custom conflicted in this file; the resolution interleaved custom's new side-question tests before the cancellation-boundary block and leaked the diff3 base marker. Evidence chain:
   - Pre-rebase `6d9d68590:…agent-manager.test.ts` contains no markers (grep count 0); post-rebase `8b6b06913` contains the marker at 10463 — the rebase introduced it.
   - `vitest agent-manager.test.ts` fails collection ("Unexpected ||", 0 tests); `npm run lint` fails with exactly this 1 error; `npm run format:check` fails on it.
   - `npm run typecheck` passes because the tsgo program excludes `*.test.ts` — so CI typecheck will not catch a re-occurrence; only vitest/lint will.
   - Verified fix (against a /tmp copy; not applied here): replacing line 10463 with `});` makes the whole file parse cleanly under esbuild — the damage is exactly one line. After fixing, the manager suite must be run before merge; its ten plan tests have never executed on this branch as rebased.
2. **GJC ownerless `interrupt()` skips the pending-permission sweep.** The base `interrupt()` resolves pending permissions as cancelled (`acp-agent.ts:2789-2792`); the GJC ownerless branch deliberately does not, with a comment explaining that the sweep mutates private state and the public reply API would fabricate a user response (`gjc-acp-agent.ts:341-345`). Not addressed by the plan either way; a GJC-raised permission stays pending across an ownerless Stop until the provider resolves it or `close()` does. Worth a conscious decision when the deny router is added, since deny+interrupt and ownerless-interrupt will then share an entry path.
3. **`stopForegroundTurn`'s suppress branch also swallows the not-initialized case.** No connection/sessionId returns silently the same way (`acp-agent.ts:2170-2176`) — same outcome (no write), fine, but the eventual `deny_cancel_suppressed` log should distinguish it or it will be indistinguishable from no-stop-able-turn.
4. **`close()` doesn't literally settle ledger writes as failed** (drops the record instead; `acp-agent.ts:2806-2813`). Waiter outcome is equivalent — the plan's letter and the code differ only in the ledger's post-close appearance, which nothing reads. Safe to leave unless A3 is implemented, at which point close should route through the same settle-as-failed helper for one code path.
5. **Two pre-existing "acknowledged" strings remain in `agent-manager.ts`** (:127 run-cancellation error message, :3001 rewind error message). Both predate the branch (upstream `d706c4339`); the plan's wording requirement targeted cancellation log lines, which were all fixed. No action needed.

## Recommended next steps

Fix before merge (ordered):

1. Repair `agent-manager.test.ts:10463` (replace the marker line with `});`), run `npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1`, and confirm lint + format:check go green. Nothing else on this branch is verified until the manager suite actually runs post-rebase.
2. Implement §11 issue-and-return for the ownerless `interrupt()` (A6/C4, AC 17): return after the request write, track the response on the stop, validate on arrival, log late rejections. Without it, a healthy slow abort turns Stop into a manager refusal — the exact production-pain category this plan exists to remove.
3. Implement §11 terminal-reason precedence (A4/C5, AC 6): `stopped` → `turn_canceled`, `no_active_turn`/`terminal_no_effect` → `turn_completed`, disposition picks the reason; add GJC test 24.
4. Complete the §7 deny router's GJC branch (deny+interrupt during an open mirror → ownerless stop with the mirror's explicit id) and the `provider.acp.deny_cancel_suppressed` log for the no-stop-able-turn branch; add Generic test 22 and GJC test 33. While there, decide finding 2 (pending-permission sweep on the shared entry path).
5. Implement A3 settle-as-failed on observed transport/process death (settle in-flight attempts failed, reject the staged successor immediately) and add Generic test 21.
6. Add the Step 5 deadline-anchor/budget-equality sentence to `docs/agent-lifecycle.md`'s Cancellation section; adjust `docs/providers.md:530` if the deny router's shape changes that sentence.

Safe to defer (with rationale):

- Generic test 20 (rollback) — the behavior is implemented and pinned indirectly by the send-failure path; the dedicated fixture can land with the A3/A1 test batch.
- The `abort_result` → `abort_attempt_result` event rename — cosmetic; renaming costs a test-update sweep for zero behavioral gain.
- Folding `provider.acp.*` assertions into Generic tests 1–3/12–15 (C2) — manager test 10 already asserts the correlation chain end-to-end, which is the part of C2 that catches real regressions.
- The explicit ≤128-byte idempotency-key assertion — the key format guarantees it; add a one-line `expect(Buffer.byteLength(key)).toBeLessThanOrEqual(128)` whenever the key derivation is next touched.
- Making `close()` settle the ledger as failed — only worth doing as part of item 5 so both death paths share the helper.

## Acceptance-criteria rollup

Met: AC 1–5, 7–10, 13 (qualified by the plan's own §2/§7 deltas), 14, 16 (code). Partial: AC 6 (two-fact yes, reason precedence no), AC 11 (close yes, deny routing incomplete), AC 12 (manager yes; generic-side event assertions missing). Not met: AC 15 (A3), AC 17 (issue-and-return). Unverifiable until the manager suite runs post-rebase: the manager-integration halves of AC 1–5 and 12.
