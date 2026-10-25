# Beta upgrade, U1 merge handover (2026-10-17)

Permanent-work candidate `upgrade/custom-0.12.0-beta.1`. Sole writer checkout:
`/home/ctaylor/repos/paseo-upgrade-custom`. Builds, dependency installs and broad checks ran on
Neptune in `~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/custom`. Nothing here was published,
installed, or restarted.

## Inputs

| Input | SHA |
| --- | --- |
| Reconciled custom (ours) | `7ce6fca987721c33ad2b87fcab8d1cb59f4b0c8b` |
| v0.12.0-beta.1 (theirs) | `e2f4948f92ce2fc3c4cfb7878f239a88034883de` |
| Merge base | `ab10a6694ccf068959d1a6b67b6c915e21a9fe91` |
| Merge commit | `4a0b83bf382e0c1fc5d2f816e5de5d5f440014a8` |
| Final source SHA | `084d37953ecd778eaa472339d90167facddd575f` |

Both inputs are ancestors of the final SHA. Commits after the merge:

| Commit | Purpose |
| --- | --- |
| `bf0ec9e75` | Port side conversation wiring into beta's compact header and sheet resolver |
| `89cf5b44e` | Drop the dead `agent-prompt` envelope import beta replaced with `projectAgentMessage` |
| `249c7181d` | Adapt fork side conversation routing to beta's layout-mode API |
| `b3dd1f955` | Beta lint regressions (duplicate case, complexity, shadow) and oxfmt |
| `0ef3e75ef` | Cover beta observation-producer gating and routing edges |
| `aa41dc761` | Deliver side conversation events through beta owned subscriptions |
| `084d37953` | Bounded lint repair: the two category cases become a set check at complexity 20, plus session test formatting |

## Conflicts at recovery

The recovery snapshot had **12 residual unmerged paths** (the planning preflight counted 29 for
the custom input; that number is not the recovery count and must not be reported as one). Four
still carried markers; eight had resolved text staged by the previous worker and were audited,
not re-resolved.

| Path | Resolution |
| --- | --- |
| `docs/agent-lifecycle.md` | Beta cancellation, stop-fence and background-workspace prose; fork side conversation and compact sections kept |
| `packages/app/src/panels/agent-tracks.tsx` | Beta `openPreferredWorkspaceTarget` and `useSubagentOpensInSheet` ownership, fork `onOpenSideConversation` wiring |
| `packages/app/src/panels/provider-subagent-panel.tsx` | Beta `PaneSubtitle` and sheet plumbing, fork NOOP side conversation prop |
| `packages/app/src/subagents/track.tsx` | Beta `opensInSheet`/`closeOnSelect`, fork `onOpenSideConversation` and row press |
| `packages/app/src/workspace-tabs/open-beside.test.ts` | Union of fork routing tests and beta preview tests |
| `packages/client/src/daemon-client.test.ts` | Union; no fork line dropped |
| `packages/plugin/src/server/provider.ts` | Fork `supportsSystemPrompt?` plus beta fields |
| `packages/server/src/server/plugins/plugin-process-protocol.ts` | Fork `supportsSystemPrompt?` in metadata and schema plus beta fields |
| `packages/server/src/server/agent/agent-manager.ts` | Fork side conversation store, events and subscriber filter plus beta `projectAgentMessage` and `includeInternal` opt-in |
| `packages/server/src/server/agent/agent-manager.test.ts` | Import union (vitest plus `agent-messages`) |
| `packages/server/src/server/agent/providers/pi/agent.ts` | Fork `handleThinkingLevelChanged` (effective-effort persistence, cache-risk notice, change-only emit) over beta's inline write |
| `packages/server/src/server/agent/providers/pi/rpc-types.ts` | Beta typed `thinking_level_changed: PiThinkingLevel`, fork `usage` block |

## Preserved fork behavior

- Side conversations end to end, including the owned-subscription delivery path below.
- ACP cancellation ledger, staged successor admission, and optional-method receiver binding in
  `provider-registry.ts` (`steerActiveTurn`, `askSideQuestion` stay bound to their session).
- Side-question forwarding through the Claude, OpenCode and ACP seams.
- Pi effective-effort persistence and the cache-risk notice.
- Plugin provider `supportsSystemPrompt` and the provider configuration transactions in
  `daemon-config-store.ts`.
- Optional protocol schemas, `agent.side_conversation.*` operation-permission entries, client
  capability defaults, and the fork's compact/desktop routing preferences.

## Beta ownership kept

Package and workspace versions at `0.12.0-beta.1`, the Markdown replacement
(`react-native-enriched-markdown` plus its patch and postinstall entry), the generated-validator
split, responsive memory fixes, panel/sheet/tab ownership, and the owned observation producers.
`package.json` fork delta was version bumps only, so the merged lock is beta's lock; the lock was
regenerated from the merged manifests on Neptune as a recorded no-op.

## Side conversation event delivery

Beta's owned observations mean a modern socket accepts only proof-carrying messages.
`sendMessageToSockets` calls `delivery.permits`, so the fork's broadcast updates and removals were
dropped for the app. Archive removal was the visible loss: the open thread kept showing an answer
the host had dropped.

The fix keeps the events inside beta's contract. `SessionEventSubscriptionSchema` gains
`agent.side_conversation.update` and `agent.side_conversation.removed`; `server_info` gains
`features.sideConversationEvents`; the payloads accept the optional `subscriptionId` proof tag.
`forwardSideConversationUpdate` mirrors `forwardProviderSubagentUpdate`: authorization once, then
proof-carrying delivery to event subscriptions whose owner source advertises `sideConversations`,
a capability-gated lane for legacy sources, and a default lane that calls `onMessage` directly so
it never re-enters the unfiltered owner loop. A side conversation subscription also counts as
AgentManager demand. The client filters the two selectors against the current handshake on every
send, including the restore after a reconnect, so an older daemon never parses a selector it
cannot know. An older host therefore keeps the old behavior and no fallback is emulated.

## Receipts

All receipts are under
`~/.paseo-fork/candidates/upgrade-0.12.0-beta.1/evidence/u1/` on Neptune and name the SHA.

- `npm ci` on the candidate, pinned Node `22.20.0` and npm `10.9.3`, hooks redirected to
  `isolated-hooks`, exited 0.
- `npm install --package-lock-only --ignore-scripts` from the merged manifests exited 0 with an
  empty `package-lock.json` diff.
- Generated validators are produced by `@getpaseo/protocol`'s `prebuild`, `pretypecheck` and
  `pretest` hooks, so `build:server` and `typecheck` regenerate them; `ws-outbound.aot.ts`
  (6,104,839 bytes) and its schema metadata (20,414 bytes) were hashed and the validator suites
  ran against the generated output.
- `build:server`, `typecheck`, `lint`, `format:check` all exit 0 at `084d37953`.
- Focused vitest suites, `--bail=1`: server `session.test.ts` and side conversation manager (160
  tests), client `connection.test.ts` and `daemon-client.test.ts` (212 tests), protocol
  `messages.wire-compat`, `messages`, side conversation and ws-outbound validation.
- Playwright browser project: 10 of 10 pass across `side-conversations.spec.ts`,
  `compact-workspace-sheet.spec.ts` and `compact-workspace-header.spec.ts`, including
  "tells the user the thread is gone when the parent is archived". The full-file run used the
  working tree that became `aa41dc761`. `084d37953` is an equivalent category-set extraction plus
  test formatting, with no behavior change, and the archive assertion was re-run green on
  `084d37953`.

## Gaps

- Physical iOS and Android and a packaged Electron build were not exercised in U1. Compact and
  desktop routing are covered by browser tests and unit suites only.
- A host that predates `features.sideConversationEvents` receives no side conversation events on a
  modern client. That is the gated contract, not a fallback; the app still reads threads through
  the existing fetch calls.
- The browser run covers one compact viewport family and the desktop Chrome project; no nine-locale
  sweep was performed for this merge.
