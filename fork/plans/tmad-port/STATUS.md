# tmad port — status (updated 2026-10-03, orchestration on pluto)

Plan: [../tmad-maintained-port-plan.md](../tmad-maintained-port-plan.md). Briefs in `briefs/` were
written for neptune workers: read `/tmp/tmad-port/...` as the pluto scratch dir (populated from this
branch: plan.md, COMMON.md, flat briefs, evidence/, logs/, prompts/) and
`/Volumes/offload/neptune/repos/paseo` as `~/repos/paseo`. `~/.paseo-fork/manifest.txt` is frozen in
`evidence/manifest-frozen-2026-10-02.txt`; never edit a live manifest.

Reviewer correction (2026-10-03, from the user): reviews run through **Pi on OpenCode Go** — provider
`pi`, model `opencode-go/muse-spark-1.3-contributor`, thinking `high`, feature `auto_accept: true`
(pluto's saved profile "Muse Spark 1.3 Contributor"). The `muse` (Muse Code) provider is NOT the
reviewer route and is not installed on pluto; the 2026-10-02 session wrongly waited on it. Reviewers
are read-only: no edits, no commits, no pushes. See `briefs/ORCHESTRATOR.md`.

## Branch state

| ID | Branch (local; intake branches not yet pushed to origin) | Base | HEAD | State |
| --- | --- | --- | --- | --- |
| P0 | `tmad-port/baseline-assembly` (on origin) | frozen manifest SHAs (`evidence/P0-inputs.txt`) | `2bfcd2e19` | DONE + **APPROVED** (evidence/review-P0.md, 2026-10-03): all exit criteria reproduce read-only; 3 non-blocking findings dispositioned in the coordinator note at the bottom of evidence/P0.md (script verdict-string bug; "29"→"31" count fixed; rr-cache informational). Gates for P2: none left. |
| TM-01 Stream | `intake/tmad-stream-flow` (on origin; history: `4dab8b364` WIP → `2197619bc` approved → `a8241e535` post-P2 fix, appended) | `v0.11.0-beta.3` (6166a7aca) | `a8241e535` | DONE + **APPROVED twice**: full review at `2197619bc` (evidence/review-TM-01.md) and delta re-review of the post-P2 seam fix at `a8241e535` (evidence/review-TM-01-delta.md — routing as a TM-01 local fix CONFIRMED, "TM-01B would be wrong, assembly-only would ship the regression"). The fix restores the source's fire-and-forget artifact collection that the P2 assembly showed breaking custom's steer-fallback fence. 3 non-blocking nits recorded (commit-message sentence, trailer spacing, log echo). UI capture remains P1 step 6 (human). |
| TM-02 queue daemon | `intake/tmad-message-queue` (on origin) | custom floor `cbd1210c7` (recorded) | `91392d6be` | DONE + **APPROVED** (evidence/review-TM-02.md): legacy send contract, wire/auth, queue semantics, custom fences, provenance all verified; no blocking findings (2 non-blocking report-wording notes). Gaps carried: daemon e2e needs provider creds (defer to TM-03/P4). Gates for TM-03/TM-04: none left. |
| TM-07 Native Find | `intake/tmad-native-find` (on origin) | `v0.11.0-beta.3` (6166a7aca) | `5f3634ad4` | DONE + **APPROVED** (evidence/review-TM-07.md, Muse Spark 1.3 Contributor via pi/OpenCode Go, 2026-10-03): no blocking findings, none non-blocking; provenance, blob parity, ancestry, diff correctness all verified by the reviewer. Promotion still wants the 10-point native device list in evidence/TM-07.md (human) and the known adapted merge with TM-01 on `agent-view-store.ts`/`workspace-tab-menu.ts` (integrator, P2). |
| TM-01B bridge | — | — | — | NOT NEEDED (TM-01 compiles and tests green on beta.3 alone). |
| TM-03 queue UI | `intake/tmad-queue-ui` (on origin) | TM-02 `91392d6be` (approved) | `9ab91bb75` | DONE + **APPROVED** (evidence/review-TM-03.md): no blocking findings; 3 non-blocking notes (trailer convention on the docs commit; the inherited source optimistic-row race — small, self-healing, documented as gap #4, hardening optional; screenshot evidence for the new badges/menus deferred to a human dev-app pass). Canonical submission ownership, no-protocol-change, no typed-send flip, queue-removal coherence all verified by the reviewer. Remaining human check: browser/native screenshot pass on the new queue UI. |
| TM-04 voice flow | `intake/tmad-voice-flow` | TM-02 `91392d6be` (approved) | running | Worker still running (fresh test logs at check time; first commit not yet landed). |
| P2 removal proof | `tmad-with-stream` (clone-local) | baseline `2bfcd2e19` | `0ff83cbc5` | **DONE + APPROVED** (evidence/review-P2.md): with-stream delta = exactly the 53 TM-01 paths; Stream-free baseline; steer-fence defect fixed in the TM-01 branch (redundancy proven, trees byte-identical); rollback demonstrated on copied data; TM-01B not needed; final manifest block in P2.md Addendum 2. |
| TM-05, TM-06, TM-08+ | — | — | — | Product decisions for the user; do not start. Typed-send default is also the user's call. |

## Source cursors

- Inspected = fully classified = `929f1add3` (`refs/research/tmad-main-latest`; PR #36 "preserve
  queued messages until host acknowledgement", 27 app files +939/−205, TM-03 scope — source-update
  candidate after TM-03 lands; not ported).
- Effective source snapshot per ported feature: `51fb7693d` (TM-01 rehearsal boundary: `af247e4f4`).

## Remaining human checks (regardless of review verdicts)

- TM-07: native device evidence, 10-point list in `evidence/TM-07.md` (iOS sim + Android:
  reachability, historical match reveal, wrap-around, cleanup, older-host, keyboard, rotation,
  non-Latin locales).
- TM-01: matched source/port UI captures (desktop + compact web), native captures, locale parity
  incl. ko; two informational decisions ("Queue" tab label; pin/artifact ceilings 100/200).
- TM-02: neptune owner to classify the pre-existing `session.test.ts` side-conversation failure at
  the custom floor; daemon e2e needs a host with provider creds (or a fake-provider harness).
- TM-04 (when run): its report will list the physical-device and per-provider checks.

## Proposed manifest append block (DRAFT — nothing live edited; each line valid only after its Muse Spark review)

```text
# Existing community, custom and infi lines retain their current order. APPEND BELOW THEM.
intake/tmad-stream-flow       # TM-01 a8241e535; source snapshot 51fb7693d reconciled; base v0.11.0-beta.3; removal group Stream (no bridge needed).
intake/tmad-message-queue     # TM-02 91392d6be; custom floor cbd1210c7 (recorded); removal group Queue+Voice (with TM-03/TM-04 when they land).
intake/tmad-native-find       # TM-07 5f3634ad4; source snapshot 51fb7693d; base v0.11.0-beta.3; removal group Native Find (independent of Stream and queue).
# TM-03 (intake/tmad-queue-ui, base TM-02) and TM-04 (intake/tmad-voice-flow, base TM-02) lines are added
# in dependency order only after their own gates; voice device evidence is a promotion gate.
```

## Orchestration log

- 2026-10-02 (neptune → handoff): P0 inputs frozen, baseline assembly merged, feature map done;
  TM-02 protocol contract committed (`6f76c621e`); TM-07 done, unreviewed; TM-01 left one WIP commit.
- 2026-10-02 (pluto): scratch dir `/tmp/tmad-port/` populated; baseline clone created at
  `/tmp/tmad-port/baseline-clone` (own index, rerere on) on `tmad-port/baseline-assembly`;
  coordinator check: baseline tree == frozen mine. Implementers dispatched (claude-zai/glm-5.3-flash,
  thinking high, bypassPermissions): TM-01 `59933eac` (wks_3919834322096f66), TM-02 `124d824b`
  (wks_b6b4404597f90c74), P0 `c1c7b820` (wks_4c44bb8d08811ddb). The 2026-10-02 session wrongly
  waited on the `muse` provider ("not found on PATH") and stopped with everything blocked; corrected
  2026-10-03 per the user.
- 2026-10-03: P0 finished (`evidence/P0.md`; note: clone rr-cache is empty after `git rerere gc`, so
  P2 budgets fresh resolutions). TM-02 finished (`evidence/TM-02.md`; handoff blocker resolved — the
  truncated typecheck failure was stale protocol `dist`; no branch-caused failures). TM-01 finished
  (`evidence/TM-01.md`). Coordinator verified each: HEAD SHAs, ancestry, blob parity, trailers, test
  logs (73 tm01-* logs, 320/320 P0 tests, 49 queue tests).
- 2026-10-03 (resume): reviews dispatching on pi/OpenCode Go per the corrected brief. Note: the CLI
  cannot pass provider features at `paseo run` time, so the profile's `auto_accept: true` is not set
  on reviewers; read-only reviewers ran without a single permission prompt, so this has not mattered.
  If a future reviewer stalls on prompts, either approve via `paseo permit allow <agent>` or create
  it through the MCP surface where `settings.features` is available.
- 2026-10-03: **TM-07 APPROVED** (evidence/review-TM-07.md) — first review through the corrected
  route; branch already on origin. P0/TM-02/TM-01 reviews dispatched in parallel (same reviewer
  profile, read-only, verdict files `evidence/review-<ID>.md`). **All four reviews returned APPROVE**
  (P0: 3 non-blocking, dispositioned; TM-02: no blocking, 2 wording notes; TM-01: no blocking, 2 doc
  nits). Approved branches pushed to origin; `intake/tmad-stream-flow` required a lease-pinned
  force-update because the approved history rewrites the superseded WIP tip `4dab8b364` (rewrites of
  unreviewed WIP are allowed by `briefs/ORCHESTRATOR.md`; nobody else builds on that tip). Next per
  the brief: P2 (baseline clone, reuse of the P0 worker's workspace), then TM-03 and TM-04
  (branch-off from the approved `intake/tmad-message-queue`), each followed by its review.
- 2026-10-03 (P2 wave): P2 worker finished (evidence/P2.md, `tmad-with-stream` @ `d17896891`) and
  **caught a real TM-01 port defect at the assembly**: the port made terminal-event artifact
  collection `await` where source `51fb7693d` is fire-and-forget (`void ...collectArtifactsForTurn`
  with rationale comment); under custom's steer-fallback fence the cwd-walk window let a steer
  admission leave a ghost tracked run (agent-manager 209/210 on the assembly, green on baseline).
  Coordinator verified the hunk against source and routed it back to a glm implementer as an ITERATE
  finding (agent `e5a7006f`): cherry-pick the one-hunk fix onto `intake/tmad-stream-flow` (append
  only, no history rewrite), retest, addendum in TM-01.md. Sequencing: TM-01 delta re-review (Muse,
  `2197619bc..new HEAD`) → push → P2 worker follow-up rebuilds `tmad-with-stream` from the updated
  branch (the assembly fix `d17896891` should then be redundant) and finalizes the manifest SHA →
  P2 review. The worker's alternative (record the assembly-only resolution and ship a manifest line
  at `2197619bc`) was rejected: it would ship the steer regression in a manifest-only assembly.
  TM-03 (`4a09bc95`) and TM-04 (`82cd1481`) running in parallel.
- 2026-10-03 (TM-01 fix round): fix implementer appended the seam fix → `intake/tmad-stream-flow`
  `a8241e535` (no rewrite; `2197619bc` still an ancestor). Delta re-review **APPROVE**
  (evidence/review-TM-01-delta.md): seam byte-equal to source, routing judgment confirmed, 192-vs-210
  test-count delta independently sanity-checked. Branch pushed to origin (fast-forward). P2 worker
  now rebuilding `tmad-with-stream` from the updated branch (assembly fix `d17896891` should become
  redundant; rerere-replay of the old tab-menu resolution to be inspected before keeping), then the
  final manifest SHA and P2's own review.
- 2026-10-03 (P2 rebuild): `tmad-with-stream` = `0ff83cbc5` (baseline 2bfcd2e19 + one merge of
  a8241e535). Redundancy proven: `git diff d17896891 0ff83cbc5` empty — byte-identical tree, no
  extra assembly commit; steer-fallback passes on the bare merge (210/210). rerere replay inspected
  before keeping (identical resolution). Gates + seam-critical tests green (build:server, typecheck,
  lint 0/0 on 4604 files, agent-manager 210, companion 12, collector 3, auth 7). Addendum 2 in
  evidence/P2.md carries the FINAL manifest block (TM-01 at `a8241e535`, no bridge). P2 review
  dispatched (Muse, `02ccfa7a`).
- 2026-10-03 (P2 review): **P2 APPROVED** (evidence/review-P2.md). Non-blocking: N1 draft-manifest
  SHA staleness (fixed in this file — TM-01 line now `a8241e535`); N2 wording note on the
  "one textual conflict" claim. The tmad port's Phase 0-2 are now fully approved end to end:
  P0 baseline, P1/TM-01 Stream (twice), P2 removal proof, TM-02 queue daemon, TM-07 Native Find.
  Remaining: TM-03/TM-04 (running) + their reviews; the work-items ledger; human evidence gates
  (device lists, UI captures).

## Limits (unchanged)

Nothing was pushed to `mine` or `custom`; no live manifest was edited; no daemon was restarted; no
desvio run against a live config. Intake branches get pushed to origin only after a reviewed
milestone. This coordination branch carries all evidence and is pushed.
