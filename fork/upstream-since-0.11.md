# Upstream since v0.11.0-beta.3

Research date: 2026-10-08 (Australia/Melbourne). Latest published upstream version: **v0.11.1**, published 2026-10-07 21:22:22 UTC. A second fetch during the implementation follow-up found this release; no v0.12.x or later release/tag was found.

The upgrade brings a reviewed plugin registry, richer plugin runtime APIs, account-scoped Usage, Explorer tab changes, and provider/lifecycle fixes. The three main fork risks are provider cancellation and side-conversation behavior, plugin host-module identity, and client/daemon contract drift. Upgrading alone does **not** address the reported date-shaped MCP protocol rejection.

## Scope and evidence

Ran `git fetch upstream --tags --prune` successfully. Remote origins match the supplied context: `origin` is `camerontaylor/paseo`, `upstream` is `getpaseo/paseo`. The initial research left `custom` at `24f134618` and made no source changes. The later user instruction explicitly authorized the source upgrade and Sol medium lanes; implementation results are recorded below. The production daemon has not been restarted.

Base tag resolves to commit `6166a7aca`; `cbd1210c7` is the fork's recording commit, not the upstream tag target. The supplied deployed version, `0.11.0-beta.3-mine.261002-1406`, was not independently checked against a live daemon. The collision statistics compare source on `custom`; the follow-up carry audit below separately examines the live Desvio manifest used to build `mine`.

Read the local protocol, plugin, permission and fork sync/ownership documents. Release evidence comes from `gh release view <tag> -R getpaseo/paseo` for the four later versions and v0.10.3, plus the paginated GitHub releases API. Source evidence comes from tag-to-tag diffs and logs. The existing fork-document namespace is `fork/`; this report uses `fork/upstream-since-0.11.md` instead of creating `docs/fork/`.

## Release inventory

Dates below are GitHub publication dates in UTC; beta.5's changelog heading uses October 6, while GitHub published it on October 5 UTC.

| Version | Published UTC | Commit | Headline changes relative to the preceding tag |
| --- | --- | --- | --- |
| [v0.11.0-beta.4](https://github.com/getpaseo/paseo/releases/tag/v0.11.0-beta.4) | 2026-10-05 02:33:37 | `6b00310f7` | Introduced registry infrastructure, initially behind a daemon flag; Explorer tabs unified with workspace tabs; account-specific context Usage and hover details; audio and closed-agent plugin APIs; chat scroll/image stability; ACP permission cleanup and context usage; resumed modes, directory-search isolation, npm-prefix updates, and CLI error/restart fixes. |
| [v0.11.0-beta.5](https://github.com/getpaseo/paseo/releases/tag/v0.11.0-beta.5) | 2026-10-05 23:30:52 | `15d774d4a` | Plugin process helpers and Windows CLI launch support; Muse model/history fixes; OMP failed/rejected/hidden-message turn settlement; SSH daemon-password input; CLI/daemon closed-output handling; Nix packaging, desktop dragging, copy-selection and tablet keyboard fixes. |
| [v0.11.0](https://github.com/getpaseo/paseo/releases/tag/v0.11.0) | 2026-10-07 13:53:05 | `22488d450` | Registry installs enabled by default; plugin display/media metadata and overview scaffolding; Usage becomes a dialog/sheet; Vue highlighting; Claude foreground/background helper separation; bounded ACP close, archived history and configured-model fixes; OpenCode v2 denial/dismissal settlement; relay handshake timeout and further desktop/chat/localization fixes. |
| [v0.11.1](https://github.com/getpaseo/paseo/releases/tag/v0.11.1) | 2026-10-07 21:22:22 | `ee398100f` (annotated tag; commit `ab10a6694`) | Haiku 5.5 with Claude Code 2.1.293+; long-running tools stop appearing as subagents; disconnected completed subagents reconcile; Claude transcript history works across project folders and WSL. |

**Release-note caveat:** upstream folded earlier betas into cumulative notes in beta.4. Muse, Antigravity, OMP steering/Fast/Auto, provider option defaults, plugin screens/sidebar contributions, usage discovery, and pairing confirmation already exist in beta.3. They are not newly gained by this upgrade. The currently served beta.5 release notes mention registry-by-default, but commit `7fd469ae1` enabling it is between beta.5 and stable. The inventory above follows the tagged source for timing.

[v0.10.3](https://github.com/getpaseo/paseo/releases/tag/v0.10.3) was also published after the base, on 2026-10-02 12:37:45 UTC. It is a lower-version hotfix line, not a successor to beta.3. Its pairing-link confirmation (#5753) was already in beta.3; it adds no upgrade benefit here.

Fetched `upstream/main` is now `99fc204c5`. The provider/history/subagent fixes previously seen after stable 0.11.0 are shipped in v0.11.1. Use v0.11.1 as the reproducible upgrade target; keep the statistics and comparisons below scoped to 0.11.0 where explicitly stated. The additional 0.11.0 → 0.11.1 diff touches 38 files (+639/−119), including release versions and these fixes.

## Changes by theme

### Features and behavior

- **Plugins:** reviewed registry installation and public directory; display name/icon/media; `OVERVIEW.md` scaffolding. These are the largest new product surface since this base.
- **Usage:** context details select the account the agent actually uses, including custom provider homes; reports arrive progressively; all failed login diagnostics can be shown. Desktop opens Usage over the current screen and mobile uses a sheet. Sidebar window pinning and names are refined.
- **Workspace/client:** Explorer uses ordinary tab behavior, including add, drag and Close. Chat pagination preserves reading position and reserves image space; copying code/list/image selections is corrected. Desktop dragging, browser typing focus, native keyboard/sidebar retention, macOS terminal editing, Vue/Astro highlighting and translations improve.
- **Providers/reliability:** Claude thinking and background-helper reporting, live-mode persistence and Bedrock/Vertex mode changes; ACP usage, failed-turn permission cleanup, close timeouts, removed-worktree history and configured models; OMP rejected/hidden-message settlement and history rendering; OpenCode server readiness and v2 permission/question completion. Relay reconnects now recover from a stalled encrypted handshake. Filesystem search cannot monopolize all worker threads.

Source ranges: [base → stable](https://github.com/getpaseo/paseo/compare/v0.11.0-beta.3...v0.11.0), [stable → fetched main](https://github.com/getpaseo/paseo/compare/v0.11.0...b352dad2e).

### Breaking changes and contract changes

| Surface | Finding | Upgrade implication |
| --- | --- | --- |
| Config | Adds optional root `pluginRegistries` (host-keyed authorization settings) and `PASEO_PLUGIN_REGISTRY` override. `pluginsEnabled` still defaults false. No required-field migration/removal was found in the persisted-config diff. | Preserve current plugin entries, provider homes, credentials and runtime paths. Registry availability does not authorize enabling installed plugin execution. |
| Plugin source CLI | Bare `owner/slug` now selects the registry, ahead of local-directory acquisition. Use an explicit local path or `github:owner/repo` for a direct GitHub install. Registry pins reject `--ref`; updates follow reviewed revisions. `plugin add .` is resolved relative to the CLI's cwd. | Audit install/update scripts and runbooks using shorthand. Existing directory/Git/npm entries retain their source identity; new registry installs record registry provenance. |
| Usage WebSocket RPC | `usage.list_reports.response.payload` changes from `{ requestId, reports }` to `{ requestId, error }`; reports are separate `usage.list_reports.update` frames. Both tags advertise `usageSources`, and the client branch checks that existing flag rather than a separate streaming capability. | **Concrete beta.3/stable compatibility risk.** An older validator cannot parse the terminal response without `reports`; a newer client against the old daemon receives no update frames and interprets absent `error` as failure. Keep client and daemon together or explicitly carry a compatibility repair; the general backward-compatibility policy does not make this diff safe. |
| Plugin usage API | `discover()` becomes `discover(scope)`, with global/session scope and provider/model/environment context; accounts can identify a harness. | Existing no-argument JavaScript implementations still run, but can select the wrong account for session usage. Recheck custom usage plugins and subprocess message forwarding. The earlier `identify` → `discover/fetch` change predates this base. |
| Provider interface | Adds optional `usageSession()` and `configuredModelIds` create/resume options; ACP honors history resume purpose and configured unadvertised models. | Preserve forwarding in wrappers and GJC-derived providers. Optional typing can hide a dropped option or method at runtime. |
| Desktop IPC/MCP | No MCP version-negotiation change was found. Desktop browser automation stops forcing input focus, affecting typing behavior rather than introducing a protocol version. | Exercise browser automation after integration; do not equate this IPC change with the MCP error. |

The Usage break is visible in `packages/protocol/src/messages.ts` and `packages/client/src/daemon-client.ts` at both tags. It conflicts with the repository's stated protocol contract and deserves a specific mixed-version test before deployment.

### Plugin system and the fork's SDK resolution

Upstream adds `spawnProcess`, `execCommand`, `terminateProcess`, `client.playAudio()` and `agent.closed`, including shutdown event draining. The server evaluator now supplies actual exports for `@getpaseo/plugin/server` rather than an empty object. Manifest metadata and registry provenance widen catalog/install schemas.

The fork's `1ff3847aa` changes SDK specifier discovery, compiler externalization, client evaluation and worker/in-process host-module lookup. Upstream has **not** replaced that fix: compiler and SDK-specifier files have no base-to-stable diff. However, both sides change `bundle-evaluator.ts`, `plugin-process.ts` and client `evaluate.ts`. In particular, the upstream server export change must survive the fork's lookup rewrite. Re-run SDK identity fixtures across client, worker and built-in paths, including the new server process helpers; a clean textual merge is insufficient. [Process-helper change #6151](https://github.com/getpaseo/paseo/pull/6151), [audio #5976](https://github.com/getpaseo/paseo/pull/5976), [lifecycle #5971](https://github.com/getpaseo/paseo/pull/5971).

### Security and permission implications

No new release-note section identifies a CVE or daemon-auth overhaul in this range. Specific hardening in source includes plugin overview rendering that disallows raw HTML and restricts links to HTTPS (#6244), and registry acquisition that pins reviewed commits/npm integrity, rejects redirects, checks returned identity, and requires HTTPS for credentials except loopback. Reviewed artifacts still execute trusted, unsandboxed plugin code. [Overview hardening](https://github.com/getpaseo/paseo/pull/6244), [registry acquisition](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/server/plugins/managed-source/registry.ts).

Remote SSH gains password entry; ACP resolves outstanding permission requests when a turn fails; operation-permission mappings gain the Usage update message. Keep the fork's eight side-conversation operations mapped correctly: asking mutates an agent and needs write authority. Pairing-link confirmation and OpenCode `ask` rule enforcement are already in the base and should not be counted as new fixes.

Upstream npm-prefix self-update fixes (#5649) and clearer linked-install refusal (#6095) do not establish that the fork's scoped release prefix, signing or macOS permission identity is supported. Follow the existing [permission-preserving upgrade plan](plans/ralplan-fork-updates.md); this report supplies no deployment authorization or signing evidence.

### Dependencies

Lockfile comparison finds only two external-package version additions/changes: `lucide-react-native` **0.546.0 → 1.50.0**, now installed under the app workspace, and new website font `@fontsource-variable/geist` **5.3.0**. Reinstall from the chosen tag and check icons/plugin client host resolution. Internal workspace versions/peer pins move from beta.3 to 0.11.0.

MCP SDK stays **1.29.0**, server ACP SDK **0.17.1**, plugin-local ACP SDK **1.4.0**, Claude Agent SDK **0.3.246**, and OpenCode SDK **1.14.46**. No SDK bump in this interval explains a change in accepted MCP dates. Nix dependency closures/hashes change and fix missing OpenCode bridge/runtime terminal dependencies.

## Collision map

Executed both requested commands:

```sh
git log --oneline v0.11.0-beta.3..custom
git diff --stat v0.11.0-beta.3...custom
```

The log has 113 reachable commits, including older fork work and merged maintenance-line commits absent from the beta tag; it is not 113 fresh fork patches. The merge base is exactly beta.3. The fork diff spans **172 files, 20,246 insertions and 169 deletions**. Upstream base-to-stable spans **618 files, 29,651 insertions and 6,492 deletions**, across 143 reachable commits. **41 files overlap**. These counts measure source footprint, not predicted merge conflicts.

| Risk | Shared area | Collision mechanism and required review |
| --- | --- | --- |
| Highest | `agent-manager.ts`, `agent-sdk-types.ts`, `providers/acp-agent.ts`, Claude/OpenCode adapters | Fork cancellation ownership/GJC and side questions intersect upstream failed-turn permission cleanup, bounded ACP close, model-option forwarding and Claude background-helper separation. ACP alone changes +113/−33 upstream lines. Check ownerless stop, successor admission, failed turns with open approvals, archived history and side-question routing. |
| High | Plugin evaluator, subprocess protocol/worker, runtime/index | Preserve host SDK identity while adding actual server exports, audio, scoped usage and closed-agent lifecycle. The registry/usage runtime changes are substantial even where the fork did not touch acquisition files. |
| High | `messages.ts`, `daemon-client.ts`, `session.ts`, `websocket-server.ts`, authorization maps | Streaming Usage changes the response contract while fork side conversations add RPCs/capabilities. Retain exhaustive maps and optional-method forwarding; test beta.3/stable combinations separately from fork/stock combinations. |
| Medium/high | Panel manifest, desktop tab row, subagent track, session context, translations | Explorer/tab changes share wiring with fork side-conversation panels and tab identity. French resources undergo a large rewrite. Check nested provider tracks, open-beside placement, archive behavior, and translations on web/native. |
| Operational | Fork release tooling and permission-preserving plan | No direct upstream edits to `fork/`, but package versions, installer behavior, npm-prefix handling and desktop artifacts affect release assumptions. Validate the full external Desvio basket; `custom` coverage cannot establish `mine` safety. |

The fork's ownership ledger lists side conversations, ACP cancellation/GJC, fork release/CI, worktree initialization, and local Zcode patches. SDK resolution is additional recent work visible in the log. See [feature ledger](feature-ledger.md), [sync checks](upstream-sync.md), and [SDK fix](https://github.com/camerontaylor/paseo/commit/1ff3847aa).

## MCP protocol-version investigation

**Finding: no upstream fix since beta.3, including v0.11.1 (rechecked during implementation).**

1. Stock `packages/cli/src/utils/client.ts` connects using `DaemonClient` over WebSocket. Its file has no change from beta.3 to fetched main. `packages/client/src/daemon-client.ts` still sends numeric `hello.protocolVersion: 1`. This is distinct from MCP's date-valued protocol.
2. The daemon exposes `/mcp/agents` in `packages/server/src/server/bootstrap.ts`, creating a stateless `StreamableHTTPServerTransport` per request. Comparing bootstrap through main shows unrelated registry/usage/hostname/download/lifecycle edits, with no changes to that transport's protocol handling.
3. The unchanged lockfile pins `@modelcontextprotocol/sdk` 1.29.0. Installed SDK source generates the exact `Bad Request: Unsupported protocol version: ...` text when the `mcp-protocol-version` HTTP header is not supported, returning HTTP 400 / JSON-RPC −32000. Supported dates in that installed source are `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07`; its default is `2025-03-26`.
4. SDK initialization selects the requested version if supported, otherwise its latest supported version. An unsupported initial version can therefore negotiate down; subsequent HTTP headers still must use a supported date. This is SDK behavior, not a new Paseo repair.

Inference: a literal `2026-07-2X` header, or an actual July 2026 date redacted that way, is outside this SDK's accepted set. A caller sending its own latest date instead of the negotiated date could trigger the rejection. The daemon log alone does not identify that caller or prove why it hung; the source does not establish that the stock CLI caused it. An agent MCP connection or another client may be concurrent with the CLI invocation.

For diagnosis, capture the exact CLI executable/version and invocation, target endpoint, negotiated initialize result and subsequent protocol header, HTTP 400 handling and client timeout. Do this against an isolated daemon. No live incident was reproduced here, and neither header rewriting nor a daemon restart was attempted. A future SDK bump or client negotiation fix requires its own verification; release 0.11.1 supplies neither.

Evidence: [CLI client](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/cli/src/utils/client.ts), [daemon endpoint](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/server/bootstrap.ts), [SDK pin](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/package.json). SDK implementation inspected locally at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`, `server/index.js`, and `types.js`.

## Carry retirement and adaptation audit

Follow-up research on 2026-10-08 includes the **live** `~/.paseo-fork/manifest.txt`, the nine external/local PR carries before `custom`, all fourteen active infi intake branches, and the fork-owned features. This extends the initial `custom`-only collision analysis above. The manifest and its comments are not updated by this report.

**Retire two complete carries:** #3117 is functionally replaced already in beta.3; #4355 is merged and shipped starting in beta.4. **Narrow #3369:** upstream owns initial generic ACP command discovery, but not its argument hints or persisted wait controls. **Keep the other six PR carries and all fourteen active infi ports.** No complete fork-owned provider, side-conversation or SDK feature has an upstream replacement in stable 0.11.0 or fetched main.

“Drop” below means omit the carry when assembling the stated base, after checking the existing focused regression. It does not mean merge the old branch and manually undo its feature. Do not drop #4355 from a build still based on beta.3. This audit makes no changes to the live basket or deployed daemon.

### Risk 1: ACP cancellation, GJC and side conversations

| Fork behavior | Upstream replacement? | Decision and integration seam |
| --- | --- | --- |
| Generic ACP cancellation boundary | **No.** Stable `interrupt()` cancels permissions and sends `session/cancel`; it has no stop record, cancellation ledger or successor-admission gate. | **Keep/adapt.** Preserve the fork's two facts: cancellation writes must settle successfully and the stopped turn must have terminal proof. A manager timeout can settle its own run without granting the provider permission to start a successor. |
| GJC ownerless turns and `turn.abort` | **No.** No GJC adapter, `_gjc/sdk/control`, `gjcPhase` tracking or validated ownerless abort exists upstream. OMP autonomous-turn settlement is a different provider implementation. | **Keep/adapt.** Preserve mirrored turn identity, the abort-result verdict, post-stop idle proof in either arrival order, and invalidation on renewed activity. Forward upstream's new `configuredModelIds` and resume `purpose` through the ACP session factory. |
| Side conversations | **No.** Neither stable nor fetched main implements the fork's `askSideQuestion` API, side-conversation RPCs/store/panel or separate provider forks. | **Keep/adapt.** Preserve Claude's disposable side query and OpenCode's separate fork without adding output to the parent's normal timeline. Native provider commands and ordinary subagents do not supply the same API/UI/parent isolation. |
| Manager cancellation changes | **No replacement.** Upstream does not add the fork's provider-boundary ownership. | Preserve the distinction between manager settlement and provider readiness, plus correlated logs and stale-terminal rejection. Do not reinterpret a returned cancel call as proof of idle. |

The upstream ACP changes are useful additions, with different responsibilities:

- **Failed/canceled turn permission cleanup:** stable factors `cancelPendingPermissions()` and calls it for non-success terminals. Port that cleanup into the fork's terminal-delivery path without clearing the stop record or bypassing its gate. Clear the existing map once; avoid a parallel permission ledger that sends duplicate answers. Include provider failure with a pending approval and stopped-turn failure in the focused tests.
- **Bounded close:** stable bounds cancel and `closeSession` requests to two seconds so archive/delete can finish. Keep that shutdown behavior alongside the fork's stop mechanism. Close is a terminal lifecycle operation; its deadline must not release a still-running session for another prompt.
- **History/model/usage fixes:** preserve removed-worktree history loading, configured unadvertised models, and ACP context occupancy updates. These can disappear silently if the fork's overridden factory or session construction drops optional upstream arguments.
- **Claude/OpenCode lifecycle:** preserve stable's foreground/background helper separation and OpenCode v2 denial/question settlement. Keep the side-question child-ID suppression and race cleanup. Fetched main's disconnected-subagent reconciliation is still unreleased and needs the same side-question isolation review if selected.

Source comparison: [upstream ACP](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/server/agent/providers/acp-agent.ts), [fork ACP](https://github.com/camerontaylor/paseo/blob/24f134618/packages/server/src/server/agent/providers/acp-agent.ts), [fork GJC](https://github.com/camerontaylor/paseo/blob/24f134618/packages/server/src/server/agent/providers/gjc-acp-agent.ts). The fork's current `finishTurn()` / `deliverTerminal()` do not include upstream's new failure permission cleanup. Use the established [cancellation fix-pass contract](plans/plan-cancellation-boundary-fix-pass.md) and [sync checks](upstream-sync.md) for adaptation.

### Other fork-owned work

| Owned behavior | Decision | Evidence / missing replacement |
| --- | --- | --- |
| Plugin SDK imports resolve to host modules | **Keep/adapt.** | Upstream does not change compiler externalization or SDK specifier discovery in this range. Its new server exports do not replace host-module identity across canonical/fork imports, client evaluation and plugin workers. Preserve both in the evaluator merge. |
| `supportsSystemPrompt` declaration and policy refusal | **Keep/adapt.** | Stable's plugin registration/adapter has no corresponding declaration. The fork's check protects the configured appended policy when a native provider cannot implement it. It is a refusal contract, not an implementation of native system instructions. |
| Scoped fork release, compressed browser assets and permission-preserving upgrades | **Keep.** | Upstream npm-prefix fixes do not implement this fork's package scope, asset rewrite, signed-client identity or deployment rules. |
| Transient worktree setup | **Keep.** | No replacement was found for the fork's dependency initialization and trust hook. |
| Zcode ACP installed-plugin patches | **Mixed; see below.** | Their owning upstreams are external plugin/bridge repositories, not `getpaseo/paseo`. A Paseo version bump alone cannot retire them. |

### Active PR grab bag

PR states were checked live with `gh pr view`; branch deltas were compared with stable source. Closed-unmerged PRs are assessed by behavior, not by closure. Local branch heads are the fetched/local snapshot; author branches were not separately fetched during this report.

| Carry | Live upstream PR state | Stable implementation and decision |
| --- | --- | --- |
| [#2785 multi-provider accounts](https://github.com/getpaseo/paseo/pull/2785), local beta.3 port `428858190` | Closed, unmerged | **Keep/adapt heavily.** Upstream's custom provider configuration and session-scoped Usage do not implement the carry's account creation/removal/rename and selection UI/CLI. Use upstream's scoped discovery/reporting instead of retaining an independent old usage pipeline; preserve the account-management behavior and its provider-home semantics. |
| [#2237 Codex toolSurface screenshots](https://github.com/getpaseo/paseo/pull/2237), `c56829d51` | Open | **Keep.** Stable only extracts top-level MCP image blocks. It leaves `_meta["codex/toolSurface"].screenshot.url` base64 data inline. The carry materializes that image and removes the inline URL, reducing oversized timeline/relay payloads. Ordinary image rendering fixes do not do this. |
| [#2664 byte-bounded timeline hydration](https://github.com/getpaseo/paseo/pull/2664), `750c19dd9` | Open | **Keep/adapt.** Stable's projected pagination takes a count limit, not a serialized-byte budget. General content limits and plugin-item limits are not a total page bound. Port at the current store/projection and response assembly boundary, preserving cursor spans and progress when one item is too large. |
| [#3117 one-shot workspace observer fanout](https://github.com/getpaseo/paseo/pull/3117), `18ba14b7d` | Closed, unmerged | **Drop; already superseded in beta.3.** The shared fetch handler only reconciles Git observers for a real subscription. Subscription ownership determines producers; upstream's pure-read integration test asserts zero client observation producers and zero Git observations. This replaces the carry's old `if (subscriptionId)` guard. Legacy clients deliberately requesting checkout events remain subscriptions. |
| [#3369 generic ACP slash commands](https://github.com/getpaseo/paseo/pull/3369), `cd55ef7b9` | Open | **Narrow/adapt; do not drop wholesale.** Upstream [#5411](https://github.com/getpaseo/paseo/pull/5411), already in beta.3, defaults generic ACP `waitForInitialCommands` to true. Stable still sets command `argumentHint: ""`; retain `command.input?.hint ?? ""`. The carry's persisted wait/timeout parameters have no equivalent config wiring; retain them if that configured behavior is required, ported through the current registry rather than resurrecting the deleted `GenericACPProviderParamsSchema`. |
| [#3545 deferred coalescer teardown error](https://github.com/getpaseo/paseo/pull/3545), `439719d9b` | Closed, unmerged | **Keep; no complete replacement found.** Stable's timer `onFlush` still calls recording without a catch; timeline append still throws for unknown state. Normal closure flushes/discards first, which reduces the race surface but is not the carry's error boundary. No new equivalent guard lands after beta.3. Confirm the deferred teardown regression during integration; this research did not reproduce a live crash. |
| [#3950 Claude permission reason](https://github.com/getpaseo/paseo/pull/3950), `e7d556ef8` | Open | **Keep.** Stable does not read `canUseTool`'s `decisionReason` into the permission description. Background-helper and thinking changes do not supply the explanation shown on the card. |
| [#4101 retained CJK terminal spacing](https://github.com/getpaseo/paseo/pull/4101), pinned `c3707e6be` | Open | **Keep pinned/adapt.** Stable lacks the carry's retained-surface/WebGL restoration and spacing repair. Terminal keyboard changes do not implement this. Do not use the author's newer rebased branch as a shortcut: its unreviewed upstream ancestry was why this carry was pinned. |
| [#4355 Claude thinking display](https://github.com/getpaseo/paseo/pull/4355), `b61e3de50` | **Merged** 2026-10-04, `cc8fe41e2` | **Drop when the base is beta.4 or later.** Stable contains `display: "summarized"` for both adaptive-thinking cases. The merge commit is an ancestor of beta.4. The live manifest's “OPEN” comment is stale. |

Key source anchors for the retirement decisions: beta.3 `packages/server/src/server/session.ts:6245` (`handleFetchWorkspacesRequest`) and `:6564` (subscription-derived observer reconciliation); beta.3 `packages/server/src/server/owned-subscriptions.e2e.test.ts:800` (pure reads); stable `packages/server/src/server/agent/providers/claude/agent.ts:3299` and `:3306` (both summarized-thinking cases). [Pure-read test](https://github.com/getpaseo/paseo/blob/v0.11.0-beta.3/packages/server/src/server/owned-subscriptions.e2e.test.ts#L800), [stable thinking](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/server/agent/providers/claude/agent.ts#L3299).

Other retention anchors: stable `providers/codex/tool-call-mapper.ts:622` in the agent directory (MCP image extraction), `agent/timeline-projection.ts:560` (count-only pagination), `agent/agent-manager.ts:781` (deferred flush), and `agent/agent-timeline-store.ts:163` (unknown-state throw). #2237 and #2664 solve different payload problems; keep both until each has its own replacement.

### All fourteen active infi ports

Compare the behavior against the [acceptance tracker](plans/infi-pc-intake-work-items.md), not just the presence of a similarly named upstream feature. None of these ports has a full replacement in stable or fetched main. Dependent branches include earlier ports in their ancestry; extract the remaining behavior in dependency order rather than diffing every branch as if it were independent.

| Port | Decision | Missing behavior / adaptation seam |
| --- | --- | --- |
| IP-01 source-accurate file links (`cabbc692d`) | **Keep/adapt.** | Upstream still resolves inline paths against the viewing `context.cwd`. Its file-link token-cache fix does not supply source-checkout identity plus containment. Preserve the carry's checkout A links while viewing B. |
| IP-02 fork-local PR lookup (`637360584`) | **Keep.** | Stable's fork resolution still redirects to the parent, including the batch path. Preserve fork-first lookup, complete-page fallback, head-repository identity and terminal-PR SHA matching. |
| IP-03 managed-daemon quit confirmation (`0d4161b1c`) | **Keep.** | Upstream quit code checks managed/running/settings and shows shutdown feedback, but has no cancelable confirmation before stopping. Preserve updater and signal handling. |
| IP-04 nested package scripts (`1967db56b`) | **Keep/adapt.** | Upstream script-status broadcasting does not discover nested `package.json` scripts or run them with the appropriate cwd/package manager. Preserve broadcasting and existing `paseo.json` services while adding discovery. |
| IP-05 plan copy (`422996012`) | **Keep/adapt.** | Upstream plan cards lack the carry's full-text and useful-link actions for live/history plans. Chat selection copying is separate. |
| IP-06 editable plan handoff (`fbc6af59c`) | **Keep/adapt after IP-05.** | No upstream plan-to-draft workflow. Preserve manual Send, source workspace/link and one destination prompt. |
| IP-07 base-ref mutation (`06b79b7c9`) | **Keep/adapt.** | Upstream has creation-time base-branch data, but no `checkout.base_ref.set.request/response` or `checkoutBaseRefSet` gate. Preserve qualified refs, optional schema, authorization and mutation without moving HEAD. |
| IP-08 branch/base pair header (`d2a069260`) | **Keep/adapt after IP-07.** | Existing branch switching does not provide the paired base editor. Recheck current workspace-header layout and capability gating on compact/native clients. |
| IP-09 recently closed agents (`6795dbffe`) | **Keep/adapt.** | Upstream tabs lack the bounded reopen menu/store. Explorer Close and archive are different operations; keep archive state unchanged. |
| IP-10 persistent navigation history (`14b36be7c`) | **Keep/adapt after IP-09.** | Upstream lacks the carry's route/tab history and replay store. Browser navigation alone does not restore its selected-workspace/agent history contract. Recheck router restore and new tab identities. |
| IP-11 visible-response prompt pin (`97753d7c9`) | **Keep/adapt.** | Upstream reading-position fixes do not show the preceding user prompt while reading historical responses. Reconcile stream reading signals and retain the desktop-only presentation. |
| IP-12 bounded sidebar status pulse (`bc2f25580`) | **Keep.** | Upstream's running spinner/loading indicator is not the attention pulse with entered-state timing and bounded animation. Preserve state aggregation and low list-render cost. |
| IP-13 project PR CI facts (`f3a66c4be`) | **Keep after IP-02.** | Blank-query PR listing is already upstream, but its `gh pr list` fields omit `statusCheckRollup` and search summaries lack optional checks / `forgeSearchChecks`. Keep only missing facts; reuse the existing rollup parser. |
| IP-14 project PR browser/workspace seed (`739ec1c37`) | **Keep/adapt after IP-13.** | The upstream per-checkout PR view is not a project-wide PR overlay that seeds a workspace. Preserve current workspace creation and forge adapter APIs. |

Source examples: [inline file opening](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/app/src/agent-stream/view.tsx#L446), [quit lifecycle](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/desktop/src/daemon/quit-lifecycle.ts), [PR list fields](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/services/github-service.ts#L2023), [parent-first lookup](https://github.com/getpaseo/paseo/blob/v0.11.0/packages/server/src/services/github-service.ts#L2980). The ports' new plan-action, branch-header, recent-agent, navigation-history, prompt-pin and project-PR modules are absent upstream; the existing entry-point inspection found no alternate full implementation.

Disabled manifest entries and unassembled `intake/tmad-*` work are outside the active basket audit. Previously retired notification sounds, queued-creation duplicate machinery, old steering forwarding and quota fetcher should not be reintroduced. Upstream-owned PR listing and merged-PR auto-archive were already excluded from the infi ports; do not add a second implementation during this sync.

### Native ZCode plugin as an ACP replacement

**A direct provider plugin exists:** [supermomonga/paseo-plugin-zcode-provider](https://github.com/supermomonga/paseo-plugin-zcode-provider), npm **0.2.0**, current source `ca87c2b023338420f9e50f0a3a62dad2e28ed16f` (2026-10-06). It registers provider `zcode` and plugin `zcode-provider` through Paseo's public Provider API, using ZCode's native stdio Services Server and V4 conversation state. It is a community plugin, separate from core Paseo and from `lianxin255/paseo-plugin-zcode` / `zcode-acp-server`.

This is a credible replacement candidate for the **ZCode ACP path**. It includes native permission/questions/Plan approval, models and reasoning, text guidance and attachment queue, turn-aware stop, persistence/history, Settings/Account/Runtime screens, provider diagnostics and scoped Coding Plan Usage. Its managed runtime is ZCode 3.14.3 with Node 24.21.0; five platforms are supported. The maintainers report compiler/adapter and real-model CI against Paseo beta.5, including stop/resume and saved mode/Plan restoration. The follow-up validates native stdio and actual upgraded PluginRuntime against v0.11.1; it also tests global/project AGENTS in model requests. Intel macOS needs explicit runtime/Node paths because the managed installer excludes darwin-x64. [Pinned verification record](https://github.com/supermomonga/paseo-plugin-zcode-provider/blob/ca87c2b023338420f9e50f0a3a62dad2e28ed16f/docs/verification.md), [native stop implementation](https://github.com/supermomonga/paseo-plugin-zcode-provider/blob/ca87c2b023338420f9e50f0a3a62dad2e28ed16f/server/session.ts#L717).

The retirement conditions remain:

| Requirement | Current native plugin | Consequence |
| --- | --- | --- |
| Appended daemon/agent system policy | `openSession` explicitly rejects a nonempty `config.systemPrompt`; no additive native instruction API is implemented. Registration still omits `supportsSystemPrompt`. | The user authorized moving this policy to `AGENTS.md`. Native runtime reads global `~/.zcode/AGENTS.md` plus project instructions as `meta_user`; this preserves instruction content with lower priority. The upgrade adds an explicit ZCode-only exclusion from daemon system appending after policy materialization. Other providers retain their current system policy; explicit unsupported agent system prompts still fail. [Exact refusal](https://github.com/supermomonga/paseo-plugin-zcode-provider/blob/ca87c2b023338420f9e50f0a3a62dad2e28ed16f/server/provider.ts#L510). |
| Existing ACP session continuity | Native persistence uses v3 logical/native mapping; old Paseo sessions are outside its migration and native v1/v2 handles are rejected. | The user explicitly excluded old session migration. Start new native sessions; old ACP handles are not converted. Retain only disabled configuration/backups for rollback. |
| Current custom launch/options/account assumptions | Nonempty `providerOptions` are rejected. Provider has no command declaration. Native session launch reads environment overrides, but provider status and Settings use plugin process environment; both paths need the same runtime defaults. ZCode allows one signed-in account, with multiple API-key providers. | Audit selected provider IDs, environment routing, account workflows and scheduled agents. Native Settings do not replace #2785 across other providers. |
| Feature parity beyond ordinary turns | Custom system prompts, output schema, `persist:false`, browser/computer use, generic rewind and independent Paseo child agents are outside its supported migration. | Match the actual required workflows before retiring the bridge. Native stop replaces ZCode's ACP stop path only; it does not replace GJC or the generic ACP boundary. |
| Fork runtime SDK identity | Our previous canonical/fork-import validation used older plugin `fc66078`; current 0.2.0 is a newer implementation. | Keep the SDK host-module fix and rerun its isolated compiler/client/provider checks against this release. Previous diagnostics evidence is not current-version real-model QA. |

Use an exact npm version or explicit `github:supermomonga/paseo-plugin-zcode-provider` with a pinned revision for reproducible installation. Its README's bare `owner/repo` Git install example now collides with stable Paseo's registry shorthand. The initial research made no installation/configuration changes; the authorized migration is separate and recorded below.

If native meets the required policy/workflow and existing ACP sessions have been retired, remove the old ZCode provider/plugin configuration and the ZCode-specific bridge-path/network patches. Remove #3369's residual argument-hint/config behavior only if no remaining ACP provider needs it. The generic ACP gate, GJC adapter and Claude/OpenCode side conversations remain independently required.

### Zcode patch retirement without a native switch

- **Bridge path patch 01:** keep. [Plugin PR #1](https://github.com/lianxin255/paseo-plugin-zcode/pull/1) is still open; current resolver still omits `checkout/node_modules`.
- **Network patch 02:** upstream behavior exists, but **keep for the installed/pinned bridge**. [zcode-acp #182](https://github.com/william0wang/zcode-acp/pull/182) merged on 2026-09-14 (`2d1496fbb`), and tagged v0.65.1 contains the native launch flags. However, the ACP plugin's current `npm ci` lockfile still pins **0.31.1**, whose tagged resolver lacks the fix. This host's installed bridge is also 0.31.1 with the local flag. Remove the patch only after a reviewed dependency update actually supplies the fixed launch behavior, or after retiring ACP. [Pinned lockfile](https://github.com/lianxin255/paseo-plugin-zcode/blob/main/package-lock.json), [fixed resolver](https://github.com/william0wang/zcode-acp/blob/v0.65.1/src/backend/resolve.ts), [old resolver](https://github.com/william0wang/zcode-acp/blob/v0.31.1/src/backend/resolve.ts).
- **Prerelease requirement relaxation (apply.sh step 03):** unnecessary once every relevant daemon runs stable 0.8.0+ and the plugin manifest is unmodified. It is a fleet-version condition, not a newly implemented feature. A prerelease `mine` build cannot be assumed to satisfy a stable-only semver range.

### Implemented upgrade and validation

The authorized follow-up advances `custom` to **v0.11.1** at `337442f70`. Sol medium lanes
preserved ACP/GJC cancellation ownership, side conversations and SDK identity;
repaired Usage negotiation; ported the retained carries; and prepared the native
ZCode provider. Old session migration was explicitly excluded.

The active Desvio manifest shrinks from 24 lines to four reviewed local groups:
`custom`, `fork/carries-0.11.1`, `fork/infi-backend-0.11.1` and
`fork/infi-ui-0.11.1`. The groups preserve commit attribution and all fourteen
infi features. This is manifest consolidation; the feature audit above determines
which behavior was actually dropped. Reassembling in this order reproduces the
validated candidate's source tree exactly. The previous manifest/config and refs
are backed up under `~/.paseo-fork/upgrades/0.11.1-20261008/`.

The native plugin is pinned to 0.2.0 / `ca87c2b023338420f9e50f0a3a62dad2e28ed16f`.
A hash-checked local preparation supplies Intel runtime defaults and accepts the
runtime's omitted provider name without weakening model/reasoning validation.
The native PluginRuntime canary passed registration, availability, Diagnostics,
Account, client bundle compilation, session creation and one actual model turn
using existing custom-provider credentials copied into a private isolated home.
The saved Flash/yolo/high profile uses the native encoded model ID; ACP `auto_accept` is translated into native mode and removed from feature settings. Unknown or conflicting settings are rejected before instruction writes. A final integration canary read the generated v2 config unchanged and created a native session through the assembled AgentManager, verifying that the actual launch omits the appended system prompt while the shared daemon policy remains configured. The ACP
replacement model catalog is removed from the candidate so it cannot shadow the
native catalog. Old sources and credentials remain backed up.

The exact daemon policy is materialized in global `~/.zcode/AGENTS.md` and the
repository `AGENTS.md` target (`CLAUDE.md`, preserving the symlink). Native stdio
canaries verified global/project instructions in model requests across ordinary
turns, permission/question handling, resume and stop. ZCode receives this content
as `meta_user`, with lower priority than a system message, and global instructions
also affect ZCode outside Paseo. Future daemon-policy edits require rematerializing
the native instructions. A ZCode-only exclusion keeps other providers' system
policy intact. Explicit unsupported per-agent system prompts still fail.

Validation includes a fresh assembled `build:server`, whole-repository typecheck,
lint with zero warnings/errors, and formatting checks. Lane tests cover ACP/GJC,
side conversations, SDK host identity, Usage wire/client/session behavior,
accounts, timeline byte bounds, flush teardown, screenshots, permission reasons,
CJK, fourteen infi ports and migration safeguards. The five previously blocked
navigation/workspace suites passed all 39 tests after rebuilding declarations;
client SDK compiler/runtime fixtures passed 3 checks. An isolated daemon accepted
the built CLI's numeric WebSocket handshake and agent listing, then closed cleanly.
No full local test suite was run. One checkout syntax-highlighting test fails in this environment; the identical failure was reproduced on untouched v0.11.1 (`ab10a6694`) after its own highlight/client builds. This is a pre-existing upstream/environment failure, with evidence in `/tmp/paseo-upstream-highlight-test.log`.

Live daemon configuration remains unchanged. The private native cutover candidate
is `~/.local/state/zcode-native-upgrade/config-native-candidate-v2.json` (0600), with
instruction/config backups beside it. Production `mine` and its old deployed
build tree remain rollback artifacts; source integration does not deploy them.

## Upgrade recommendation

Use **v0.11.1**. Keep the client/daemon feature boundary explicit: the repaired
fork client handles both older terminal and streamed Usage hosts. Unpatched
beta.4–v0.11.1 clients can parse the repaired daemon's terminal response but do
not display its terminal reports; update those clients for Usage.

Build each final workspace stack locally before trusting its tests. Sharing
third-party packages is safe only when workspace package links and `dist` remain
local. Validate the assembled basket and native plugin on an isolated home/port.
Keep the permission-preserving release plan for deployment. No full local suite
is needed.

## Initial report validation

`npm run lint` passed with zero warnings/errors. `npm run typecheck` exited 2: server/app consume stale plugin declarations missing `pluginSdkEntry`, `PLUGIN_SDK_PACKAGE_NAMES` and `supportsSystemPrompt`; those exports/declarations exist in current plugin source but not its built declarations. No source repair or rebuild was attempted within this report-only task. `git diff --check` and the report's whitespace check passed. Fork Markdown is excluded by the configured formatter.

At the end of the initial research, the only change was this untracked report and `custom` remained at `24f134618`. Later implementation commits are authorized by the follow-up. The user subsequently authorized committing and pushing this report with the upgrade.
