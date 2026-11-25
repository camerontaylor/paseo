# Beta upgrade, U2b infi backend handover (2026-10-17)

Candidate branch `fork/infi-backend-0.12.0-beta.1` in the isolated worktree
`/home/ctaylor/repos/paseo-upgrade-infi-backend`. The U1 and U2a branches and worktrees were not
touched. Checks ran on Neptune in the shared private candidate.

## Inputs

| Input | SHA |
| --- | --- |
| U2a head (base) | `b02d333f729c02651659b3aba757da84312704d1` |
| Adapted infi backend carry | `1dd375931a0c4de5e930abb4b2cf2dc52d9cbcc5` |
| Merge | `5b2dfb6e78a23b1a5775dc496cec80b90c22cee3` (parents `b02d333f7`, `1dd375931`) |
| Behavioral receipts | `be3197a9d3a0420a7085a9d0bc00e56624ac24aa` |
| Compact owner correction | `6677c971462ee9ccf8a0fa4b4fccb1840e32b1b9` |
| Compact page states | `707b8b23ed1a40f6f57a837da981cf4fea664b41` |
| Final source SHA | `c077a85ab434351d1bad133853f73437ed6c2dd9` |

The carry is one adapted commit, 54 files (+2751/-320), pinned to Source-IP01 `cabbc692d`,
IP02 `637360584`, IP03 `0d4161b1c`, IP04 `1967db56b`, IP07 `06b79b7c9`, IP13 `f3a66c4be`. No
author fork and no UI layer was merged. Merge base with the carry branch is `5c922d3d2`.

## Conflicts

Fresh count 3, confirmed by `git merge-tree --write-tree` (tree `68d9ae84a2f33db0e1542fbf0a281098092433a2`)
and by the real merge.

| Path | Resolution |
| --- | --- |
| `packages/app/src/screens/workspace/scripts/workspace-scripts-button.tsx` | Beta's moved component keeps its shape and its `useWorkspaceScriptActions` seam; the carry's IP-04 behavior is ported in: menu-demand discovery behind `packageJsonScripts`, search, collapsible package groups, loading, retry and empty states, package-script labels, and a sheet menu on compact |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | Beta's header stays as it is, with no restored mobile ternary. The scripts button gate keeps beta's structure and additionally renders for a discovery-capable host, so IP-04 stays reachable when a workspace has no configured scripts yet |
| `packages/protocol/src/messages.wire-compat.test.ts` | Import union |

## Compact owner correction

Compact has no scripts button in beta's layout. Beta puts scripts on a page of the workspace header
menu (`useWorkspaceScriptsMenuPages`), and the carry's discovery only reached the desktop button, so
a compact workspace could not see package scripts at all and the carry-authored compact assertions
clicked an element that does not exist. `6677c9714` and `707b8b23e` extend beta's existing hook
with the same menu-demand discovery and the same capability gate (shared query key, rows and pages
labelled by the package script name, discovery only while the menu is open) and give the Scripts
page loading, error-with-retry and empty rows, so the row a capable host shows always targets a
real page and a discovery failure is visible. No compact button was added; beta's page grid,
grouping and search stay in the desktop button.

## Semantic audit of the auto-merges

30 paths are changed by both sides; 3 conflicted and 27 auto-merged. The auto-merged set was
audited for call sites, guards, ordering and error paths:

- **U2a rename serialization intact**: `providerRenameMigration`, `enqueueProviderRenameMigration`,
  the close drain, and the completion broadcast of `daemonConfigStore.get()` are unchanged.
- **U1 side-conversation delivery intact**: `forwardSideConversationUpdate`, the capability set,
  `hasSideConversationEventSubscription`, and the byte-budget import all survive; the U1 session
  suite passes including the new base-ref denial test.
- **IP-07 base ref**: schemas, session routing, `workspace.write` entries for request and response,
  the `checkoutBaseRefSet` flag, `checkout-git` `set-base-ref`, `writePaseoWorktreeBaseRef`, and
  the branch-suggestion `localRefs`/`remoteRefs` metadata are present.
- **IP-02 and IP-13**: `resolveForkLocalPullRequestView`, `pickPullRequestCandidate`,
  `parseStatusCheckRollup`, optional `checks` on PR facts, and the `forgeSearchChecks` flag.
- **IP-03**: the quit path keeps `isDesktopManagedDaemonRunning()` and adds the cancelable
  confirmation plus `quitSignal` and `confirmStopDaemon`; no unowned-daemon authority and no
  confirmation bypass.
- **IP-01**: the link parser takes `sourceCwd`/`workspaceRoot`, reports
  `outsideWorkspaceDirectory`, and the stream view resolves source locations with an inline error
  surface.
- **IP-04**: `discoverPackageScripts` with quoting, exclusion of dependency, generated, hidden and
  symlinked directories, package-manager inheritance, the `packageJsonScripts` flag, script status
  projection, and the replica-cache script snapshot.
- **Other overlaps** (`session.ts`, `websocket-server.ts`, `daemon-client.ts`, i18n, docs) hold the
  carry's additions next to beta's ownership.

No carry hunk was retired as equivalent in this layer. The only carry text dropped is the obsolete
mobile header ternary and its ghost scripts button, which beta's compact header replaced.

Scope ruling: compact search, grouping and the desktop grid are **not adopted**. Beta's compact
header menu is the canonical compact owner and lists scripts as pages, so those desktop surfaces
stay in the desktop button. This is a scope decision, not equivalence or coverage: the desktop
keeps its bounded list, scroll and filter, and compact keeps discovery, run, terminal navigation
and resize.

## Behavioral receipts

| Behaviour | Evidence |
| --- | --- |
| Compact discovery, run and navigation | Browser: `workspace-package-scripts.spec.ts` case at `126` starts compact and drives the header menu: nested package script discovered, run, sheet closes, its `terminal-surface` visible, reopening reports the row `Running` |
| Resize preservation | Browser: case at `157` starts desktop, asserts the desktop trigger, narrows to compact, then drives the same compact flow, so the resize path is asserted rather than replaced |
| Old-host no-send | `packages/client/src/daemon-client.test.ts` "refuses to set a checkout base ref when the host lacks the feature" asserts the rejection and `mock.sent` length 0; `daemon-client.ts` calls `requireCheckoutBaseRefSupport()` before building the request |
| Base-ref authorization denial | `session.test.ts` "rejects a base-ref change without workspace.write" expects `access_denied` before dispatch |
| Base-ref persistence and refresh | `checkout-session.test.ts` persists the base, refreshes git state, rejects an unsafe ref before touching the checkout, and emits an error response when persisting fails |
| Quit cancel and updater | `quit-lifecycle.test.ts` covers cancel, keep-running, OS signal and updater-started quit |
| Fork-local versus parent PR | `github-service.test.ts` covers fork-redirect when the fork has no matching PR, fork-local PR resolved without redirecting, a fork-local PR crowded out of a batch page, bounded open PR listing, and listing without checks permission |
| Scripts capability absence | `workspace-scripts-button.test.tsx` with `packageJsonScripts: false` shows no discovered rows |

## Receipts

All evidence paths are under
`/Users/ctaylor/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2b/` on Neptune.

- `build:server`, `typecheck`, `lint`, `format:check` all exit 0 at `34b55a2ec`; `typecheck`,
  `lint` and `format:check` exit 0 again at `c077a85ab` after the app-only compact correction,
  which leaves the server and protocol declarations untouched.
- Focused suites, `npx vitest run <file> --bail=1`: protocol checkout-pr-schema and wire-compat;
  server checkout-session, workspace-scripts-service, package-scripts, terminal-notifications,
  worktree-bootstrap, checkout-git, session (159), provider-rename, mutable-provider-config-owner;
  app assistant-file-links parse, scripts button (12), sidebar meta-items and service-summary;
  desktop quit-lifecycle; client daemon-client (177). All exit 0 except the attribution below.
- Browser, `workspace-package-scripts.spec.ts`: 4 of 4 at `c077a85ab`, covering desktop nested
  scripts and bounded search plus fresh-compact and resized-compact discovery, run and navigation.
- `github-service.test.ts` fails one case, "merges pull requests with gh using merge", with
  `GitHubCliMissingError`. The same file and case fail identically at `b02d333f7` (rc 1), so this is
  an inherited environment limitation, not a carry regression.
- The three known environment limitations from earlier layers (claude binary, packaged zsh prompt,
  claude provider unavailable) remain open.

## Gaps

- The claude CLI and a usable claude provider are absent here.
- Physical iOS and Android, packaged Electron and nine-locale sweeps remain U7 work.
- The U2c infi UI layer is not started.
