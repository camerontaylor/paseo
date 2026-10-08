# Syncing onto a newer upstream

What breaks when the pinned upstream base moves or a carried branch changes,
and what to check before trusting a green merge. The [feature ledger](feature-ledger.md)
tracks work owned by `custom`; the external Desvio manifest tracks active PR
branches. Add to this record as syncs teach you more.

## Sync the source that owns the change

| Change | Update | Check |
| --- | --- | --- |
| New upstream release | Move `custom` onto the chosen release tag and update `DESVIO_BASE` in `~/.paseo-fork/desvio.conf`. Record the reason in [CHANGELOG.md](CHANGELOG.md). | Run the checkout checks below, then rebuild the full Desvio basket. A green `custom` alone does not validate the external carries. |
| Author updates an external PR branch | Fetch its configured remote. Keep the same manifest line and its position; Desvio rebuilds from the new branch head. | Read the author's changes since the last build and run targeted tests for the changed behavior. |
| Upstream merges or replaces a carried PR | Remove or replace its manifest line after confirming the pinned base contains the replacement. | Check the behavior and any downstream carries that depended on it. Desvio re-resolves entries below the changed line. |
| Our code changes | Edit `custom`, then rebuild `mine`. | Update [feature-ledger.md](feature-ledger.md) when a feature's entry point or shared wiring changes. |

Do not treat a fix made only in `mine` as durable: the next Desvio build
recreates it. A recurring conflict resolution belongs in Desvio's recorded
resolution or in the owning branch; a behavior change belongs in `custom` or a
separate manifest branch. Keep the manifest's comments as the current carry
rationale, rather than copying its changing list into this document.

## A clean merge proves nothing

Several earlier `custom` syncs merged with zero conflicts and then failed
to build. The fork adds to files upstream also grows, and git is happy as long
as the two sides touch different lines — or different files entirely.

Run, in this order, before believing a sync:

```sh
npm ci                          # install the pinned lockfile and apply repo patches
npm run build:server            # generated declarations, or you chase phantom type errors
npm run typecheck
npm run lint
```

Use an isolated candidate tree when a daemon serves the current build. Keep
its lazy-loaded `dist/` files intact. Share third-party dependencies through
[init-worktree](worktrees.md), which keeps workspace links and built output
local. A whole `node_modules` or `dist` symlink invalidates source verification.


After the Desvio rebuild, run focused tests for changed code and a client/daemon
smoke test before deploying. Desvio's own gate runs typecheck and lint but does
not execute tests. Base decisions are in [CHANGELOG.md](CHANGELOG.md);
the live base and carries are in `~/.paseo-fork/desvio.conf` and
`~/.paseo-fork/manifest.txt`.

## The joints that rot without conflicting

The fork carries new protocol message types. Upstream keeps adding exhaustive maps
and switches over _all_ message types. Neither side conflicts; the build fails.

The same shape catches any contract the fork widens and upstream keeps calling: a
required prop added to a shared component, a widened union, a new argument. Upstream
adds a call site in a file the fork never touched, so there is nothing to conflict.
Grep for new callers of anything the fork made stricter.

| Sync               | What broke                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| → `v0.11.0-beta.1` | Upstream made `wrapSessionProvider` exhaustive over session methods. Forward the fork's `askSideQuestion` with its receiver bound, and include it in `provider-registry-wrap.test.ts`'s optional-method coverage. |
| → `v0.7.2`         | `packages/server/src/server/authorization/operation-permissions.ts` — new file, `satisfies Record<InboundOperation \| OutboundOperation, …>` over every message type. The eight `agent.side_conversation.*` types were absent, so `TS1360` on both maps. |
| → `v0.8.0`         | Two, one from each half of the hop. From `v0.7.2`: `packages/app/src/panels/provider-subagent-panel.tsx` — new upstream file rendering `SubagentsTrack`, whose `onOpenSideConversation` the fork made required, so `TS2741` at the new call site. A no-op is the correct fix, not real wiring: `useSubagentsForParent` returns `providerRows` alone once `providerParentSubagentId` is set, so no side-conversation row reaches a nested provider track. `selectSideConversationsForParent` does ignore that param, which makes the opposite conclusion easy to reach — check the hook's return, not the selector. From `v0.8.0-beta.1`: `packages/client/src/connection/index.ts` — `DEFAULT_CLIENT_CAPABILITIES` gained `satisfies Record<Exclude<ClientCapability, …>, true>`, and the fork's `sideConversations` cap had no entry, so `TS1360`. |

**Every message type the fork adds needs an entry in both maps.** Requests that
mutate get `workspace.write`; queries get `workspace.read`; a response takes the
same permission as its request. Get `ask.request` wrong and a read-only
Hub-triggered session can drive someone's agent.

Unmapped types fail closed — `requiredPermissionForInbound` returns `undefined`,
`allows()` denies, and the feature is dead for everyone including the owner, with
`access_denied` on every RPC and pushes dropped silently. That is the right
direction for a security default and a miserable thing to debug from the symptom.

`packages/server/src/server/authorization/index.test.ts` enumerates the message
schema at runtime and asserts every type is authorized. It is the cheapest guard
against this whole class. Run it on any sync.

## Where the evidence goes stale

A feature branch's own "all suites green" note is scoped to the base it was written
on. `fork/side-conversations-follow-ups.md` says typecheck was clean across twelve
workspaces and every suite green; both were true on its base and neither survived
the `v0.7.2` merge. Re-run rather than cite — and prefer running the browser e2e,
which is the only check here that exercises the daemon and app together.
