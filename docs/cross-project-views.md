# Cross-project Views (design)

Status: in progress on `feat/cross-project-views`. Design decided with Jacob 2026-10-02.

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
