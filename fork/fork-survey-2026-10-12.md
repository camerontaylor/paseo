# Fork survey, 2026-10-12

Snapshot: **2026-10-12**. Companion to
[upstream-prs-2026-10-12.md](upstream-prs-2026-10-12.md), which covers the same
window's pull requests. Read with the 2026-08-22 survey
([upstream-research-2026-08-22.md](upstream-research-2026-08-22.md) §2-4), which
mapped the fork corpus from the beginning.

## Method and numbers

`getpaseo/paseo` had **2,417 forks** at snapshot. The GitHub forks API cannot sort
by `pushed_at`, so the sweep enumerated forks sorted by newest and by stargazers,
filtered to those pushed on or after 2026-09-28, and compared each against
`getpaseo/paseo:main` with the compare API.

| Stage | Count |
| --- | --- |
| Forks enumerated | 2,417 |
| Pushed since 2026-09-28 | 549 |
| Of those, `created_at != pushed_at` | 356 |
| Owners with no PR in the window (not a PR branch push) | 272 |
| Compared against upstream `main` | 545 |
| With commits authored by someone other than the maintainer | **129** |

`forkCommits` (commits not authored by `boudra`) is the field that matters.
`ahead_by` counts maintainer commits a fork merely absorbed, which is why the
prior survey found six forks "40-2,954 commits ahead" with no fork work. It is
capped at 250 by the compare API and the file list at 300, so the largest forks
undercount.

Four scout workers took the corpus: the 25 heaviest divergences, the 52 mid-tier,
the 52 smallest, and a re-check of the 32 forks named in the 2026-08 survey.

## What the sweep found

**Most of the corpus is sync traffic.** Of the 545 forks compared, 416 have no
non-maintainer commit at all: they pushed only because they fetched upstream, or
because their owner opened a PR from a feature branch. Renaming remains a weak
signal.

**The 2026-08 roster is largely dormant.** Seventeen of the 32 named forks have
no commits after 2026-09-28 on their surveyed branch: `haikostudio`,
`AngusFu`, `sakurayun`, `hinneslung`, `citizenll`, `affil-ai`, `PowerDi`,
`jingwangsg`, `hahahuy`, `hubtool/hubcode`, `sumaliqinghua`, `mcrowder65`,
`jtalborough`, `figuernd`, `cleiter/desvio`, `JrDw0`, `BAS-More`. Three
repositories are gone: `amitbtcai/paseo`, `alnimra/paseo`, `JLarky/paseo` all
return 404. `hinneslung`'s VS Code extension, the most credible fork product in
the old survey, has not pushed since 2026-09-21.

**The infi-pc intake source is exhausted.** `infi-pc/paseo` is now **0 ahead, 239
behind** upstream: its commits are upstream changes already in our base. The
ledger's four infi features have nothing further to port. Stop checking it at sync.

**`colonelpanic8/paseo` needs care.** Its default `main` is dormant since August,
which reads as zero in both this sweep and the old one. Its previously surveyed
`assembled` branch is alive (674 ahead / 38 behind) and is a rebuilt PR basket
rather than independent work. Do not read the default-branch zero as a verdict.

**The fork corpus is converging on upstream's provider table.** The
"Keep a custom Codex provider and Paseo tools after rewinding" chain
(`walter-erquinigo/paseito`, `Jank1310`, `z0rgoyok`, `Hypnocratic/myseo`,
`desflynn`) and the "Revert reflow after pane resize" chain (`yinaoxiong`,
`devorbitus`, `RDeluxe`, `lzm04521`) each look like several forks and are one
lineage. Count them once.

## Mines

Small, verified against this checkout, and extractable without the rest of the
fork. Each is a fix or a narrow capability, not a product.

| Fork | Extract | Where it lands here |
| --- | --- | --- |
| **papag00se/paseo** | Git `diff.mnemonicPrefix` parsing (`c/i/w/o` prefixes) plus no-prefix rename disambiguation. Two files, +130/-9. | `diff-highlighter.ts:46-47` accepts only `a/`+`b/`. **Upstream #4233 proposing the same fix is CLOSED, `mergedAt: null`.** This is the clearest carry in the sweep. |
| **fiuhq/paseo** | Kill Git's whole process tree on timeout or output overflow, with real-process tests. +238/-6. | `run-git-command.ts:420-432,438-448,487-491` signals only the child, so a hung `GIT_SSH_COMMAND` survives cleanup. Review the un-timeouted `ps` call before taking. |
| **infectiousstupidity/paseo** | Tolerate plugin IPC closure during shutdown: send-before-disconnect, always pass a send callback, guard repeated `disconnect()`. Two files. | `plugin-process.ts:550-561` sends without a callback when the caller omits one and disconnects unconditionally. Already fork-patched, so take a hunk, not the file. |
| **dgk-dev/daseo** | Never signal a child whose spawn failed; distinguish a real `ChildProcess` with no PID from an in-memory test target. | `tree-kill.ts` falls back to `signalDirectChild` when `pid` is missing. Sits below the ACP/GJC cancellation boundary without replacing it. |
| **fl4p/paseo** | Replace a terminal worker that exits on its own, replay cwd environment, ignore messages from a replaced worker. | `worker-terminal-manager.ts:153` forks once; `:605-620` only rejects pending requests on exit and `sendRequest` rejects permanently after. Recovery is absent. Carry the tests, not fl4p's force-stop series, which competes with our cancellation. |
| **smdex/paseo** | Keep authoritative assistant snapshots for a plugin provider's final text while continuing to emit deltas. Four-case test. | `plugin-provider.ts:1147-1154,1692-1699` with `provider-runner.ts:33` defaulting to replacement, so a growing answer leaves only its suffix in `finalText`. |
| **everruns/paseo** | Fall back from `rawOutput` to ACP text content before the generic "Tool call failed". | `acp-agent.ts:4544,4900-4905`. Touches our GJC/ACP-owned provider but not cancellation state. |
| **Anurag-Raut/paseo** | Settle a replica row read when the IndexedDB transaction fails, by awaiting request and completion together. | `row-store.web.ts:120-132` awaits them sequentially, so a failing transaction can hang. Browser and Electron both benefit. |
| **MaxFangX/paseo** | Two commits: do not restart the Claude query that owns the foreground turn, and ignore persisted split sizes whose length no longer matches the children. | `claude/agent.ts:2635-2650,3283-3305` (fork-owned, preserve our session-open guard); `app/src/components/split-container.tsx:967-972`. |
| **mduan/paseo** | Do not resurrect a workspace when an archive request times out after the daemon already removed it. | `workspace-archive.ts:93-99` restores unconditionally on rejection while `workspace-replica.ts:184` has already cleared the pending marker. |
| **enemyrr/buildr** | Keep PR wrap-up archive promotion out of a long-lived main checkout. | `app/src/git/use-actions.tsx:151-158` promotes on clean status plus merged PR with no owned-worktree condition. Protects our disposable-worktree distinction. |
| **team-harness/paseo** | Clear a failed agent replacement and publish settled lifecycle instead of leaving a stale `running` label. | `agent-manager.ts:2830-2844,2977-2990` clear `pendingReplacement` without restoring published state. Must be adapted around our cancellation lane; exclude the fork's completion-watcher change and its usage dashboard. |
| **lanej/paseo** | Scope explicit directory suggestions to the named parent. | `utils/directory-suggestions.ts:614-622` returns a rooted plan without the direct-child flag, so a query can search unrelated subtrees. |
| **tzheng11/paseo** | Bound JSONL frame decoding: count bytes before accumulating a line, decode across Buffer boundaries, fail an oversized frame instead of growing forever. | `jsonl-frame-decoder.ts:80-99` appends unrestricted. Take only the decoder and its callers; the commit also rewrites history authority in `agent-manager.ts`. |
| **rui-movio/paseo** | Read Claude Code `modelPicker` from `settings.json`, including gateway-only catalogs. | `claude/models.ts:99-115` reads only `model` and env. Useful only if a gateway emits the setting. |
| **zeyugao/paseo** | Resolve a config symlink before the atomic write, and keep a dangling link a rejection rather than a silent replacement. | Overlaps upstream open **#6023**, which fixes `private-files.ts:30-36`. Take #6023 as the carrier and this fork's dangling-link and relative-link tests as coverage. |
| **devorbitus/paseo** | Make overflowing settings select menus scrollable. One prop. | `components/settings/index.tsx:132`. Ignore the same fork's iPad-revert ancestry, which is upstream's. |
| **howardlau1999/paseo** | Honour `proxy-from-env` for daemon WebSocket connections with an `HttpsProxyAgent`. | `relay-transport.ts:61-63` and `hub/relationship-remote.ts:163-172` build sockets with no agent. Conditional: only if this fleet needs HTTP proxy egress. Not SOCKS; `YoungCatChen`'s SOCKS relay proxy is a separate, 902-behind option. |

## Watch

| Fork | What | Blocked on |
| --- | --- | --- |
| **mduan/paseo** | Serialize worktree deletion with a `pLimit(1)` queue and re-check references when a queued deletion starts. | Our `utils/worktree.ts` has no queue and `workspace-archive-service.ts:390-410` checks references before calling. The fork admits queued intent is lost on restart and creation is not serialized. Separate design review. |
| **suislurper/paseo** | Retry a failed provider catalog probe after a 30 s cooldown instead of pinning the provider to error. | Its cache is 1,385 commits behind ours. Extract the error-versus-unavailable contract into `provider-snapshot-manager.ts:957-963,1054-1060`, where discovery failures are currently cached as results. |
| **gszep/paseo** | Drain running work before a wait-idle daemon restart. | Crosses `agent-manager.ts`, `session.ts`, protocol and client, and must account for GJC/ACP cancellation and side conversations. Not cheap. |
| **iExalt/paseo** | Give an AppImage-installed CLI supervisor its own mount so it outlives the launching CLI. | Only if we ship an AppImage CLI. Reject its signing and promotion channel; releases are ours. |
| **broomva/paseo** | Bound supervisor crash restarts after readiness, with delay and jitter. | `packages/server/scripts/supervisor.ts:402-413` respawns immediately today. The startup hot-loop motivation is obsolete because `:390-393` already exits on failed readiness. |
| **juanlatorre/paseo** | Keep the last successful usage report for up to an hour when a refresh fails. | Our cache key includes ordered logins and labels (`usage-sources/index.ts:237-240`); the fork's is account-ID only. Rework around the scoped key so stale data cannot cross credential scopes. |
| **jstdlee/paseo** | Publish Linux arm64 desktop artifacts and the architecture-specific updater manifest. | Only wanted if we deploy arm64. Our `.github/workflows/desktop-release.yml` handles the generic manifest; this is a lane, not a release owner. |
| **Juns-g/paseo** | Activate inherited HTTP proxy env for Electron-launched Node daemons. | Three lines in `node-entrypoint-launcher.ts:26-34`. Validate real Electron HTTP behaviour first; an existing `NO_PROXY` replaces the loopback defaults. |
| **zhab1/paseo** | Page Codex history and defer idle Codex context restoration. | 48 files, 2,401 additions, crosses `agent-manager.ts` and provider-registry seams. Needs a measured reproduction before anything. |
| **CN-liuzhiyang/paseo** | Deliver scheduled run results to plugin-registered outbound channels. | `schedule/service.ts:712-737` completes a run with no channel handoff. One attempt, 60 s timeout, no durable retry. Watch until unattended reports must reach a channel. |
| **colonelpanic8/paseo** (`assembled`) | Merge usage history across every host. | Depends on that basket's own history topic. Watch the merge/derive tests as the smallest extract; do not import the 674-commit basket. |

## What forks are building that upstream has not answered

These are signals about the product, not carry candidates. Several are things our
ledger already owns, which is the useful part: independent forks reaching the same
conclusion is evidence the gap is real.

- **Usage, cost and quota across accounts and hosts** is the most repeated new
  capability in the sweep: `team-harness` (persistent usage ledger plus a status
  bar), `marushan49/pandaos` (one card per account, add-account sheet),
  `colonelpanic8` (cross-host usage history), `juanlatorre` (stale report
  retention), `ajmariduena` (show whether an agent bills a subscription or an API
  key), `allrested` (every logged-in Claude profile). This is adjacent to our
  Usage protocol compatibility work: keep the wire negotiation, do not build a
  second reporting model.
- **Side conversations stay unclaimed upstream.** `marushan49/pandaos` ships `/btw`
  as `btw/client/side-agent.ts` and `btw/client/panel.tsx`. It is the only fork
  implementation, and it duplicates ours. The 2026-08 read holds: no upstream
  answer exists, and writeback is still unsolved everywhere.
- **Provider account registries.** `edihasaj/paseo` (70 commits) pins agents to
  provider accounts. This is the same question as upstream #2785, which is already
  in our basket. Support that, do not start a third model.
- **Crash and restart recovery of running agents.** `iamriajul` (auto-resume after
  power cut), `zhab1` (recover running Codex agents), `frontend-london`,
  `broomva` (supervisor budgets), `team-harness` (stuck replacements). A
  recurring defect class, and `gszep`'s restart drain is the most complete answer.
- **Self-hosted distribution.** Roughly a dozen forks ship their own release
  channel (`iExalt`, `jstdlee`, `yinaoxiong`, `devorbitus`, `lzm04521`,
  `RyanEwen`, `yooztech`, `staoran`, `mathiaskk`, `LouisJalouzot`, `ThePharmer`,
  `zuna2026x7`). Our channel is owned; the pattern says upstream still has no
  self-hosting story.
- **Worktree lifecycle safety.** `mduan` (deletion queue), `enemyrr` (promotion
  gate), `suislurper` (reserve Git capacity before checkout). Our transient
  worktree setup is a fork-owned seam; these are downstream of it.

## Discarded, by reason

- **Competing product architectures**: `AubreyF/vorteo` (container factory),
  `BAS-More` (Docker/Kubernetes/RBAC stack), `iamsxm` (PocketBase host sync),
  `daedal-one` (DSH client), `Xenonesis` (Tauri shell), `tmad4000`,
  `ajmariduena`, `finelly977`, `sylvaindiv`, `isleei`, `drzfan`.
- **Another answer to something we own**: `marushan49` (`/btw`),
  `chenxhhh` (`acp-agent.ts` cancel replay), `naytewilson`/`rohan-patra`/`n24q02m`
  (steering and settlement), `gszep`'s Chi integration, `fl4p`'s force-stop series.
- **Duplicates our release channel**: `yooztech`, `LouisJalouzot`, `mathiaskk`,
  `cyberneticlabs/zekoder-studio`, `RyanEwen`, `staoran`.
- **Maintenance only**: `nguyendinhquocx`, `WolffyCode`, `gpambrozio`,
  `panrafal`, `fsinbad`, `ggondim`, `Rajendertyagi`.
- **Platform outside our use**: `Ynd-i/codex-app`, `jeroenfrenken` (iPad
  keyboards), `jasonmarkperez` (Android terminal), `cescox` (macOS Electron
  helper), `Pukujan` (Windows installer), `ThePharmer`, `zuna2026x7` (Android
  builds), `ding113` (Mac App Store).
- **Claims not reproduced**: `HamiltonHuaji`'s `a5f64b1ef` says Node readline
  splits U+2028/U+2029; a probe here preserved both in one frame, and the same
  commit bundles an unrelated fallback. `lisachandra`'s replica-cache retry loop
  is already answered at `runtime/replica-cache/index.ts:1000-1005`.
- **One to avoid on sight**: `MovieHolic-Plex/paseo`'s history contains
  `security: remove exfiltrating workflow (POST to 193.32.204.199)`. The subject
  is evidence about its history, not a claim the current tree is malicious, but
  there is no reason to ingest that lineage.

## Verification

Hand-checked here: `infi-pc/paseo` compare is 0 ahead / 239 behind;
`amitbtcai`, `alnimra`, `JLarky` return 404; the papag00se, zeyugao and fiuhq
commits exist with the stated file scopes (`diff-highlighter.ts`,
`persisted-config.ts` + `private-files.ts`, `run-git-command.ts` +
`kill-process-tree.ts`); `run-git-command.ts:420-432` signals only the child;
`tree-kill.ts` falls back to `signalDirectChild` with no positive PID;
`plugin-process.ts:550-561`; `worker-terminal-manager.ts:153,605-620`;
`utils/worktree.ts` has no deletion queue; `row-store.web.ts:120-132`.

`forkCommits` is a snapshot of the compare API on 2026-10-11, capped at 250, and
counts commits rather than features. No fork was cloned, built or run.
