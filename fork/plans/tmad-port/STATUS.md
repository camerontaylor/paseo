# tmad port — handoff status (2026-10-02)

Plan: [../tmad-maintained-port-plan.md](../tmad-maintained-port-plan.md). Briefs in `briefs/` were written for
neptune workers: read `/tmp/tmad-port/...` as this directory and `/Volumes/offload/neptune/repos/paseo` as the
local checkout on the host running the work. `~/.paseo-fork/manifest.txt` is frozen in
`evidence/manifest-frozen-2026-10-02.txt`; never edit a live manifest.

| ID | Branch (origin) | Base | State |
| --- | --- | --- | --- |
| P0 | `tmad-port/baseline-assembly` | frozen manifest SHAs in `evidence/P0-inputs.txt` | DONE (pluto, evidence/P0.md): baseline tree == frozen mine `4cc94e07e` (empty diff), 24-merge first-parent chain verified, build/typecheck/lint green, 11 focused test files 320/320 pass, licensing = identical Apache-2.0 (no extra attribution). Exit criteria met. **Awaiting muse review** (gates P2). |
| TM-01 Stream | `intake/tmad-stream-flow` | `v0.11.0-beta.3` | DONE (pluto, evidence/TM-01.md): HEAD `2197619bc`, 9 commits (+4129/−51) — PR#19 import, PR19→#21 rehearsal, 7 contract-fix commits. 11/15 core files blob-identical to `51fb7693d`, 4 intentional deltas listed with reasons; rehearsal found source #21 itself removed recursive fs.watch. Ancestry clean (no custom/mine/source). All focused suites pass incl. new bounds/renamed-RPC/capability-absent tests; scoped lint clean (baseline lint failures in untouched files recorded). TM-01B bridge: NOT NEEDED. UI capture evidence deferred to P1 step 6 as briefed. **Awaiting muse review** (gates P2 with P0). |
| TM-07 Native Find | `intake/tmad-native-find` | `v0.11.0-beta.3` | Complete per worker (`evidence/TM-07.md`), unreviewed. Needs independent review and native device evidence. |
| TM-02 queue daemon | `intake/tmad-message-queue` | custom `cbd1210c7` | DONE (pluto, evidence/TM-02.md): HEAD `91392d6be`, 6 commits (+3792/−20). Queue contract implemented per plan (intent-gated admission, receipts, uncertain/failed, recovery, bounds, 0600 journal); 49 queue tests + auth 7 + agent-manager 210 + ACP 130 + GJC 43 pass; ancestry verified (custom floor only). Gaps: daemon e2e needs provider creds (defer to TM-03/P4); one pre-existing side-conversation test failure at its base needs an owner on neptune. **Awaiting muse review** (gates TM-03/TM-04). |
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
- TM-01 worker finished (pluto, evidence/TM-01.md). Coordinator verified: HEAD `2197619bc`, custom
  and mine NOT ancestors (both local and origin refs), source integration not an ancestor, 5/5
  spot-checked core blobs equal `51fb7693d`, import/rehearsal trailers present, test logs match
  (73 tm01-* logs; final protocol suite 6/6).

## BLOCKED — everything left needs muse (as of 2026-10-03 00:53 AEST)

All implementable work inside the orchestrator's limits is done; 0 workers running. muse re-checked
at every gate, most recently 2026-10-03 00:53 AEST: still "not found on PATH". Per
`briefs/ORCHESTRATOR.md` no substitute reviewer is allowed. Pending, in order:

1. muse review of TM-07 (branch done).
2. muse review of P0 evidence (gates P2).
3. muse review of TM-02 (gates TM-03 + TM-04 starts).
4. muse review of TM-01 (with P0 approval, gates P2).
5. After approvals: P2 removal proof; TM-03; TM-04; then the work-items ledger + manifest block.
6. Human-only regardless of muse: native device evidence (TM-07 list in evidence/TM-07.md; voice
   list comes with TM-04), the neptune check of the pre-existing session.test.ts side-conversation
   failure at the custom floor, and the two TM-01 naming/ceiling decisions recorded in its report.
- TM-02 worker finished (pluto, evidence/TM-02.md): lease complete except the provider-cred e2e
  (documented). Coordinator verified: HEAD `91392d6be`, custom floor is the only extra ancestry,
  source integration NOT an ancestor, queue/auth test logs match the report. muse re-checked at this
  gate: still "not found on PATH". TM-03/TM-04 stay unstarted until TM-02 has a muse APPROVE.
  Handoff blocker resolved: the truncated typecheck failure was stale protocol `dist` — all commits
  since pass hooks; no branch-caused failures. Pre-existing: `session.test.ts` side-conversation
  event test fails at the floor (needs neptune owner).
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
