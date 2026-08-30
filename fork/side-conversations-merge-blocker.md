# Landing side conversations on `custom`

`read/side-conversations-phase1-plan` carries a complete, test-verified Phase 1
side-conversations feature that has never landed. Merging it is not a conflict
resolution — the branch was cut before an upstream refactor that deleted the API
it is built on. This is the map. Delete it when the merge lands.

Verified 2026-08-30 against `custom` at `de22c6238`.

## What collides

The branch's four commits sit on `8905ad416`, which is also
`git merge-base custom read/side-conversations-phase1-plan`. Since then `custom`
picked up upstream #3826, `c914bcb44 feat(app): make Explorer a first-class pane
host`, which **deleted `packages/app/src/workspace-tabs/side-panel.ts`**. That file
exported `openSupportingTab`, `openSidePanelView`, `showSidePanel` and
`hideSidePanel`. The whole app layer of side conversations calls `openSupportingTab`.

Its replacements on `custom`:

| Gone from `side-panel.ts` | Now in                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `openSupportingTab`       | `workspace-tabs/open-beside.ts` — `openPreferredWorkspaceTarget` and friends                |
| `openSidePanelView`       | `workspace-tabs/open-supporting-view.ts` — `openWorkspaceChanges`, `openComposerChanges`, … |
| `showSidePanel` / `hide…` | `workspace-tabs/explorer-sidebar.ts` — the overlay / dock / pane presentation model         |

`openSupportingTab` took a boolean `openInSidePanelByDefault`. The new API takes an
`OpenInSidePanePreferences` object plus a `source` key. Work out which `source` a side
conversation should use before porting anything, and check what became of the
`openSupportingTabsInSidePanel` setting that `hooks/use-settings/storage.ts:255` still
declares.

## The dangerous part

Git reports no conflict in files only the branch touched, so these merge clean and
then fail to build:

- `packages/app/src/side-conversations/start.ts:6` imports `openSupportingTab` from
  `@/workspace-tabs/side-panel`.
- `packages/app/src/panels/agent-tracks.tsx:121` calls it.

Grep for the whole deleted surface before trusting a clean merge, not just the
conflicted files.

## The six conflicts

1. `contexts/session-context.tsx` — `custom` deleted the `script_status_update`
   handler; the branch inserted two `agent.side_conversation.*` handlers just before
   it. Keep the deletion and both new handlers.
2. `stores/workspace-layout-actions.ts` — `custom` relocated
   `SIDE_PANEL_EXCLUDED_TAB_KINDS`; the branch added `"side_conversation"` at the old
   location. Take `custom`'s side, then add the member to the surviving declaration.
3. `panels/agent-tracks.tsx` — `custom`'s `handleOpenChanges` versus the branch's
   `handleOpenSideConversation`. Both are wanted; the second needs the API port.
4. `screens/workspace/workspace-screen.tsx` — imports. `custom` dropped
   `buildDeterministicWorkspaceTabId` and moved `selectVisibleAgentIds` to a
   `useVisibleAgentIds` hook. The branch's auto-merged body still calls both.
5. `workspace-tabs/side-panel.test.ts` — modify/delete. Honour the deletion, but port
   the two `side_conversation` routing cases the branch added into whichever file now
   owns that coverage.
6. `server/agent/agent-manager.ts` — one union member each side. Union both.

Two more conflict on `fork/`, from the rebase duplicate of the namespace commit. Take
ours for both: `local-fork-candidates.md` differs only by formatting, and `README.md`
is strictly newer on `custom` — add the branch's `side-conversations-follow-ups.md`
row to the table by hand.

## Before you start

Run `npm install`. `node_modules` in a checkout that predates the upstream rebase is
missing `expo-sqlite` and `fake-indexeddb`, so `packages/app` fails typecheck and the
pre-commit hook rejects every commit. Revert `package-lock.json` afterwards — npm
rewrites hundreds of `"peer": true` markers, which is nothing but future rebase
conflict. Then `npm run build:server`, or cross-package type errors will send you
chasing declarations that are merely unbuilt.
