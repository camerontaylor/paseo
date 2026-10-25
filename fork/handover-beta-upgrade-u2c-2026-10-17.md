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
| Header dependency fix | `ed1a399176ac497f5a7ead4cd163f1a8f8945a56` |
| History route-context fix | `bcc4a49ed48b3c41040fa1db9466328d0a5b0a8a` |
| Suite rename for JSX cases | `895f1c660598cb20378c8992697e4cf6ba5ddece` |
| Handoff suite lint and JSX runtime | `31911d43611816b9843e48005e60e241949e49c0` |
| Formatter pass on the new evidence | `d372efd5aaceb36cab683beecc3188633dd32935` |
| Handoff evidence corrections | `d7f65eadbfa1186e7b85d671e5bde81be055d0a5` |
| Daemon-side handoff setup proof | `7d8d787cae45f6b326164ad591c22760d59b4ea9` |
| Pin fixture turn count | `f97f1d173ae5de6ddb261e0281b1277cec7773da` |
| E2E helper type for the thinking option | `1005bda7826c961597f9f6ebc1ae1c561f858e4c` |
| Final source SHA | `1005bda7826c961597f9f6ebc1ae1c561f858e4c` |

Merge base with the carry branch is `5c922d3d2`. The carry covers IP-05, IP-06, IP-08, IP-09, IP-10,
IP-11 and IP-14.

The ledger itself is a docs-only commit on top of the source head; `fork/**/*.md` is outside the
formatter's scope (`.oxfmtrc.json`), so it carries no formatter pass.

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

Denominators, all reproducible from the merge:

| Measure | Count |
| --- | --- |
| Paths changed by both sides versus `5c922d3d2` | 69 |
| Real conflicts | 11 |
| Both-side paths auto-merged | 59 |
| ... byte-identical on both sides | 21 |
| ... requiring a content merge | 38 |
| ... merged result byte-identical to the U2b head | 15 |
| ... genuine unions of both sides | 23 |
| ... merged result equal to the carry | 0 |
| Merge versus U2b head | 86 paths (83 under `packages/app`) |

The preflight figure "28 files changed by both sides, 11 conflicted and 17 auto-merged" describes a
different set: 28 is the UI-layer carry delta (`1dd375931` -> `133ff0f7e`, 85 paths) intersected with
paths beta also changed, and inside that 28 it is 5 conflicted and 23 auto-merged, because six of the
eleven conflicts are backend-replay paths outside it.

Observed blob facts for the 38 content merges: the merged blob equals the U2b head in 15 paths,
differs from both sides in 23, and equals the carry in 0. That is a statement about content, not a
preservation proof; preservation is established by the per-path ownership, guard, ordering and
cleanup audit below, and by the 21 byte-identical paths, where `ours:path` and `theirs:path` are the
same blob.

**The 21 byte-identical paths** (backend carry replay, accepted in U2b) have `ours:path` and
`theirs:path` at the same blob, so the merged content equals both sides by construction. They are
`packages/server/**` (session, websocket-server, worktree-bootstrap, checkout-git, forge and github
services and their tests, package-scripts, workspace-scripts-service, script-status-projection,
operation-permissions, workspace-script-runtime-store, worktree-metadata,
websocket-server.terminal-notifications), `packages/desktop/src/daemon/quit-lifecycle*`,
`packages/app/e2e/support/helpers/workspace-setup.ts`,
`packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`,
`packages/app/src/components/sidebar/workspace-meta-row/*`, `docs/forge-providers.md` and
`docs/terminal-activity.md`.

**The 15 paths whose merge equals the U2b head** keep ours byte for byte, and every line the carry
added is present in ours, so the carry's change is a subset of the change U2b already adapted:
`packages/server/src/{server/session.ts,server/websocket-server.ts,server/worktree-bootstrap*.ts,
services/forge-service.ts,services/github-service*.ts,utils/checkout-git*.ts}`,
`packages/protocol/src/{messages.ts,messages.checkout-pr-schema.test.ts}`,
`packages/desktop/src/main.ts`, `docs/service-proxy.md`,
`packages/app/src/assistant-file-links/parse.ts` and `packages/app/src/runtime/replica-cache/index.ts`.

**The 23 unions**, reviewed for ownership, guards, ordering and cleanup:

- `app/_layout.tsx` — the carry mounts `NavigationHistoryRecorder` once, inside `ProvidersWrapper`
  after `HostSessionManager` and inside the appearance and voice providers; it renders nothing and
  touches no route registration, so beta's route tree is untouched.
- `navigation/history` seam — recording is an effect on (pathname, focused tab of that pathname's
  workspace) rather than a raw store subscription, which keeps the torn `navigateToWorkspace` sample
  invisible; replay moves the index before navigating (`store.setIndex(nextIndex)` at
  `navigation/history/replay.ts:81`) so the landing location is a no-op for the recorder; `pushEntry`
  drops the forward branch and caps at 100; `entriesEqual` identifies a route entry by its path, so a
  distinct change request is a distinct entry.
- `keyboard/keyboard-shortcuts.ts` and `keyboard/actions.ts` — four history entries (`Cmd+[`,
  `Cmd+]`, `Ctrl+[`, `Ctrl+]`), each desktop-only with `commandCenter: false` and `terminal: false`
  where it applies, no duplicates; beta's shortcut table and dispatch are unchanged.
- `hooks/use-keyboard-shortcuts.ts` — `history-go` maps to `goHistory(action.delta)` and returns its
  handled flag; beta's `router-back`/`router-push` cases are untouched.
- `components/sidebar-workspace-list.tsx` — the project PR shortcut renders only for a row with a
  worktree target on a host whose `worktreeSupport !== "unsupported"`, behind `actionsVisible`; the
  carry's `useSidebarProjectStatus`/`statusEnteredAt` plumbing sits beside beta's row content.
- `components/sidebar/project-leading-visual.tsx` and
  `components/sidebar/sidebar-workspace-row-content.tsx` — `useStatusPulse` wraps the status dot and
  takes the bucket's `enteredAt`. The hook cancels its animation and clears its timer on cleanup,
  restores opacity, keeps the original expiry (`enteredAt + 60s`) rather than restarting it, and
  returns early under reduced motion or while the retained panel is inactive. Beta's "busy is the
  ring, not a dot" rule survives in the merged comment and markup.
- `hooks/sidebar-workspaces-view-model.ts` (and its suite) — `deriveProjectStatusBucket` stays as a
  wrapper over the new `deriveProjectStatus`, which returns `{ bucket, enteredAt }` where `enteredAt`
  is the latest timestamp among members that match the aggregated bucket; beta's bucketing is
  unchanged.
- `screens/new-workspace-screen.tsx` — the seeded change request attaches exactly once behind an
  `initialRequestAttached` ref, starts the form in worktree isolation
  (`initialWorktree: Boolean(initialChangeRequest)`), and derives the initial picker selection with
  `allowAutoPrSelection: false`, so a later user selection is not overwritten.
- `stores/workspace-layout-store.ts` — the carry adds an injectable
  `storage: StateStorage = AsyncStorage` factory parameter and passes it to
  `createValidatedPersistStorage`; beta's persist name, version, migrate and partialize are untouched.
- `vitest.config.ts` — `optimizeDeps.include` gains `react`, `react-dom/client` and two
  react-native-web style modules for the jsdom and browser suites; beta's exclude list is intact.
- `docs/glossary.md` — union of the carry's "Base branch" term (which the ported header branch pair
  and the Changes "Compared with" label depend on) and beta's forge terms.
- `e2e/browser/plan-card-markdown.spec.ts` — the carry's handoff case lands on beta's spec; this
  layer extends it with the non-overwrite, setup-preservation and no-auto-send assertions.
- The nine `i18n/resources/*.ts` files — union of carry and beta keys; the locale parity suite
  compares every locale's flattened key set against English and passes.

## Behavioral receipts

All evidence paths are under
`/Users/ctaylor/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u2c/` on Neptune.

- `build:client`, `build:server`, `typecheck`, `format:check` exit 0 and `lint` exits 1 at
  `07e3835f2` (`checks-07e3835f2.log`). The single lint error is the header memo reading
  `normalizedWorkspaceId` without listing it; `ed1a39917` fixes it.
- `typecheck`, `lint` and `format:check` exit 0 at `ed1a39917` (`checks-ed1a39917.log`).
- `typecheck`, `lint` and `format:check` exit 0 at `d372efd5a` (`checks-d372efd5a.log`).
- `typecheck`, `lint` and `format:check` exit 0 at `1005bda78` (`checks-1005bda78.log`), after the
  type-only e2e helper change. The layer's last product-relevant static receipt is `d372efd5a`; the
  commits after it touch tests and the ledger only.
- Focused suites, `npx vitest run <files> --bail=1`, 457 tests pass at `7d8d787ca`
  (`tests-7d8d787ca.log`), including the four navigation-history suites, the handoff suite, the
  pinned-prompt model suite and the locale parity suite that compares every locale's flattened key
  set against English. Earlier runs: `tests-d7f65eadb.log` (81 of 81 for the four touched suites)
  and `tests-895f1c660.log`.
- Browser, pinned UI only, desktop and compact:
  - `project-pull-requests.spec.ts` 2 of 2 and `branch-switcher.spec.ts` 1 of 1 pass at
    `d7f65eadb` (`browser-d7f65eadb.log`).
  - `plan-card-markdown.spec.ts` 3 of 3 passes at `7d8d787ca`
    (`browser-plan-card-7d8d787ca.log`).
  - `pinned-prompt.spec.ts` 6 of 6 passes at `f97f1d173`
    (`browser-pinned-prompt-f97f1d173.log`) after the fixture repair below.

### Browser failures and the repair

The first gate run failed four cases. Both causes are recorded here rather than waived.

**Handoff case.** The setup assertions read the composer chrome, and the seeded mock model
(`e2e-fast-stream`) is `isSelectable: false` with no `thinkingOptions`, so no provider, model or
thinking selector renders. Replaced with daemon-side proof: the spec seeds `ten-second-stream` with
`thinkingOptionId: "high"` and asserts the created destination agent's `provider`, `model` and
`thinkingOptionId` equal the source agent's, with the source's `thinkingOptionId` pinned to `"high"`
so the effort check cannot pass vacuously. Every pre-existing assertion is unchanged. One type-only
test-infrastructure fix went with it: `seed-client.ts`'s `fetchAgents` return type now lists
`thinkingOptionId`, which the daemon payload already carries — `packages/protocol/src/agent-types.ts`
types it on the agent payload, `packages/client/src/daemon-client.ts:903` on the client's agent
record, and `packages/app/src/stores/session-store.ts:68` on the `Agent` the app reads it from.

**Pin cases.** Quantified with a temporary diagnostic spec (uncommitted, deleted) that printed
scroll geometry: at 12 seeded turns the transcript was `scrollHeight` 1914 against a 696px
viewport, so at maximum `scrollTop` (1218) prompt 8's bubble bottom sat 25px below the transcript
top with no scroll range left, and `scrollPromptAboveFold(prompts[8])` could never reach its
precondition. Content below that row was 671px against the 696px viewport, so the row could
approach the top no closer than 25px. Prompts 6 and 7 clear the top on the same fixture, and their
tests passed. The same three cases failed identically at `07e3835f2`
(`browser-pinned-prompt-baseline-07e3835f2.log`), which attributes them to the checkpoint, not to
the later commits. The repair is fixture-only: `LOADED_TURNS` 12 -> 14, so the seeded transcript has
enough content below `prompts[8]` to fill the viewport and the helper still derives `newestPrompt`
itself. `prompts[8]` and every behavioral assertion are unchanged, no timeout moved and no product
code changed. Measured after the repair (`pin-diag-14.log`): at maximum scroll prompt 8's bubble
bottom is 273px above the transcript top, 345px of headroom.

## Gaps

- Coverage boundary, not a waived bug: the pin's behavior for a turn whose remaining content is
  shorter than the transcript viewport is unreachable, because no scroll position can put such a
  prompt above the fold. That is a precondition no fixture can satisfy, and it says nothing about
  whether the pin is correct there. The repaired fixture proves the reachable case with `prompts[8]`
  and 345px of headroom.
- The claude CLI and a usable claude provider are absent here.
- Physical iOS and Android, packaged Electron and nine-locale sweeps remain U7 work.
