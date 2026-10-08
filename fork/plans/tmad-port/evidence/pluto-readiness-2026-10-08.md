# Paseo fork-build readiness audit — corrected 2026-10-08

Scope: read-only reconciliation of TMAD and other Paseo fork work from the `tmad-port/coordination` checkout. This correction replaces the earlier audit’s ancestry, ACP status, CI, and promotion-path claims. No source edits, tests, daemon operations, or manifest edits were performed in this coordination checkout. Initial typecheck showed 14 CLI TS7006 diagnostics; after repairing stale package-level dependency links with the worktree initializer and rebuilding client/server, full typecheck and lint passed. This is a recovered worktree setup issue; no source defect or permanent hook bypass is claimed. No tests were run in this coordination checkout. Active `voice-flow-r2` was not entered. The requested docs/tracker edits are separate from source.

## Recommendation

Keep TMAD out of the live manifest pending the active integrator follow-up, remaining review, and human gates. The approved four-feature frozen-P0 assembly is complete at P6 HEAD `e423a8666a30075a584f4a8e6f646a28054e6af0`; its server build, root typecheck/lint, and scoped tests passed. Queue-free build/runtime rollback and the full P0 + current-custom + independently reviewed side-fix rehearsal remain open. Preserve P0 external/infi carries in that rehearsal. Do not rebase approved branches before this follow-up; changing the queue root remains a separate update-loop decision.

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
- Public jobs/annotations identify `packages/server/src/server/session.test.ts:259`, test “side conversation manager events reach every capable client”: expected update and removed events, received `[]`. It failed in `fork-checks (makemake)`, full-matrix server tests on ubuntu and Windows. This is the pre-fix historical run. Repair commit `fddb4fa8587ae377286ffbea3137df4c53bdc7a9` has independent approval and remains an integration candidate outside `custom`/`mine`, awaiting integration and CI. Typecheck, lint, and format jobs are green. Playwright shards 3/4 and 4/4 failed with generic exit-code annotations; public annotations provide no detailed cause. Do not attribute those failures to a particular test or feature.
- Active worktrees observed: coordination, custom, P0 assembly, TM-01, TM-02, TM-03, TM-04. TM-04 remained at recovered WIP SHA in the visible ref listing when checked; per instruction its worktree was not inspected. GitHub API/npm public endpoints were used read-only. No `gh` auth was needed for those APIs.

## TMAD readiness

“Approved” refers to the recorded read-only branch review. It does not by itself clear human evidence or integrated removal checks.

| Item | Exact ref / evidence | Readiness and remaining gates |
|---|---|---|
| P0 | `2bfcd2e19638484baf1651d69dc0be55df483bcd`; `P0.md`, `review-P0.md` | Approved frozen baseline. Use it for the planned frozen-basket rehearsal. It does not contain current `custom` HEAD `24f134618` and is not proof of the live basket. |
| TM-01 Stream | `a8241e53530d6bd0a958971118d6b8b57ff80b0c`; `TM-01.md`, both reviews; P2 `0ff83cbc5` and `review-P2.md` | Approved; Stream-only removal and copied-data rollback proof complete. Promotion still owes matched desktop/compact-web, native, and locale captures including Korean, plus the noted label/ceiling decisions. Re-run relevant integrated checks in the frozen-basket rehearsal. No TM-01B bridge is needed. |
| P6 frozen basket | `e423a8666a30075a584f4a8e6f646a28054e6af0`; [P6 report](P6-assembly-2026-10-08.md), [conflict log](P6-conflict-resolution-log-2026-10-08.md) | Approved four-feature frozen assembly; `build:server`, root typecheck/lint, and scoped tests passed. Does not close removal/current-custom gates: queue-free tree is unbuilt with source/copy proof only; custom+TM scratch is unbuilt and omits P0 external/infi carries. Full carry-preserving rehearsal with the approved side fix remains active. |
| TM-02 queue daemon | `91392d6beed3fc49f9be7496a70b8d5822957d4c`; `TM-02.md`, `review-TM-02.md` | Approved intake. Existing base is historical custom floor `cbd1210c7`; do not treat that as a reason to alter the branch before the frozen-basket rehearsal. Queue+Voice removal proof with pending items remains open. The pre-fix `session.test.ts:259` failure has repair commit `fddb4fa8587ae377286ffbea3137df4c53bdc7a9`, independently approved by Luna; integration and CI remain outstanding. TM-03 has fake-provider two-client daemon E2E; provider-credential E2E remains a limitation. |
| TM-03 queue UI | `9ab91bb759be1951bdaa9cbe7bc991cafed2569d`; `TM-03.md`, `review-TM-03.md` | Approved intake; browser/native dev-app captures for delivery badges, row menu, and failed overlay remain open. Its Queue+Voice removal proof is also open. Typed-send default remains unchanged. |
| TM-04 voice | Recovered ref `6ab56eba1ae1efe2d2696ca090d6ec82f579f2f8`; current work not inspected | In progress with agent `agent9307e007` (Sol, low), workspace `wks_9d17ba714b1dcd50`, branch `intake/tmad-voice-flow` (`voice-flow-r2`). No completion SHA/review is claimed here. Still needs worker report, review, gates, and voice device/provider evidence. |
| TM-07 Native Find | `5f3634ad43256c18f9f41667348c65fe1b03d7f4`; `TM-07.md`, `review-TM-07.md` | Approved intake. 10-point iOS/Android device matrix remains open. Known adapted merge with Stream at `agent-view-store.ts` and `workspace-tab-menu.ts` still needs an integrated proof. |
| TM-05/06/08+, typed-send default | No branches | Product decisions for the user; do not start or flip the default. |

### Build path and boundaries

The approved frozen-P0 four-feature assembly is recorded at P6 HEAD `e423a8666a30075a584f4a8e6f646a28054e6af0`. Its `build:server`, root typecheck/lint, and scoped tests passed. The queue-free tree has only structural and copied-file evidence and was not built; its rollback check does not start a daemon or dispatch a provider request. Queue-free build and isolated runtime rollback are active integrator follow-up. These limits leave Queue+Voice removal open, as well as any live/home migration claim.

The separate current-custom scratch rehearsal stacked the same four approved intake SHAs but remains unbuilt, with no typecheck or test result, and omits P0 external/infi carries. The active follow-up is a full P0 + current-custom + independently approved side-fix rehearsal that preserves those carries. It must include the queue-free build and isolated runtime rollback proof. Do not treat the partial scratch tree as current-custom readiness, and do not rewrite approved branch ancestry before the follow-up. Moving the queue root from `cbd1210c7` remains a later, separately reviewed update-loop decision.

The final manifest append block remains a proposal: preserve all existing line order; Stream, Queue, and Native Find are reviewed candidates; Queue UI and Voice are conditional on their own gates and dependency order. The P6 basket is not promoted. None of these TMAD heads is in `mine` or the frozen manifest.

## Other fork work and current ownership

| Work | Actual inclusion status |
|---|---|
| ACP cancellation boundary / GJC | The historical fix-pass plan and review are stale as implementation plans. The units landed in current `custom` and are also ancestors of P0 and `mine`: `816d7dcc0` observed-death settlement (`deathSettled`/`transport_death`), `7353f6181` issue-and-return, `300eec342` terminal-kind precedence, `28b167ed3` deny routing and `deny_cancel_suppressed`; `5b2e21d83` repaired the manager test terminator and records 186 passing tests; `f8c5b791b` updated lifecycle/provider docs. Do not dispatch redundant ACP implementation. The 2026-09-04 plan/review still record the earlier snapshot accurately but not current status; they are marked historical in this correction. Current fork CI has the separate side-conversation test failure described above. |
| Side conversations | Older implementation commit `7308e46e7` is in P0 and `mine`. Repair commit `fddb4fa8587ae377286ffbea3137df4c53bdc7a9` reproduces the base failure and restores delivery; final session file (157), authorization (7), build, typecheck, lint, format, and hooks passed in the worker report. Luna independently APPROVED it. It is an integration candidate outside `custom`/`mine`, awaiting integration and CI; it is not promoted. The original failing CI run remains historical until the fix reaches CI. CodeRabbit did not start because browser authentication returned `environment_unsupported`. See [repair evidence](pluto-side-conversation-events-2026-10-08.md) and [independent review](pluto-side-conversation-review-2026-10-08.md). |
| Zcode | Legacy local plugin patch/reapply machinery (`57317859a`) is in P0 and `mine`. Current plugin SDK import wiring commit `1ff3847aa` and current custom head `24f134618` are not ancestors of `mine`. Plugin patch scripts target installed plugin files, distinct from the core SDK change. |
| Fork release and worktree plumbing | Older fork release/worktree features are in the P0/mine snapshot. The released CLI artifact is proven above. Current custom-only additions are not included merely because the branch named `custom` exists. |
| Infi-PC IP-01…IP-14 | The `mine` history contains the infi integration sequence through IP-14 at `4cc94e07e`. The 2026-09-30 ledger documents integrated Desvio gates and browser checks; branch-pair picker browser QA and native device QA remain noted gaps. |
| Source PR #36 / TM-03 update candidates | Classified at source `929f1add3`; not ported. Revisit through the update loop after the relevant queue work; this is not a current implementation task. |

## Worker ownership and test ownership

The single source for exact agent IDs, workspace IDs, branches, and worker states is the
[STATUS worker ownership table](../STATUS.md#worker-ownership--2026-10-08). On 2026-10-08, 19 old or
finished agents were archived, including the completed CLI, side-repair, and independent-review
agents. The CLI evidence is linked once in STATUS. The side-repair evidence is
[recorded here](pluto-side-conversation-events-2026-10-08.md), with the independent approval
[here](pluto-side-conversation-review-2026-10-08.md). Do not rerun worker-owned suites or builds.

## Concrete next steps

1. Complete the assigned integrator follow-up: isolated runtime rollback, queue-free build, and a full P0 + current-custom + approved-side-fix rehearsal preserving P0 external/infi carries. Review its evidence and assembly SHA. Do not alter approved branch ancestry or the live manifest as a prerequisite.
2. Keep TMAD excluded pending follow-up evidence, review, and human gates. Close TM-01/TM-03/TM-07 human evidence; finish TM-04 review and per-provider/device evidence; retain Queue+Voice pending-message removal and TM-07+TM-01 adapted integration proof as open until demonstrated.
3. The side-conversation repair `fddb4fa8587ae377286ffbea3137df4c53bdc7a9` is independently approved but awaits integration and CI; the original custom run remains historical pre-fix evidence. Treat Playwright shard failures as unresolved until detailed logs or a rerun identifies the cause.
4. No CLI source repair is indicated based on the rebuilt-stack evidence; initialize dependencies and rebuild owning stacks before diagnosing any recurrence. Reconcile the missing live manifest/config on its owning host before any live build decision. For CLI consumers, use `latest`/the default install path (`0.11.0-beta.3.fork.1`); treat the stale `fork` tag (`0.8.0-fork.1`) as the documented trusted-publishing limitation. A credentialed operator can repair it; no code change is indicated.
5. Only after the follow-up and human evidence gates, consider a separate current-custom update-loop batch. Any eventual push to `mine` publishes; no publish or daemon switch is authorized by this audit.
