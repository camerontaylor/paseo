APPROVE

# Review: P0 frozen-baseline verification — report under audit `/tmp/tmad-port/evidence/P0.md`

Reviewer: read-only audit on pluto. No files edited except this report. No npm ci,
installs, builds, or tests run. No commits, pushes, or ref modifications. All
verification via read-only git commands (`rev-parse`, `cat-file`, `diff`, `log`,
`merge-base`, `rev-list`, `ls-tree`) in `/tmp/tmad-port/baseline-clone` and
`git -C /home/ctaylor/repos/paseo`, plus reading source files, the cited logs
under `/tmp/tmad-port/logs/`, and the actual LICENSE text.

Inputs read: `/tmp/tmad-port/brief-P0.md`; plan sections "Evidence and baseline",
"P0", "Source tracking"; `P0-inputs.txt`; `.baseline-merge-status.txt`;
`P0-feature-map.md`. (TM-07 material in the request is covered by the existing
`evidence/review-TM-07.md` (APPROVE) and is out of scope for this report.)

## 1. Reproducibility — CONFIRMED

- `git -C /tmp/tmad-port/baseline-clone diff --stat HEAD 4cc94e07e870e1461640ce3256d1db2d0ab1bc2f`
  → empty output, exit 0. Baseline tree == frozen mine tree. PASS.
- `HEAD` is `2bfcd2e19638484baf1651d69dc0be55df483bcd` (`2bfcd2e19`). Matches the
  report's claimed final HEAD. PASS.
- First-parent chain `6166a7aca..HEAD`: 24 commits, every one a 2-parent merge,
  unbroken first-parent linkage from the base, and each second parent equals the
  frozen carry SHA at that manifest position in `P0-inputs.txt` (verified
  position-by-position against all 24 lines, order multi-account → … →
  infi-project-pr-browser). 24/24 OK, 0 mismatches. The report prints this chain
  newest-first while listing manifest lines 1–24; both orders were checked and agree.
- Frozen-mine chain `6166a7aca..4cc94e07e`: independently re-verified — 24 merges,
  same manifest order, same second parents, 0 mismatches. Merge SHAs differ from
  the clone's (parallel assembly, as the report states); trees are equal per above.
- Extra-commit check: `git rev-list HEAD --not <base> <24 carries>` returns exactly
  the 24 assembly merges — I diffed that set against the first-parent chain set:
  IDENTICAL. Same holds for frozen mine vs its chain. "Nothing else" conclusion is
  correct. PASS.
- Delta-vs-base figure spot-checked: `git diff --stat 6166a7aca..HEAD` →
  `329 files changed, 31611 insertions(+), 772 deletions(-)`. Matches the report
  exactly. PASS.

## 2. Ancestry statement — CONFIRMED (all five rows re-run)

| Ref → baseline HEAD | Observed | Report claims | Verdict |
| --- | --- | --- | --- |
| base 6166a7aca | ancestor | YES | PASS |
| custom cbd1210c7 | ancestor | YES (manifest line 10) | PASS |
| frozen mine 4cc94e07e | NOT ancestor | NO | PASS |
| source head f0d5507d2 (full SHA; `refs/research/tmad-main` exists in the shared repo, absent by name in the clone — objects present, check run by SHA) | NOT ancestor | NO | PASS |
| source integration 51fb7693d | NOT ancestor | NO | PASS |

"No unknown branch ancestry" exit criterion: met.

## 3. Command-evidence audit — ALL CITATIONS MATCH

Every cited log exists; every tail shows the claimed result:

- `p0-npm-ci.log` (EXIT=0), `p0-build-server.log` (build:server EXIT=0),
  `p0-typecheck.log` (typecheck EXIT=0), `p0-lint.log`
  (0 warnings, 0 errors, 4589 files, 177 rules; lint EXIT=0). PASS.
- 11 `p0-test-*.log` files, each `1 passed` file with the exact claimed counts:
  7 + 210 + 6 + 56 + 4 + 9 + 10 + 5 + 6 + 4 + 3 = **320/320, 0 failures**.
  `p0-test-summary.txt` shows exit 0 for all 11. The report's 320/320 claim is
  arithmetically exact. PASS.
- `.baseline-merge-status.txt`: 1 aborted attempt on carry 3, clean restart, rerere
  replays on timigod/one-shot, bwestlund17/zcode, infi-plan-copy (+assisted
  infi-base-branch-contract) — consistent with the report's "21 clean, 3 replays +
  2 assisted" account. PASS.
- `p0-baseline-log.txt` head matches the report's 24-merge list. PASS.
- `P0-inputs.txt`: named anchors (base, tag, custom, tmad-main, 51fb7693d,
  af247e4f4, dd8a111c3, mine) and all 24 manifest SHAs verified against the
  objects used above. PASS.
- `p0-source-LICENSE.txt` is 211 lines, matching the claimed LICENSE length. PASS.

## 4. Licensing conclusion — SOUND

- `rev-parse 51fb7693d:LICENSE` = `rev-parse HEAD:LICENSE` =
  `2f5903143b08de0aa991ab535d9582aca6b9b44a`; `diff` of the two blobs is empty.
  Byte-identical claim CONFIRMED (read-only; nothing executed).
- LICENSE text read: "Copyright (c) 2025-present Mohamed Boudra", third-party
  components under their own licenses, remainder Apache-2.0. No top-level NOTICE
  file in the source snapshot; no per-file license headers on the inspected
  feature files (`companion-stream.ts`, `artifacts/collector.ts`,
  `companion-stream/model.ts` all begin with imports). The only NOTICE-named hits
  are pre-existing subpackage/operational files (e.g. `expo-two-way-audio/LICENSE`,
  provider notice toasts), not source-copyright notices requiring preservation.
  The §4(a)/§4(b)/(d) reasoning and the trailers-satisfy-change-notice conclusion
  are a fair reading of the actual text. No additional attribution required. PASS.

## 5. Exit criteria (plan) — ALL MET

- Reproducible baseline: yes (§1). Input SHA list: yes (`P0-inputs.txt`, verified).
  Feature/file map: yes (`P0-feature-map.md`; method spot-checked —
  `git diff --name-only 51fb7693d v0.10.0-beta.1` returns exactly **190** paths as
  the map states; TM-07 rows and FORK.md presence confirmed; post-integration
  range table covers the full span — see non-blocking note NB-2 on its header
  count). No unknown branch ancestry: yes (§2).
- "No pre-existing failures" claim: fairly scoped — the report says the *focused
  set* (11 files) carries no pre-existing failures and explicitly defers the
  broader verification matrix to P1/P2 gates (§Known gaps #3). Not overstated as
  written; later phases must still compare against this green result rather than
  assume it. No blocking overstatement found.

## Findings (all NON-BLOCKING — no claim fails, no redo required)

- **NB-1 (log hygiene): `p0-verify-mine-chain.log` ends with `VERDICT: FAIL`.**
  Contradicting evidence: every check line in that log is `OK` (24/24 second-parent
  matches), and I independently confirmed the extra-commit set == the 24 assembly
  merges (IDENTICAL). The FAIL string comes from a script bug in
  `p0-verify-mine-chain.sh`: it requires `extra == 0`, but the 24 assembly merges
  themselves are (correctly) reachable from mine and not from base+carries, so
  `extra` is 24 by construction. The report never cites the script's verdict
  string and its written conclusion is correct. Action: fix the script's verdict
  predicate (`extra == chain length` with set-equality) or annotate the log; do not
  re-run the assembly.
- **NB-2 (doc count): `P0-feature-map.md` says "29 commits" for
  `51fb7693d..f0d5507d2`, but its own table lists 31 rows and
  `git log --oneline 51fb7693d..f0d5507d2` returns 31 commits — row-for-row
  identical sets.** Content is complete; only the header number is wrong.
  Action: correct "29" → "31".
- **NB-3 (informational): clone `.git/rr-cache/` is absent (report says "empty").**
  `rerere.enabled=true` confirmed; working tree clean confirmed. Consistent with
  the report's warning that P1/P2 must re-copy a live rr-cache or budget fresh
  resolutions. No action for P0.

## Verdict rationale

Every P0 exit criterion reproduces read-only: tree equality, HEAD SHA, both 24-merge
chains with manifest-order second parents, all five ancestry rows, all log
citations with exact test arithmetic (320/320), LICENSE blob identity with the
reasoning checked against the real text, and the feature-map method/counts. The
three findings above are documentation/script-hygiene issues that contradict no
evidence and require no rework of the baseline. Per the brief, no code, manifest,
or daemon state was touched by the worker (clone working tree verified clean),
and none was touched by this review.

APPROVE — P0 baseline is frozen, reproducible, and correctly recorded; P1 may proceed.
