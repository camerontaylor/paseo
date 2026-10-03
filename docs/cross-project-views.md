# Cross-project Views (design)

Status: phase 1 shipped in fork 0.10.0-beta.6; phase 2 (broadcast, keyboard, dimming, focus-following header) on `feat/views-phase-2` (2026-10-03). Design decided with Jacob 2026-10-02.

## Problem

Split panes already exist, but only inside one workspace: each workspace owns a split tree
(`packages/app/src/stores/workspace-layout-store.ts`) and every tab in it belongs to that
workspace. There is no way to put an agent from project A beside an agent from project B.

What makes it feasible: pane content already receives its own `serverId` + `workspaceId`
through `PaneContext` (`screens/workspace/workspace-pane-content.tsx`), so one layout can
render sessions from different workspaces and hosts.

## Options considered

### Pane model

| Option                              | Description                                                                                                     | Decision   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| One session per pane (iTerm)        | The View is the "tab"; each pane is exactly one agent or terminal.                                              | Not chosen |
| Tab strip per pane (cmux / VS Code) | Each pane has its own tab bar; any tab can be any session. Same as today's workspace splits, but cross-project. | **Chosen** |

### Placement

| Option                                  | Description                                                                                                                                   | Decision   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| New "Views" surface                     | Separate saved layouts in the sidebar; per-project workspaces unchanged. Low upstream merge risk.                                             | **Chosen** |
| Foreign tabs inside existing workspaces | Faster demo, but explorer/git sidebars point at the wrong project, tab reconcile drops foreign tabs, heavy edits to upstream's busiest files. | Rejected   |
| Replace workspaces entirely (full cmux) | Workspaces become project-less containers. Much bigger change, hard to keep in sync with upstream.                                            | Rejected   |

### Platforms

All three: desktop (full splits), iPad (two panes side by side), phone (swipe pager across panes).

## How cmux does it (reference)

Window → Workspace (sidebar entry) → Pane (split region) → Surface (tab in the pane's own tab
bar) → Panel (terminal or browser). A cmux workspace is **not** a project: each terminal has its
own cwd, and the sidebar entry shows branch, cwd, ports and latest notification. Tabs move freely
between panes, workspaces and windows (`cmux move-surface --workspace 2`).
Sources: https://cmux.com/docs/concepts, https://manaflow-ai-cmux.mintlify.app/cli/surfaces

Mapping to Paseo: a **View** is a cmux workspace — a project-less container of splits whose tabs
each carry a fully qualified session reference (`serverId`, `workspaceId`, tab target). Paseo's
existing workspaces stay as they are: effectively a View pinned to one project.

## Design

- **View** = named split tree; panes have tab strips; each tab is `{ serverId, workspaceId, target }`.
- Create via "Split with session…" (picker over every session across projects/hosts), "Open in
  View" from a workspace tab, or drag from the sidebar onto a pane edge.
- Chrome follows focus: header, explorer and git/diff panels show the focused tab's workspace.
- Closing a tab in a View only removes it from the View; it never archives the agent. The same
  agent may appear in a View and in its home workspace.
- Borrowed from iTerm: pane zoom, dim inactive panes, ⌘⌥+arrow pane navigation.
- Client-only (AsyncStorage, per device). No protocol or daemon change.
- Offline host → the tab renders a "host offline" placeholder.

## Phases

1. View store + route, cross-project tabs, "Split with session…" picker, sidebar section (desktop).
2. Drag-to-split, zoom, dimming, focus-following side panels; iPad two-up.
3. Phone pager, broadcast input to all agents in a View, saved arrangement templates.

## Implementation (phase 1)

| Piece                                                                                                                     | Where                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Persisted store (`paseo-views` in AsyncStorage), split/tab ops reuse the pure workspace layout actions                    | `packages/app/src/stores/views-store.ts`                                           |
| Route `/views/[viewId]`, registered in the root stack and the app-chrome allowlist                                        | `packages/app/src/app/views/[viewId].tsx`, `app/_layout.tsx`                       |
| Screen: `SplitContainer` fed with scoped tabs; non-session targets (files, diffs) open in the tab's home workspace        | `packages/app/src/views/view-screen.tsx`                                           |
| Per-tab scope: `WorkspaceTab.scope` / `WorkspaceTabDescriptor.scope`; tab titles, icons and drag chips resolve against it | `workspace-tabs/model.ts`, `workspace-desktop-tabs-row.tsx`, `split-container.tsx` |
| "+" and empty panes open the session picker instead of the workspace launcher                                             | `views/view-pane-actions.tsx`                                                      |
| Session picker (agents across all hosts and projects)                                                                     | `views/view-session-picker.tsx`                                                    |
| Timeline sync: agents in a View stay open and are reported as visible per host                                            | `views/use-view-timeline-sync.ts`, `contexts/session-context.tsx`                  |
| Sidebar section and "Open in View" tab menu entries                                                                       | `views/sidebar-views-section.tsx`, `views/open-in-view-menu.ts`                    |
| Phone: one pane at a time, header pager (‹ 1/2 ›)                                                                         | `views/view-screen.tsx`, `views/view-screen-header.tsx`                            |

## Phase 2

| Piece                                                                                                                                                                                       | Where                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Broadcast: one prompt to every agent in a View. Idle agents get it now; busy agents get it through the host's durable queue (never steers or interrupts); hosts without a queue are skipped | `views/broadcast-plan.ts`, `views/broadcast.ts`, `views/view-broadcast-modal.tsx` |
| Workspace pane shortcuts inside a View (split opens the session picker, focus/move-tab by direction, close pane/tab)                                                                        | `views/use-view-keyboard.ts`                                                      |
| Inactive panes dimmed (Views only)                                                                                                                                                          | `components/split-container.tsx` (`dimInactivePane`)                              |
| Header shows the focused pane's project and branch                                                                                                                                          | `views/view-screen-header.tsx`                                                    |

Dropped from the plan: dragging a session from the sidebar. The sidebar lists workspaces,
not sessions, so there is nothing session-shaped to drag; "Open in View" on tab menus and the
picker cover it.

Gotchas:

- Zustand selectors here must return stable references. `useShallow` over freshly built
  `{ id, name }` objects loops forever ("Maximum update depth exceeded"); select `order` and
  `views` and derive with `useMemo`.
- Only agents and terminals can join a View: their tab ids are globally unique, while
  targets like `files` or `changes_tree` would collide across workspaces.
- Tab ids are deterministic per target, so a View dedupes the same agent opened twice.
