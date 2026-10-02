# P0 source feature/file map

Source repo: `tmad4000/paseo`. Snapshot inspected: **`51fb7693d`** (source PR #21, the reconciled
integration). Later source commits `51fb7693d..f0d5507d2` are listed at the end.

## Method

`51fb7693d` is a **single squash commit** whose message carries an entire upstream sync, so
`git diff dd8a111c3 51fb7693d` touches **3,687 paths** and cannot be used as a feature map. The map
below uses the plan's "declared `v0.10.0-beta.1` integration tree" method instead:

1. `git diff --name-status 51fb7693d v0.10.0-beta.1^{commit}` -> **190 paths** whose content in the
   source snapshot differs from the upstream release #21 declares as its base (`52d345db7`).
   These are the fork's own content.
2. The other **3,497 paths** are byte-identical to upstream `v0.10.0-beta.1`: pure upstream-sync
   noise, zero port work. 3,487 of them are already carried by our own
   `dd8a111c3..v0.11.0-beta.3` sync. The 10 that are not were removed again upstream before
   `v0.11.0-beta.3` (`packages/app/src/hooks/use-compact-time-ago.ts`,
   `packages/app/src/plugins/{runtime-boundary.tsx,sidebar-items.tsx,surface-runtime.ts,surface-runtime.test.tsx}`,
   `packages/app/src/provider-usage/balance-bar.tsx`, two provider-usage e2e specs plus their helper,
   `packages/server/src/services/quota-fetcher/providers/claude-keychain.test.ts`). Recorded as gaps
   only; they are upstream churn, not fork content.
3. Feature attribution uses the per-PR file lists (`gh api --paginate
   repos/tmad4000/paseo/pulls/<N>/files` for N in 1 5 8 9 10 11 13..35; raw output kept in
   `evidence/gh/pr-<N>-files.txt`). **PR #21 is treated as the integration carrier and is never used
   as a feature attribution**; content unique to #21 is mapped by inspection and flagged `#21 only`.

`status` is the source snapshot's state against upstream `v0.10.0-beta.1`: `D` = file exists only in
the fork, `M` = exists in both with different content.

## Summary

| disposition | paths |
| --- | --- |
| EXCLUDED | 49 |
| TM-01 | 48 |
| TM-02/TM-03 | 34 |
| TM-08+ | 24 |
| TM-03/TM-08+ | 7 |
| TM-07 | 6 |
| TM-04 | 6 |
| TM-03 | 5 |
| TM-06 | 4 |
| TM-05 | 3 |
| TM-01 seam | 2 |
| TM-01/TM-07 | 2 |
| **total** | **190** |

Reading notes:

- `EXCLUDED` covers source branding, app ids/TestFlight, auto-updater, source CI and packaging,
  version reservations, and fork-owned documentation (`FORK.md`, `NOTES.md`, the source's own
  `docs/rpc-namespacing.md`). We keep our own release channel and our own protocol docs.
- Every `M` row on a shared host file (`panels/agent-panel.tsx`, `agent-stream/view.tsx`,
  `screens/workspace/workspace-tab-menu.ts`, `components/ui/segmented-control.tsx`,
  `agent-stream/turn-footer.tsx`, `components/message.tsx`, `contexts/session-context.tsx`,
  `contexts/voice-context.tsx`, `composer/index.tsx`, `composer/input/input.tsx`,
  `stores/session-store.ts`, `stores/panel-store/index.ts`, `i18n/resources/*.ts`,
  `server/agent/agent-manager.ts`, `server/session.ts`, `websocket-server.ts`, `protocol/messages.ts`,
  `server/authorization/operation-permissions.ts`, `client/daemon-client.ts`) is a **seam**:
  infi/custom and the source both changed it. These are the TM-01B candidates.
- `packages/protocol/src/messages.ts` and `packages/server/src/server/authorization/operation-permissions.ts`
  are touched by both TM-01 and TM-02/TM-03; they must be sequenced, never cherry-picked twice.
- 9 locale files (`i18n/resources/*.ts`) change for almost every feature; `ko.ts` is the one the
  plan calls out for parity checking.

## Per-path table

| path | status | feature | source PR | note |
| --- | --- | --- | --- | --- |
| `.oxfmtrc.json` | M | EXCLUDED | #16 | build/branding/release/test-config or fork-owned doc - not ported |
| `CLAUDE.md` | M | EXCLUDED | #16 | build/branding/release/test-config or fork-owned doc - not ported |
| `FORK.md` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `NOTES.md` | D | EXCLUDED | #1 | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/agent-lifecycle.md` | M | EXCLUDED | #5 | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/agent-tab-control.md` | D | TM-02/TM-03 | #32 | durable queue daemon + queue UI (#23-26,#30-32) |
| `docs/architecture.md` | M | EXCLUDED | #8 | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/artifact-feed.png` | D | TM-01 | #1 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `docs/companion-stream.md` | D | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `docs/development.md` | M | EXCLUDED | #15,#17,#8 | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/expo-router.md` | M | EXCLUDED | #16,#9 | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/queue-mirroring.md` | D | TM-02/TM-03 | #23,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `docs/rpc-namespacing.md` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `docs/voice-input.md` | D | TM-02/TM-03 | #17,#22,#23,#32 | durable queue daemon + queue UI (#23-26,#30-32) |
| `nix/npm-deps.hash` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `package-lock.json` | M | EXCLUDED | #25,#27,#28,#35 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/app.config.js` | M | EXCLUDED | #14 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/eas.json` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/scripts/testflight-fork.sh` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/src/agent-stream/chat-find/index.tsx` | M | TM-07 | #21 only | reconciled native Find wrapper (replaces the #11 scaffold); uses @/pane-find + existing search model |
| `packages/app/src/agent-stream/chat-find/matches.test.ts` | D | TM-07 | #21 only | native Find match projection test |
| `packages/app/src/agent-stream/chat-find/matches.ts` | D | TM-07 | #21 only | native Find match projection |
| `packages/app/src/agent-stream/chat-find/native-viewport.test.ts` | D | TM-07 | #21 only | native Find viewport test |
| `packages/app/src/agent-stream/chat-find/native-viewport.ts` | D | TM-07 | #21 only | native Find viewport reveal |
| `packages/app/src/agent-stream/strategy-native.tsx` | M | TM-07 | #21 only | native strategy mounts the Find wrapper |
| `packages/app/src/agent-stream/turn-footer.tsx` | M | TM-01 | #19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/agent-stream/view.tsx` | M | TM-01 | #19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/app/_layout.tsx` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/artifacts/feed.tsx` | D | TM-01 | #1,#10,#16,#19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/command-center/agent-control-contributions.test.ts` | M | TM-01 seam | #21 only | contribution ordering test |
| `packages/app/src/command-center/agent-control-contributions.ts` | M | TM-01 seam | #21 only | command-center contributions used by the Stream panel; shared seam |
| `packages/app/src/companion-stream/feed.tsx` | D | TM-01 | #16,#19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/companion-stream/model.test.ts` | D | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/companion-stream/model.ts` | D | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/components/desktop/fork-badge.tsx` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/src/components/headers/back-header.tsx` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/components/headers/navigation-back-button.tsx` | D | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/components/message.tsx` | M | TM-01 | #18,#19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/components/realtime-voice-overlay.test.tsx` | D | TM-02/TM-03 | #17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/components/realtime-voice-overlay.tsx` | M | TM-02/TM-03 | #13,#17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/components/ui/segmented-control.tsx` | M | TM-01 | #10,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/composer/actions.test.ts` | M | TM-02/TM-03 | #25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/actions.ts` | M | TM-02/TM-03 | #25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/index.tsx` | M | TM-02/TM-03 | #13,#23,#24,#25,#32 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/input/input.tsx` | M | TM-02/TM-03 | #13,#17,#22,#23,#25,#30,#32 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/input/state.test.ts` | M | TM-02/TM-03 | #13,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/input/state.ts` | M | TM-02/TM-03 | #13,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/composer/queue-sync.test.ts` | D | TM-03 | #21 only | queue-sync test |
| `packages/app/src/composer/queue-sync.ts` | D | TM-03 | #21 only | daemon queue snapshot <-> local optimistic outbox reconciliation |
| `packages/app/src/contexts/session-context.tsx` | M | TM-02/TM-03 | #15,#17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/contexts/voice-context.tsx` | M | TM-02/TM-03 | #17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/data/push-router.test.ts` | M | TM-02/TM-03 | #21 only | push-router test |
| `packages/app/src/data/push-router.ts` | M | TM-02/TM-03 | #21 only | push delivery owner for queue snapshots; shared seam |
| `packages/app/src/hooks/use-keyboard-shortcuts.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/i18n/resources/ar.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/en.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/es.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/fr.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/ja.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/ko.ts` | M | TM-02/TM-03 | #22,#23,#25,#30,#32,#33,#34 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/i18n/resources/pt-BR.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/ru.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/i18n/resources/zh-CN.ts` | M | TM-01 | #1,#10,#16,#17,#22,#23,#25,#30,#32,#33,#34 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/keyboard/actions.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/keyboard/keyboard-shortcuts.test.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/keyboard/keyboard-shortcuts.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/keyboard/route-shortcut.test.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/keyboard/route-shortcut.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/navigation/focus-history-runtime.test.ts` | D | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/navigation/focus-history-runtime.tsx` | D | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/navigation/focus-history.test.ts` | D | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/navigation/focus-history.ts` | D | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/panels/agent-panel.tsx` | M | TM-01 | #1,#10,#11,#16,#19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/runtime/host-runtime.test.ts` | M | TM-01/TM-07 | #21 only | host-runtime test |
| `packages/app/src/runtime/host-runtime.ts` | M | TM-01/TM-07 | #21 only | host feature store (companionStreamPortV1 gate lives here); shared seam |
| `packages/app/src/runtime/replica-cache/index.test.ts` | M | TM-01 | #21 only | replica cache test added with artifact feed (#1) |
| `packages/app/src/runtime/replica-cache/index.ts` | M | TM-01 | #1 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx` | M | TM-01 | #10,#33 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | M | TM-01 | #10,#16,#33,#9 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/screens/workspace/workspace-tab-menu.ts` | M | TM-01 | #10 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/screens/workspace/workspace-tab-trailing-accessory.test.tsx` | M | TM-08+ | #21 only | trailing control test |
| `packages/app/src/screens/workspace/workspace-tab-trailing-accessory.tsx` | M | TM-08+ | #21 only | tab trailing control used by CLI-opened tabs (#5) |
| `packages/app/src/stores/agent-view-store.ts` | D | TM-01 | #10,#11 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/stores/panel-store/index.ts` | M | EXCLUDED | #9 | Recent-focus Back is owned by IP-10 navigation history (duplicate store) |
| `packages/app/src/stores/queue-outbox-store/index.ts` | D | TM-03 | #21 only | local optimistic outbox store |
| `packages/app/src/stores/queue-outbox-store/model.test.ts` | D | TM-03 | #21 only | outbox model test |
| `packages/app/src/stores/queue-outbox-store/model.ts` | D | TM-03 | #21 only | outbox model + pending enqueue intent |
| `packages/app/src/stores/session-store.ts` | M | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/stores/workspace-layout-store.ts` | M | TM-08+ | #21 only | tab layout/visibility store touched by #5 |
| `packages/app/src/ui-commands/listener.tsx` | D | TM-03/TM-08+ | #21 only | drains buffered ui.commands once the shell mounts |
| `packages/app/src/ui-commands/queue.ts` | D | TM-03/TM-08+ | #21 only | pre-mount ui.command buffer; lost commands are the risk to test |
| `packages/app/src/ui-commands/resolve.test.ts` | D | TM-03/TM-08+ | #21 only | ui.command resolution test |
| `packages/app/src/ui-commands/resolve.ts` | D | TM-03/TM-08+ | #21 only | ui.command resolution (tab open + queue control targets) |
| `packages/app/src/utils/agent-snapshots.ts` | M | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/app/src/voice/audio-engine.native.test.ts` | D | TM-04 | #15 | voice lifecycle / playback recovery / failure feedback |
| `packages/app/src/voice/audio-engine.native.ts` | M | TM-04 | #14,#15 | voice lifecycle / playback recovery / failure feedback |
| `packages/app/src/voice/microphone-cue.ts` | D | TM-05 | #17 | verbal mute/unmute |
| `packages/app/src/voice/voice-runtime.test.ts` | M | TM-02/TM-03 | #15,#17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/voice/voice-runtime.ts` | M | TM-02/TM-03 | #15,#17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/app/src/workspace-tabs/agent-visibility.test.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/app/src/workspace-tabs/agent-visibility.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/app/test-stubs/lucide-react-native.ts` | M | EXCLUDED | #17 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/tsconfig.json` | M | EXCLUDED | #15 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/app/vitest.config.ts` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/cli/package.json` | M | EXCLUDED | #25,#27,#35 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/cli/src/cli-surface.test.ts` | M | TM-08+ | #8 | remember default CLI daemon target |
| `packages/cli/src/cli.ts` | M | EXCLUDED | #8 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/cli/src/commands/agent/artifacts-scan.ts` | D | TM-01 | #21 only | CLI artifact scan against the artifact collector |
| `packages/cli/src/commands/agent/index.ts` | M | TM-08+ | #21 only | CLI agent command surface (#8 daemon target + #5 tab open) |
| `packages/cli/src/commands/agent/run.test.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/cli/src/commands/agent/run.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/cli/src/commands/open.ts` | M | TM-08+ | #21 only | CLI open/deep-link (#5) |
| `packages/cli/src/commands/target.test.ts` | D | TM-08+ | #8 | remember default CLI daemon target |
| `packages/cli/src/commands/target.ts` | D | TM-08+ | #8 | remember default CLI daemon target |
| `packages/cli/src/commands/ui/index.ts` | D | TM-08+ | #21 only | CLI ui command surface (#5) |
| `packages/cli/src/commands/ui/open-tab.ts` | D | TM-08+ | #21 only | CLI open-tab (#5) |
| `packages/cli/src/utils/client-target.ts` | D | TM-08+ | #8 | remember default CLI daemon target |
| `packages/cli/src/utils/daemon-target.ts` | M | TM-08+ | #21 only | persisted CLI daemon target (#8) |
| `packages/cli/tests/28-client-ipc-targets.test.ts` | M | TM-08+ | #8 | remember default CLI daemon target |
| `packages/client/src/daemon-client.ts` | M | TM-01 | #11,#15,#16,#17,#19,#23,#25 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/desktop/assets/icon-fork.icns` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/assets/icon-fork.png` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/bin/paseo` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/electron-builder.fork.cjs` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/package.json` | M | EXCLUDED | #25,#27,#35 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/scripts/after-pack.js` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/scripts/after-sign.js` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/scripts/linux-sandbox/index.js` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/scripts/make-fork-icon.py` | D | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/src/daemon/desktop-packaging.test.ts` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/src/features/auto-updater.ts` | M | EXCLUDED | #20 | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/desktop/src/integrations/cli-install/paths.ts` | M | EXCLUDED | #21 only | build/branding/release/test-config or fork-owned doc - not ported |
| `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/AudioEngine.kt` | M | TM-06 | #14 | iOS background dictation - own native gate |
| `packages/expo-two-way-audio/android/src/main/java/expo/modules/twowayaudio/ExpoTwoWayAudioModule.kt` | M | TM-06 | #14 | iOS background dictation - own native gate |
| `packages/expo-two-way-audio/ios/AudioEngine.swift` | M | TM-06 | #14 | iOS background dictation - own native gate |
| `packages/expo-two-way-audio/ios/ExpoTwoWayAudioModule.swift` | M | TM-06 | #14 | iOS background dictation - own native gate |
| `packages/expo-two-way-audio/src/events.ts` | M | TM-04 | #15 | voice lifecycle / playback recovery / failure feedback |
| `packages/protocol/src/agent-deep-link.test.ts` | M | TM-08+ | #21 only | deep link test |
| `packages/protocol/src/agent-deep-link.ts` | M | TM-08+ | #21 only | agent deep link wire shape (#5) - new wire fields must be optional |
| `packages/protocol/src/agent-labels.test.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/protocol/src/agent-labels.ts` | M | TM-08+ | #5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/protocol/src/agent-types.ts` | M | TM-01 | #1 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/protocol/src/companion-stream.ts` | D | TM-01 | #16,#19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/protocol/src/messages.artifacts.test.ts` | D | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/protocol/src/messages.ts` | M | TM-01 | #1,#11,#15,#16,#17,#19,#22,#23,#25 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/protocol/src/messages.ui-commands.test.ts` | D | TM-03/TM-08+ | #21 only | ui.command wire schema test |
| `packages/protocol/src/messages.voice-mute.test.ts` | D | TM-02/TM-03 | #17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent-queue/send-or-queue.test.ts` | D | TM-02/TM-03 | #23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent-queue/send-or-queue.ts` | D | TM-02/TM-03 | #23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent-queue/service.test.ts` | D | TM-02/TM-03 | #23,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent-queue/service.ts` | D | TM-02/TM-03 | #23,#25,#31 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent-queue/store.ts` | D | TM-02/TM-03 | #23,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent/agent-loading.ts` | M | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/agent-manager-stream-coalescing.test.ts` | M | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/agent-manager.test.ts` | M | TM-02/TM-03 | #17,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent/agent-manager.ts` | M | TM-01 | #1,#11,#16,#17,#19,#23 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/agent-projections.ts` | M | TM-01 | #1,#16,#5 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/agent-prompt.ts` | M | TM-02/TM-03 | #23,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent/agent-storage.ts` | M | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/artifacts/backfill.test.ts` | D | TM-01 | #21 only | artifact backfill coverage added by #21 |
| `packages/server/src/server/agent/artifacts/collector.test.ts` | D | TM-01 | #1 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/artifacts/collector.ts` | D | TM-01 | #1 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/companion-stream.test.ts` | D | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/companion-stream.ts` | D | TM-01 | #16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/create-agent/create.ts` | M | TM-08+ | #21 only | creation path touched for CLI tab policy (#5) |
| `packages/server/src/server/agent/lifecycle-command.test.ts` | M | TM-01 | #21 only | lifecycle-command coverage from Stream pins (#19) |
| `packages/server/src/server/agent/lifecycle-command.ts` | M | TM-01 | #19 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/agent/mcp-server.test.ts` | M | TM-08+ | #15,#23,#5 | CLI-created sessions open tabs - needs tab/subagent-close policy review |
| `packages/server/src/server/agent/tools/paseo-tools.ts` | M | TM-02/TM-03 | #23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/agent/tts-manager.test.ts` | M | TM-04 | #15 | voice lifecycle / playback recovery / failure feedback |
| `packages/server/src/server/agent/tts-manager.ts` | M | TM-04 | #15 | voice lifecycle / playback recovery / failure feedback |
| `packages/server/src/server/authorization/operation-permissions.ts` | M | TM-02/TM-03 | #23,#25 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/bootstrap.ts` | M | TM-02/TM-03 | #23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/daemon-e2e/agent-queue-mirroring.e2e.test.ts` | D | TM-02/TM-03 | #25,#31 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/persistence-hooks.ts` | M | TM-01 | #1,#16 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/session.ts` | M | TM-01 | #11,#15,#16,#17,#19,#23,#25 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `packages/server/src/server/session/voice/index.ts` | M | TM-02/TM-03 | #23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/session/voice/voice-input-command.test.ts` | D | TM-05 | #17 | verbal mute/unmute |
| `packages/server/src/server/session/voice/voice-input-command.ts` | D | TM-05 | #17 | verbal mute/unmute |
| `packages/server/src/server/session/voice/voice-session.test.ts` | M | TM-02/TM-03 | #17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/session/voice/voice-session.ts` | M | TM-02/TM-03 | #13,#15,#17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/session/voice/voice-turn-controller.test.ts` | M | TM-04 | #17,#22 | voice lifecycle / playback recovery / failure feedback |
| `packages/server/src/server/session/voice/voice-turn-controller.ts` | M | TM-02/TM-03 | #17,#22,#23 | durable queue daemon + queue UI (#23-26,#30-32) |
| `packages/server/src/server/ui-commands.test.ts` | D | TM-03/TM-08+ | #21 only | ui.command test |
| `packages/server/src/server/ui-commands.ts` | D | TM-03/TM-08+ | #21 only | daemon-side ui.command fan-out (exists check only) |
| `packages/server/src/server/ui-tab-open.e2e.test.ts` | D | TM-08+ | #21 only | CLI-open tab e2e |
| `packages/server/src/server/websocket-server.ts` | M | TM-01 | #1,#15,#16,#17,#23,#25 | Stream/artifact capture + feed + pins/triage (#1,#10,#16,#19; reconciled by #21) |
| `public-docs/always-on-daemon.md` | D | EXCLUDED | #8 | build/branding/release/test-config or fork-owned doc - not ported |
| `public-docs/cli.md` | M | EXCLUDED | #8 | build/branding/release/test-config or fork-owned doc - not ported |
| `public-docs/configuration.md` | M | EXCLUDED | #8 | build/branding/release/test-config or fork-owned doc - not ported |

## Commits after `51fb7693d` up to the frozen source head `f0d5507d2`

`git log --oneline 51fb7693d..f0d5507d2` — 29 commits. Proposed disposition for each. None of
these are in the frozen source snapshot used for TM-01; they are **candidates for the update loop**,
not part of the first port.

| sha | paths | subject | feature | proposed disposition |
| --- | --- | --- | --- | --- |
| `5c757bdddb` | 2 | fix(app): rebuild relay before TestFlight app deps; document M3 build steps | EXCLUDED | drop: TestFlight/source release machinery |
| `af517bc7ee` | 32 | #22 voice failure reasons | TM-04 | candidate; read `packages/server/src/server/session/voice/voice-recognition-issue.ts` at `f0d5507d2` when TM-04 starts |
| `e309257e61` | 53 | #23 keep agent work running while voice queues follow-ups | TM-02/TM-04 | candidate; **this is the durable queue's origin on the source side** — TM-02 must read it, but its admission semantics conflict with our receipt-backed interrupt path |
| `79e2c2e480` | 3 | #24 restore queued message text in the editor | TM-03 | candidate; composer draft recovery |
| `0bdb40e485` | 4 | fix(server): preserve structured provider startup errors | standalone | candidate independent fix; evaluate against our current upstream (plan: "provider startup/ACP rejection messages") |
| `2fd4c4778e` | 2 | fix(server): show ACP mode rejection details | standalone | candidate independent fix; **must not weaken the custom ACP/GJC admission fence** |
| `d6d640344f` | 21 | filter and sort sidebar sessions | DEFER (sidebar) | defer; reconcile with IP-09/IP-10/IP-12 |
| `fe206f5e40` | 25 | preserve queued messages + safe steer now | TM-02/TM-03 | candidate; source's "safe steer now" omits the receipt service on our side — do not copy as-is |
| `490c25e10f` | 21 | edit queued messages in place | TM-02/TM-03 | candidate; queue revisions |
| `72727a6e9c` | 12 | atomic send with strict steer | TM-02 | candidate; **strict steer must never interrupt a turn** |
| `5b6631b454` | 3 | keep send-now queued until receipt confirms | TM-02/TM-03 | candidate; this is the behaviour our receipt model already wants |
| `b9454b38b1` | 14 | chore: mark fork 0.10.0-beta.2 | EXCLUDED | drop: version reservation + workspace package.json churn |
| `11362e27d5` | 10 | collapse long queued message lists | TM-03 | candidate; presentation |
| `8c97ca3786` | 57 | merge #25 queue safety + sidebar controls | TM-02/TM-03/DEFER | mixed: split into the queue part (candidate) and the sidebar part (DEFER) |
| `d68969c647` | 1 | #26 journal POSIX mode only on POSIX | TM-02 | candidate; portability test, trivial |
| `1d1d3ddba0` | 1 | merge #26 | TM-02 | candidate (merge wrapper) |
| `fd35cb3dfa` | 18 | #27 sort project groups by recent activity | DEFER | defer; version/package churn + sidebar |
| `9d5c5a1510` | 2 | #28 restore xterm addon beta pins | EXCLUDED | drop: source dependency pins |
| `a84417ac51` | 1 | #29 parseable beta3 changelog heading | EXCLUDED | drop: source CHANGELOG |
| `ea20ccc76c` | 10 | #30 send actions in tooltip and menu | TM-03 | candidate |
| `b88762352e` | 6 | #31 queued send control tests | TM-03 | candidate; carry the tests |
| `794c9e0b35` | 20 | #32 busy send choices visible | TM-03 | candidate; **the typed-send default is a product decision, not a source merge** |
| `fe9086a39b` | 17 | #33 unread activity + agent tab sorting | DEFER | defer; reconcile with IP-12 status pulse |
| `e66cc56b84` | 17 | #34 quiet tool-call display | DEFER | optional; approved-command visibility gap recorded in the source PR |
| `da5b159af0` | 9 | default to Summary, keep failed calls visible | DEFER | optional; existing tool presentation is our owner |
| `6cae90316e` | 1 | Summary default settings test | DEFER | with the above |
| `a4bd8e3fe8` | 2 | keep answered questions/approvals visible in Quiet | DEFER | with the above |
| `5de785ea26` | 3 | document tool-call display | DEFER | with the above |
| `c40ee303ff` | 14 | #35 reserve beta.5 | EXCLUDED | drop: version reservations |
| `9c613486dc` | 3 | no-mistakes: apply CI fixes | EXCLUDED | drop: source CI |
| `f0d5507d21` | 22 | merge #34 | DEFER | merge wrapper for #34 |

### Classification cursors for this snapshot

- Last source head **inspected**: `f0d5507d21cf7f6d86c792d235f3c27156a27d7a` (`f0d5507d2`).
- Last source head **fully classified**: `f0d5507d2` — every commit in `51fb7693d..f0d5507d2` has a
  disposition above and every path in the frozen 190-path fork delta has a feature ID.
- **Effective source snapshot for TM-01**: `51fb7693d` (the reconciled integration), with
  `af247e4f4` (PR #19, Stream pins) as the pre-reconciliation boundary for the P1 rehearsal.
