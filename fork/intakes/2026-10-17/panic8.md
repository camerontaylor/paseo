# colonelpanic8 intake — 2026-10-17

## Decision

Keep our adapted #2785 account carry on the beta upgrade. The author's refreshed branch adds **no demonstrated account feature gap** against `fork/carries-0.11.1@36fdadba65369dc41feb756d5b2c6004dc2a17e8`. The three highlighted October 15 interface repairs are already present in our adaptation. Do not cherry-pick the refreshed account series merely because its SHAs changed.

Treat usage history as a separate, substantial feature intake, outside the inexpensive PR-addition lane. Never merge `assembled` wholesale: it bundles unrelated topics and performance proposals now superseded by stronger upstream beta implementations.

This is source/equivalence evidence, not confirmation that a running daemon or client has these features deployed. No production inspection or mutation was performed.

## Verified sources

- Latest upstream prerelease from GitHub releases API: `v0.12.0-beta.1`, published 2026-10-16 19:57:52 UTC. Stable `v0.11.4` predates it.
- Account source: https://github.com/colonelpanic8/paseo/tree/multi-account-provider at `63916fe3003da650fe418fb94856d038c534caea`.
- Recorded source: `refs/research/fork-refresh-accounts-20261008=f9ee6713b3d2050734fc87113f000cad8ed6dd4d`.
- `assembled` / `assembly-candidate`: `558947f02e0bcf90447dacce990b892605926dc3`, committed October 15.
- `usage-history`: `7dc20c0503f94e02bf4732b060d60a134ef7a6a0`.
- `usage-history-all-hosts`: `dea4100133cf0df52a42ae1e4bbfef25eb5c5248` (older topic version; choose refreshed usage-history instead).
- Documents read: provider conventions, protocol compatibility, control-worktree upstream-since-0.11 analysis and campaign baseline-equivalence. The campaign recorded account refresh as a no-op; current code supports that verdict.

## Account equivalence evidence

GitHub comparison reports 121 ahead / 15 behind between source snapshots. This includes rebased topic commits and upstream drift, so it is not an outstanding-work count.

| Author update | Our carry evidence | Disposition |
| --- | --- | --- |
| `58fc1f22447d`: current theme | `provider-account-sheet.tsx` already uses `theme.fontSize.sm` for rename warning and environment error | Already adapted |
| `2c1f5406f941`: refreshed forms and snapshot-manager stubs | Sheet already supplies `initialValue` without removed `value` props; `session-stubs.ts` already defines and returns `prepareMutableProviderConfig` spy | Already adapted |
| `c303ca721cc4`: daemon target CLI | Both provider `add.ts` and `rm.ts` already call `getDaemonHost({target: options.daemonTarget})` and `connectToDaemon({target: options.daemonTarget})` | Already adapted |
| `63916fe3003d`: remove dependency on banked reset topic | Our adapted usage registry does not serialize `bankedResets` | Already independent |

Our account port `bac68296d71fcf3f0adc8f60adffef6d3bc9ba2f` explicitly preserves creation/editing/renaming/provider-home routing while adopting scoped discovery, ordered harness logins, streaming reports and configuration invalidation. The carry includes account grouping/icon inheritance and agent/provider relationships. Upstream quota usage does not replace account management.

### Upgrade integration and acceptance

1. Preserve the carry's user behavior while merging beta's provider-removal/config-transaction changes. Inspect `daemon-config-store.ts`, provider snapshot manager, WebSocket rename handler, agent record migration and account discovery together. Do not replace our scoped usage registry with an old source copy.
2. Recheck our optional protocol account/base-provider fields; regenerate protocol validation using the repository process if changed. Preserve backward parsing and use beta capability rules.
3. Run existing, relevant files individually on a build-capable host after current declarations are built: account form model, settings providers section, CLI provider/add, agent storage, daemon config store, provider snapshot manager, provider-account discovery/accounts, WebSocket provider rename. Run typecheck and lint as repository policy requires.
4. Existing browser specs `provider-account-create.spec.ts` and `provider-removal.spec.ts`: create/edit/rename/remove an account, verify derived provider ID and inherited icon, and ensure independent provider-home environment. Verify CLI add/remove chooses the requested daemon target.
5. Extend existing rename coverage only if beta integration exposes a gap: live and persisted agents, configured defaults/schedules as applicable, no half-applied rename or removal on failure. Confirm scoped usage picks the selected account before first turn and after editing home configuration. Never require provider authentication in tests.

These are planned checks; no tests were run by this read-only intake worker.

## Usage history: real additional feature, larger than a cheap carry

The refreshed topic's isolated range is `6db47b3c37f702b8647a6c8667b685bfe74091f0..7dc20c0503f94e02bf4732b060d60a134ef7a6a0`: **24 topic commits, 57 files, 9,970 additions**. Comparing to author `main` hides this behind 1,193 upstream-plus-topic commits and a truncated file list; use the isolated range.

No `provider-usage-history` or server `usage-history` files exist in our account carry. This is a genuine new feature, not an account refresh. It scans Claude and Codex transcript homes, resolves configured account homes, deduplicates realpaths and repeated events, reads Codex archived sessions, estimates costs and renders cross-host history with grouping/sorting/chart controls. Keep it distinct from live subscription quota. The source documentation's reference to a legacy quota-fetcher path should be corrected to our plugin-owned live usage pipeline when adopted.

Bounded packages for a later dedicated worker:

- **P8-H1 — Contract and scanner:** optional capability `providerUsageHistory`, dotted `provider.usage_history.read.request/response`, client method, bounded streaming transcript reader, per-home/account resolution, aggregation, scan cache, pricing and server session wiring. Source first commits `6c60e41e6c3b`, `d661f053bbc5`, bounds `1dfc6cd873c9`, configured homes `7d2cc9612291`, source fingerprint `1dcdd83a10e3`, archived Codex `8dd48019d5f7`. Keep scans out of active provider paths and bound concurrent I/O/record memory. Tests: existing transcript, transcript-reader, provider-homes, aggregation, pricing, scan-cache, service and usage-session files.
- **P8-H2 — Multi-host UI:** use refreshed `usage-history` branch, not older all-hosts. Gate each host once, show offline/error/unsupported coverage, merge shared transcript sources without counting a shared home twice, retain account attribution and unpriced cost notices, day/week/month grouping, sorting, chart controls. Tests: derive, merge, curve, view, window, section and existing provider-usage-history browser spec. Since this changes settings routes/ownership, read `docs/expo-router.md` before implementation.
- **P8-H3 — Source follow-ups outside topic head:** branch `perf/usage-history-subagent-tokens@9300f23c078689804cb1997f7a9e4606ad0031fb` actually adds local-midnight window rollover tests/repair; branch `perf/usage-history-token-fix@cacac662b710d67edecfa4f2534872f585c6b2d9` actually adds persistent last-payload rendering while fresh scans run. Inspect commit behavior, not branch names. Apply after H2 if straightforward. Cached results must not mask a failed host scan.

The user's full-TMAD requirement does not imply that this unrelated 10k-line panic8 feature is already active. Report it explicitly as separate optional intake.

## Assembled fork and upstream performance overlap

The assembly includes source PR #4827 and #4831 along with #4828/#4829/#4830/#4832/#4833, voice, usage history, Android intents and other topics. It is a source catalogue, not a safe upgrade base.

- Beta merged https://github.com/getpaseo/paseo/pull/7052 on October 15: builds on #4827, **bounds retained history-window caches**. Retaining author #4827 on top can restore the old retention bug. Keep beta's implementation.
- Beta merged https://github.com/getpaseo/paseo/pull/7074 on October 16: replaces #4831's overlay with row-scoped invalidation. The author overlay could return unpersisted data after failed writes and stale rows after host remove/reactivate. Keep beta's durable-read behavior. Retry/backoff scope remains independently tracked in #5491; do not claim complete equivalence for that separate behavior.
- Defer unspecified assembled topics until isolated against beta and the TMAD/infi workers' ownership. Prefer existing upstream candidate PR intake when the same fix appears there.

## Worker result / handoff

Panic8-account refresh: **no new port needed**; preserve behavior and verify on beta. P8-H1/H2/H3: separate optional feature worker after core beta upgrade, with route/protocol/performance review. Whole-assembly merge: **defer**. Production activation: **not verified**. No source edits, branch/ref changes, builds, test suites or service actions were performed.
