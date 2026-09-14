# Plan — ACP cancellation-boundary fix pass

Executable plan for the gaps listed in [../handover-2026-09-04.md](../handover-2026-09-04.md),
verified against `acc60db36` on 2026-09-04 and corrected where verification disagreed with the
handover.

The handover and [review-gjc-acp-cancellation-boundary.md](review-gjc-acp-cancellation-boundary.md)
stay as written — they are the record. Where this plan and the handover disagree, the disagreement
is stated explicitly below with the evidence; **this plan wins for fix 5**, which the handover gets
backwards.

## Verification record

Everything the handover asserts was re-checked at `acc60db36`. Held:

| Claim                                                                                                                                                                                                           | Result                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- |
| Branch `acc60db36`, five commits, rebased on `custom` `54c7d08b4`, unpushed                                                                                                                                     | ✓                                                                                                                                                                                                                               |
| `agent-manager.test.ts:10463` is a bare diff3 marker; the `});` above it was dropped                                                                                                                            | ✓                                                                                                                                                                                                                               |
| Replacing line 10463 with `});` makes the file parse                                                                                                                                                            | ✓ esbuild parses the patched copy; the original fails on `Unexpected "                                                                                                                                                          |     | "`  |
| Lint fails with exactly one error there; `format:check` fails on the same line                                                                                                                                  | ✓                                                                                                                                                                                                                               |
| Typecheck green (tsgo excludes `*.test.ts`)                                                                                                                                                                     | ✓                                                                                                                                                                                                                               |
| acp-agent 117 + gjc-acp-agent 39 + provider-registry 51                                                                                                                                                         | ✓ 207 passed                                                                                                                                                                                                                    |
| Ten manager plan tests have never run                                                                                                                                                                           | ✓ nine numbered tests after line 10463, plus plan test 8 implemented as the `fenceOrder` assertion on the pre-existing replace fixture (`agent-manager.test.ts:9820`). The numbering gap at 8 is by design, not a missing test. |
| Fix 2 anchors — `issueTerminalAbort` awaited at `gjc-acp-agent.ts:329` and `:361`, awaiting `extMethod` at `:548`; `recordAbortResult` at `:574`                                                                | ✓                                                                                                                                                                                                                               |
| Fix 3 anchor — `maybeReleaseOwnerlessStop` emits `turn_canceled` unconditionally at `gjc-acp-agent.ts:614`                                                                                                      | ✓ verdict vocabulary (`safe`/`conditional`/`no_active_turn`/`terminal_no_effect`) all present                                                                                                                                   |
| Fix 4 — `provider.acp.deny_cancel_suppressed` exists nowhere in source; suppress branch at `acp-agent.ts:2171` is silent; `GjcACPAgentSession` overrides neither `respondToPermission` nor `stopForegroundTurn` | ✓                                                                                                                                                                                                                               |
| Fix 6 — the §5 deadline-anchor sentence is absent from `docs/agent-lifecycle.md`                                                                                                                                | ✓                                                                                                                                                                                                                               |

Two things the handover states that verification contradicts, and one omission — see below.

## Correction 1: fix 5's mechanism is inverted

The handover says the in-flight `cancelAttempts` entry "stays pending forever" on process death, so
the ledger never opens and the successor burns the ten-second deadline. That is not what happens on
the generic ACP path.

`ACPAgentSession.issueCancelWrite` (`acp-agent.ts:2190`) calls `connection.cancel()`, which the SDK
implements as a **notification**, not a request:

- `ClientSideConnection.cancel` → `Connection.sendNotification` → `#sendMessage`
  (`node_modules/@agentclientprotocol/sdk/dist/acp.js:641`, `:902`, `:905`).
- `#sendMessage` awaits only the write to the pipe, and its `.catch` **swallows the write error**
  ("Continue processing writes on error", `acp.js:915`), so the returned promise resolves.

Writing to a dead child's stdin rejects (`ABORT_ERR`, confirmed by probe). The SDK catches it, the
promise resolves, and `issueCancelWrite`'s success branch calls
`settleCancelAttempt(stop, attempt, "success")` (`acp-agent.ts:2211`).

So the failure mode is the opposite of the handover's, and worse: **a cancellation that was never
delivered is recorded as a settled successful cancel.** Together with the exit handler's synthesized
foreground terminal (`acp-agent.ts:3126-3140`), both gate facts are satisfied and the staged
successor is **admitted and prompted into a dead process** — the fence opens on proof it does not
have. Fail-closed becomes fail-open.

The handover's prescription (settle in-flight attempts as failed on observed death) is still the
right remedy. It just has to **override a false success**, not resolve a hang, which changes the
ordering requirement: the death handler must run and mark the stop unsatisfiable regardless of what
the write promise already reported.

## Correction 2: the real forever-pending hazard is the GJC path, which fix 5 does not mention

`extMethod` is a **request** — `ClientSideConnection.extMethod` → `Connection.sendRequest`
(`acp.js:649`, `:894`), which awaits an entry in `#pendingResponses`. When the read loop ends it
`break`s, releases the reader and aborts the controller (`acp.js:760-789`); **`#pendingResponses` is
never rejected**. There is no cleanup anywhere (`grep pendingResponses` → set/get/delete on the
response path only).

So on transport or process death the GJC ownerless `turn.abort` response never lands:
`state.result` stays null, `gjc.abort_result` never satisfies, `maybeReleaseOwnerlessStop`
(`gjc-acp-agent.ts:595`) never fires, and the successor burns the full
`ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS` before `expireStagedSuccessor` (`acp-agent.ts:1918`) rejects
it. That is exactly the symptom the handover describes — on a path it does not cover.

**This makes P2 dependent on P5.** Today the hang is at least surfaced: `interrupt()` awaits the
response, the manager's wait times out, `interruptReturned` goes false. Once P2 stops awaiting, the
hang becomes silent and permanent. P2 must not land without P5.

`ClientSideConnection` exposes `get signal(): AbortSignal` (`acp.d.ts:444`), which aborts when the
connection closes. That is the death hook both corrections want, and it covers transport death that
no process `exit` event reports.

## Correction 3 (minor)

- The working tree also holds a modified tracked file, `fork/README.md` (an index row for the
  handover). The handover says only two untracked files.
- "`interruptReturned` goes false, and `cancelAgentRun` returns `refused`" is conditional:
  `agent-manager.ts:2868-2870` returns `refused` only when the run also failed to settle within
  `rescueTimeouts.interruptSessionMs`. The user-visible outcome the fix targets is unchanged.

## Plan units

Ordered. P1 gates everything; P5 gates P2.

### P1 — Repair the rebase damage (blocker)

**Goal:** the manager suite runs.

Replace `packages/server/src/server/agent/agent-manager.test.ts:10463` with `});`. Nothing else.

```bash
npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1 > /tmp/mgr.txt 2>&1
npm run lint -- packages/server/src/server/agent/agent-manager.test.ts
npm run format:check
```

**Done when:** the suite runs to completion and its result is recorded (pass or fail — the ten plan
tests have never executed, so a failure here is information, not a regression), lint and
`format:check` are green.

**Commit alone**, before any behavioral work. Everything below is unverified until this lands.

### P5 — Settle as failed on observed death (plan §2, A3; AC 15)

Promoted ahead of P2, which depends on it. Supersedes the handover's fix 5 rationale per correction 1.

**Goal:** observed transport or process death closes the boundary against both facts instead of
opening it on a phantom cancel or hanging on a response that will never arrive.

One death helper on `ACPAgentSession`, called from three places:

1. the child `exit` handler (`acp-agent.ts:3126`), after the synthesized terminal;
2. `connection.signal`'s `abort` (`acp.d.ts:444`), for transport death with no process exit;
3. `close()` (`acp-agent.ts:2797`), which today drops the stop record rather than settling it —
   equivalent for waiters, not in letter, and there should be one death path.

The helper, gated on `stopIdentityMatches(stop)` so a stop captured on an older connection is
untouched:

- mark every attempt of the current stop settled with outcome `rejected`, **including attempts
  already marked `success`** — correction 1 is why: on the generic path the success is a lie. Set
  the ledger's newest-succeeded state to false so `isCancelLedgerSatisfied` (`acp-agent.ts:2023`)
  cannot open;
- reject the staged successor immediately with a death-specific reason rather than leaving it to the
  admission deadline;
- for the GJC subclass, record a `reject` verdict on any unsettled ownerless abort attempt through
  the existing `recordAbortResult` (`gjc-acp-agent.ts:574`) so `unresolvedGjcStopFacts` reports the
  real reason instead of a bare `gjc.abort_result` at deadline. Newest-wins already protects this
  from a late real reply.

**Consider (decide during implementation, do not silently skip):** whether to stop trusting a
resolved `connection.cancel()` as proof at all, given the SDK swallows write errors. A settled
notification proves the write was _attempted_, which is weaker than what `docs/providers.md:526`
claims it proves. Out of scope to change the ledger's contract here; note it and raise it if the
death helper turns out not to cover the observed cases.

**Tests:** generic test 21 (death during stopping settles in-flight writes as failed and rejects the
staged successor immediately), plus a new case for the inverted mode — a cancel write that resolves
because the SDK swallowed its error must not satisfy the ledger once death is observed. Land generic
test 20 (reservation rollback) with this batch, per the handover's deferral.

**Done when:** AC 15 met; no path exists on which death leaves an unsettled or falsely-successful
attempt.

### P2 — Issue-and-return for the ownerless interrupt (plan §11, A6+C4; AC 17)

**Depends on P5.**

**Goal:** `interrupt()` returns once the `turn.abort` write is dispatched, so a healthy slow abort is
not reported as a failed Stop.

gjc's abort budget and `ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS` are both 10 s
(`acp-agent.ts:1412`); the manager's post-interrupt wait is `INTERRUPT_SESSION_TIMEOUT_MS` = 2 s
(`agent-manager.ts:92`), and `interruptSession` (`agent-manager.ts:2933`) waits
`rescueTimeouts.interruptSessionMs` around the call itself. A legitimate 10 s abort therefore always
loses that race today.

Keep the synchronous prefix of `issueTerminalAbort` (`gjc-acp-agent.ts:530`) — identity check,
revision bump, idempotency key, `provider.gjc.abort_attempt` log — then issue `extMethod` **without
awaiting**, attaching both handlers to the existing `recordAbortResult`, which already does
newest-wins, validation and release. Stop awaiting in both `interrupt()` branches
(`gjc-acp-agent.ts:329`, `:361`). A late rejection is logged and never terminalizes.

**Tests:** GJC test 32 — interrupt resolves before the control response resolves; the response
validates later; a late rejection never terminalizes. Existing tests that resolve the control
deferred after `await interrupt()` will need reordering; the write is still issued synchronously so
`abortRequests` length assertions hold.

**Done when:** AC 17 met, and a 10 s healthy abort no longer produces a refused Stop.

### P3 — Terminal-reason precedence on ownerless release (plan §11, A4/C5; AC 6)

**Goal:** the validated disposition picks the terminal kind at `gjc-acp-agent.ts:614`.

- verdict `safe` (dispositions `stopped_left_running` / `stopped_stopped`, `gjc-acp-agent.ts:156`)
  → `turn_canceled`, even when the eligible idle arrived first;
- verdict `conditional` (`no_active_turn` + `terminal_no_effect`, `:166`) → `turn_completed`;
  nothing was left to stop, so the post-stop idle is the natural completion edge.

Exactly one terminal either way — `terminalDelivered` already guarantees once.

**Tests:** GJC test 24, both halves. **Done when:** AC 6 met.

### P4 — The §7 deny router's GJC branch and the suppression log (plan §7, A1; AC 11)

**Goal:** all three deny branches exist and the suppressed one is observable.

Entry is `respondToPermission` (`acp-agent.ts:2762`) → `stopForegroundTurn` (`acp-agent.ts:2156`).

- Foreground → generic stop + ledger cancel: done, generic test 17.
- No stop-able turn → suppress the write (`acp-agent.ts:2171`): implemented but silent. Add
  `provider.acp.deny_cancel_suppressed` with the permission request id and correlation ids threaded
  from `respondToPermission`, and **distinguish the no-connection/not-initialized early return from
  the no-stop-able-turn case** — they share the branch today and would be indistinguishable in the
  log (review finding 3).
- GJC ownerless mirror open → ownerless stop: **missing.** Factor the ownerless install-and-issue out
  of `interrupt()` (`gjc-acp-agent.ts:314-362`) into a helper both paths call, and override the
  routing hook in `GjcACPAgentSession`.

**Decide while in here:** the ownerless `interrupt` deliberately skips the base pending-permission
sweep (`gjc-acp-agent.ts:341-345`; the comment explains why). Once deny shares the helper, confirm a
gjc-raised permission pending across an ownerless stop cannot wedge. The deny path resolves its own
permission; Stop does not resolve theirs. Record the decision in the commit message.

**Tests:** generic test 22, GJC test 33. **Done when:** AC 11 and AC 12 met.

### P6 — Docs

1. `docs/agent-lifecycle.md`, Cancellation section (lines 36-51): add the plan's §5 sentence — the
   ten-second admission deadline equals gjc's own abort budget and anchors at successor staging, so
   expiry under a slow-but-healthy abort is the documented fail-closed outcome, not a defect.
   `docs/providers.md:534` already names the constant and the fail-closed semantics; link, do not
   restate (one fact, one doc).
2. If P4 lands: revisit `docs/providers.md:530` ("ACP installs it in `interrupt()` and on permission
   denial") — with the router, the deny entry routes by stop kind rather than always installing.
3. If P5's "consider" resolves against the current wording: `docs/providers.md:526` says an ACP
   cancellation is "a notification whose completion proves the write settled and nothing else". Per
   correction 1 the SDK swallows write errors, so completion proves the write was _attempted_.
   Tighten that clause.

### P7 — Deferrables (unchanged from the handover, restated so they are not lost)

- `provider.gjc.abort_result` → `abort_attempt_result` rename: cosmetic; costs a test sweep.
- Folding `provider.acp.*` assertions into generic tests 1-3/12-15: manager test 10 already asserts
  the correlation chain end to end.
- Explicit `Buffer.byteLength(key) <= 128` assertion: the `${stopId}:${revision}` format guarantees
  it; add when the key derivation is next touched.

### P8 — Working-tree and record hygiene

Decide deliberately whether the two untracked fork files and the modified `fork/README.md` are
committed with this pass. Add an index row for this plan to `fork/README.md` if it is kept.

## Sequencing

| Batch | Units                | Rationale                                       |
| ----- | -------------------- | ----------------------------------------------- |
| 1     | P1                   | Blocker, commit alone, no behavioral change.    |
| 2     | P5 (+ generic 20/21) | Must precede P2; the largest correctness delta. |
| 3     | P2, P3               | Both GJC ownerless release; share fixtures.     |
| 4     | P4                   | Touches both classes and the generic router.    |
| 5     | P6, P8               | Docs follow settled behavior.                   |

## Definition of done

AC 6, 11, 12, 15 and 17 met; AC 1-5's manager-integration halves verifiable once P1 lands. Manager
suite green, lint and `format:check` green, targeted `npx vitest run <file> --bail=1` for every
touched file with output piped to a file. The whole-suite run goes to CI, not localhost. The plan's
live E2E (steps 1-7) needs a gjc host — ceres or saturn, provider registered with
`GJC_ACP_ABORT_SCOPE=owned`, `paseo daemon reload`, never restart.

## Traps

Carried from the handover, all re-verified:

- **Typecheck is blind to test files.** The tsgo program excludes `*.test.ts` — the P1 marker passed
  `npm run typecheck` while breaking vitest, lint and format. Run lint after any rebase.
- **`agent-manager.test.ts` is the rebase hot zone.** Custom's side-conversations suite and the
  cancellation-boundary block both append at the end of the file. Expect the next rebase to conflict
  there again.
- **The suites stub the connection.** Both provider suites drive a stub whose `cancel` settles on a
  test-controlled deferred, so they encode the intended settlement semantics rather than the SDK's.
  That is why corrections 1 and 2 were invisible to 207 passing tests. Any test for P5 that also
  stubs the settlement will re-hide the bug; assert against the SDK's actual behavior.
- lefthook pre-commit runs a full workspace typecheck; this worktree is built and passes.
- If `npm install` runs again, `git checkout -- package-lock.json` afterwards.
- Never run the full suite locally. Never restart the daemon on port 6767.
- Do not modify the plan or the review's verdicts. The plan's escalation gates apply: if gjc 0.15.5
  emits an unexpected terminal shape, stop and review rather than broadening the matrix; if
  fail-closed scope ever conflicts with a launch-config convention, back to review, no silent
  fallback.
- `plans/ralplan-gjc-acp-busy-turn.md` is superseded in its cancellation design. Do not implement it.
