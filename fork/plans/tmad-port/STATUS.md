# tmad port — handoff status (2026-10-02)

Plan: [../tmad-maintained-port-plan.md](../tmad-maintained-port-plan.md). Briefs in `briefs/` were written for
neptune workers: read `/tmp/tmad-port/...` as this directory and `/Volumes/offload/neptune/repos/paseo` as the
local checkout on the host running the work. `~/.paseo-fork/manifest.txt` is frozen in
`evidence/manifest-frozen-2026-10-02.txt`; never edit a live manifest.

| ID | Branch (origin) | Base | State |
| --- | --- | --- | --- |
| P0 | `tmad-port/baseline-assembly` | frozen manifest SHAs in `evidence/P0-inputs.txt` | Baseline assembly merged in a scratch clone; feature map done (`evidence/P0-feature-map.md`). Worker died before build/typecheck/lint/focused tests and `P0.md`. Remaining: brief-P0 steps 2 (verify vs frozen mine), 4, 6 and the report. |
| TM-01 Stream | `intake/tmad-stream-flow` | `v0.11.0-beta.3` | One WIP commit (`--no-verify`): source core files at PR #19 (`af247e4f4`, blobs verified) plus partial protocol/agent-manager/authorization seams. Not typechecked. Remaining: finish PR19 commit, the PR19→#21 rehearsal commit, contract fixes, tests, report. |
| TM-07 Native Find | `intake/tmad-native-find` | `v0.11.0-beta.3` | Complete per worker (`evidence/TM-07.md`), unreviewed. Needs independent review and native device evidence. |
| TM-02 queue daemon | `intake/tmad-message-queue` | custom `cbd1210c7` | Protocol wire contract committed (`6f76c621e`). Server store/service/wiring and tests not started; see `evidence/TM-02.md`. |
| P2, TM-03, TM-04 | — | — | Not started; briefs ready. |
| TM-05, TM-06, TM-08+ | — | — | Product decisions for the user; do not start. Typed-send default is also the user's call. |

Nothing has been pushed to `mine` or `custom`, no manifest was edited, and no daemon was restarted.
