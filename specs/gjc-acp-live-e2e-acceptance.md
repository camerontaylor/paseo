# GJC ACP cancellation boundary — live E2E acceptance

Status: complete. Executed 2026-09-08 against commit `e86d165f5` (`integrate/side-conversations-acp-v072`). Seven of seven steps pass; every gjc 0.16.6 behavioral difference from the 0.15.5 plan matrix is recorded below.

## Run context

- Dev daemon `127.0.0.1:6768`, run home `<worktree>/.dev/paseo-home`, provider `gjc` (`extends: "acp"`, `GJC_ACP_ABORT_SCOPE=owned`, `GJC_ACP_PERMISSION_MODE=auto`).
- Local gjc binary **0.16.6**; the plan matrix derives from **0.15.5**. Differences are findings, not failures of the boundary.
- Scratch workspace `/tmp/gjc-e2e-scratch`; evidence timestamps quote the run's `daemon.log` (ephemeral, not retained — this file is the record).
- Plan: `fork/plans/ralplan-gjc-acp-cancellation-boundary.md` § Live E2E acceptance.

## Verdicts

| Step                                         | Verdict       | Basis and evidence                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Autonomous turn + steering                 | PASS w/ drift | Mirror ids explicit (`gjc-autonomous-58afc4ce…`, `gjc-autonomous-45162401…`). Steer into an ownerless mirror is not accepted by 0.16.6; the send degraded to a fenced replace and the gate held: `successor_staged` 20:39:58.560 → `admission_deadline` 20:40:08.560 → `agent.replace.start_turn_rejected`; no prompt sent. Only a foreground turn accepted steering (`printf 't4-stage-1\nsteered\n'` visible in tool args) |
| 2 Replacement under foreground               | PASS w/ drift | The invariant — manager force-settle with **no** replacement `session/prompt` — held, but on the ownerless path: force-settle 20:39:58.559 (`cancelAgentRun: manager settlement wait timed out; force-settling the manager-owned run`) → successor staged, never prompted. Foreground terminals settled in 321/106/725 ms (3/3 attempts), so the 2 s force-settle never fired foreground on 0.16.6                           |
| 3 Fence ordering                             | PASS          | 20:44:37.443 `cancel_attempt_settled {"outcome":"success"}` → 20:44:37.763 `stop_terminal_observed` → 20:44:37.764 `successor_staged` + `admission_released {"satisfiedGates":["terminal","cancelWrites","providerGate"]}` → `start_turn_resolved` .765. Same order in all three attempts                                                                                                                                    |
| 4 Ownerless Stop (two-fact gate)             | PASS          | Chain below. Release names both facts; exactly one client-visible `turn_canceled` (emitted by the manager's 2 s settle; metrics window 20:51:44.999, `cancel_agent_request` latency 2001 ms); gate held 69 s past force-settle — no synthetic closure                                                                                                                                                                        |
| 5 Unresolved abort → 10 s admission deadline | PASS          | Chain below. Deadline anchored at staging to the millisecond; waiter rejected; no prompt. The goal kept running (`t6-stage-2`/`t6-stage-3` appended to `progress.txt` by 20:58:30), proving the replacement never touched it                                                                                                                                                                                                 |
| 6 Close hygiene                              | PASS          | Archive 20:58:34.924. Sole post-close provider event: `stop_death_settled {"attempts":0,"reason":"closed"}` at +10 ms — the archive's own teardown of the installed stop. No `phase_edge`, terminal, or prompt for the closed session in ~3 min after; scratch file last write 20:58:30 predates the archive                                                                                                                 |
| 7 Final state                                | PASS          | Both surviving agents idle. Whole-log greps: `-32603`/busy = 0, `A foreground turn is already active` = 0. Positive events: 6× `stop_installed`, 4× `admission_released`, 2× `ownerless_stop_released`, 2× `admission_deadline`                                                                                                                                                                                              |

## gjc 0.16.6 vs 0.15.5 findings

These feed the plan's escalation gate. No unexpected terminal _shape_ ever appeared — every abort disposition was the known `no_active_turn`/`conditional`, so the stop-and-escalate condition never triggered.

1. **Background goal continuations are not addressable by control ops.** Every ownerless `turn.abort scope=owned` returned `no_active_turn` in 17–50 ms (verdict `conditional` — a valid matrix outcome) while the goal ran to completion. On 0.15.5 the inspected source treated owned busy work as abortable; 0.16.6's restructured waiter (`#promptPhaseOwner = activePrompt ?? background`, deferred events, `terminalReserved`, correlation matching) dissociates background continuations from the turn registry. Stop on an ownerless mirror is cosmetic for the underlying work on 0.16.6. The gate handled this correctly: held, released on natural idle.
2. **Single-continuation goals publish no phase edges.** Prompts asking for one self-started continuation turn ran with zero `working`/`idle` edges — work happens while Paseo shows idle, so no mirror opens. Multi-stage goals (three or more turns) published edges reliably.
3. **Foreground terminals settle in 105–724 ms after cancel** (3/3, including mid-generation and a SIGTERM-trapping `sleep` tool). The 0.15.5 race — `CANCEL_SETTLEMENT_GRACE_MS = 5_000` outliving Paseo's 2 s manager force-settle, the original incident — never reproduced. Step 2's foreground scenario is unreachable on 0.16.6; the invariant was proven on the ownerless path.
4. **Steer is unavailable for ownerless mirrors.** An `activeTurnBehavior: "steer"` send into a mirror degraded through `steerOrReplaceActiveTurn` to a fenced replace. Only foreground turns steered.
5. **Post-stop idle arrives only at natural goal completion** (40–70 s after Stop). The gate held the whole time; fail-closed as designed.
6. **Working-edge log lines lack `mirrorTurnId`.** `observeGjcPhase` logs before handling, so the opening `working` edge omits the id and the closing `idle` edge carries it. Code-verified asymmetry; affects log-based mirror detection.
7. **The step-5 deadline rejection surfaces to the client as `turn_failed`**, leaving the agent in `error` lifecycle until archive (metrics 20:58:15, `byLifecycle: {idle: 2, error: 1}`). Expected visibility of the rejection, not a fault.

## Step 4 chain — two-fact gate

Agent `5d03dc8e`, session `093ce391`, mirror `gjc-autonomous-1837c314-7372-4fbd-9c35-bc0d1288e841`, stop `936a564d`.

```
20:51:30.221  provider.gjc.phase_edge          {"phase":"working","phaseRevision":10}                       mirror opens (edge pre-mint: no id)
20:51:36.735  provider.acp.stop_installed      {"stoppedTurnId":"gjc-autonomous-1837c314…","kind":"provider-owned","reason":"interrupt"}
20:51:36.735  provider.gjc.abort_attempt       {"revision":1,"scope":"owned"}
20:51:36.756  provider.gjc.abort_result        {"revision":1,"scope":"owned","disposition":"no_active_turn","verdict":"conditional"}   [21 ms]
20:51:38.735  WARN cancelAgentRun: manager settlement wait timed out; force-settling the manager-owned run {"kind":"autonomous"}
              metrics 20:51:44.999: exactly 1 × outbound turn_canceled (the manager's settle); cancel_agent_request latency 2001 ms
              gate stays closed 69 s — no synthetic provider closure
20:52:45.665  provider.gjc.phase_edge          {"phase":"idle","phaseRevision":11,"mirrorTurnId":"gjc-autonomous-1837c314…","stopId":"936a564d…"}
20:52:45.665  provider.acp.stop_terminal_observed {"turnId":"gjc-autonomous-1837c314…","kind":"provider-owned"}                        exact-id terminal
20:52:45.666  provider.gjc.ownerless_stop_released {"resultRevision":1,"resultDisposition":"no_active_turn","idlePhaseRevision":11}
```

`ownerless_stop_released` names both facts: the validated abort result (revision 1, `no_active_turn`) and the eligible post-stop idle (phase revision 11 > installed).

## Step 5 chain — admission deadline

Disposable agent `6ab3ab30`, session `5529e903`, mirror `gjc-autonomous-05b152b3-e032-4f00-92ee-a08263b588e4`, stop `3d232568`.

```
20:57:34.914  provider.gjc.phase_edge          {"phase":"working","phaseRevision":4}                        mirror opens
20:57:40.859  provider.acp.stop_installed      {"stoppedTurnId":"gjc-autonomous-05b152b3…","kind":"provider-owned","reason":"interrupt"}
20:57:40.859  provider.gjc.abort_attempt       {"revision":1,"scope":"owned"}
20:57:40.909  provider.gjc.abort_result        {"revision":1,"scope":"owned","disposition":"no_active_turn","verdict":"conditional"}   [50 ms]
20:57:42.860  WARN cancelAgentRun: manager settlement wait timed out; force-settling the manager-owned run
20:57:48.874  provider.acp.successor_staged    {"token":"9c2251c9…","kind":"provider-owned","timeoutMs":10000}                        deadline anchored HERE
20:57:58.874  provider.acp.admission_deadline  {"timeoutMs":10000,"unresolved":{"terminal":true,"cancelWrites":false,"providerGate":true,"providerGateFacts":["gjc.idle"]}}
              exactly 10.000 s after staging; waiter rejected, no prompt written
              CLI: Error: Failed to send message: acp replacement turn was not admitted within 10000ms; the previous turn is still being stopped
              goal continues untouched: t6-stage-2/3 appended to progress.txt by 20:58:30
20:58:34.924  Archiving agent 6ab3ab30…                                                        step 6 close
20:58:34.934  provider.acp.stop_death_settled  {"attempts":0,"reason":"closed"}                   stop cleaned up by closure; nothing after
```

## Not verified

1. **The 0.15.5 foreground 2 s force-settlement race** (step 2's named scenario) — unreproducible on 0.16.6; foreground always settled under 1 s. Needs the plan's controlled-delay disposable ACP connection or a 0.15.5 binary.
2. **A `safe` abort on ownerless work** — never observed; every ownerless abort returned `no_active_turn`/`conditional`. Blocked by finding 1.
3. **Idle-first ordering of the two release facts** — the abort result always arrived in milliseconds, idle tens of seconds later; the reverse order was never exercised live (unit tests cover it).
4. **`turn.steer` accepted on an ownerless mirror** — never observed (finding 4).
5. **Negative-path events** (`successor_invalidated`, `deny_cancel_suppressed`, `abort_transport_rejected`, `idle_invalidated`) — no step triggers them; absence is expected, not evidence.
