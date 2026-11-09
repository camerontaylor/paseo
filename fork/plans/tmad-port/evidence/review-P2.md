APPROVE

# Review: P2 with/without-Stream assembly + removal proof + rollback — report under audit `/tmp/tmad-port/evidence/P2.md` including Addendum 2

Reviewer: read-only audit on pluto. No file edited except this report. No npm ci,
installs, builds, or tests executed. No commits, pushes, or ref modifications.
All verification via read-only git commands (`rev-parse`, `cat-file`, `diff`,
`log`, `merge-base`, `rev-list`, `grep`, `show`) inside `/tmp/tmad-port/baseline-clone`,
reading source files at pinned refs, and reading implementer logs under
`/tmp/tmad-port/logs/` and scratch data under `/tmp/tmad-port/rollback-home`.
Anything requiring code execution is marked "not verifiable read-only".

Inputs read first, in order: `/tmp/tmad-port/COMMON.md`, `/tmp/tmad-port/plan.md`
("Branch and removal contract", P1 steps 4–5, P2, Stream compatibility contracts),
`/tmp/tmad-port/brief-P2.md`, `/tmp/tmad-port/evidence/P2.md` (report under audit,
headline through Addendum 2), plus `evidence/P0.md` (+ coordinator post-review note),
`evidence/TM-01.md` (+ post-P2 addendum), `evidence/review-TM-01.md` (APPROVE),
`evidence/review-TM-01-delta.md` (APPROVE), `/tmp/tmad-port/stream-rollback.md`
(note: lives at top level, not `evidence/` as the task description suggests),
and the draft manifest block in `STATUS.md`.

Final assembly under review: branch `tmad-with-stream` = `0ff83cbc5e31f4ec16e4b28c0694230c4a83debd`
(Addendum 2 rebuild; interim `d17896891` assembly superseded, branch deleted, commit object retained).
Clone verified clean on `tmad-with-stream` at review time.

## 1. With-stream assembly — PASS

- `git rev-parse tmad-with-stream` = `0ff83cbc5…` ✔; base `tmad-port/baseline-assembly` =
  `2bfcd2e19…` (unchanged frozen P0 baseline) ✔; `intake/tmad-stream-flow` = `a8241e535…` ✔.
- Merge structure: `git log --format='%H %P'` on `0ff83cbc5` → parents exactly
  `2bfcd2e19` (baseline) + `a8241e535` (TM-01 tip). Single merge, `--no-ff` shape ✔.
- `git log --oneline tmad-port/baseline-assembly..tmad-with-stream` → **11 lines**:
  the merge + TM-01's 10 commits (9 original + `a8241e535` seam fix). No extra assembly
  commit — the fix arrives inside the merged branch ✔.
- Superseded-assembly redundancy: `d17896891` still resolves
  (`d178968919e66e9bc32e5d8b9e34e389baacb343`); `git diff d17896891 0ff83cbc5` →
  **empty, exit 0**. Rebuilt tree is byte-identical to the tree that passed the full P2
  battery; only the graph changed ✔.
- Fallback path (had the object been gone) not needed, but the equivalent check was also
  run: `git diff <baseline> tmad-with-stream --stat` = 53 files, and the sorted name list
  is **identical** (`diff` empty) to `git diff 6166a7aca a8241e535 --name-only` — exactly
  the 53 TM-01 paths ✔.

## 2. Removal proof — PASS

- Removal assembly = `tmad-port/baseline-assembly` itself (Stream appended, not interwoven;
  the self-diff trivially empty — stated honestly as definitional, not as evidence).
- Substantive check re-run: with-stream minus baseline = 53 files, `+4135/−51`, and the
  path set is byte-identical to TM-01's own 53-file delta (see §1). Zero non-TM-01 paths;
  no bridge line exists ✔.
- Baseline cleanliness: `git grep -E 'companion-stream|AgentArtifact|companionEntries|companionStreamPortV1'
  tmad-port/baseline-assembly -- 'packages/**'` → **0 hits** ✔. (A bare `grep -l "companion"`
  returns 7 hits; each inspected — e.g. "desktop companion pane", "companion tools" test
  description — plain English, feature-irrelevant ✔.) Control direction (Stream files present
  on the with-stream tree) is established by the 53-path diff itself.

## 3. Ancestry on the new graph — PASS (all rows re-run)

| Ref → `0ff83cbc5` | Observed | Expected |
|---|---|---|
| base `6166a7aca` | ancestor ✔ | YES |
| `custom` `cbd1210c7` | ancestor ✔ | YES (via baseline) |
| all 24 frozen carries (P0-inputs.txt order) | all ancestors ✔ | YES |
| TM-01 `a8241e535` | ancestor ✔ | YES |
| frozen `mine` `4cc94e07e` | NOT ancestor ✔ | NO |
| source head `f0d5507d2` | NOT ancestor ✔ | NO |
| source integration `51fb7693d` | NOT ancestor ✔ | NO |

- Extra-commit set: `git rev-list 0ff83cbc5 --not <base> <24 carries> a8241e535` → **25
  commits** = the 24 baseline assembly merges + the new with-stream merge. Listed and
  eyeballed: second entry is `2bfcd2e19` (baseline tip), remainder are the 24 carry merges.
  Nothing unknown ✔.

## 4. TM-01 seam-defect handling — PASS

- Pre-fix failure confirmed in logs: `p2-test-agent-manager.log` → `210 tests | 1 failed`,
  FAIL on "does not replace a newer foreground turn after unavailable steer fallback is
  admitted"; isolated rerun `p2-test-agent-manager-rerun.log` fails the same single test
  deterministically (`1 failed | 209 skipped`) ✔. Matches the report's 209/210 account.
- Post-fix green confirmed: `p2-test-agent-manager-postfix.log` → 210/210 ✔; on the
  rebuilt tree `p2b-test-agent-agent-manager.log` → 210/210 ✔ and `p2b-test-steer-single.log`
  → `1 passed | 209 skipped` ✔.
- Fix routing verified in the graph: `2197619bc..a8241e535` = exactly the one commit
  `a8241e535`, whose parent is `2197619bc` on `intake/tmad-stream-flow` — the fix lives in
  the TM-01 branch, and the with-stream history contains exactly the merge + TM-01's 10
  commits with **no assembly-side fix commit** ✔ (this is precisely what the brief required:
  fix in the branch, not in the assembly).
- Source fidelity of the call site re-checked: `git diff 51fb7693d a8241e535 --
  packages/server/src/server/agent/agent-manager.ts | grep -c 'isTurnTerminalEvent|shouldNotifyWaiters'`
  = **0** — no divergence remains at the terminal-event region ✔ (consistent with
  review-TM-01-delta's byte-equality finding; not re-litigated here).
- Mechanism/trace claims (ghost tracked run, await window) are taken from the P2 trace log
  and the deterministic pre/post-fix pair; the mechanism itself is not re-verifiable
  read-only, but the evidence pair (209/210 → 210/210 on identical trees modulo one hunk)
  is present in the logs and supports the claim.

## 5. Rollback exercise — PASS

- `/tmp/tmad-port/stream-rollback.md` read in full: coherent backup (`cp -a agents…`) +
  per-agent-ID Stream-field export procedure, disable step with expected-stripping warning,
  restore-only-Stream-fields rules (never replace whole record, skip deleted agents, don't
  clobber newer Stream fields, schema round-trip assertion), verification steps, and honest
  limits (point-in-time snapshot, last-write-wins on double-edit). Matches plan P2.4
  (backup/export before disabling; restore merges only Stream fields; no generic-storage
  change) ✔.
- Transcript confirmed in phase logs (not just the report's quote): write phase records
  `companionEntries: 2 artifacts: 1`; strip phase shows parse-level stripping
  (`present in file: true | after parse: false`) plus rewrite persistence and the
  disabled-window title rename; restore phase shows `title … preserved` with `restored: 2 | 1`
  and schema round-trip true ✔.
- Isolation: demo script (`logs/p2-rollback-demo.ts.txt`) hardcodes
  `HOME = "/tmp/tmad-port/rollback-home"`; the only `~/.paseo` mention is the "never …"
  guard comment. Scratch `rollback-home/` contains `agents/`, `backup/`, `stream-export.json`
  ✔. No live-home contact.

## 6. Conflict/merge record — PASS

- End state verified: merged `workspace-tab-menu.ts` contains **both** union members
  (`message-circle-plus` + `file-code-2`), both label keys (`newSideConversation`,
  `viewArtifacts`), both input props (`onStartSideConversation`, `onViewArtifacts`), and
  **zero** conflict markers ✔. The keep-both resolution is sound for the manifest context:
  the two icons belong to disjoint features (custom side-conversations vs Stream
  view-artifacts) sharing only a union position — a superset union preserves both behaviors
  with no semantic interaction.
- Replay consistency: `git diff d238504cf 0ff83cbc5 -- <workspace-tab-menu.ts>` → empty
  (the only inter-merge delta is the agent-manager fix hunk arriving via the branch).
  The rerere replay reproduced the original resolution bit-for-bit, consistent with the
  "inspected before keeping" account ✔.
- Report lists the single conflicted file with its resolution plus a 24-file clean-merge
  inspection table covering the plan-named shared seams (agent-panel, segmented-control,
  turn-footer, message, agent-stream/view, protocol/authorization/i18n maps). The
  conflict *count* (exactly one) itself rests on worker testimony — a merge commit does not
  record how many files conflicted — but every independently checkable artifact (union
  end state, replay identity, additive clean-merge claims spot-checked against the 53-path
  set) is consistent with it. No contradicting evidence found.
- Pre-commit hook on the rebuild merge green per `p2b-merge-commit.log` (format check,
  0-warning lint, full-workspace typecheck) ✔.

## 7. TM-01B decision ("not needed") — CONFIRMED

- The report's evidence holds: the only textual conflict resolves as a feature-disjoint
  union inside the merge (no custom/infi code involved); the one semantic fix restores
  reconciled-source semantics and compiles/passes on the release base alone (per the
  approved delta review: build/typecheck/lint green, 192/192 + 22/22 on the pure branch).
- Graph-level corroboration re-run here: the with-stream tree delta is exactly TM-01's
  53 paths (PATHS-IDENTICAL, §1) — the merge's non-TM-01 delta is nil beyond the merge
  itself, so no commit in the with-stream graph smuggles custom/infi code to make Stream
  compile standalone ✔.

## 8. Manifest block — PASS

- The FINAL block (Addendum 2) complies with the plan's append rules: existing order
  untouched ("retain their current order. APPEND BELOW THEM"), no insertion, TM-03/TM-04
  deferred with dependency-order notes, removal groups named per line (Stream; Queue+Voice;
  Native Find), TM-01B explicitly recorded as uncreated, TM-01 SHA refreshed to `a8241e535`
  with the fix's delta-reviewed status noted ✔.
- Consistent with STATUS.md's draft in structure and ordering; differs only in the TM-01
  SHA (draft still shows superseded `2197619bc`) and the added fix/verification notes —
  the expected update, not a contradiction. STATUS.md itself is the coordinator's file to
  refresh (see N1).

## Gate results audit (spot-checked, not re-run — read-only)

- Rebuild gates present and green: `p2b-build-server.log` (relay/highlight/plugin exit 0),
  `p2b-typecheck.log`, `p2b-lint.log` (0/0, 4604 files = 4589 baseline + 15 Stream files,
  consistent with P2's arithmetic), companion 12/12, collector 3/3, auth 7/7 ✔.
- Non-rerun justification accepted: tree equality (§1) makes the rebuilt tree the same
  artifact the full 23-file/411-test battery passed on; re-running everything would add no
  information. The seam-critical suites (agent-manager incl. isolated steer case) plus
  build/typecheck/lint were re-run on the final tree ✔.

## Findings

No blocking findings. Two non-blocking notes:

- (N1, non-blocking) `STATUS.md`'s draft manifest block still pins TM-01 at superseded
  `2197619bc`. Coordinator action: refresh to the Addendum 2 FINAL block (`a8241e535`)
  when recording this review. No P2 redo — the report already carries the correct block.
- (N2, non-blocking) The "exactly one textual conflict" claim, while consistent with all
  checkable artifacts, is not independently provable from the commit graph alone (merge
  commits don't record conflict counts). Future assembly reports could preserve the
  `git merge` stdout showing the conflicted-file list as a log file. Nothing to redo here:
  the resolution end state and replay identity both verify.

## Verdict rationale

Final assembly `0ff83cbc5` = frozen baseline + exactly one merge of TM-01 at its fixed tip;
rebuilt tree byte-identical to the fully-batteried interim tree; ancestry clean (carries +
TM-01 in, mine/source/integration out, 25-commit extra set exact); with-stream delta is
exactly the 53 TM-01 paths with a Stream-free baseline; the steer-fence defect is proven
fixed by the pre/post log pair and now lives in the TM-01 branch (no assembly-side commit);
rollback is a coherent export/restore-only procedure demonstrated on copied data with newer
non-Stream metadata preserved; the tab-menu resolution is a sound disjoint-union, replayed
identically; TM-01B correctly unneeded; the FINAL manifest block follows the plan's append
rules. → APPROVE.
