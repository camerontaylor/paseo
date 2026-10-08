# Paseo fork-build readiness audit — corrected 2026-10-08

Scope: read-only reconciliation of TMAD and other Paseo fork work from the `tmad-port/coordination` checkout. This correction replaces the earlier audit’s ancestry, ACP status, CI, and promotion-path claims. No source edits, builds, tests, daemon operations, manifest edits, or pushes were performed in this coordination checkout. An initial root typecheck attempt was cancelled after worker-owned rebuilt-stack evidence arrived; the later pre-commit hook completed workspace typecheck and failed on 14 TS7006 diagnostics in the six CLI command files. The hook generated protocol validators but no generated-file diff remains. Coordination lint and repo-wide format check passed. Worker-owned CLI builds/typecheck/lint and one targeted test are recorded in the linked evidence. The docs commit records this hook failure; see STATUS. Active `voice-flow-r2` was not entered. The requested docs/tracker edits are separate from source.

## Recommendation

Keep the TMAD lines out of the live manifest pending the recorded human gates and isolated basket validation. Do not rebase TM-02/03/04 before doing the planned frozen-basket rehearsal: the existing ledger explicitly treats movement of the queue root onto newer `custom` as a future update-loop batch. Validate the approved branches first against the frozen P0 inputs, then separately decide whether to refresh onto current `custom`.

The published fork build is identifiable: npm’s `@camerontaylor/paseo-cli@0.11.0-beta.3.fork.1` SLSA provenance resolves to `mine` at `4cc94e07e870e1461640ce3256d1db2d0ab1bc2f`; this artifact predates TMAD inclusion. Consumers should use `latest`/the default install path for the current CLI build. The stale `fork` tag is a documented operational gap: `fork/scripts/release-fork.mjs:596-604` and the fork publish workflow state trusted publishing may publish but cannot write dist-tags; updating `fork` is best-effort and can return E401. A credentialed operator may repair the tag; this is not a code defect. The current live manifest/config remains unavailable in this environment, so this does not establish its present contents.

## Git and artifact facts

- Coordination HEAD: `f46150ffc2cb332d1853e12c6f030496dfbb38ac`, clean at audit start.
- `origin/main`/`upstream/main`: `cc8fe41e2828a34d4d9706c0b8353c0e91987a25`.
- `origin/custom`: `24f134618cd8a7143615debf927c1ac60b9ba813`.
- `origin/mine`: `4cc94e07e870e1461640ce3256d1db2d0ab1bc2f`.
- Direct ancestry checks return false (`git merge-base --is-ancestor` exit 1) for current `custom` → `origin/mine`, current `custom` → `tmad-port/baseline-assembly` (P0), and `1ff3847aa` (plugin SDK import wiring) → `origin/mine`. The current custom/Zcode SDK integration is not in the published mine tree.
- Historical commits `acc60db36`, `816d7dcc0`, `7353f6181`, `300eec342`, `28b167ed3`, `5b2e21d83`, `f8c5b791b`, side-conversation commit `7308e46e7`, and local Zcode patch script commit `57317859a` are ancestors of both `origin/mine` and P0. Thus the old mine/P0 snapshot contains those older custom behaviors and the completed ACP fix-pass code; “current custom is not an ancestor” does not mean all custom-originated work is absent.
- `origin/mine` has no ancestry from TM-01 `a8241e535`, TM-02 `91392d6be`, TM-03 `9ab91bb75`, or TM-07 `5f3634ad4`.
- Frozen manifest copy: `fork/plans/tmad-port/evidence/manifest-frozen-2026-10-02.txt`; no TMAD lines. The documented live path `/home/ctaylor/.paseo-fork/manifest.txt`, `desvio.conf`, and `/Volumes/offload/neptune/repos/paseo` are absent here. Do not infer live state from the frozen copy.
- Public npm metadata reports `latest=0.11.0-beta.3.fork.1`, while `fork=0.8.0-fork.1` is stale by documented design/credential limits. Consumers should use `latest` or the default install path. The release script makes the `fork` re-point best-effort because trusted publishing lacks dist-tag permission; a credentialed operator can repair it if needed. For the CLI version, npm has no `gitHead`, but its SLSA provenance names workflow `.github/workflows/fork-npm-publish.yml`, repo `camerontaylor/paseo`, ref `refs/heads/mine`, commit `4cc94e07e870e1461640ce3256d1db2d0ab1bc2f`, and publish run `36963052999` (success). The provenance’s SHA-512 subject matches the npm tarball `dist.integrity`. This verifies this package artifact’s build source, not every package in the release.
- GitHub Actions run `37187135673` is `Fork CI` on `custom` SHA `24f134618…`, conclusion failure. Upstream/main run `37186340343` on `cc8fe41e2…` succeeded.
- Public jobs/annotations identify `packages/server/src/server/session.test.ts:259`, test “side conversation manager events reach every capable client”: expected update and removed events, received `[]`. It fails in `fork-checks (makemake)`, full-matrix server tests on ubuntu and Windows. Typecheck, lint, and format jobs are green. Playwright shards 3/4 and 4/4 failed with generic exit-code annotations; public annotations provide no detailed cause. Do not attribute those failures to a particular test or feature.
- Active worktrees observed: coordination, custom, P0 assembly, TM-01, TM-02, TM-03, TM-04. TM-04 remained at recovered WIP SHA in the visible ref listing when checked; per instruction its worktree was not inspected. GitHub API/npm public endpoints were used read-only. No `gh` auth was needed for those APIs.

## TMAD readiness

“Approved” refers to the recorded read-only branch review. It does not by itself clear human evidence or integrated removal checks.

| Item | Exact ref / evidence | Readiness and remaining gates |
|---|---|---|
| P0 | `2bfcd2e19638484baf1651d69dc0be55df483bcd`; `P0.md`, `review-P0.md` | Approved frozen baseline. Use it for the planned frozen-basket rehearsal. It does not contain current `custom` HEAD `24f134618` and is not proof of the live basket. |
| TM-01 Stream | `a8241e53530d6bd0a958971118d6b8b57ff80b0c`; `TM-01.md`, both reviews; P2 `0ff83cbc5` and `review-P2.md` | Approved; Stream-only removal and copied-data rollback proof complete. Promotion still owes matched desktop/compact-web, native, and locale captures including Korean, plus the noted label/ceiling decisions. Re-run relevant integrated checks in the frozen-basket rehearsal. No TM-01B bridge is needed. |
| TM-02 queue daemon | `91392d6beed3fc49f9be7496a70b8d5822957d4c`; `TM-02.md`, `review-TM-02.md` | Approved intake. Existing base is historical custom floor `cbd1210c7`; do not treat that as a reason to alter the branch before the frozen-basket rehearsal. Queue+Voice removal proof with pending items remains open. The known `session.test.ts:259` CI failure now has an assigned repair worker (below). TM-03 has fake-provider two-client daemon E2E; provider-credential E2E remains a limitation. |
| TM-03 queue UI | `9ab91bb759be1951bdaa9cbe7bc991cafed2569d`; `TM-03.md`, `review-TM-03.md` | Approved intake; browser/native dev-app captures for delivery badges, row menu, and failed overlay remain open. Its Queue+Voice removal proof is also open. Typed-send default remains unchanged. |
| TM-04 voice | Recovered ref `6ab56eba1ae1efe2d2696ca090d6ec82f579f2f8`; current work not inspected | In progress with Sol (low), workspace `9307e007`, on the assigned `voice-flow-r2` worktree. No completion SHA/review is claimed here. Still needs worker’s report, review, gates, and voice device/provider evidence. Do not duplicate checks in that worktree. |
| TM-07 Native Find | `5f3634ad43256c18f9f41667348c65fe1b03d7f4`; `TM-07.md`, `review-TM-07.md` | Approved intake. 10-point iOS/Android device matrix remains open. Known adapted merge with Stream at `agent-view-store.ts` and `workspace-tab-menu.ts` still needs an integrated proof. |
| TM-05/06/08+, typed-send default | No branches | Product decisions for the user; do not start or flip the default. |

### Build path and boundaries

The required immediate step is an isolated P2-style assembly using the frozen manifest inputs and approved recorded SHAs, followed by integrated checks and explicit removal behavior. This verifies the planned frozen basket; it does not edit or stand in for the live manifest. Queue+Voice still needs a separate removal exercise with pending messages, and TM-07 needs its adapted merge proof with TM-01.

The work-items ledger says a queue-root move from `cbd1210c7` to the then-newer custom head is a future update-loop step. It is not a prerequisite to the frozen-basket rehearsal and must not be converted into an unreviewed branch rewrite. After that rehearsal, decide in a separate reviewed batch whether to refresh the root and its dependents against current custom, then repeat affected gates.

The final manifest append block remains a proposal: preserve all existing line order; Stream, Queue, and Native Find are the reviewed candidates; Queue UI and Voice are conditional on their own gates and dependency order. None of these TMAD heads is in `mine` or the frozen manifest.

## Other fork work and current ownership

| Work | Actual inclusion status |
|---|---|
| ACP cancellation boundary / GJC | The historical fix-pass plan and review are stale as implementation plans. The units landed in current `custom` and are also ancestors of P0 and `mine`: `816d7dcc0` observed-death settlement (`deathSettled`/`transport_death`), `7353f6181` issue-and-return, `300eec342` terminal-kind precedence, `28b167ed3` deny routing and `deny_cancel_suppressed`; `5b2e21d83` repaired the manager test terminator and records 186 passing tests; `f8c5b791b` updated lifecycle/provider docs. Do not dispatch redundant ACP implementation. The 2026-09-04 plan/review still record the earlier snapshot accurately but not current status; they are marked historical in this correction. Current fork CI has the separate side-conversation test failure described above. |
| Side conversations | Older implementation commit `7308e46e7` is in P0 and `mine`. The current failing manager-event test is a live integration/regression issue, not evidence the feature is absent. Sol (low) is assigned repair, workspace `wks_0a7dc387a32f7959`, branch `fix/pluto-side-conversation-events`; this is the fourth implementer. Do not rerun that worker’s owned suites. |
| Zcode | Legacy local plugin patch/reapply machinery (`57317859a`) is in P0 and `mine`. Current plugin SDK import wiring commit `1ff3847aa` and current custom head `24f134618` are not ancestors of `mine`. Plugin patch scripts target installed plugin files, distinct from the core SDK change. |
| Fork release and worktree plumbing | Older fork release/worktree features are in the P0/mine snapshot. The released CLI artifact is proven above. Current custom-only additions are not included merely because the branch named `custom` exists. |
| Infi-PC IP-01…IP-14 | The `mine` history contains the infi integration sequence through IP-14 at `4cc94e07e`. The 2026-09-30 ledger documents integrated Desvio gates and browser checks; branch-pair picker browser QA and native device QA remain noted gaps. |
| Source PR #36 / TM-03 update candidates | Classified at source `929f1add3`; not ported. Revisit through the update loop after the relevant queue work; this is not a current implementation task. |

## Worker assignments and test ownership

As reported by the coordinator on 2026-10-08 (16 older sessions archived):

- Sol, low, workspace `9307e007`: TM-04 voice flow in `voice-flow-r2`.
- Luna, high, workspace `feb33ae6`: isolated assembly on branch `build/tmad-readiness-2026-10-08`, based at P0 SHA `2bfcd2e…`.
- Sol, low, workspace `fc3f12c9`: CLI declaration-resolution investigation on `fix/pluto-cli-typecheck` is complete; evidence is recorded at `pluto-cli-typecheck-2026-10-08.md`; no source fix was needed.
- Sol, low, workspace `wks_0a7dc387a32f7959`: side-conversation manager-event CI failure on `fix/pluto-side-conversation-events`.

The CLI TS7006 report is classified as an environment/declaration-resolution issue, not a source defect. At `24f134618`, the worker rebuilt `build:client` and `build:server`, then full typecheck and lint passed; the targeted `delete.test.ts` passed 1/1. The exact original failing checkout was unavailable, so its state was not reproduced. A controlled removal of worktree-local protocol `dist` reproduced the six-file TS7006 pattern; restoring it cleared the errors without a source change. See [CLI typecheck evidence](pluto-cli-typecheck-2026-10-08.md). The CLI worker is complete and archived; no source fix is indicated. Do not rerun the side-conversation or voice suites owned by the active workers.

## Concrete next steps

1. Let the assigned assembly worker finish the frozen-P0 rehearsal; read its report and exact assembly SHA. Do not change manifest or feature branch ancestry as a prerequisite.
2. Close TM-01/TM-03/TM-07 human evidence; finish TM-04 review and per-provider/device evidence; perform Queue+Voice pending-message removal and TM-07+TM-01 adapted integration proof.
3. Let the side-conversation worker diagnose/fix `session.test.ts:259`; inspect their evidence and CI rerun when complete. Treat Playwright shard failures as unresolved until detailed logs or a rerun identifies the cause.
4. No CLI source repair is required based on the completed rebuilt-stack evidence; initialize dependencies and rebuild the owning stacks before diagnosing any recurrence. Reconcile the missing live manifest/config on its owning host before any live build decision. For CLI consumers, use `latest`/the default install path (`0.11.0-beta.3.fork.1`); treat the stale `fork` tag (`0.8.0-fork.1`) as the documented trusted-publishing limitation. A credentialed operator can repair it; no code change is indicated.
5. Only after the frozen rehearsal and evidence gates, consider a separate current-custom update-loop batch. Any eventual push to `mine` publishes; no publish or daemon switch is authorized by this audit.
