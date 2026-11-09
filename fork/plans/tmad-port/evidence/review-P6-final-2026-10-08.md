# P6 final integration review (READ-ONLY, Pi/Muse route)

Verdict: **APPROVE** — full basket `9584b2a669ce90a5df8c9eac66073e85124e90bb`.
Separate frozen+voice `0169f9a839fcdc01d4df04da02872ef3167c6dc9` is a
consistent voice-integration checkpoint with one known, by-design omission
(see §7). No CodeRabbit claim; reviewer route is Pi/Muse per intake rule.

Reviewer performed zero source edits, commits, pushes, daemon operations, or
test re-runs. All verification is read-only (`git rev-parse/merge-base/show/
grep`, file reads, existing log inspection) against the EXACT final refs in
their scratch worktrees — not the primary workspace cwd HEAD `e423a8666`
(earlier P6 checkpoint). Test/build claims below are the assembler's evidence
in `/tmp/tmad-port/evidence/P6-assembly.md` plus raw logs, assessed for
honesty and scope, not re-executed.

Inputs read: `P6-assembly.md`, `P6-conflict-resolution-log.md`,
`review-TM-04.md` (APPROVE of exact `84f11381`).

## 1. Reviewed refs (exact)

| Basket | HEAD reviewed | Worktree inspected |
| --- | --- | --- |
| Full current-custom + side-repair + Voice + receipt fix | `9584b2a669ce90a5df8c9eac66073e85124e90bb` | `/tmp/tmad-port/full-custom-plus-voice` (clean) |
| Frozen P6 + Voice + receipt fix | `0169f9a839fcdc01d4df04da02872ef3167c6dc9` | `/tmp/tmad-port/frozen-plus-voice` (clean) |

Both `git status --short` clean at review time. `git rev-parse HEAD` matches
the SHAs above.

## 2. Ancestry (all required inputs present, unmutated)

`merge-base --is-ancestor` at the exact final refs:

Full `9584` — all YES:
- P0 `2bfcd2e19638484baf1651d69dc0be55df483bcd` YES
- current custom `24f134618cd8a7143615debf927c1ac60b9ba813` YES
- side repair `fddb4fa8587ae377286ffbea3137df4c53bdc7a9` YES
- TM-01 `a8241e53530d6bd0a958971118d6b8b57ff80b0c` YES
- TM-02 `91392d6beed3fc49f9be7496a70b8d5822957d4c` YES
- TM-03 `9ab91bb759be1951bdaa9cbe7bc991cafed2569d` YES
- TM-07 `5f3634ad43256c18f9f41667348c65fe1b03d7f4` YES
- TM-04 `84f11381ceabec13d5deaff6c1e2c05dc67a6c62` YES (via import `5ecb83246`)

Frozen `0169` — YES for P0 + all four TM SHAs + TM-04 + `e423a8666`;
correctly NO for custom `24f134618` and side repair `fddb4fa85`
(frozen basket by design).

History shape confirmed:
- `9584` → `6e9fab673` (Voice merge of exact `84f11381`) → `348e5b988`
  (side-repair merge) → `505595ab2` (custom merge) → P6 `e423…`.
- `0169` → `af9c9839a` (Voice merge of exact `84f11381`) → P6 `e423…`.
- All five/six reviewed intake SHAs resolve (`rev-parse --verify` OK);
  no intake SHA was edited — the only post-merge deltas are the two
  assembly-owned commits (`9584`, `0169`) plus the previously approved
  `e423a8666` harness mock.

## 3. Merge/adaptation deltas reviewed (nothing beyond assembly log)

1. **Native Find / Stream / artifacts menu union** — PASS. At `9584`,
   `workspace-tab-menu.ts` retains side-conversation (`message-circle-plus`),
   artifacts (`view-artifacts` + separator), and Find (`find-in-chat` +
   separator) as independent entries with distinct keys/labels/callbacks.
   No contract conflict; matches conflict-log rationale.
2. **Voice+queue composer/client API cleanup + cap hello** — PASS. Single
   `listQueuedAgentMessages` at `daemon-client.ts:3764` uses the namespaced
   `agent.queue.list.request/response` pair; the duplicate Voice-era
   flat-RPC method/import is gone. Composer keeps both Queue selectors
   (`supportsDurableQueue`, snapshot, failed outbox) and
   `supportsVoiceConcurrentInput`. Cap-hello test expects all three caps
   (`companion_stream_port_v1`, `durable_agent_queue`,
   `durable_voice_input_v1`).
3. **Session voice ownership × capable-source observation/delivery** —
   PASS. `session.ts` at `9584` keeps `hasSideConversationDemand`
   (capable-attached-source OR demand flag) and per-source
   `forwardSideConversationUpdate` delivery, alongside
   `ownsAttachment`/`voiceOwner`/generation gating on the receipt-read
   path (`≈L8490–8510`). No dropped behavior found in the read-only
   inspection; consistent with the full-basket unfiltered session pass
   (373 tests, see §6).
4. **AsyncStorage mock `e423` inherited** — PASS. `session-store.test.ts`
   blob `9a89a34f6b8b3b61fcd91e1a23c0f7c99f44d5df` identical in both
   finals; the reviewed intake SHAs themselves untouched.
5. **Bootstrap receipt-owner startup fix (`9584`/`0169`)** — PASS and the
   only new integration delta since the TM-04 review. Each commit is a
   2-line deletion in `bootstrap.ts` (drop `MessageReceipts` import +
   `receipts:` construction arg). Post-fix wiring verified at `9584`:
   - `AgentQueueService` constructed receipt-free; `setMessageReceipts`
     throws on double-provide (fail-closed against a second owner).
   - Sole production `new MessageReceipts` is `websocket-server.ts:707`;
     injection `setMessageReceipts` runs at construction, and
     `agentQueueService.activate()` runs at `bootstrap.ts:1752` — after
     `wsServer` construction and `beginAcceptingConnections`.
   - Therefore exactly one shared receipt owner exists BEFORE queue
     activation in the daemon startup path. Receipt-gated writes are
     `if (this.receipts)`-guarded, so there is no second-owner fork and
     no lost-receipt behavior outside the WebSocket startup path; the
     pre-injection window is construction-only with dispatch gated on
     `activate()`. Unit tests inject explicitly and are unaffected.

## 4. Rollback / removal evidence (source vs runtime separated)

- Source/storage: queue-free rehearsals (`365cd7a1c` from P0+Stream+Find+
  custom+side-repair; `97612a458` P0+Stream+Find) structurally lack queue/
  voice layers while preserving carries. Accepted as structural evidence;
  root typecheck/lint were not run on the removal-only tree (disclosed).
- Runtime (copied home `/tmp/tmad-port/queue-runtime-custom-copy`,
  fake Codex provider, ephemeral loopback, `createTestPaseoDaemon`):
  queue-free run and final enabled run both preserve `pending-copy-1`
  (rev 1), SHA-256 `eb0fbafe…b2ae3` unchanged before/during/after, 0
  provider queued turns. Logs: `p6-noqueue-custom-runtime.log`,
  `p6-final-enabled-runtime.log`.
- Limitation (non-blocking, must stay on the gate list): **zero turns
  means dormant preservation, not provider dispatch.** The copied pending
  item is synthetic test data attached to a copied idle agent, not an
  exercised live agent. This proves no deletion/clobber across
  removal→recovery, but proves nothing about provider credentials,
  voice-device capture/playback, or live-home migration. The assembly doc
  states this honestly; the claim is proportionate.

## 5. No lost-receipt confirmation

Single shared `MessageReceipts` initialized in `WebSocketServer` and
injected via `setMessageReceipts` before `activate()`. No second
construction path in production code (`grep new MessageReceipts` at
`9584` hits only `websocket-server.ts` plus `*.test.ts`). Double-provide
throws. No evidence of receipt writes bypassing the shared owner.

## 6. Build/test log honesty spot-check (not re-run)

- Full+Voice: `build:server`, `build:app-deps`, root `typecheck`, root
  `lint` PASS; client/server focused set 373 passed; composer/voice/
  session set 76 passed. Log tails inspected; no anomalies.
- Frozen+Voice: same build/typecheck/lint PASS; app set 76 passed;
  client/server set 215 passed + 1 failed — the known side-conversation
  manager broadcast test, expected because frozen omits side repair
  `fddb4fa85`. Correctly disclosed, not a merge defect.
- No full suite run (disclosed, per constraint). Worker-approved
  unchanged tests trusted without repetition — acceptable.

## 7. Findings

No blocking findings. Notes:

1. Frozen `0169` retains the known side-conversation test failure by
   design (missing repair). It is a valid voice-integration checkpoint,
   not the ship candidate. The ship candidate is full `9584`.
2. `voiceOwner` optional-typed but single-caller-supplied (already noted
   non-blocking in review-TM-04). No action required here.
3. Runtime proof limits in §4 remain open gates, not review failures.

## 8. Result

**APPROVE** full basket `9584b2a669ce90a5df8c9eac66073e85124e90bb`
(and, as a checkpoint only, frozen `0169f9a839fcdc01d4df04da02872ef3167c6dc9`).
Reviewed intake SHAs unchanged: P0 `2bfcd2e1`, custom `24f13461`,
side repair `fddb4fa8`, TM-01 `a8241e53`, TM-02 `91392d6b`, TM-03
`9ab91bb7`, TM-07 `5f3634ad`, TM-04 `84f11381`.

Remaining gates (coordinator/root, not this review): CI/full suites
remotely; Stream desktop/compact-web + native captures, Korean locale,
label/retention decisions; Native Find 10-point device pass; queue-UI
browser/native captures; provider-credential E2E; voice device
capture/playback, real-provider, and live-home migration; keep parent P6
worktree at `e423a8666` until root picks a basket; no live-manifest edits,
custom/mine moves, daemon restarts, pushes, or TM-05/06/08 scope.
