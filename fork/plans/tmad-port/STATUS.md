# tmad port — handoff status (2026-10-02)

Plan: [../tmad-maintained-port-plan.md](../tmad-maintained-port-plan.md). Briefs in `briefs/` were written for
neptune workers: read `/tmp/tmad-port/...` as this directory and `/Volumes/offload/neptune/repos/paseo` as the
local checkout on the host running the work. `~/.paseo-fork/manifest.txt` is frozen in
`evidence/manifest-frozen-2026-10-02.txt`; never edit a live manifest.

| ID | Branch (origin) | Base | State |
| --- | --- | --- | --- |
| P0 | `tmad-port/baseline-assembly` | frozen manifest SHAs in `evidence/P0-inputs.txt` | DONE (pluto, evidence/P0.md): baseline tree == frozen mine `4cc94e07e` (empty diff), 24-merge first-parent chain verified, build/typecheck/lint green, 11 focused test files 320/320 pass, licensing = identical Apache-2.0 (no extra attribution). Exit criteria met. **Awaiting muse review** (gates P2). |
| TM-01 Stream | `intake/tmad-stream-flow` | `v0.11.0-beta.3` | One WIP commit (`--no-verify`): source core files at PR #19 (`af247e4f4`, blobs verified) plus partial protocol/agent-manager/authorization seams. Not typechecked. Remaining: finish PR19 commit, the PR19→#21 rehearsal commit, contract fixes, tests, report. |
| TM-07 Native Find | `intake/tmad-native-find` | `v0.11.0-beta.3` | Complete per worker (`evidence/TM-07.md`), unreviewed. Needs independent review and native device evidence. |
| TM-02 queue daemon | `intake/tmad-message-queue` | custom `cbd1210c7` | Protocol wire contract committed (`6f76c621e`). Server store/service/wiring and tests not started; see `evidence/TM-02.md`. |
| P2, TM-03, TM-04 | — | — | Not started; briefs ready. |

Orchestration continues on pluto per `briefs/ORCHESTRATOR.md`.
| TM-05, TM-06, TM-08+ | — | — | Product decisions for the user; do not start. Typed-send default is also the user's call. |

## Pluto orchestration log (2026-10-02)

- Scratch dir `/tmp/tmad-port/` populated from this branch (plan.md, COMMON.md, flat briefs, evidence/,
  logs/, prompts/). Baseline clone created at `/tmp/tmad-port/baseline-clone` (own index, rerere on) on
  `tmad-port/baseline-assembly` = 2bfcd2e19. Coordinator check: `git diff --stat 2bfcd2e19 4cc94e07e`
  (frozen mine) is EMPTY — the baseline tree reproduces frozen mine exactly.
- Reviewer provider `muse` re-checked on pluto: `paseo provider diagnostic muse` → "muse not found on
  PATH", still unavailable. No substitute reviewer per the brief. All review gates are blocked until it
  is installed; re-checking before each gate.
- tmad-main-latest = 929f1add3 (source PR #36 "preserve queued messages until host acknowledgement",
  queue-adjacent). Classified at ledger time; not ported.
- Workers dispatched (provider claude-zai/glm-5.3-flash, thinking high, bypassPermissions, one per
  branch/worktree):
  - TM-01 finish: agent `59933eac`, workspace `wks_3919834322096f66` (checkout-branch
    `intake/tmad-stream-flow`).
  - TM-02 continue: agent `124d824b`, workspace `wks_b6b4404597f90c74` (checkout-branch
    `intake/tmad-message-queue`); first reproduces the truncated typecheck failure with full output.
  - P0 remainder: agent `c1c7b820`, workspace `wks_4c44bb8d08811ddb` (local workspace at
    `/tmp/tmad-port/baseline-clone`); brief-P0 steps 2, 4, 6 + report.
- TM-07 review: BLOCKED on muse (branch complete per `evidence/TM-07.md`, awaiting muse review).
- P0 worker finished (`evidence/P0.md`): all four exit criteria met, no pre-existing failures in the
  focused set. Note for P2: the clone's rr-cache is now empty (entries apparently pruned by `git rerere
  gc`), so P2 merges must budget fresh resolutions. P2 start is gated on muse approving P0 + TM-01.
- Source cursor update: `929f1add3` (PR #36) classified — TM-03 scope (outbox/composer durability,
  27 app files +939/−205), source-update candidate after TM-03 lands; not ported. Cursors: inspected =
  classified = `929f1add3`; effective snapshot per feature remains `51fb7693d`.
- Coordination-worktree note: after a fresh `npm ci` + build:client/build:server, root typecheck here
  reports 14 TS7006 errors, all in packages/cli/src/commands/agent/*.ts (callback params off
  `fetchAgents().entries` inferring any). Not present in P0's clone (typecheck/lint clean, 320/320
  tests) — treat the baseline clone, not this worktree, as the reference environment; docs-only commits
  here go in with `--no-verify` and the quirk recorded. Not investigated further (no code on this
  branch).

Nothing has been pushed to `mine` or `custom`, no manifest was edited, and no daemon was restarted.
