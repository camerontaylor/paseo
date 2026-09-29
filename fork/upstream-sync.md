# Syncing onto a newer upstream

What breaks when `custom` moves to a newer upstream tag, and what to check before
trusting a green merge. Add to this as syncs teach you more.

## A clean merge proves nothing

Every sync so far has merged with zero conflicts and then failed to build. The fork
adds to files upstream also grows, and git is happy as long as the two sides touch
different lines — or different files entirely.

Run, in this order, before believing a sync:

```sh
npm install                     # the tag may have moved dependencies
git checkout -- package-lock.json   # npm rewrites hundreds of "peer": true markers
npm run build:server            # generated declarations, or you chase phantom type errors
npm run typecheck
```

`npm install` is not optional when the tag changed `package.json` anywhere.
Reverting the lockfile after it is: the rewrite is pure churn and pure future
conflict. Confirm that is all it was — `git diff package-lock.json`, strip the
`"peer": true` lines, and nothing should remain.

## The joints that rot without conflicting

The fork carries new protocol message types. Upstream keeps adding exhaustive maps
and switches over _all_ message types. Neither side conflicts; the build fails.

The same shape catches any contract the fork widens and upstream keeps calling: a
required prop added to a shared component, a widened union, a new argument. Upstream
adds a call site in a file the fork never touched, so there is nothing to conflict.
Grep for new callers of anything the fork made stricter.

| Sync               | What broke                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
