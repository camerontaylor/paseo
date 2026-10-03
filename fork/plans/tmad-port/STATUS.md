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
| TM-01 Stream | `intake/tmad-stream-flow` (on origin; force-updated `4dab8b364`→`2197619bc` with lease — the approved history rewrites the superseded unreviewed WIP, as the brief allows) | `v0.11.0-beta.3` (6166a7aca) | `2197619bc` | DONE + **APPROVED** (evidence/review-TM-01.md): ancestry clean, trailers correct, rehearsal converged then diverged only for contracted reasons, every Stream wire/behavior contract verified in file content, scope exclusions hold, TM-01B correctly unneeded. 2 non-blocking doc nits recorded (stale "11 of 15" prose — the ledger table is authoritative; evidence logs should echo commands). UI capture remains P1 step 6 (human). |
| TM-02 queue daemon | `intake/tmad-message-queue` (on origin) | custom floor `cbd1210c7` (recorded) | `91392d6be` | DONE + **APPROVED** (evidence/review-TM-02.md): legacy send contract, wire/auth, queue semantics, custom fences, provenance all verified; no blocking findings (2 non-blocking report-wording notes). Gaps carried: daemon e2e needs provider creds (defer to TM-03/P4). Gates for TM-03/TM-04: none left. |
| TM-07 Native Find | `intake/tmad-native-find` (on origin) | `v0.11.0-beta.3` (6166a7aca) | `5f3634ad4` | DONE + **APPROVED** (evidence/review-TM-07.md, Muse Spark 1.3 Contributor via pi/OpenCode Go, 2026-10-03): no blocking findings, none non-blocking; provenance, blob parity, ancestry, diff correctness all verified by the reviewer. Promotion still wants the 10-point native device list in evidence/TM-07.md (human) and the known adapted merge with TM-01 on `agent-view-store.ts`/`workspace-tab-menu.ts` (integrator, P2). |
| TM-01B bridge | — | — | — | NOT NEEDED (TM-01 compiles and tests green on beta.3 alone). |
| P2, TM-03, TM-04 | — | — | — | Not started. P2 gated on P0+TM-01 APPROVE; TM-03/TM-04 gated on TM-02 APPROVE. Briefs ready. |
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
intake/tmad-stream-flow       # TM-01 2197619bc; source snapshot 51fb7693d reconciled; base v0.11.0-beta.3; removal group Stream (no bridge needed).
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

## Limits (unchanged)

Nothing was pushed to `mine` or `custom`; no live manifest was edited; no daemon was restarted; no
desvio run against a live config. Intake branches get pushed to origin only after a reviewed
milestone. This coordination branch carries all evidence and is pushed.
