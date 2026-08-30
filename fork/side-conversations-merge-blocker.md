# Landing side conversations on `custom`

`read/side-conversations-phase1-plan` carries a complete, test-verified Phase 1
side-conversations feature that has never landed. Merging it is not a conflict
resolution — the branch was cut before an upstream refactor that deleted the API it is
built on. This is the map and the port plan. Delete it when the merge lands.

Verified 2026-08-30 against `custom` at `793c5ff0f`, by trial merge.

## What collides

The branch's four commits sit on `8905ad416`, which is also
`git merge-base custom read/side-conversations-phase1-plan`. Since then `custom` picked
up upstream #3826, `c914bcb44 feat(app): make Explorer a first-class pane host`. That
commit drifted the app layer in three separate ways, and only the first produces git
conflicts.

### 1. A deleted module

#3826 deleted `packages/app/src/workspace-tabs/side-panel.ts`, which exported
`openSupportingTab`, `openSidePanelView`, `showSidePanel` and `hideSidePanel`. The whole
app layer of side conversations calls `openSupportingTab`.

| Gone from `side-panel.ts` | Now in                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `openSupportingTab`       | `workspace-tabs/open-beside.ts` — `openPreferredWorkspaceTarget` and friends                |
| `openSidePanelView`       | `workspace-tabs/open-supporting-view.ts` — `openWorkspaceChanges`, `openComposerChanges`, … |
| `showSidePanel` / `hide…` | `workspace-tabs/explorer-sidebar.ts` — the overlay / dock / pane presentation model         |

### 2. A dead setting

`openSupportingTab` took a boolean `openInSidePanelByDefault`, which the branch reads
from `settings.openSupportingTabsInSidePanel`. That single global boolean no longer
exists as a setting. #3826 replaced it with `settings.openInSidePane`, an
`OpenInSidePanePreferences` object with one boolean per open source
(`storage.ts:94`). The old key survives only as a COMPAT field on the stored zod schema
(`storage.ts:255`) and is not a member of the `AppSettings` interface, so the branch's
`useSettings` selector is a type error, not a silent `undefined`.

`openPreferredWorkspaceTarget` accordingly takes a `source` key plus the whole
`preferences` object instead of one boolean.

### 3. A new exhaustive registry — the part with no conflict

#3826 added `packages/app/src/panels/panel-manifest.ts`. Its `manifests` record is
`satisfies PanelManifestByKind`, a mapped type over **every** member of
`WorkspaceTabTarget["kind"]`. The branch adds `side_conversation` to that union in
`workspace-tabs/model.ts`.

The branch has never touched `panel-manifest.ts`, so git reports no conflict and the
merge breaks a file that appears in neither diff. The same commit also moved
`resourceKey` out of `PanelRegistration` into the manifest and introduced `definePanel`,
so the branch's hand-written registration object is stale too.

## The dangerous part

Files only the branch touched merge clean and then fail to build. Grep the whole deleted
surface before trusting a clean merge — the conflict list is not the work list.

- `packages/app/src/side-conversations/start.ts:6` imports `openSupportingTab`; `:36`
  reads the dead setting; `:44` calls the dead function.
- `packages/app/src/panels/agent-tracks.tsx:121` calls `openSupportingTab`.
- `packages/app/src/panels/panel-manifest.ts` — no `side_conversation` entry, so
  `satisfies` fails and `getPanelManifest("side_conversation")` is undefined at runtime.
- `packages/app/src/panels/side-conversation-panel.tsx:272` builds a
  `PanelRegistration<"side_conversation">` literal with an inline `resourceKey`.

## Two decisions, before you port anything

**Which `source` key.** Reuse `"subagents"`. Side conversations launch from the same
agent-tracks row as subagents and present the same way, and `agent-tracks.tsx:72` and
`:89` are a working template for the exact call. A new `sideConversations` key would
cost the `OpenInSidePanePreferences` interface, the defaults, the zod field, a settings
row and nine locale files, to split a preference no user has asked to split. Adding the
key later is additive; removing one is a migration.

**Which `supportedHosts`.** `["main", "explorer"]`, matching `agent` and
`provider_subagent`. Every nested-agent panel supports both hosts; `resolvePlacementPane`
now picks a pane by `panelSupportsHost` rather than by an exclusion list, and returns
null when nothing supports the target.

Do not port the branch's `SIDE_PANEL_EXCLUDED_TAB_KINDS` line. See correction 2 below.

## Ordered steps

1. **Make the checkout buildable first.** See "Before you start". A merge on an
   unbuildable checkout produces type errors you cannot attribute.

2. **Merge and resolve the six conflicts** (below), taking `custom`'s side on all
   structural drift.

3. **Add the manifest entry** in `panels/panel-manifest.ts`, next to
   `provider_subagent`:

   ```ts
   side_conversation: {
     kind: "side_conversation",
     supportedHosts: ["main", "explorer"],
     resourceKey: (target) => `${target.parentAgentId}:${target.threadId}`,
   },
   ```

   The `resourceKey` is the branch's own, moved from its registration object.

4. **Convert the registration** in `panels/side-conversation-panel.tsx` to
   `definePanel("side_conversation", { component, useDescriptor })`, dropping `kind` and
   `resourceKey`. Copy the shape from `provider-subagent-panel.tsx:231`.

5. **Port `side-conversations/start.ts`** to the new API: read
   `settings.openInSidePane` instead of the dead boolean, and call
   `openPreferredWorkspaceTarget` with `source: "subagents"` and
   `preferences: openInSidePane`. The rest of the hook is unchanged.

6. **Port `agent-tracks.tsx`'s `handleOpenSideConversation`** the same way. Its
   neighbours `handleOpenSubagent` and `handleOpenProviderSubagent` are the template,
   including the `canSplit && workspaceKey` guard the branch already has.

7. **Rehome the deleted routing tests.** `side-panel.test.ts` is gone and `open-beside.ts`
   has no test file — `open-supporting-view.test.ts` covers only the view helpers. Add
   `packages/app/src/workspace-tabs/open-beside.test.ts` with the branch's two
   `side_conversation` cases rewritten against `openPreferredWorkspaceTarget`: compact
   opens in the single pane, non-compact with `openInSidePane.subagents` true opens in
   the side pane.

8. **Grep the deleted surface again** before you commit:

   ```bash
   rg "openSupportingTab|openSidePanelView|showSidePanel|hideSidePanel|workspace-tabs/side-panel" packages/app/src
   ```

   The only surviving hit should be the COMPAT field at `storage.ts:255`.

## The six conflicts

1. `contexts/session-context.tsx` — `custom` deleted the `script_status_update` handler;
   the branch inserted two `agent.side_conversation.*` handlers just before it. Keep the
   deletion and both new handlers.
2. `stores/workspace-layout-actions.ts` — take `custom`'s side and drop the branch's
   line. See correction 2.
3. `panels/agent-tracks.tsx` — `custom`'s `handleOpenChanges` versus the branch's
   `handleOpenSideConversation`. Both are wanted; the second needs step 6.
4. `screens/workspace/workspace-screen.tsx` — imports only. See correction 1.
5. `workspace-tabs/side-panel.test.ts` — modify/delete. Honour the deletion; step 7 is
   where the coverage goes.
6. `server/agent/agent-manager.ts` — one `AgentManagerEvent` union member each side
   (`timeline_replacement` versus `side_conversation`) plus one import block. Union both.
   The server layer has no other drift; it merges clean.

Two more conflict on `fork/`, from the rebase duplicate of the namespace commit. Take
ours for both: `local-fork-candidates.md` differs only by formatting, and `README.md` is
strictly newer on `custom` — add the branch's `side-conversations-follow-ups.md` row to
the table by hand.

## Corrections to the 2026-08-30 map

The first version of this doc was written from the conflict list. A trial merge corrected
two of its resolutions and found a third break.

1. **Conflict 4 is smaller than described.** The earlier note said the branch's
   auto-merged body still calls `buildDeterministicWorkspaceTabId` and
   `selectVisibleAgentIds`. It does not — the branch's three hunks in that file are all
   additive (`useStartSideConversation` import, a `side_conversation` case in
   `getFallbackTabOptionDescription`, and the `MobileWorkspaceTabOption` wiring), and
   none reference either symbol. Take `custom`'s import block and add the one new import.
   `buildDeterministicWorkspaceTabId` is alive in `workspace-tabs/identity.ts`; only
   `workspace-screen.tsx` stopped importing it, and `selectVisibleAgentIds` is now the
   `useVisibleAgentIds` hook at `workspace-screen.tsx:1910`.

2. **Conflict 2 has no surviving declaration to add a member to.**
   `SIDE_PANEL_EXCLUDED_TAB_KINDS` was deleted outright, not relocated —
   `rg SIDE_PANEL_EXCLUDED_TAB_KINDS packages/app/src` returns nothing. #3826 replaced
   the exclusion test in `resolvePlacementPane` with a `panelSupportsHost` capability
   check, and `agent` and `provider_subagent` now support both hosts deliberately, since
   routing them into the side pane is what `openInSidePane.subagents` is for. Relocating
   the branch's line would encode the opposite of current intent. The manifest entry in
   step 3 is where that decision lives now.

3. **`panel-manifest.ts` is a third silent break**, not covered by "the two files that
   merge clean and then fail to build". It is the one file the branch could not have
   anticipated: it did not exist at the merge base.

## Verification

All three must be green before you commit; the lefthook pre-commit hook runs a full
workspace typecheck and will reject the commit otherwise.

```bash
npm run typecheck
npm run lint
```

Targeted suites only — never the full suite:

```bash
npx vitest run packages/app/src/workspace-tabs/identity.test.ts --bail=1
npx vitest run packages/app/src/workspace-tabs/open-beside.test.ts --bail=1
npx vitest run packages/app/src/panels/side-conversation-panel-state.test.ts --bail=1
npx vitest run packages/app/src/side-conversations/store.test.ts --bail=1
npx vitest run packages/app/src/screens/workspace/workspace-tab-menu.test.ts --bail=1
npx vitest run packages/app/src/i18n/resources.test.ts --bail=1
npx vitest run packages/protocol/tests/side-conversation.test.ts --bail=1
npx vitest run packages/server/src/server/agent/agent-manager.test.ts --bail=1
npx vitest run packages/server/src/server/session.test.ts --bail=1
```

The i18n suite is the one that catches a half-ported feature: the branch adds
`sideConversations.*` keys to all nine locales and `resources.test.ts` asserts parity.

`npm run format` before committing. Do not hand-fix formatting.

## Before you start

Run `npm install`. `node_modules` in a checkout that predates the upstream rebase is
missing `expo-sqlite` and `fake-indexeddb`, so `packages/app` fails typecheck and the
pre-commit hook rejects every commit, including docs-only ones. Revert
`package-lock.json` afterwards — npm rewrites hundreds of `"peer": true` markers, which
is nothing but future rebase conflict. Then `npm run build:server`, or cross-package type
errors will send you chasing declarations that are merely unbuilt.
