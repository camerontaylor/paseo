# tmad port orchestrator brief (pluto)

You orchestrate the rest of the tmad port plan on pluto. You do not write feature code yourself:
you dispatch implementers, route their output to review, integrate status, and push branches.

Read first, in this order: `fork/plans/tmad-maintained-port-plan.md`, `fork/plans/tmad-port/STATUS.md`,
`fork/plans/tmad-port/briefs/COMMON.md`, every other brief in `briefs/`, and `evidence/*`. Also the repo
CLAUDE.md and docs it points to for the area at hand.

## Environment on pluto

- Repo: `~/repos/paseo` (origin = camerontaylor/paseo). Source objects are present:
  `refs/research/tmad-main` = frozen source snapshot f0d5507d2; `refs/research/tmad-main-latest` = 929f1add3
  (one newer source commit; classify it in the ledger, do not port it unless the plan's update loop selects it).
- You run in a worktree on branch `tmad-port/coordination`. Keep STATUS.md and evidence there; commit and
  push it after every phase change.
- Path translation for the briefs (they were written on neptune): `/tmp/tmad-port/` -> a scratch dir
  `/tmp/tmad-port/` on pluto that you populate from this branch (`briefs/*`, `evidence/*`, `plan.md` copy of
  the plan); `/Volumes/offload/neptune/repos/paseo` -> `~/repos/paseo`; `~/.paseo-fork/manifest.txt` ->
  `evidence/manifest-frozen-2026-10-02.txt`; the P0 baseline clone -> make a separate clone at
  `/tmp/tmad-port/baseline-clone` and check out `tmad-port/baseline-assembly` (the already-merged frozen
  baseline). Put this translation at the top of every worker prompt.
- The Paseo daemon on pluto port 6767 is the one running you. NEVER restart, stop or rebuild it.

## Workers

- Implementers: provider `claude-zai`, model `glm-5.3-flash`, thinking high, bypass/unattended mode.
  One worker per branch, each in its own Paseo worktree workspace created with checkout-branch mode on the
  existing branch (`intake/tmad-stream-flow`, `intake/tmad-native-find`, `intake/tmad-message-queue`), or
  branch-off from the declared base for new branches (`intake/tmad-queue-ui` and `intake/tmad-voice-flow`
  from `intake/tmad-message-queue`). Never point two workers at one branch at once.
- Reviewers: provider `muse` (Muse Code), a `muse-spark` model (list models for `muse` to get the exact ID,
  e.g. `meta/muse-spark-1.3`), read-only task: review the branch diff against its declared base for
  correctness against the plan's contracts and the brief, and verify the worker's evidence claims (blob
  matches, tests actually run, ancestry). Reviews return APPROVE or ITERATE with concrete findings; send
  ITERATE findings back to an implementer on the same branch, then re-review. A phase is done only after an
  APPROVE.
- If `muse` is unavailable (on 2026-10-02 it was not installed on pluto: "muse not found on PATH"), do not
  substitute another reviewer. Mark the branch "awaiting muse review" in STATUS.md, keep implementing
  independent work, and re-check the provider before each review gate. If everything left is blocked on
  review, stop and say so.
- Workers die sometimes. On a dead or stalled worker: commit its partial state with a `wip(...)` commit
  (`--no-verify` allowed only for WIP), record it in STATUS.md, and start a fresh worker from the branch.
- Keep at most 4 implementers running at once. Wait on finish notifications; do not poll in tight loops.

## Order of work

1. Now, in parallel: TM-01 finish (brief-TM01; the branch has a WIP commit of the PR #19 core files — the
   worker should restructure it into the PR #19 import commit, then the PR19->#21 rehearsal commit, then
   contract-fix commits; rewriting this branch's unreviewed WIP history is allowed), TM-02 continue
   (brief-TM02 plus evidence/TM-02.md remaining list; first reproduce the pre-commit typecheck failure with
   full output), P0 remainder (brief-P0 steps 2, 4, 6 and the report, on the baseline clone), and the muse
   review of TM-07.
2. After TM-01 and P0 are approved: P2 (brief-P2).
3. After TM-02 is approved: TM-03 and TM-04 (briefs exist), each then reviewed.
4. Then create `fork/plans/tmad-port-work-items.md` (the ledger the plan describes; precedent format:
   `fork/plans/infi-pc-intake-work-items.md`) from all evidence, and the proposed manifest append block.

## Limits (from the plan; these need the user)

- Do NOT push to `mine` or `custom`, edit any live manifest, run desvio against a live config, or deploy.
- You MAY push `intake/tmad-*` and `tmad-port/*` branches to origin after each reviewed milestone.
- Do NOT start TM-05, TM-06, TM-08+, and do not change the typed-send default; those are user decisions.
- Device evidence (native Find on iOS/Android, voice mic/playback/background) cannot be produced here:
  list exactly what a human must check.
- Never run full test suites; only specific files, as COMMON.md says.

Finish with STATUS.md describing each branch: HEAD, review verdict, remaining human checks, and the
proposed manifest lines. Push the coordination branch.
