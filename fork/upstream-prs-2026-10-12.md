# Upstream PR evaluation, 2026-10-12

Snapshot: **2026-10-12**. Fork base: tag `v0.11.1` (`ab10a6694`, 2026-10-07).
Upstream main at snapshot: `a5dba3c99`, 36 commits past the base. Latest release:
**`v0.11.2`** (`75953250`, 2026-10-09).

Scope: every PR created on `getpaseo/paseo` in the two weeks 2026-09-28..2026-10-11,
whatever its state. That is 562 PRs: 268 open, 226 merged, 68 closed. Split by
author: 219 open, 64 closed and 13 merged community PRs, plus 49 open and 217
merged maintainer/bot PRs.

Method: 13 headless workers read title and body for one slice each, pulled diffs
only for PRs that survived triage, and cited `file:line` in **this** checkout for
every claim about our tree. The load-bearing claims were re-verified by hand (see
[Verification](#verification)). Read with
[the 2026-09-07 pass](upstream-prs-2026-09-07.md); that one searched a different
month and its grab list is a separate stack.

Fork developments from the same window are in
[fork-survey-2026-10-12.md](fork-survey-2026-10-12.md).

## Reading the window

**Our base is four days old, so most of the window is already inside it.** 191 of
the 226 merges landed before 2026-10-08 and are in `v0.11.1`. Only **35 merges**
fall after the base, of which four are community PRs. The interesting surface is
therefore not "what merged"; it is:

- **36 commits on `upstream/main`** that are not in our base, which the next sync
  brings. See [What the next base sync brings](#what-the-next-base-sync-brings).
- **219 open community PRs**, of which 98 triaged to `grab` and 68 to `watch`.
- **64 closed community PRs**, of which 15 describe behaviour we want and cannot
  get by waiting. See [Declined upstream](#declined-upstream-what-to-carry).
- **49 open maintainer PRs**, which are the sync hazards: they will land on
  `upstream/main` without our input and some of them land on our owned seams.

The merge queue still favours the maintainer. 213 of the 226 merges in the window
are his own or the bot's, and only 13 community PRs merged in two weeks. The
bottleneck reading from the 2026-08 research has not changed: community PRs wait
while maintainer work does not.

## What the next base sync brings

Two candidate bases, and they are not the same thing.

**`v0.11.2` is a hotfix, not a roll-up.** `git log v0.11.1..v0.11.2` is three
commits, and the only product change is #6445, which reverts the native
`react-native-uitextview` patch to fix iOS text clipping. Its 24-file delta
(+77/-230) does not touch the 181-file fork footprint. Taking it alone buys one
fix and accepts the documented return of the iPad Explorer-resize reflow defect.

**`upstream/main` is the real sync.** Its 36 commits bring 29 of the 35 post-base
merges: agent provenance and creation-failure handling, compact header rework,
mobile review comment sheets, a `usage` CLI, Claude model discovery, worktree
comparison fixes, agent-log timestamp handling, and a run of Git diff parser
fixes. Four changes overlap fork-owned files and are listed as hazards below.

**Six live-merged PRs are absent from the fetched `main`**: #6370, #6567, #6569,
#6572, #6573, #6604. They merged on 2026-10-11 after the local fetch. A sync to
`a5dba3c99` does not include them; a fresh fetch probably does. Verify rather
than assume, because the fetch is what the build actually sees.

### Sync hazards

These need deliberate reconciliation, not a merge that happens to compile.

| What | Hazard | Where |
| --- | --- | --- |
| **#6431** compact header rework (merged) | The mobile workspace switcher moves to `screens/workspace/compact-workspace-header/tab-switcher.tsx` (501 lines). The new file enumerates `tab.target.kind` for `new_tab`, `draft`, `setup`, `terminal`, `browser`, `file`, `agent`, `provider_subagent`, `working_diff`, `changes_tree`, `files`, `pull_request`, `commit_diff` and has **no `side_conversation` branch**. Ours is at `packages/app/src/screens/workspace/workspace-screen.tsx:387`, with the required label at `:555-573` and `newSideConversation` in `workspace-tab-menu.ts:21,211`. Making the label optional to silence the type error still loses the menu action. | app tab identity |
| **#6373** agent-message provenance (merged) | Rewrites the submitted-prompt path and envelope projection at `agent-manager.ts:667,4192,4265,4600,4872-4889`, and edits `messages.ts` next to the fork Usage and side-conversation fields (`:1793`, `:3691-3692`). 8 fork-patched files. | manager, session, protocol |
| **#6379** keep created agents after first-prompt failure (merged) | Follows #6373 into the same projection and into `create-agent/create.ts:202-206`. Adds rejected-prompt recording after our settled-run and stale-session checks. | manager, session |
| **#6474** `usage` CLI (merged) | Additive caller of `DaemonClient.listUsageReports`, and it inherits our streaming negotiation. Compatible in shape, but only if the client negotiation at `daemon-client.ts:5365-5376,5448,5460-5466` survives the merge. | Usage compat seam |
| **#6621** published editor schema (open) | Regenerates the JSON Schema from `persisted-config.ts:264`, which contains our fork-only `appendSystemPromptExcludedProviders`. Regenerate against the merged fork source, or the freshness assertion and editors reject fork policy config. | ZCode policy |
| **#6192** steer during turn startup (open) | Pending-run settlement crosses our ACP/GJC cancellation boundary (`agent-manager.ts:2853-2856` vs our force-settlement at `:3191-3216`). Highest lifecycle hazard. | GJC/ACP |
| **#6305** single Claude runtime owner (open) | Replaces the query/pump ownership our side questions bind to (`claude/agent.ts:2396-2445`). A merge can compile while side questions rebind to a dead runtime. | side conversations |
| **#5729** context meter persistence (open) | Adds optional stored usage to `messages.ts` and `agent-manager.ts:2035`. Per-agent context usage, not account Usage reports. Do not let it absorb the streaming capability gate. | Usage compat seam |
| **#6285** oversized-message preflight (open) | Edits `daemon-client.ts:1758-1767` and `websocket-server.ts`. Same files as the Usage client. | client transport |
| **#6531** fullscreen mobile drafting (open) | 40 files including all nine fork-patched locale files and `workspace-screen.tsx`. Our side-conversation panel has its own input at `panels/side-conversation-panel.tsx:209-227`, so it will not inherit fullscreen for free. | app, locales |
| **#5764** Android rotation and fold (open) | `workspace-desktop-tabs-row.tsx:1108,1299` owns side-conversation start wiring in the row it changes. Needs a native rebuild against fork artifacts. | app tabs |

## Grab now

Ranked by value to us per unit of carry cost. Every entry below was verified
against this checkout. `Carry` means cherry-pick onto `custom`; `Sync` means it
arrives with the base move and needs no carry.

### Tier 1: cheap and verified, take them

| PR | What it fixes here | Evidence | How |
| --- | --- | --- | --- |
| **#6033** | `paseo agent ls` fetches exactly one page and silently truncates past 200 agents. | `packages/cli/src/commands/agent/ls.ts:185-187` performs a single `fetchAgents` with no cursor loop. +64/-4, 2 files. | Carry |
| **#6264** | `daemon status` over `ssh://` gets a 1.5 s connect budget and reports a slow host unreachable. | `packages/cli/src/commands/daemon/status.ts:61` passes `timeout: 1_500` for every target kind. +63/-1. | Carry |
| **#6023** | Saving a symlinked `config.json` replaces the link, so a dotfile-managed config detaches from its repo. | `private-files.ts:30-36` renames the temp file over the given path. +61/-6. Fork commit `zeyugao` covers the same defect plus dangling-link cases; prefer this upstream-shaped patch and take zeyugao's relative/dangling-link tests. | Carry |
| **#6553 + #6545** | A worktree created or archived does not appear or disappear in the next listing: creation returns before rollback and only invalidates the forge cache. | `paseo-worktree-service.ts:117-130`; archive at `workspace-archive-service.ts:404-412` invalidates forge only, while the list cache lives at `workspace-git-service.ts:894-907`. | Carry both, one shared `invalidateWorktrees` |
| **#6149** (dup #6143) | OpenCode v2 multi-select question cards cannot be answered. The daemon emits `multiple`, the card reads `multiSelect`. | `opencode/v2/permissions.ts:112,145-147`; card field at `question-form-card-core.ts:55`. +132/-4. | Carry |
| **#6079** | Agent-to-agent `send_agent_prompt` interrupts the running turn instead of steering it. | `tools/paseo-tools.ts:1931-1938` omits `activeTurnBehavior`; `agent-prompt.ts:52` requires an explicit steer. +97/-1. Directly relevant to GJC steering. | Carry |
| **#6422** | A focused pane does not claim terminal size on a measured resize, so multi-client PTY size drifts. | `terminal-pane-focus-claim.ts:33` sends `update` whenever `shouldClaim` is false, reusing `canRequestFocusClaim` fixes it. +48/-5. | Carry |
| **#6166** | Reconnect drops agents that are waiting on a permission. The delta read omits unchanged entries and permissions are deliberately not persisted. | `directory-sync/index.ts:83-90` sends the collection delta only. +57/-3. | Carry |
| **#6371** | Listing workspace scripts builds a fresh snapshot but never publishes it, so subscribers stay stale after `paseo.json` changes. | `workspace-scripts-service.ts:168-172` returns `buildSnapshot(...)` without publishing. +104/-2. | Carry |
| **#6165** | Workspace fallback picks the most recent agent, not the most urgent, so waiting permission prompts go unseen. | `packages/app/src/utils/workspace-agent-activity.ts:21-34` selects by timestamp first. +98/-18. | Carry |
| **#5652** | Pasting text that also carries an image pastes nothing. | One-line browser paste guard; unconditional image interception. | Carry |
| **#6317** | `PressHighlight` swallows mouse clicks. | Component-local mouse rejection. | Carry |
| **#6450** | Mermaid labels do not wrap when the display has fractional pixels (exact float equality). | Isolated patch to the Mermaid wrap path. | Carry |
| **#6260** | Question prompt text cannot be selected or copied. | One production prop. | Carry |
| **#6590** | Dark-mode Android splash shows white corners. | One config image. | Carry |
| **#6537** | Nix desktop build has no Node heap ceiling and can OOM during the Metro pass. | `nix/desktop-package.nix:84-89` sets no `NODE_OPTIONS`. +6/-0. | Carry |
| **#5670** | Seven published workspace manifests omit the `license` field, including the plugin SDK. | `packages/{cli,client,highlight,plugin,protocol,relay,server}/package.json` have no `license`; `packages/desktop` does. +14/-8. | Carry |

### Tier 2: daemon survival and provider correctness

| PR | What it fixes here | Evidence | How |
| --- | --- | --- | --- |
| **#6402** | Directory search allocates a whole directory tree eagerly and caches unbounded children, so one query can OOM the daemon. | `directory-suggestions.ts:123-125` eager `fs.readdir`; `:780-784` bounds directories, not children. Patch context needs post-base #5789, so backport rather than cherry-pick. | Carry |
| **#6258** | Git event bursts re-canonicalise the same paths synchronously per event. | `workspace-git-service.ts:2235-2238`; `utils/path.ts:92-94,140-145` re-collects and re-realpaths. +202/-19. | Carry |
| **#6262** | Long OpenCode v2 streams retain the whole accumulated string per suffix and can exhaust daemon memory. | `opencode/v2/timeline.ts:39,142` slices a growing accumulator. +94/-2. | Carry |
| **#5999** | Codex chats containing U+2028/U+2029 cannot reopen on Node 24; the transport uses readline. | `codex/app-server-transport.ts:2,171,185`. +76/-6. | Carry |
| **#6014** | Rewinding a steer message drops the earlier prompt: rollback counts messages, not turns. | `codex/rewind.ts:79-85`. +274/-85. | Carry |
| **#5644** | Codex agents in a worktree ignore the project's configured model and effort. | `codex-app-server-agent.ts:3177-3202` reads global saved config; `:5228` passes no cwd. +60/-16. | Carry |
| **#5588** | A model switched from the provider side is lost on agent reload. | `agent-manager.ts:4509-4522` updates runtime info only, unlike the adjacent thinking handler. +37/-0. Our adjacent model policy must survive. | Carry |
| **#6466** | Claude multi-block messages show thinking and text more than once. | Message-wide cursor reset instead of block-local reconciliation. | Carry |
| **#6594** | Pi `tintinweb` subagents that finish at the turn limit stay "running". | One adapter status branch. | Carry |
| **#6607** | `paseo permit allow/deny` reports success and closes before the daemon acknowledges, so remote approvals are silently lost. | `cli/commands/permit/allow.ts:132,140`; `deny.ts:85,94`. Uses the existing `respondToPermissionAndWait` at `daemon-client.ts:5751-5778`. +397/-170. | Carry |
| **#6306** | A plugin reload fails at the request deadline while the reload is still running. | `daemon-client.ts:5727-5731` sends reload with the default timeout. Reload-only `timeout: 0`. | Carry |
| **#6619** | Desktop client demands daemon identity while an owned daemon is still starting. | `daemon-manager.ts:311-325` swallows `DAEMON_NOT_READY` after 30 s; `daemon-start-service.ts:82-83` immediately upserts. +98/-2. | Carry |
| **#6008** | A child agent that finishes before `create_agent` returns never notifies its caller. Local watcher ignores an immediately idle child. | `agent-prompt.ts:454,585-589`. Relevant to unattended fan-out. | Carry |
| **#6542** | Adding a service to `paseo.json` needs a daemon restart. | `workspace-service-port-registry.ts:40-43,65-67` returns the cached plan. +358/-54. | Watch |

### Tier 3: arrive with the sync, verify the L list

The 29 post-base merges are summarised in
[What the next base sync brings](#what-the-next-base-sync-brings) and need no
carry. Two caveats on the four community merges in that set: #5789 is a macOS-only
benefit and touches `session.ts`, so it is a skip rather than a win; and #6573
(bracket paths in rename) is in the L set, so it needs the fresh fetch.

Two of the M-set fixes are worth keeping on the list even though they arrive for
free, because they fix defects a fork-free build still has until the sync lands:
#6536/#6562 (Git patch presentation, `checkout-git.ts:639-640`) and #6452 (CJK
terminal continuation cells, `terminal/terminal.ts:582-583`).

## Declined upstream: what to carry

Three closed community PRs describe a fix we want and no successor covers them.
These are direct carries:

| PR | Behaviour | Why carry |
| --- | --- | --- |
| **#6340** | Pi waits for prompt acceptance instead of a wall-clock timeout. | Author-closed with no explanation. The finite prompt timeout is still in our tree. |
| **#6543** | Protect replacement turns from delayed Stop cleanup. | Author-closed, no explanation. Our Claude adapter still releases the foreground before the asynchronous Stop completes. Validate against the cancellation seam before taking it. |
| **#6098** | Preserve the settings sidebar scroll offset across navigation. | Author-closed with no reason, no successor. Carry only if the scroll loss reproduces. |

One more closed PR points at an open one rather than a merged one: **#5507**
(fill direct-connection fields on an Advanced URI paste) names **#5570**, still
open. Carry #5570 if wanted, not the competing field-sync approach in #5507.

Seven closed PRs were superseded. Carry the successor, or let the sync bring it:

| Closed PR | Behaviour | Superseded by | Where the successor is |
| --- | --- | --- | --- |
| **#6359** | Decode percent-encoded assistant file links | #6520 | Merged, in the M set, absent from base |
| **#6555** | Ignore external Git diff commands when parsing patches | #6562 | Merged, in the M set |
| **#6554** | Close canceled HTTP download streams | #6567 | Live-merged, absent from the fetched main |
| **#6571** | Keep deleted SQL comment lines in Git Changes | #6569 | Live-merged, absent from the fetched main |
| **#6592** | File explorer names starting with two dots | #6604 | Live-merged, absent from the fetched main |
| **#5562** | Persist a provider-side model switch across reload | #5588 | Open, Tier 2 carry |
| **#5624** | Resolve Codex defaults from the session project | #5644 | Open, Tier 2 carry |

Two closed PRs need a caveat. **#6062** is a duplicate of #6045, which merged on
2026-10-04 and is already in our base, but the fork's own note records a
late-Stop `permission_resolved` delta that is still missing here: check our ACP
path before calling that behaviour present. **#6338** ("shadow: rebased on main,
CI verification for #6311") is a throwaway CI probe that upstream closed. A closed
shadow PR is not a rejected idea.

## Watch

Real, blocked or expensive. Re-check before the next pass.

| PR | Blocked on |
| --- | --- |
| #6192 | Reconciling pending-run settlement with our ACP stop fence |
| #6305 | Rebinding side questions to the new Claude runtime owner |
| #6325, #6129, #6242, #6259 | One Claude integration, not four carries of `claude/agent.ts` |
| #6373, #6379, #6455 | One provenance integration; #6455 is a main-sync feature, not a carry |
| #6510 | Bundles unattended metadata, permission policy and a cancellation watcher |
| #6096 | 21-file permission redesign that overlaps Claude provider seams |
| #6180 | Queued delivery is a new lifecycle outcome across mirrored interfaces |
| #6544 | Needs #6373's notification identity first |
| #6545/#6553 | Listed as Tier 1; watch only the interface churn |
| #6314 | New auth prompt and host-identity contract |
| #6595, #6413 | Transport-neutral downloads, shared client seam |
| #6285, #5729 | Client and protocol hotspot, Usage gate must survive |
| #6531, #5764, #6291 | App and locale churn, side-conversation identity must survive |
| #5847 | Validate against ACP-to-native ZCode mode migration |
| #6461 | CLI structured-output field types change; audit fleet consumers |
| #6601 | Fork-owned plugin SDK compiler path |
| #6542 | Medium concurrency complexity |

## Rejected

Notable skips, so the next pass does not re-litigate them.

- **#5582** is a concrete duplicate: our `opencode/v2/session.ts:295-335` already
  answers it. Do not overwrite the newer local implementation with the older diff.
- **#6108** is superseded by the maintainer's own #6305. Never carry both.
- **#6620** is the focused Cursor usage fix; #6460 and #6615 bundle it with
  account refresh and reordering. They are duplicates of each other, not a set.
- **#6498** and #6568 are the same "only offer Remove for config-defined
  providers" fix; #6568 is the newer copy.
- Locale-completion PRs (#6118, #6291, #6406, #6409) all overlap fork
  `sideConversations` resource keys and are not worth a carry.
- New-surface PRs with no consumer here: #6220 (background work SDK), #6236
  (worktree choice UI), #6377 (plugin SSH hosts), #6394 (keeper), #6465
  (CLI `--feature`), #6622 (conversation titles), #6481 (Rename with AI),
  #6146 (background plugin panels).

## Verification

Hand-checked in this checkout, not taken from a worker's summary:

- `agent/ls.ts:185-187` single fetch; `daemon/status.ts:61` `timeout: 1_500`.
- `private-files.ts:30-36` `renameSync` over a symlinked path.
- `directory-sync/index.ts:83-90` delta-only read.
- `workspace-scripts-service.ts:168-172` `buildSnapshot` with no publish.
- `terminal-pane-focus-claim.ts:33` claim/update choice.
- `diff-highlighter.ts:46-47` accepts only `a/`+`b/`, so `diff.mnemonicPrefix`
  (`c/i/w/o`) breaks path extraction. Upstream **#4233** proposing the fix is
  CLOSED with `mergedAt: null`, closed 2026-10-07.
- `run-git-command.ts:420-432` signals only the child on timeout, leaving
  descendants, which is the defect fiuhq's fork commit fixes.
- Upstream `compact-workspace-header/tab-switcher.tsx` has no `side_conversation`
  branch (501 lines, 13 target kinds enumerated).
- Fork-heavy mines: `tree-kill.ts` signals a child with no positive PID;
  `plugin-process.ts:550-561` sends without a callback and disconnects
  unconditionally; `worker-terminal-manager.ts:153` forks once and `:605-620`
  only rejects on exit, with no respawn; `utils/worktree.ts` has no deletion
  queue; `row-store.web.ts:120-132` awaits a request and transaction completion
  sequentially.

Not verified: any runtime behaviour, any test result, any device or platform
outcome. Sizes are GitHub's. Nothing here was built or executed.
