# Maintaining the fork

This repository is Michael's long-term personal fork of Paseo. The policy (what the fork optimizes for, English-only copy) lives in the top of [CLAUDE.md](../CLAUDE.md). This doc owns the mechanics: which branch is what, how to sync with upstream, and how to keep the fork's footprint visible so each sync stays cheap.

## Branches

| Branch                 | Role                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `upstream/main`        | getpaseo/paseo. Read-only.                                                                            |
| `main`                 | Exact mirror of `upstream/main`. Never commit here; it only moves by fast-forward. Tracks `upstream`. |
| `paseo-customizations` | The fork. Every fork commit lives here or on a feature branch that merges here.                       |

Keep `main` a pure mirror. That is what makes `git log main..paseo-customizations` and GitHub's compare view answer "what has the fork changed" without guesswork. `backup/main-before-upstream-reset-*` exists because `main` once carried fork commits and had to be reset.

## Sync with upstream

Run this when upstream has moved. Start with the report so you know what you are walking into:

```bash
npm run fork:status
```

It fetches upstream and prints the lag of both branches, the fork-only commits, the fork footprint by package, upstream churn inside files the fork also modifies, and the result of an in-memory dry-run merge with the files that would conflict. Nothing is written. `--json` gives the same data for scripts.

Then sync:

```bash
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout paseo-customizations && git merge main
# resolve conflicts, then:
npm run typecheck && npm run lint && npm run format
git commit
```

Merge, don't rebase. `paseo-customizations` is shared across worktrees and origin, and its merge history is the record of what each upstream sync cost. If the dry run shows more than a handful of conflicts, do the merge in a throwaway worktree (`git worktree add /tmp/paseo-merge -b tmp/merge paseo-customizations`) so the main checkout and the dev daemon keep working while you resolve.

Conflict rules:

- Keep both sides. Upstream's change never gets dropped to make a fork feature fit; the fork feature gets re-applied on top of upstream's new shape.
- Non-English locale files: keep upstream's text and whatever fork blocks are already there. The fork does not maintain translations, so a fork key missing from `es.ts` is expected. That is why `TranslationResources` in `en.ts` has optional leaves and the locale files use a trailing `satisfies TranslationResources` instead of an annotation; keep that shape when upstream's header conflicts with it.
- A file upstream deleted and the fork edited: accept the deletion unless the fork edit was the only coverage of a fork feature.
- Finish with the repo checks in the task's package, then the targeted tests for every file that conflicted. Never run the full suite locally.

After the merge, run `npm run fork:status` again. The conflict list should be empty and the merge base should be the new upstream head.

## Sync history

One row per upstream sync. Record what conflicted and what the merge broke silently (auto-merged code that typechecked or tested wrong), so the next sync starts from the last one's lessons.

| Date       | Upstream head | Fork commits | Conflicted files | Notes                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------- | ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | `e3c853df5`   | 25           | 37               | Merge `c97e1eb10`. Silent breakage: upstream's timeline projection collapsed tool-call rows so summary targets lost their seq (`agent-timeline-store.getRow`), upstream's exhaustive `diff-sharing.test.ts` demanded equality checks for fork fields, and a new layout-store test did not expect the fork's default chapters tab. Complexity lint tripped on four merged functions. |
| 2026-09-29 | `f232d23e9`   | 27           | 1                | Includes Sonnet 5.5. Resolved `bootstrap.ts` cleanup by retaining local credential deletion alongside fork summary and sleep cleanup. Auto-merged `registerSession` exceeded the complexity limit; extracted the existing response-metadata restore logic.                                                                                                                          |
| 2026-09-30 | `5599f9e56`   | 27           | 1                | Retained recommended prompts while adopting configurable content width in `turn-footer.tsx`. Upstream removed `MAX_CONTENT_WIDTH`; updated the fork-owned pinned prompt to use `theme.contentMaxWidth`.                                                                                                                                                                             |

## Keeping the footprint small

Each upstream file the fork modifies is a future conflict. Fork-owned files never conflict. When adding a feature:

- Put the feature in new files (a service, a schema module, a component) and touch upstream files only for the wiring: an import, a registration, a menu item, a feature flag.
- At every wiring site in an upstream file, leave a `// FORK(<feature>):` comment. `rg "FORK\("` then lists the fork's intrusions the same way `rg "COMPAT\("` lists shims, and a reader resolving a conflict knows which side of the hunk is fork code without opening git history.
- Prefer upstream's extension points (plugins, feature flags on `server_info.features`, provider registries) over editing core files. When a fork feature needs a protocol change, follow [protocol-compatibility.md](protocol-compatibility.md) as if upstream clients would talk to this daemon; the desktop app and the phone often run different builds of this fork.
- Do not fix upstream bugs on `paseo-customizations` unless they block a fork feature. Send those upstream; the fork inherits them on the next sync without carrying a diff.

## Feature ledger

One entry per fork feature: the commits that built it, the files that own it, and the upstream files it wires into. Update it when you add or remove a feature. The hotspot lists are the files to read first when `fork:status` reports conflicts.

Commits are the fork commits that built the feature (`git show --stat <sha>` for the full file list). "Owns" lists the fork-owned entry points. "Wires into" lists the upstream files the feature edits, largest first.

### Responsive browser preview scale

- Wires into: `packages/app/src/desktop/browser/pane/index.electron.tsx`, `desktop/browser/store/state.ts`, `desktop/browser/resident-webviews.ts`, and English browser labels.
- Responsive tabs default to 75% with a persisted percentage picker. Parking preserves logical viewport dimensions; see [browser capture](browser-capture-harness.md#mechanism).

### Host and project agent defaults

- Owns: `packages/protocol/src/agent-defaults.ts`, `packages/app/src/agent-defaults/`
- Wires into: daemon config schemas, resolution, store and bootstrap; `websocket-server.ts`; app agent-form resolution, project settings and host Agents settings.
- Shared defaults for new composers, with project overrides that follow worktree membership. See [default agents](data-model.md#default-agents).

### Linked Linear issues in the workspace header

- Owns: `packages/app/src/linear/`, `packages/server/src/services/linear-service.ts`, `packages/protocol/src/linear.ts`.
- Wires into: workspace actions, checkout session RPC dispatch, daemon capability reporting, client requests, and English resources.
- Uses the host's `linear` CLI and its existing workspace credentials. The daemon must have the CLI on its PATH; no credentials enter the app. Linking adds the PR URL as a Linear attachment. Creating an issue opens Linear's form, after which you can link its identifier.
- PR URLs are the lookup identity; a shared short-lived daemon cache prevents each connected client from launching another CLI process.

### Workspace PR toolbar button

- Owns: `packages/app/src/git/workspace-pull-request-button.tsx`
- Wires into: Git action policy and hook, `git/workspace-actions.tsx`, and the workspace header.
- Keeps the current PR directly accessible from the toolbar; branches without a PR offer creation from the grey icon's menu.

### Project PR browser

- Commits: `80c69f95c`
- Owns: `packages/app/src/screens/project-pull-requests/` (view, model, checks, shortcut, overlay frame)
- Wires into: `packages/server/src/services/github-service.ts`, `packages/app/src/screens/new-workspace-screen.tsx`, `packages/app/src/git/use-forge-search-query.ts`, `packages/protocol/src/messages.ts`, `packages/app/src/utils/host-routes.ts`, `packages/server/src/services/forge-service.ts`
- Project-scoped overlay listing a repo's open PRs with CI check state; can seed a new workspace from a PR.

### PR polling cadence and merged-PR archive

- Commits: `429051faa`, `8e090cc2c`
- Owns: `packages/app/src/components/sidebar/merged-archive-action.*`
- Wires into: `packages/server/src/services/github-service.ts`, `packages/server/src/server/workspace-git-service.ts`, `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`, `packages/app/src/hooks/use-client-activity.ts`, `packages/app/src/hooks/client-activity-tracker.ts`, `packages/server/src/server/session.ts`
- Focus-aware, rate-limit-budgeted PR polling tiers so merges and CI results land in seconds; one-click archive on merged rows.

### Fork-aware PR resolution

- Commits: `160430f94`
- Owns: nothing new
- Wires into: `packages/server/src/services/github-service.ts` (candidate selection rewrite), `docs/forge-providers.md`
- Looks up a fork's own PRs before falling back to the parent repository.

### Change statistics breakdown

- Commits: `80c69f95c`, `4f9a6f739`, `ff66c741b`
- Owns: `packages/server/src/git/change-stats/`, `packages/protocol/src/diff-stat.ts`, `packages/app/src/components/change-stats.tsx`
- Wires into: `packages/server/src/utils/checkout-git.ts`, `packages/app/src/composer/diff-stat-pill.tsx`, `packages/app/src/git/diff-pane.tsx`, `packages/app/src/git/file-header.tsx`, `packages/app/src/components/diff-stat.tsx`, `packages/app/src/git/diff-tree.ts`, `packages/app/src/components/workspace-hover-card.tsx`, `packages/app/src/components/sidebar-workspace-list.tsx`, `packages/server/src/server/utils/diff-highlighter.ts`
- Categorizes added/removed lines (code, tests, generated, docs, ...) and shows the breakdown in the diff tree, file headers, composer pill, and hover cards.

### Daemon shutdown confirmation

- Commits: `884ac282d`
- Owns: nothing new
- Wires into: `packages/desktop/src/main.ts`, `packages/desktop/src/daemon/quit-lifecycle.ts`, `packages/desktop/src/daemon/daemon-manager.ts`, `paseo.json`
- Confirms before quitting the desktop app when that would stop the daemon.
- Covers any running desktop-managed daemon in the home, not only one this app process launched. Upstream narrowed `isDesktopManagedDaemonRunningSync` and `stopDesktopDaemon` to the owned launch in #4575; the fork keeps the pid-file fallback and lets a confirmed `quit` stop an unowned desktop-managed daemon.

### package.json script discovery

- Commits: `41b31a3dd`, `4f9a6f739`, `ff66c741b`
- Owns: `packages/server/src/server/workspace-scripts/package-scripts.ts`
- Wires into: `packages/app/src/screens/workspace/workspace-scripts-button.tsx`, `packages/server/src/server/worktree-bootstrap.ts`, `packages/app/src/components/sidebar/workspace-meta-row/service-summary.ts`, `packages/server/src/server/script-status-projection.ts`, `packages/server/src/server/workspace-script-runtime-store.ts`, `packages/app/src/components/sidebar/workspace-meta-row/index.tsx`
- Scripts from a workspace's `package.json` are runnable and searchable from the scripts button; run state shows in the sidebar meta row.

### Branch pair and base branch control

- Commits: `fae603ccb`
- Owns: `packages/app/src/screens/workspace/workspace-header-branches.tsx`
- Wires into: `packages/app/src/screens/workspace/workspace-screen.tsx`, `packages/server/src/server/session/checkout/checkout-session.ts`, `packages/server/src/utils/checkout-git.ts`, `packages/server/src/utils/worktree-metadata.ts`, `packages/protocol/src/messages.ts`, `packages/client/src/daemon-client.ts`, `docs/glossary.md`, `public-docs/workspaces.md`
- Shows branch and base branch as a pair in the workspace header and lets you change the base there.

### Tool call summaries

- Commits: `4f9a6f739`, `fe676b131`, `ff66c741b`
- Owns: `packages/server/src/server/agent/tool-call-summaries/`, `packages/protocol/src/tool-call-summary.ts`, `packages/app/src/tool-calls/summary-label.tsx`
- Wires into: `packages/server/src/server/agent/agent-manager.ts`, `packages/app/src/components/message.tsx`, `packages/app/src/tool-calls/presentation.ts`, `packages/server/src/server/agent/agent-response-loop.ts`, `packages/server/src/server/agent/agent-timeline-store.ts`, `packages/app/src/components/tool-call-details.tsx`, `packages/server/src/server/websocket-server.ts` (`toolCallDescriptions` feature flag)
- Model-written labels for tool calls, streamed into the timeline so a collapsed tool call says what it did.

### Sleep prevention

- Commits: `4f9a6f739`, `59ed3d0cb`, `fb4f42001`
- Owns: `packages/server/src/server/sleep-inhibitor/`, `packages/app/src/hooks/use-sleep-prevention.ts`, `packages/app/src/components/desktop/keep-awake-indicator.tsx`, `packages/app/src/screens/settings/prevent-sleep-card.tsx`
- Wires into: `packages/server/src/server/bootstrap.ts`, `packages/server/src/server/websocket-server.ts`, `packages/server/src/server/session.ts`, `packages/app/src/stores/session-store.ts`, `packages/app/src/app/_layout.tsx`, `packages/server/src/server/config.ts`, `packages/server/src/server/persisted-config.ts`, `packages/app/src/screens/settings/host-page.tsx`
- Keeps the host awake while agents run, with a settings card and indicator.
- `sleep_prevention_changed` travels on the `status.server_info` event feed (see `sessionEventCategory` in `packages/server/src/server/session.ts`), and `Session` replays the current state when a client subscribes. Owned-subscription clients drop status messages that no subscription owns, so a raw socket send never reaches them.

### Pinned prompts

- Commits: `6843b4ff7`, `05382d877`, `0d3bda58e`
- Owns: `packages/app/src/agent-stream/pinned-prompt/`, `packages/app/src/agent-stream/reading-signal.ts`
- Wires into: `packages/app/src/agent-stream/view.tsx`, `packages/app/src/agent-stream/chat-outline/model.ts`, `packages/app/src/agent-stream/chat-outline/rail.web.tsx`
- Pins the prompt the agent is currently answering to the top of the timeline.

### Workspace status indicators

- Commits: `6843b4ff7`
- Owns: `packages/app/src/hooks/use-status-pulse.ts`
- Wires into: `packages/app/src/hooks/sidebar-workspaces-view-model.ts`, `packages/app/src/components/sidebar/project-leading-visual.tsx`, `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`, `packages/app/src/hooks/use-sidebar-workspaces-list.ts`
- Live pulse on sidebar status dots; app focus regain triggers a forge status refresh (`session.ts` heartbeat).

### Background activity inspection

- Commits: `fe676b131`, `23cb8e83c`
- Owns: `packages/server/src/server/background-activity/recorder.ts`, `packages/app/src/background-activity/`
- Wires into: `packages/protocol/src/messages.ts`, `packages/server/src/server/session.ts`, `packages/app/src/components/compact-explorer-sidebar.tsx`, `packages/client/src/daemon-client.ts`, `packages/app/src/panels/panel-manifest.ts`, `packages/app/src/workspace-tabs/identity.ts`, `packages/server/src/server/authorization/operation-permissions.ts`
- Records off-timeline daemon work (summaries, git metadata, chapter runs) in an explorer panel.

### Plan handoff and copy actions

- Commits: `fe676b131`, `f777bc1b3`
- Owns: `packages/app/src/components/plan-handoff-button.tsx`, `packages/app/src/components/plan-copy-actions.tsx`
- Wires into: `packages/app/src/components/plan-card.tsx`
- Copy and "hand this plan to another agent" actions on a plan card.

### Navigation history and recently closed agents

- Commits: `f777bc1b3`, `ff66c741b`
- Owns: `packages/app/src/navigation/history/`, `packages/app/src/screens/workspace/workspace-recent-agents-menu.tsx`, `packages/app/src/workspace-tabs/recently-closed.ts`
- Wires into: `packages/app/src/hooks/use-keyboard-shortcuts.ts`, `packages/app/src/keyboard/keyboard-shortcuts.ts`, `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx`, `packages/app/src/styles/theme.ts`, `packages/app/src/app/_layout.tsx`, `docs/expo-router.md`
- Browser-style back/forward plus a menu of recently closed agents.

### Response control (agent naming and summaries)

- Commits: `819cee695`, `c3e1edd11`
- Owns: `packages/protocol/src/response-control/footer.ts`, `packages/server/src/server/agent/response-control/session.ts`, `packages/app/src/response-control/`, `packages/app/src/screens/settings/response-control-card.tsx`
- Wires into: `packages/server/src/server/agent/agent-manager.ts`, `packages/app/src/agent-stream/layout.ts`, `packages/app/src/runtime/replica-cache/index.ts`, `packages/app/src/screens/workspace/workspace-screen.tsx`, `packages/app/src/screens/workspace/workspace-tab-menu.ts`, `packages/protocol/src/messages.ts`, `packages/website/public/schemas/paseo.config.v1.json`
- The agent emits a structured footer that auto-names tabs and summarizes each response.

### Chapter views for checkout diffs

- Commits: `23cb8e83c`
- Owns: `packages/server/src/server/chapters/`, `packages/protocol/src/chapters.ts`, `packages/app/src/chapters/`
- Wires into: `packages/protocol/src/messages.ts`, `packages/server/src/server/session.ts`, `packages/app/src/review/surface.tsx`, `packages/app/src/review/store.ts`, `packages/client/src/daemon-client.ts`, `packages/app/src/components/compact-explorer-sidebar.tsx`, `packages/app/src/stores/workspace-layout-store.ts`, `packages/app/src/workspace-tabs/identity.ts`, `packages/app/src/panels/diff-panel.tsx`, `docs/explorer-sidebar.md`
- Groups a checkout's diff into model-generated chapters with an outline panel.

### Host-backed TypeScript code intelligence

- Commits: `58edd998d`, `7da2f317e`
- Owns: `packages/server/src/server/code-language/`, `packages/protocol/src/code-language.ts`, `packages/app/src/code-language/`, `packages/app/src/git/diff-document/language-target.ts`
- Wires into: `packages/app/src/file-pane/editor/view.web.tsx`, `packages/app/src/git/diff-document/surface.web.tsx`, `packages/client/src/daemon-client.ts`, `packages/protocol/src/messages.ts`, `packages/app/src/panels/diff-panel.tsx`, `packages/app/src/workspace/file-open/index.ts`, `packages/server/src/server/authorization/operation-permissions.ts`, `packages/server/src/utils/checkout-git.ts`, `packages/desktop/electron-builder.yml`, `packages/server/package.json`, `docs/architecture.md`
- A TypeScript language service on the host gives file and diff viewers hover types, go-to-definition, and navigation, with process recovery.

### Source-accurate file links in agent activity

- Commits: `0f0ba1f1d`
- Owns: nothing new
- Wires into: `packages/app/src/assistant-file-links/parse.ts`, `packages/app/src/agent-stream/view.tsx`
- File references in agent output keep their originating checkout path.

### Fork process and review artifacts

- Commits: `fae603ccb`, `202ad64a9`, `7db463fe8`, `ff66c741b`, `fb4f42001`, `84dd166a1`
- Owns: the fork section of `CLAUDE.md`, this doc, `scripts/fork-status.mjs`, `findings/`
- Wires into: `CLAUDE.md`, `package.json` (`fork:status`)

### Shared hotspots

Upstream files that three or more features edit. These conflict on most syncs; read them with `git log -p main..paseo-customizations -- <file>` before resolving.

| File                                                                | Features                                          |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `packages/app/src/i18n/resources/en.ts`                             | nearly all                                        |
| `packages/protocol/src/messages.ts`                                 | 9                                                 |
| `packages/server/src/server/websocket-server.ts`                    | 9                                                 |
| `packages/server/src/server/session.ts`                             | 7                                                 |
| `packages/client/src/daemon-client.ts`                              | 5                                                 |
| `packages/app/src/screens/workspace/workspace-screen.tsx`           | 5                                                 |
| `packages/app/src/agent-stream/view.tsx`                            | 5                                                 |
| `packages/server/src/services/github-service.ts` (+ test)           | 4                                                 |
| `packages/server/src/utils/checkout-git.ts`                         | 4                                                 |
| `packages/server/src/server/authorization/operation-permissions.ts` | 4                                                 |
| `packages/app/src/runtime/replica-cache/index.ts`                   | 4                                                 |
| `packages/server/src/server/agent/agent-manager.ts`                 | 3                                                 |
| `packages/server/src/server/bootstrap.ts`                           | 3                                                 |
| `packages/app/src/stores/workspace-layout-store.ts`                 | 3                                                 |
| `packages/app/src/stores/session-store.ts`                          | 3                                                 |
| `packages/app/src/components/compact-explorer-sidebar.tsx`          | 3                                                 |
| `packages/app/src/git/diff-document/surface.web.tsx`                | 3                                                 |
| `packages/app/src/components/sidebar-workspace-list.tsx`            | 3                                                 |
| non-English `packages/app/src/i18n/resources/*.ts`                  | 3 (pre-policy translations; no longer maintained) |

## Review artifacts

`findings/` holds review-loop output for fork work (`CR*.md` reviewer findings, `FIXES-*.md` fix records, `evidence/` CI logs and screenshots). It is fork-owned and never conflicts. Delete a set once its branch has merged and the findings are resolved; the ledger above is the durable record.
