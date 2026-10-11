# Partial deployment, 2026-10-12

Authority: Cameron requested "Resume, deploy work that is available." See [execution-start.md](execution-start.md#authorization-record). Release candidates are separate from the frozen campaign baskets. No production restart or in-place installation is authorized.

## Current delivery

Publish A1 ACP diagnostics only, subject to exact-candidate checks and Sol's final release verdict. Hold C1 and C2 from publication while the new browser failures are investigated.

| Input | Pin |
| --- | --- |
| Current release | `d62ed60c8db88f762945284b433d57c43c6f1c69`, upstream 0.11.2, including the newer ACP model-switch fix |
| A1 | `831f6a858127a41a6eeeef1dce2e6df0c905e18c`, package and frozen-basket ADVANCE |
| A1 campaign basket | `9d2fdd0d243272794756eabf78243bb0ee85d5c7` |
| A1-only release candidate | `929d7427163474f5c0cbfc45192436d3de7540c6`, branch `fork/refresh-deploy-a1-20261012` |

The candidate changes four A1 files only, 48 additions and 3 deletions. Its ACP test-file conflict replays Sol's approved resolution: keep the inserted A1 regression and the current release's renamed test and assertions. Versions, workflows, and release tooling are unchanged.

- Fork CI: https://github.com/camerontaylor/paseo/actions/runs/38153628787
- Packaging dry-run: https://github.com/camerontaylor/paseo/actions/runs/38153632643
- Local build/check logs: `/home/ctaylor/.jcode/scratch/a1-release-*.log`.

## Delivery checklist

- [x] Resume persistent Sol and requested DeepSeek workers.
- [x] Close A1 package and frozen-basket gates.
- [x] Assemble and preserve the A1-only candidate.
- [x] Obtain narrowed-release preflight: Sol approved exact candidate `929d74271`; publication remains pending. C1/C2 publication is explicitly held for dedicated browser investigation.
- [x] Finish local build, format, typecheck, lint, and full affected files: all passed on `929d74271`; ACP 143/143, creation 12/12, diagnostics 15/15. Typecheck ran after fresh server declarations.
- [ ] Finish exact-SHA remote CI. Packaging dry-run `38153632643` passed all seven pack gates, staging `0.11.2-fork.2` without publishing.
- [ ] Classify every failure against current-release baseline.
- [ ] Obtain Sol's final release verdict.
- [ ] Recheck remote `mine`, then fast-forward without force.
- [ ] Verify publication and registry version.

## Held three-package candidate

Initial candidate `568b12127fe0519396ef18ebfdcd74d205480f7d`, branch `fork/refresh-deploy-20261012`, preserves the current release plus C1 `8468e7f55`, C2 `2671a9f62`, and A1. It has not been pushed to `mine` or published.

- Initial CI: https://github.com/camerontaylor/paseo/actions/runs/38150800919
- Initial packaging dry-run: https://github.com/camerontaylor/paseo/actions/runs/38150802920, passed all seven pack gates and staged `0.11.2-fork.2` without publication.
- Independent release baseline: https://github.com/camerontaylor/paseo/actions/runs/38151464496 at `d62ed60c8`.

Two stale C2 test expectations were fixed in `94fbbd6a416fb71e2fd36eb539c25560a73718f6`, with Sol ADVANCE and coordinator-signed C2-GATE-EXC-3. Only the exact hello capability map and sidebar arrays changed. Worker `ab0168d1-a415-4512-a33c-0a93f94c9ae7` reported complete files green, 166 client and 19 sidebar tests, plus build/typecheck/lint/format and hooks. The correction still needs integration into the frozen basket and future combined release candidate.

Two additional browser failures are absent from the baseline:

1. `agent-message-submission.spec.ts:1296`, overlapping queued sends restored after connection failure: expected two "Send queued message now" buttons, observed zero. Preserve the recovery assertions during diagnosis.
2. `sidebar-nav-settings.spec.ts:82`, moving Schedules up twice above History: C2 adds Stream to the builtin order. Review the changed interaction before adapting any test expectation.

Baseline Windows fails the nested-script `worktree-bootstrap.test.ts` case because the temp path uses `RUNNER~1` versus `runneradmin`. Those files are unchanged in the candidate. Existing browser failures include pinned prompt, archived side conversation, viewed timelines, workspace package scripts, hydration/scroll, and chat-find/creation flows. Baseline app and SDK jobs pass. Full logs are in `/home/ctaylor/.jcode/scratch/partial-deploy-{ci,baseline}-failed.log`. Do not describe the failing matrix as green.

## Campaign continuation and safety

A2 worker `3af10474-80e6-4085-8371-62a4d4b7b062`, DeepSeek V4.1 Flash via Jcode, obtained read-only s0 ADVANCE on frozen backend. Implementation is held during release checks and release-regression work. C2 follow-up worker `ab0168d1` is investigating both held browser failures read-only from source and logs, with no local builds/tests or edits authorized. Keep one implementation worker active and local builds/tests serial.

The coordinator resumed as Jcode on uranus. Persistent Sol `3f2c7ea5` resumed with its existing context. No frozen campaign ref was repinned. Current custom `a4d6922874fb68fa5cab2ffa946a80baf8c441e4` belongs only to release-history investigation, not campaign baskets.

No production restart, installation, config change, or live-home repair. The live Desvio directory is absent on uranus, so no live manifest is edited. A future Desvio rebuild needs the accepted overlays added to the owning host's manifest or it will drop them.

Integration merge hooks were skipped, with checks after assembly. Docs-only control commits skip hooks in the dependency-free worktree. The formatter runs before commits, but repo config explicitly excludes `fork/**/*.md`. C1/C2 native, locale, and real disk-full gaps remain in the ledger.
