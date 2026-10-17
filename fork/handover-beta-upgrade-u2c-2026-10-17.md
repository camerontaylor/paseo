# Beta upgrade, U2c infi UI handover (2026-10-17)

Candidate branch `fork/infi-ui-0.12.0-beta.1` in the isolated worktree
`/home/ctaylor/repos/paseo-upgrade-infi-ui`. The U1, U2a and U2b branches and worktrees were not
touched. Checks ran on Neptune in the shared private candidate.

## Inputs

| Input | SHA |
| --- | --- |
| U2b head (base) | `d9e19ff7d5776fee993d93a354375b2a367bdafc` |
| Adapted infi UI carry | `133ff0f7e0234da8aa684a23a8da31024531242d` |
| Merge | `07e3835f2c7d6363c631a069c028bfd4e1939d6e` (parents `d9e19ff7d`, `133ff0f7e`) |
| Final source SHA | `ed1a399176ac497f5a7ead4cd163f1a8f8945a56` |

Merge base with the carry branch is `5c922d3d2`. The carry covers IP-05, IP-06, IP-08, IP-09, IP-10,
IP-11 and IP-14.

## Footprint

The merge touches `packages/app` and three docs only: 83 files, +5241/-99. `git diff --stat` over
`packages/server`, `packages/protocol`, `packages/client`, `packages/cli`, `packages/relay` and
`packages/desktop` is empty, so the U1 side-conversation delivery, the U2a rename serialization and
the U2b backend and capability surfaces are untouched by construction.

## Conflicts

Fresh count 10 from `git merge-tree --write-tree`, 11 in the real merge. Six of the eleven are the
backend carry replayed on a different base, with no UI delta, and are byte-identical to the U2b head
after resolution:

| Path | Resolution |
| --- | --- |
| `packages/app/e2e/browser/workspace-package-scripts.spec.ts`, `packages/app/src/assistant-file-links/parse.test.ts`, `packages/app/src/screens/workspace/scripts/workspace-scripts-button.tsx`, `packages/client/src/daemon-client.ts`, `packages/client/src/daemon-client.test.ts`, `packages/protocol/src/messages.wire-compat.test.ts` | ours |

The five UI conflicts:

| Path | Resolution |
| --- | --- |
| `packages/app/src/components/message.tsx` | Beta's reordered imports; `AgentDeepLinkTarget` re-added next to `PlanCard` and the pin plumbing re-applied by hand (`source` on `ToolCallProps`, in the destructure, on `PlanCard`, and in `areToolCallPropsEqual`) because the conflict block was imports only while the body already carried the carry's changes |
| `packages/app/src/app/new.tsx` | Beta's `WorkspaceComposerEditingSessionsProvider`/`ComposerEditingScope` shell kept with `initialChangeRequest` passed to `NewWorkspaceScreen`; import union with `parseInitialChangeRequest` |
| `packages/app/src/components/plan-card.tsx` | Imports only; beta's set kept plus `AgentDeepLinkTarget`, `PlanCopyActions`, `PlanHandoffButton`. Beta's body already carried `source`, `PlanCopyActions` and the conditional `PlanHandoffButton` |
| `packages/app/src/agent-stream/view.tsx` | Union of beta's `destinationRoot` and the carry's `planSource` memo; beta's body already threads `source` through both `ToolCallSlot` call sites and `ToolCallSlotProps` |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | Beta's extracted `WorkspaceHeaderProjectRow` module and header menu kept; the wide branch pair ported into that module (`branches` prop, `WorkspaceHeaderBranchesModel` exported there), beta's title bar extended with `baseRefName`/`workspaceDirectory`/`normalizedWorkspaceId` and the branches memo, and `baseRef` carried through the checkout-state derivation to `baseRefName` |

## Retired carry hunks

Three, each with evidence rather than equivalence:

- The carry's inline `WorkspaceHeaderProjectRow` and its local `WorkspaceHeaderBranchesModel`. Beta
  moved the component into `@/screens/workspace/workspace-header-project-row`, and the branch pair
  was ported there. No `headerProjectRow*` style remains in `workspace-screen.tsx`.
- `{isMobile && workspaceScripts.length > 0 ? <WorkspaceScriptsButton .../> : null}` in the title
  bar. Beta's title bar has neither the button nor a `workspaceScripts` prop; beta's compact header
  menu owns scripts as pages, which U2b extended with menu-demand discovery (`6677c9714`,
  `707b8b23e`).
- `{!isMobile && workspaceDescriptor && workspaceDescriptor.scripts.length > 0 ? ...}` in
  `headerRight`. Beta's gate is `workspaceDescriptor && (workspaceDescriptor.scripts.length > 0 ||
  supportsPackageJsonScripts)`, a superset for the discovery-capable host and the gate U2b's carry
  introduced. Restoring the carry's gate would have removed the package.json entry point.

Compact search and grouping stay **not adopted**, per the U2b scope ruling. Beta keeps tab, header,
route and compact-menu ownership.

## Semantic audit of the auto-merges

45 paths are changed by both sides; 5 conflicted and 40 auto-merged. For each path the carry's added
lines (base `5c922d3d2` -> carry `133ff0f7e`) were checked for presence in the merged file. Every
path is complete except the two accounted above: `app/new.tsx` reports one line that is present at
beta's indentation, and `workspace-screen.tsx` reports exactly the retired and ported hunks.

Every new carry module resolves to a live reference: `project-pull-requests/view` through
`shortcut.tsx` into `sidebar-workspace-list.tsx`, `overlay-frame` through `view.tsx`,
`navigation/history/recorder` mounted in `app/_layout.tsx`, `reading-signal` through
`pinned-prompt`, `plan-copy-actions` and `plan-handoff-button` through `plan-card.tsx`,
`workspace-header-branches` through the header module, plus `use-status-pulse`, `recently-closed`
and `workspace-recent-agents-menu`.

## Receipts

All evidence paths are under
`/Users/ctaylor/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2c/` on Neptune.

- `build:client`, `build:server`, `typecheck`, `format:check` exit 0 and `lint` exits 1 at
  `07e3835f2` (`checks-07e3835f2.log`). The single lint error is the header memo reading
  `normalizedWorkspaceId` without listing it; `ed1a39917` fixes it and `typecheck`, `lint` and
  `format:check` exit 0 at that SHA (`checks-ed1a39917.log`).
- Focused suites, `npx vitest run <files> --bail=1` (`tests-ed1a39917.log`).
- Browser, pinned UI only, at desktop and compact widths (`browser-ed1a39917.log`).
