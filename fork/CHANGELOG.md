# Fork changelog

Fork-local release notes. Upstream `CHANGELOG.md` is never touched; entries here
record fork-only decisions and releases. See
[the archived release-channel plan](https://github.com/camerontaylor/agents/blob/cd412623d27b7f46ad2d7be5aa3fe782c0938947/docs/paseo-fork/archive/fork/plans/ralplan-fork-release-channel.md) for the plan of record.

## 0.16.0-beta.2 base decision — 2026-11-12

Advance custom to upstream `v0.16.0-beta.2`
(`b7605043878e509699bf2d8428253a257dda478d`), retaining merged PR27's
lean checkout-placement lookup. Keep the existing TMAD-derived carry for
this release; its removal is a separate task after fleet activation.

The beta and stable branches diverged before 0.15.3. Where custom was
byte-identical to that stable tag, use the beta's updated owner, including
responsive control sizing. Preserve fork-specific changes at the shared
provider, side-conversation, plugin and protocol seams.

ACP disconnect failure and abandoned-approval cleanup now share the fork's
stop/successor admission path. The reservation rechecks transport death
after queued admission, and terminal delivery leaves slot ownership to the
identity-checked settlement path. Merge the enriched-markdown patches on
their applied package sources, retaining Android table selection and copy
alongside the beta's web inline-image fixes. Regenerate dependency metadata
and the Nix hash from the merged manifests.

## 0.15.2 build and deploy — 2026-11-06

Built `0.15.2-fork.261106-2234.gae9279071e78` from
`ae9279071e783898b5180a917805e8aa3c325e60` and published it: all seven
packages resolve from npm and `mine` pushed cleanly through
`fork-npm-publish.yml`. The basket carry needed one adaptation commit
(`upgrade/basket-0.15.2`): 0.15.2 removed `buttonControlHeight`,
`FieldControlSize` and the `xs` control size, and the merge applied the
carried UI hunks cleanly beside custom's new-API code, so only typecheck
saw it.

Deployed to pluto (canary), ceres, makemake and triton, each verified on
the stamp with real Claude and Codex turns on pluto. Pluto needed a manual
step: its unit is a read-only nix-store symlink and the fork pin lives in
`/etc/systemd/system.control/paseo-daemon.service.d/90-fork-release.conf`,
which `setup-paseo.sh` does not rewrite, so the first run restarted the
old 0.14.0 pin and reported success.

Saturn failed. Its one-shot deploy installed the arm64 bundle and reached
`canonical-daemon-start`, but the launchd-started daemon stalled after
`Workspace registries bootstrapped` with the main thread blocked in
`open()`; it never listened, and the starter gave up with `not ready`
after 600s. Reproduced on a second kickstart. The same bundle started from
an ssh shell (`daemon start`, identical argv) served health 200 in
seconds, and a copy of the state dir without `models`/`runtime`/
`opencode-worktrees` also started under ssh, so the trigger is the launchd
job context and not the state or the bundle alone. The preserved 0.14.0
bundle in the same job started in 10s, so saturn was rolled back to
`0.14.0-fork.261030-0840.g64487f6805ee` and left healthy on it. Neptune was
not deployed: the cycle stopped at the failed host.

## 0.15.2 base decision — 2026-11-06

Advance `custom` from `v0.15.1` to upstream stable `v0.15.2` (`e896c05b0`),
a direct descendant of the previous base. 190 files, no conflicts. The
release is the first-run setup flow (#8363, #8824): `packages/app/src/onboarding/`
and `packages/app/src/project-suggestions/` are new, first launch goes from the
loading screen into setup, the theme picker becomes a tile grid, and controls
collapse to two sizes.

It touches six files the fork also edits, and every one auto-merged: the nine
i18n resource files (fork strings beside upstream's new setup keys),
`protocol/src/messages.ts` with `authorization/operation-permissions.ts` (both
exhaustive over message types, so a missed fork entry fails closed),
`server/src/server/session.ts`, `websocket-server.ts`,
`client/src/daemon-client.ts` and the theme-driven
`screens/workspace/workspace-desktop-tabs-row.tsx`. Typecheck is the gate that
catches that class; lint does not.

`npm ci`, `build:server`, typecheck, lint and the seven authorization tests
pass on neptune, plus the node suites for the seam features: app 232 (side
conversations, subagents track, workspace tabs, panel manifest, i18n
resources, native release version), server 348 (session, side conversations,
provider registry wrap, plugin compiler and process), protocol 23, client 256.
Android device validation remains outstanding.

## 0.15.1 base decision — 2026-11-05

Advance `custom` from `v0.15.0-beta.1` to upstream stable `v0.15.1`
(`c4dc36272`), a direct descendant of the previous base. Nine commits, no
conflicts. Interrupted-agent recovery becomes opt-in (#8619): `bootstrap.ts`
and `config.ts` flip the `resumeOnStartup` default beside the fork's
system-prompt policy fields, and no fork code relies on the old default.
Native chats keep reconnect and update status visible (#8568), and the daemon
starts when the terminal worker cannot (#8810).

`npm ci`, `build:server`, typecheck, lint and the seven authorization tests
pass on atlas.

## 0.15.0-beta.1 base decision — 2026-11-03

Advance `custom` from `v0.14.0` to upstream `v0.15.0-beta.1` (`8bd38fb23`),
the newest published release including betas; `v0.15.0-beta.1` continues from
mainline, which diverged from the `v0.14.0` release branch at `8419c2122`, so
both sides carried version-field changes. Thirty-one conflicts: version
fields, the lockfile and the store-screenshot staging take upstream; the fork
keeps side-conversation rows, sheet targets, event-selector gating, the
`pkg.version` app version source and the system-prompt policy picker.
Upstream's terminal-keep capability, agent-resume settings and the
`./internal/lifecycle` plugin export land beside the fork's seams. The fork's
enriched-markdown patch is already a content superset of upstream's — the
file-level conflict was textual only, and the fork's patch applies to the
pristine package unchanged.

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
The [difference audit](https://github.com/camerontaylor/agents/blob/cd412623d27b7f46ad2d7be5aa3fe782c0938947/docs/paseo-fork/archive/fork/audit-0.13.2.md) assesses permanent work and the live
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
