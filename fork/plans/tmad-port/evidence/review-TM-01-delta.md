APPROVE

# Delta re-review: TM-01 terminal-event seam fix — `2197619bc..a8241e535`

Reviewer: read-only audit on pluto. No file edited except this report. No npm ci,
installs, builds, or tests executed. No commits, pushes, or ref modifications.
All verification via read-only `git -C /home/ctaylor/repos/paseo` commands
(rev-parse, show, diff, log, merge-base, grep), reading source files at pinned
refs, and reading logs under `/tmp/tmad-port/logs/`. Anything requiring code
execution is marked "not verifiable read-only".

Inputs read first: `/tmp/tmad-port/plan.md` (Compatibility contracts, Source
tracking, Branch and removal contract, P1/P2), `/tmp/tmad-port/COMMON.md`,
`/tmp/tmad-port/brief-TM01.md`, `/tmp/tmad-port/evidence/TM-01.md` (incl. the
post-P2 addendum), `/tmp/tmad-port/evidence/review-TM-01.md` (prior APPROVE at
2197619bc), `/tmp/tmad-port/evidence/P2.md`.

## Identity (verified)

- Claimed HEAD `a8241e53530d6bd0a958971118d6b8b57ff80b0c` resolves exactly ✔
- `git log --oneline 2197619bc..intake/tmad-stream-flow` → exactly one commit:
  `a8241e535 fix(server): restore fire-and-forget artifact collection at the
  terminal-event seam` ✔ (one commit appended, no rewrite)
- Single parent `2197619bc4a656104e5ab5738de026e1c8353c0e` (not a merge) ✔
- `2197619bc` is an ancestor of the branch tip ✔
- Ancestry still clean at new HEAD (`merge-base --is-ancestor`, all NOT ancestors):
  `cbd1210c7` (custom) ✔, `4cc94e07e` (mine) ✔, `51fb7693d` (source) ✔ —
  the branch remains release-based; the fix imports no foreign ancestry.

## 1. Delta scope — PASS

`git diff 2197619bc..intake/tmad-stream-flow`: **1 file,
`packages/server/src/server/agent/agent-manager.ts`, +4/−1, single hunk**:

```diff
     if (isTurnTerminalEvent(event)) {
-      await this.collectArtifactsForTurn(agent);
+      // Artifact collection walks the working directory. Never hold the turn's waiters
+      // on it: upstream settles and notifies at the terminal event, and a steer or
+      // replace admitted during the walk must see the run already settled.
+      void this.collectArtifactsForTurn(agent);
     }
```

Nothing else touched. The delta is exactly what the fix requires.

Seam fidelity vs reconciled source `51fb7693d` (line 4012):
- Extracted source lines 4008–4013 vs port lines 3962–3967: `diff` → **BYTE-EQUAL**
  (`void` + the two-line rationale comment, verbatim).
- Stronger check: `git diff 51fb7693d a8241e535 -- <agent-manager.ts>` contains
  **no hunk mentioning `isTurnTerminalEvent` or the `shouldNotifyWaiters` terminal
  region** — the whole dispatch seam now matches source; the P2-reported
  `await` divergence is gone.
- The port's separate intentional method relocation remains elsewhere in the file
  and is untouched by this delta: the full-file source-vs-port diff shows
  `collectArtifactsForTurn` only as a `-` block at the source position and an
  identical `+` block beside the backfill helper (bodies identical; pure move,
  pre-existing and documented in the TM-01 seam table). All other full-file hunks
  are pre-existing beta.3-vs-source-base differences (imports, interfaces), none
  introduced by this delta.
- The addendum's archived diff (`/tmp/tmad-port/logs/tmad-seam-vs-source.diff`,
  header `c40f776a6..0ec670ac8`) is genuine: target blob `0ec670ac8` equals
  `rev-parse a8241e535:<file>`, and its only `collectArtifacts*` entries are the
  relocation pair — no call-site divergence remains.

## 2. Commit message — PASS

- Local-fix framing ✔ ("TM-01's port changed the source's …", "Restores the
  reconciled source semantics", "Assembly semantic resolution").
- Cites the source line ✔ (`51fb7693d:4012`).
- Carries `Port-Feature: TM-01` ✔, carries **no** `Source-Commit` trailer ✔
  (local fixes stay separate from imports per COMMON.md; `grep -i Source-Commit`
  on the message is empty).
- Non-blocking nits (N1/N2 below): a stale P2-assembly sentence copied verbatim,
  and trailer-block contiguity. Neither affects code or provenance tooling that
  greps the trailer line.

## 3. Evidence audit — PASS

Addendum claims vs logs (all under `/tmp/tmad-port/logs/`):

| Claim | Log | Result |
|---|---|---|
| agent-manager 192/192 on pure branch | `fix-agent-manager-test.txt` | **192 passed (192)** ✔ |
| steer-fallback case passes by name | `fix-steer-fallback-test.txt` | **1 passed \| 191 skipped (192)** ✔ — total reconciles with the full-file count; the test name `"does not replace a newer foreground turn after unavailable steer fallback is admitted"` verified present at line 1107 of the branch's test file. Caveat N3: the log does not echo the `-t` filter, so the by-name selection is consistent-but-not-self-documenting. |
| 22/22 adjacent suites (companion 12 + collector 3 + auth 7) | `fix-adjacent-tests.txt` | **3 files, 22 passed** ✔ |
| build / typecheck / lint green | `fix-build-server.txt` (exit-0 builds incl. cli), `fix-typecheck.txt` (all workspaces, no errors), `fix-lint.txt` (`oxlint <file>`, 0 warnings/0 errors), `fix-format.txt` | ✔ |

192-vs-210 count explanation — verified plausible, no flag:
- `agent-manager.test.ts` is **not** in the TM-01 delta (`diff --name-only
  6166a7aca..a8241e535` grep count 0), so the pure-branch file is the base file:
  base `6166a7aca` version has 190 `it(`/`test(` grep hits (≈192 vitest; the
  2-gap is immaterial — likely parameterized/dynamic cases).
- Custom `cbd1210c7` version has 212 grep hits; the merged tree ran 210. The
  baseline/custom side contributes roughly 18–20 fence tests (ACP/GJC/steer),
  exactly the direction and magnitude the addendum claims. ✔

Not verifiable read-only: that the logged runs reflect the exact HEAD tree
(logs could in principle be stale); scheduling/timing behavior beyond the
unit-tested seam. The mechanism itself (await-window → ghost tracked run) was
trace-verified in P2 and the P2 pre/post-fix 209/210→210/210 pair is the
deterministic proof; this delta review confirms the branch now carries the
identical fix.

## 4. Routing judgment — CONFIRMED: local fix on TM-01 is correct

- **Not TM-01B.** The Branch and removal contract creates TM-01B only for
  "custom/infi adaptations that cannot compile in TM-01 alone." This fix
  restores reconciled-source semantics, needs no custom/infi code, and compiles
  + passes on the declared beta.3 base alone (build/typecheck/lint + 192/192 +
  22/22 per logs). A bridge would be the wrong home.
- **Not assembly-only.** P2 §Human decisions is explicit: a manifest line at
  `2197619bc` ships the steer regression; assembly-only would leave the defect
  in the maintained branch and force every assembler to replay `d17896891`.
  The plan's Source tracking rule ("keep local-only fixes as separate
  commits") and Update-loop rule ("fix the owning port") both require the fix
  to land on TM-01 as its own commit — which is what happened.
- **Source-fidelity restoration, not a custom adaptation** ✔ — the hunk is
  byte-equal to `51fb7693d`, comment included; no custom fence code was
  touched or needed.

## Findings

No blocking findings. Three non-blocking nits:
- (N1, non-blocking) Commit message retains P2's assembly-side sentence "the
  same one-hunk fix should be applied to intake/tmad-stream-flow" though it now
  lives on that branch (verbatim copy, disclosed in the addendum). Stale
  sentence in an immutable message; do not rewrite history to fix it.
- (N2, non-blocking) `Port-Feature: TM-01` is separated by a blank line from the
  trailing `Co-Authored-By`, so `git %(trailers)` parses only the latter (prior
  branch commits put `Port-Feature` last). The line is present and grep-able;
  keep the trailer block contiguous (no blank line) on future commits.
- (N3, non-blocking) Fix-test logs lack command echo (same class as prior
  review's N2): `fix-steer-fallback-test.txt` records "1 passed | 191 skipped"
  without the `-t` filter string. Future evidence logs should echo the exact
  invocation. Credibility is established by count reconciliation + the verified
  test name; nothing to re-run.

## Verdict rationale

One commit appended, no rewrite, ancestry still release-clean; delta is a single
seam hunk byte-equal to the reconciled source (void + rationale comment) with
the pre-existing relocation untouched; message framing/trailers correct per
COMMON.md; all claimed evidence present in logs with the 192-vs-210 delta
independently sanity-checked against the test files; routing as a TM-01 local
fix is what the plan requires (TM-01B would be wrong, assembly-only would ship
the regression). Prior APPROVE at 2197619bc stands; the delta removes the one
known defect. → APPROVE.
