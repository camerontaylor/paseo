---

**ADVANCE — APPROVE A1-only fork publication at `929d7427163474f5c0cbfc45192436d3de7540c6`.**

Verified: candidate parents are current release `d62ed60c8` and accepted A1 `831f6a858`; clean tree; exactly four A1 files, **48 additions / 3 deletions**. Newer ACP behavior, app/desktop, versions and release tooling remain preserved. Remote `mine` currently equals `d62ed60c8`.

Evidence: diagnostic substitutions are at `acp-agent.ts:216,232` and `creation/index.ts:208`. Fork publication is triggered by `mine` pushes (`.github/workflows/fork-npm-publish.yml:35`); its dry-run explicitly excludes publication (`:39`). I inspected packaging and failure logs; local green checks and complete ACP143/creation12/diagnostics15 results are accepted on report, not rerun.

**CI remains FAILED.** For this narrowly scoped release, the reproduced baseline failures are nonblocking:
- Windows path normalization and listed browser failures predate A1.
- Slow-scroll failure worsened from baseline retry-pass to candidate retry-fail; retain that instability explicitly.
- Old-daemon creation passed retry. I classify it as a newly observed, nonblocking flake: unchanged app against published daemon0.2.5 provides no demonstrated causal path from A1.

Authorize the coordinator to:
1. Recheck remote `mine`; **STOP and revalidate if it moved**.
2. Non-force fast-forward `mine` to **exactly `929d7427163474f5c0cbfc45192436d3de7540c6`**, triggering existing fork npm publication.
3. Verify workflow success and all seven published package versions before declaring shipped.

This authorizes fork publication only. No upstream stable release, live installation, restart, configuration or manifest activation. C1/C2 publication remains **HOLD**.
