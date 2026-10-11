# C2 partial-deploy CI expectations — local working log (excluded)

Scope: carry-test exception **C2-GATE-EXC-3**. Test-only delta in the partial-deployment candidate's failing paths, applied on
`fork/tmad-refresh-stream-durability-0.11.1`. Not a package or basket gate; production is unchanged.

Started 2026-10-12 (local) by the Jcode coordinator acting as the single implementation worker for this delta.

## Pre-edit state (verified before any change)

- Worktree `/home/ctaylor/.paseo/worktrees/3rzqjhby/c2-ci-expectations`, branch `fork/tmad-refresh-stream-durability-0.11.1`, head `2671a9f624ada1e85b3d588bc965def5c7e06553`. Clean tree.
- Parent audit: `git merge-base HEAD fork/tmad-0.11.1` = `139e0c81e8eb51b0f97551171b2217838c3ebab5` = frozen tmad head recorded in [execution-start.md](../execution-start.md). Matches.
- Plan sha256 re-verified: `abfe87512f35907382ff559d59a6a5c102ceff28290bb09faf62d16ed0605c53`.
- Coordinator sign-off for C2-GATE-EXC-3 is recorded **before** any edit at [execution-start.md:90-94](../execution-start.md) (uncommitted control record, together with the ledger and the C2 log).
- `packages/app/src/sidebar-nav/model.ts:11` — `header: ["new-workspace", "history", "search", "stream", "schedules"]`, so the builtin Stream precedes schedules.
- `packages/client/src/connection/index.ts` — `DEFAULT_CLIENT_CAPABILITIES` includes `[CLIENT_CAPS.globalStream]: true` under `COMPAT(globalStream) … added in v0.11.1-fork (C2)`; `packages/protocol/src/client-capabilities.ts:68` defines `globalStream: "global_stream"`.

## Approved behavior under test

1. `global_stream: true` is a default client hello capability (C2).
2. The sidebar header builtin `stream` precedes `schedules` in the default order and follows the same persisted-order/append rules as every other builtin.

## Remote evidence (candidate `568b12127`, Fork CI run 38150800919)

- SDK: `packages/client/src/daemon-client.test.ts` — 1 failed / 166 tests in the file; suite 1 failed | 243 passed (244). `advertises client capabilities in hello` at `:1019` — received capability map has one extra key, `global_stream: true`.
- App: `packages/app/src/sidebar-nav/model.test.ts` — 9 failed / 665 files; suite 9 failed | 6117 passed (6126). Every failure is an extra `stream` entry in an expected exact array (`toEqual`), plus the shifted plugin index in the first test.
- Logs: `/home/ctaylor/.jcode/scratch/partial-deploy-ci-sdk.log`, `/home/ctaylor/.jcode/scratch/partial-deploy-ci-app.log`.

## Failing-first evidence (local, pre-edit, both complete files)

Worktree deps: `npm ci` with `ONNXRUNTIME_NODE_INSTALL=skip ELECTRON_SKIP_BINARY_DOWNLOAD=1` (exit 0,
`/home/ctaylor/.jcode/scratch/c2-ci-npm-ci.log`). Declarations rebuilt with `npm run build:server` (exit 0, 4m26s,
`/home/ctaylor/.jcode/scratch/c2-ci-build-server.log`).

| Run | Command (cwd) | Result |
| --- | --- | --- |
| SDK before | `npx vitest run src/daemon-client.test.ts` (packages/client) | **1 failed / 165 passed (166)** — `advertises client capabilities in hello`, missing `global_stream` |
| App before | `npx vitest run --project unit src/sidebar-nav/model.test.ts` (packages/app) | **9 failed / 10 passed (19)** — the same nine tests as remote |

Logs: `c2-ci-sdk-before.log`, `c2-ci-app-before.log`. Both reproduce the remote failure set exactly.

## Delta applied (test-only, explicit expectations)

- `packages/client/src/daemon-client.test.ts:1041` — add `global_stream: true` to the exact hello capability map, next to the other `COMPAT` fork capabilities.
- `packages/app/src/sidebar-nav/model.test.ts` — add the explicit `stream` entry to nine expected arrays (`:45, :76, :96, :115, :145, :169, :196, :236, :249`), and move the plugin index assertion at `:49` from `items[4]` to `items[5]`, keeping its exact object check.

No fixture, visibility, order, or plugin assertion was changed; no matcher was weakened (`toEqual`/exact objects kept); no expected value is derived from production code.

## Post-edit evidence

| Run | Result |
| --- | --- |
| `npx vitest run src/daemon-client.test.ts` (packages/client) | **166 passed / 166**, exit 0 |
| `npx vitest run --project unit src/sidebar-nav/model.test.ts` (packages/app) | **19 passed / 19**, exit 0 |
| `npm run typecheck` | exit 0 (2m51s) |
| `npm run lint` | exit 0 — 0 warnings, 0 errors (4739 files) |
| `npm run format` | exit 0 — 5083 files, only the two intended files dirty |
| lefthook pre-commit | green — format 1.02s, lint 1.75s, typecheck 154.81s |

Logs: `c2-ci-sdk-after.log`, `c2-ci-app-after.log`, `c2-ci-typecheck.log`, `c2-ci-lint.log`, `c2-ci-format.log`.

## Commit and push

`94fbbd6a416fb71e2fd36eb539c25560a73718f6` — `test(client,app): Expect the global Stream capability and sidebar builtin`, on top of
`2671a9f62`; 2 files, +11/−1. Source trailer `tmad4000/paseo@0aded86cd`; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Push: `2671a9f62..94fbbd6a4 fork/tmad-refresh-stream-durability-0.11.1` (fast-forward, that ref only). No other ref pushed; no
cherry-pick or merge into the candidate; integration stays with the coordinator.

## Deviations

- The task specified only the two test files; nothing else was touched. No production change. No broad suite, no system install,
  no daemon contact.

## Advisor verdict — ADVANCE (Sol `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff`, 2026-10-12)

Request prompt: `/home/ctaylor/.jcode/scratch/c2-ci-advance-request.md`; send record
`/home/ctaylor/.jcode/scratch/c2-ci-advance-response.log` (agent completed). Verbatim, via
`paseo logs 3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff --tail 1 --filter text`:

> **ADVANCE — C2-GATE-EXC-3 at `94fbbd6a416fb71e2fd36eb539c25560a73718f6`.**
>
> Verified the two-file test-only diff, frozen-tmad merge-base, and recorded coordinator sign-off. Literal Stream expectations preserve ordering and visibility; the plugin assertion remains exact (`model.test.ts:50`), and hello gains only `global_stream: true` (`daemon-client.test.ts:1041`). No fixtures or matchers were weakened.
>
> Accepted the reported failing-first results, **166 client + 19 sidebar tests passing**, and clean checks; I did not rerun them.
>
> No required deltas. Coordinator may integrate into both paths and rerun remote gates on the new exact SHA. Release verdict and `mine` push remain pending.

Outcome: no required deltas. Integration into both paths and the remote-gate rerun on the new exact SHA belong to the
coordinator; this delta's work is closed at head `94fbbd6a4`.

## Held combined-candidate browser failures — read-only diagnosis (2026-10-12)

Requested by the coordinator: diagnose the two candidate-only browser failures using source and saved logs only, no
edits/builds/tests/install/config. Full report: `/home/ctaylor/.jcode/scratch/c2-browser-diagnosis.md`.

Inputs: held candidate `568b12127` (release `d62ed60c8` + C1 + C2 + A1); logs `partial-deploy-ci-failed.log`,
`partial-deploy-baseline-failed.log`; sources read from git objects of both SHAs (candidate worktree was already at the A1-only
staging `929d74271`, so `git show 568b12127:<path>` was used). No worktree was modified.

Verified pass/fail split (both pass at baseline, both fail twice on the candidate):
`agent-message-submission.spec.ts:1296` (10s `toHaveCount(2)` on "Send queued message now", got 0) and
`sidebar-nav-settings.spec.ts:82` step `:113` (order poll expected schedules above search, got search above schedules).

### Cause 1 — queue: stale acceptance assertion left by C1, not message loss

- The gate holds both `send_agent_message_request` frames and then closes the socket with code 1008
  (`e2e/support/helpers/agent-message-gate.ts:41-63`), so both submissions reject.
- The send-now failure path (byte-identical at baseline) re-enqueues through the durable outbox
  (`composer/index.tsx:2244-2263` → `composer/actions.ts:575-626`), which writes the outbox entry and fire-and-forgets the flush
  and deliberately writes **no** optimistic session row.
- The restored row therefore comes from the outbox overlay (`composer/queue-sync.ts:90-112`, `composer/index.tsx:2912-2916`) and
  is marked pending by `getPendingQueueMessageIds` (`queue-sync.ts:118-127`, `index.tsx:1380-1383`).
- C1's new row gate hides edit/send-now for pending rows
  (`composer/queued-message-row.tsx:259-282`: `canEditOrSend = !isPending && !removalBlocked && deliveryState ∈ {undefined,
  pending}`) and renders "Waiting to sync with host" instead (`:774`). This is the documented contract
  (`docs/queue-mirroring.md:64`: waiting-to-sync rows "cannot be edited or sent").
- Baseline passes because `queueComposerMessageOnServer` there wrote an optimistic queued row first and kept it on enqueue failure
  (`d62ed60c8:composer/actions.ts:550-609`), and its overlay re-appended only *failed* entries
  (`d62ed60c8:composer/index.tsx:2806-2830`); baseline has no `getPendingQueueMessageIds`/`isPending` at all.
- C1 changed no e2e file (`git diff --stat d62ed60c8 568b12127 -- packages/app/e2e` → only `global-stream.spec.ts`,
  `support/helpers/seed-client.ts`), and no spec references the waiting-to-sync state.
- The controls return only after the host acks the re-enqueue, which needs a reconnect: the outbox flushes on every status/server_info
  (`contexts/session-context.tsx:626-643`, `composer/index.tsx:1746-1764`). The test never reconnects inside its 10s window.
- Open (needs a run, not done): whether an explicit reconnect + flush + ack restores the controls in budget. If not, it is a
  production defect in C1's re-enqueue/reconnect path and goes back to Sol before implementation.

### Cause 2 — sidebar: stale key map and click distance vs the approved C2 Stream builtin

- `sidebar-nav/model.ts:11` puts `stream` before `schedules`; the row renders (`components/sidebar/sidebar-nav-rows.tsx:157-175,197-203`)
  and the settings list renders it too (`screens/settings/sidebar/sidebar-nav-section.tsx:109,125`).
- The spec helper knows only four keys (`e2e/support/helpers/sidebar-nav-settings.ts:9-16,33-40`) and measures only the keys it is
  given (`:144-162`), so the new row is invisible: one move-up swaps schedules with Stream and leaves it below Search — exactly the
  received array. Three move-ups are now needed to lift schedules above history.
- Second, unreached failure in the same test: `:136-141` `expectStoredSidebarNav` lists four entries, but `toPreferences`
  (`sidebar-nav/model.ts:145-169`) writes all five resolved items.

### Proposed narrow fix (test-only; no production change; for advisor preflight)

- Sidebar: add `stream` to the helper's row map/labels and to the default/settings order expectations; extend the move step to the
  real distance with an intermediate-order assertion per click (rename to three clicks); add the explicit stored `stream` entry.
  Strictly stronger than today; same class as the approved C2-GATE-EXC-3 unit-test additions.
- Queue: keep `expectQueuedSendFailuresRestored(page, prompts)` as the final acceptance, but reach it by asserting the
  waiting-to-sync restore state immediately after the disconnect (two rows with the prompts, 0 send-now buttons, no user-message
  rows), then reconnecting and waiting for the outbox flush + host ack. Needs a reconnect affordance in
  `agent-message-gate.ts` (today only `accept`/`disconnect`), matching the `restoreFresh()` pattern already used in the same spec.
  The two-send acceptance and no-user-message assertions are preserved, not weakened. A product change (sendable waiting-to-sync
  rows) is not proposed: it contradicts `docs/queue-mirroring.md:64` and needs a new exception.

Stopped here as instructed: no edits, no builds, no tests, no coordinator overlap. Report is ready for the coordinator to route to
Sol; I did not message Sol.
