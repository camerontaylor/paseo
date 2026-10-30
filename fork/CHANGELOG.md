# Fork changelog

Fork-local release notes. Upstream `CHANGELOG.md` is never touched; entries here
record fork-only decisions and releases. See
[the archived release-channel plan](https://github.com/camerontaylor/agents/blob/43c872f513edc5e0d529199348dae6b74c5182b5/docs/paseo-fork/archive/fork/plans/ralplan-fork-release-channel.md) for the plan of record.

## 0.14.0 base decision — 2026-10-30

Advance `custom` from `v0.13.2` to upstream stable `v0.14.0`.
Preserve version overrides, side conversations, closed-session fences and
provider policy exclusions. Move the plugin SDK alias checks into upstream's
worker-side compiler and side-conversation targets into the new in-place
subagent target helper, retaining compact side-conversation tabs. Guard idle
runtime cleanup while a side question is pending. Regenerate the enriched-markdown patch from merged
dependency sources, retaining Android selection and table copy.

## 0.13.2 base decision — 2026-10-27

Advance `custom` to upstream stable `v0.13.2` (`d2941157a`). Regenerate the
enriched-markdown patch from a source merge: retain Android cell selection,
short link taps and whole-table copy alongside upstream's settled-row
measurement and lifecycle fixes. The other upstream changes merge cleanly.

Patch application, `build:server`, typecheck, lint and the seven authorization
tests pass. Android device/instrumentation validation remains outstanding.
The [difference audit](https://github.com/camerontaylor/agents/blob/43c872f513edc5e0d529199348dae6b74c5182b5/docs/paseo-fork/archive/fork/audit-0.13.2.md) assesses permanent work and the live
external basket, including upstream replacements and plugin extraction options.
The concurrent unified artifact-version change is retained; its 27 release-tool
and eight native-version tests pass on this base. Neptune's Desvio base pin and
manifest header now name 0.13.2, with backups beside both files. No carries are
removed and no plugins are migrated. Rebuild and gate the basket before
publishing or deploying.

## 0.13.0 base decision — 2026-10-25

Advance `custom` from `v0.12.0` to upstream stable `v0.13.0` (`d34d17a90`).
Thirteen conflicts, all import or union shaped: keep the fork's plugin SDK
alias mapping and side-conversation rows, adopt upstream's plural
`projectAgentMessages`, `SubagentRow.address` and `pickRelayPatch`, and keep
upstream's `pluginReactNativeEntrypoint` compat entry annotated in the derived
SDK specifier list. Upstream removed the WebView terminal renderer; the fork's
terminal selection tests merge without a textual conflict, so re-run the native
selection suite rather than trusting the merge. The Desvio base moves with this
decision; rebuild the basket before publishing or deploying.

## 0.12.0 base decision — 2026-10-20

Advance the preserved beta.3 custom merge to upstream stable `v0.12.0`
(`cafe4b01c`). Keep the five beta.3 conflict decisions and union upstream
subagent selector imports with the fork's side-conversation selector tests.
Retain the beta.3 postmortem below. Rebuild and gate the accepted basket on
this stable base before publishing or deploying. Real OMP on Triton remains
unverified because its selected provider has no credentials; preserve the failed
receipt and verify authenticated providers during host canaries.

## 0.12.0-beta.3 base decision — 2026-10-19

Advance from the reviewed beta.1 custom merge to upstream `v0.12.0-beta.3`.
Skip beta.2 and stable 0.11.4. Keep side conversations, closed-session fences,
ACP cancellation ownership and Pi effort/cache-risk behavior. Preserve upstream
active-query reuse and additive Usage snapshots. Rebuild the accepted beta.1
basket separately, retiring carries only after proving upstream equivalence.
Publication and host deployment remain gated by the fleet release cycle.

## 0.13.0 same-base rebuild: tree-kill carry — 2026-10-25

No new upstream tag: `v0.13.0` was already merged into `custom`. Rebuild
`mine` on the same base to ship the new basket carry
`fix/tree-kill-spare-detached` (upstream #7843, 402d083f5e). Paseo tree-killed
a shared `jcode serve` whenever one ACP adapter (including the short-lived
history-resume adapter) closed, failing every other jcode agent with
`Jcode daemon disconnected` / `Broken pipe (os error 32)`. The carry makes
tree-kill spare `setsid` descendants. This cycle syncs with `origin/custom`
(which carries the `fork/repros/tree-kill-detached` harness) and gates a new
`0.13.0-mine.<stamp>`; the pluto canary also runs that harness.

## 0.11.2 base decision — 2026-10-11

Advance `custom` and the Desvio base to upstream `v0.11.2`, the newest
published release including betas. Preserve the six ordered carries and
keep the ACP model-switch and CLI default-thinking fix as a separate carry.
Rebuild and validate the complete basket before packaging; this cycle stops
before publication and deployment.

## 0.11.1 base decision — 2026-10-08

Advance `custom` to upstream `v0.11.1`. Preserve cancellation ownership,
side conversations and canonical host SDK identity. Repair Usage negotiation
for mixed versions. Move ZCode to the pinned native provider plugin and put
its daemon policy in global and project `AGENTS.md`; keep the system-policy
path for other providers.

Retire observer fanout #3117 and thinking display #4355. Keep only command
argument hints from #3369. Port the remaining six PR carries and fourteen
infi features onto the new base. The validated external basket stays separate
from `custom`; no deployment or publication is implied by this source sync.

## 0.11.0-beta.3 base decision — 2026-10-02

Advance `custom` and the Desvio base to upstream `v0.11.0-beta.3`. The two
intervening betas fix packaged plugin startup and usage source discovery and
authentication. Rebuild the ordered carries, including every infi-pc intake
branch, before deploying the fleet.

## 0.11.0-beta.1 base decision — 2026-10-01

Advance `custom` and the Desvio base to upstream `v0.11.0-beta.1`. Preserve
the ACP cancellation boundary while adopting upstream provider options. Rebuild
the ordered external carries before deploying the fleet.

## 0.10.2 base decision — 2026-10-01

Advance `custom` and the Desvio base to upstream `v0.10.2`. This release fixes
OpenCode v2 long-running turns, edit details, question cards, and context usage.
Rebuild the full basket so the infi-pc intake ports remain above `custom`.

## 0.10.1 base decision — 2026-09-29

Advance `custom` to upstream `v0.10.1`, the latest published release including
betas. Pin the local Desvio build base to that tag; it includes #5227's
external-volume protection. Preserve the fork's side conversations and ACP
cancellation boundary alongside upstream's injectable Claude rewind SDK.

## npm channel goes automatic — 2026-09-13

Scope confirmed as **`@camerontaylor`** (the ADR's "personal scope, pending
approval"). `.github/workflows/fork-npm-publish.yml` publishes every push to
`mine` through npm trusted publishing (OIDC, GitHub-hosted runner, provenance
attached) — no long-lived token, which npm is retiring for CI anyway. The
first version of each of the 7 packages still has to go out with a token
(npm cannot attach a trusted publisher to a package that does not exist,
npm/cli#8544); the workflow carries a one-run `BOOTSTRAP_NPM_TOKEN` path for
that. `release-fork.mjs` gained `--fork-number auto` (next N from the
registry), `--no-github-release`, pushes only the tag (never the branch), and
stamps `<base>-fork.N` when the base is a stable release: `0.8.0.fork.1` is
not semver and npm rejected it at pack time. First automatic version:
`0.8.0-fork.1`.

## 0.7.0-beta.2 base decision — 2026-08-30

Fork base advanced to upstream `v0.7.0-beta.2` (4e60c2880b4c9ebdb9937be4782a21406bab9933,
CI green at tag time): the fork daemon must not be older than the stock
0.7.0-beta.2 client it replaces
(`fork/plans/ralplan-fork-release-channel.md`, Sitting 1 step 1). Branch
`plan/fork-release-channel` rebased onto the tag ahead of the first fork release
(0.7.0-beta.2.fork.1).
