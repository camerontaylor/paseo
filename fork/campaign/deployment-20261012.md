# Partial deployment, 2026-10-12

Authority: Cameron requested "Resume, deploy work that is available." See [execution-start.md](execution-start.md#authorization-record). Release candidates are separate from the frozen campaign baskets. No production restart or in-place installation is authorized.

## Current delivery

A1 ACP diagnostics is published as `0.11.2-fork.2`. All seven `@camerontaylor/paseo-*` packages expose that version through npm `latest`; the GitHub release has all seven tarballs. Hold C1 and C2 from publication while their new browser failures are investigated.

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
- [x] Finish exact-SHA remote CI `38153628787`: completed with five failed jobs, not green. Packaging dry-run `38153632643` passed all seven pack gates, staging `0.11.2-fork.2` without publishing.
- [x] Classify every failure against current-release baseline. Sol accepts the reproduced baseline failures and observed flake differences as nonblocking for A1-only publication, not as a green matrix.
- [x] Obtain Sol's final release verdict: **ADVANCE / APPROVE** exact `929d7427163474f5c0cbfc45192436d3de7540c6`. [Quoted ruling](logs/A1-release-verdict.md) explicitly accepts reproduced baseline failures and observed flake severity only for this narrow fork publication.
- [x] Recheck remote `mine`, then fast-forward without force: `d62ed60c8` remained unchanged and advanced to exact `929d74271` on 2026-10-12. Automatic publication run [38156081965](https://github.com/camerontaylor/paseo/actions/runs/38156081965) completed successfully.
- [x] Verify publication and registry version: workflow success at exact `929d74271`; all seven packages and `latest` verified as `0.11.2-fork.2` on 2026-10-12. Tag `fork/v0.11.2-fork.2` resolves directly to the candidate; [GitHub release](https://github.com/camerontaylor/paseo/releases/tag/fork/v0.11.2-fork.2) is published with seven uploaded tarballs.

Publication evidence: `/home/ctaylor/.jcode/scratch/a1-publication.log` and `a1-registry-verification.log`. The trusted publisher cannot manage the optional npm `fork` dist-tag and emitted expected 403 warnings; `latest` and explicit versions are verified. Do not claim `@fork` was updated. This delivery publishes packages only; no production daemon was installed, restarted or activated.

## A1-only remote evidence

CI `38153628787` at exact `929d74271` completed with five failed jobs. Makemake, Linux server, macOS file observation, app, SDK, all CLI shards, relay, both desktop platforms, typecheck, lint and formatting passed. The failing Windows job has exactly the baseline nested-package-script temp-path mismatch. All ten final browser-failure cases appear in the independently run current-release baseline:

| Shard | Cases | Baseline comparison |
| --- | --- | --- |
| 1 | First-prompt hydration, slow upward scrolling | Hydration also hard-fails at baseline. The identical scrolling assertion fails baseline first attempt and passes retry, but fails both candidate attempts. Preserve this severity difference as a limitation. |
| 2 | Chat find | Same duplicate `Prompt number 5` locator failure. |
| 3 | Pinned prompt, archived side conversation | Same hard failures. Provider-refresh age flakes then passes in both runs. |
| 4 | Four viewed-timeline cases, nested package scripts | Same five hard failures. Candidate additionally flakes on old-daemon prompt visibility, then passes retry. That flow runs published daemon 0.2.5 and unchanged app code, not the modified A1 server. |

The baseline's bottom-sheet and creation-idempotency flakes passed in this candidate. All app/desktop files and worktree-bootstrap implementation/tests are byte-identical to baseline. Full logs: `/home/ctaylor/.jcode/scratch/a1-ci-failed.log`, `partial-deploy-baseline-failed.log`. Sol inspected these logs and approved this narrow release despite inherited failures. The scrolling instability and newly observed old-daemon retry-pass remain limitations. Broad CI is failed.

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

## Browser carry-test exceptions, approved before edits

Sol issued separate PREFLIGHT APPROVE rulings on 2026-10-12 for C1-BROWSER-EXC-1 and C2-BROWSER-EXC-1. The coordinator signs off on both now, before worker edits. Source/log diagnosis is not proof that no message was lost.

C1 scope is only `agent-message-submission.spec.ts` and `support/helpers/agent-message-gate.ts`. Preserve the original held requests without forwarding or replay. Before reconnect, prove both distinct payloads and item identities are durable and render as two pending rows. Use genuine reconnect and deterministic host acknowledgements, then keep the original two actionable-row acceptance and no canonical user messages. No synthetic ack, reseeding, additional submission, fixture or production changes. Stop for production-design review if recovery fails.

C2 scope is only `sidebar-nav-settings.spec.ts` and its sidebar helper. Add literal Stream identity, visibility, order and persistence throughout. Assert each of three Schedules moves above Stream, Search, then History. Preserve shortcut, visibility, persistence, reload and plugin checks. The existing all-items-off fixture may explicitly add `{ key: "stream", visible: false }` and assert it hidden. No shared fixtures, derived expectations or weakened matchers.

One isolated DeepSeek worker may make separate package commits on `fork/refresh-browser-repair-20261012`, based on held combined candidate plus the already accepted EXC-3 correction. Complete the affected browser files and required checks, then obtain Sol ADVANCE before transplanting follow-ups into package branches and both basket/release paths. A2 remains held. C1/C2 publication stays held pending exact-SHA gates. Full quoted preflight is preserved in `/home/ctaylor/.jcode/scratch/browser-repair-preflight-verdict.md` and must be mirrored into the worker report.

## Campaign continuation and safety

A2 worker `3af10474-80e6-4085-8371-62a4d4b7b062`, DeepSeek V4.1 Flash via Jcode, obtained read-only s0 ADVANCE on frozen backend. A2 implementation stays held. Worker `ab0168d1` completed source/log-only diagnosis; sole active implementation worker `99388f8a-3c03-4b92-817b-9f5e46f6351b` is on isolated branch `fork/refresh-browser-repair-20261012`, workspace `wks_7dfe3f6b186c871b`. Local release validation has completed, so its serial install/build and targeted checks are released. Keep one implementation worker active and local builds/tests serial.

The coordinator resumed as Jcode on uranus. Persistent Sol `3f2c7ea5` resumed with its existing context. No frozen campaign ref was repinned. Current custom `a4d6922874fb68fa5cab2ffa946a80baf8c441e4` belongs only to release-history investigation, not campaign baskets.

No production restart, installation, config change, or live-home repair. The live Desvio directory is absent on uranus, so no live manifest is edited. A future Desvio rebuild needs the accepted overlays added to the owning host's manifest or it will drop them.

Integration merge hooks were skipped, with checks after assembly. Docs-only control commits skip hooks in the dependency-free worktree. The formatter runs before commits, but repo config explicitly excludes `fork/**/*.md`. C1/C2 native, locale, and real disk-full gaps remain in the ledger.
