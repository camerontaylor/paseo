# Upstream PR evaluation — 2026-09-12

Snapshot: **2026-09-12**, upstream main `d1b705a0c`. Fork base: still v0.7.2
(`9400a49af`) — **108 commits behind**, up from 102 when this sweep started;
boudra landed six more while it ran. Delta sweep against
[upstream-prs-2026-09-07.md](upstream-prs-2026-09-07.md) — read that one first
for the method and the standing verdicts.

The event this sweep is about: **v0.8.0 stable (2026-09-10)**, the next sync
target. Everything below is what the release and the last five days do to the
fork's carries.

Addendum, same evening: the sync landed on `custom` while this doc was being
written — final section.

## The release

- Plugin SDK breaks: #4347 split client/server entries, #4577 new composer
  pill API, #4430 manifest version requirements (#4452 accepts prereleases).
  Plugin code the fork carries needs the 0.8 migration at sync.
- Desktop requires macOS 13+ (#4322). Fork release notes need the same line.
- #4443 keeps 0.7.2 apps working with 0.8 daemons — fork npm consumers who lag
  a release keep working.
- Upstream is still npm (two lockfile-signature chores in the range), so
  `chore/pnpm-migration` stays shelved.
- beta.1 → stable is 31 commits, including #4629. A desvio build pinned to
  beta.1 predates it — that is why the manifest BASE moved (see Basket).

## Sync payload — what v0.8.0 does to our carries

Ranked by collision risk. A clean merge still proves nothing
([upstream-sync.md](upstream-sync.md)); run
`server/authorization/index.test.ts` on the sync.

| PR | What | Fork joint |
| --- | --- | --- |
| #4321 (merged 09-04) | nested subagent ownership | The one the reconcile handover pre-planned: dual COMPAT flags in `messages.ts`, `select.ts` ordering, the `track.tsx`/`track-presentation` row-kind joints, semantic conflict with our `feb84133b` in `opencode-agent.ts`. Two of its fixes are pre-positioned on `fork/reseat-side-conversations-0.8`. |
| #4629 (merged 09-10) | stale plugin-provider session recovery | `agent-manager.ts`, `plugin-provider.ts`, snapshot manager. Our newest commit `438fa5e40` extracts the reloaded-child discard helper in the same file, same area — diff the helper against #4629 at sync. |
| #4479 (merged 09-08) | ACP vendor config notifications atomic | `acp-internal/connection.ts` — the layer the cancellation boundary sits on. |
| #4347 (merged) | plugin SDK boundary enforcement | May flag fork-only imports; one more exhaustive-map surface for the permission maps. |
| #4215 (merged) | explicit setup gating in fork PR workspaces | Worktree setup — our `de22c6238` (trust mise) and `fork/scripts/init-worktree.mjs` live in this path. |
| #4391 (merged 09-09) | one compaction marker per compaction | Was the 09-07 sweep's grab-next; it is in the base now, never carry it. Open follow-up #4439 rides it. |
| #4575, #4596, #4470 | instance selection, quiet subscriptions, lean connections | Connection behavior under the capability map; #4470 added the file the reseat branch's first fix edits. |
| #4354, #4517 | Hub continuation via daemon API, org triggers | Grow the message-type surface the fork's permission maps must cover. |

## New open PRs in fork territory

1. **#4719 — release the ACP turn when an agent never answers a cancelled
   prompt.** Cancellation plan §3/§5 ground exactly: cancel sent, provider
   silent, who owns the release. Triage against the plan's proof gate before
   it merges; if the verdict is partial, mine its tests.
2. **#4633 — forward `steerActiveTurn` through `wrapSessionProvider`**
   (roman-yakobnyuk, `fix/wrap-session-provider-forwards-steer`). Reconcile
   handover §0 verbatim — same file, and it adds the
   `provider-registry-wrap.test.ts` §0 prescribed. §0 is still not on
   `custom`. If this merges before the sync, the sync does §0 for us; if fork
   steer work is blocked first, land the one-liner as the isolated commit and
   let the later merge dedupe.
3. **#4539** — ACP session/load replay until updates drain. Overlaps the
   #3145 resume-replay tests the handover wants ported.
4. **#4594** — spare Claude background subagents from an interrupt. Feeds the
   deferred claude-parity plan (#3091).
5. **#4710** (subagents reported under existing providers) and **#4557**
   (nested finish follow-ups) — more subagents-track growth around the #4321
   re-seat joints.
6. **#4668** — discard rewound plugin-provider history; pairs with #4629 and
   the discard helper.
7. **#4439** — drop the stale loading compaction marker; rides #4391.

## Merged while this sweep ran (2026-09-12)

- **#4737 — keep older daemons usable, clients choose timeline recovery.**
  Protocol-compat work, arrives by sync. It edits
  `packages/client/src/connection/index.ts` — the file the reseat branch's
  capability-map fix was written against on 09-09. That fix's hunk context has
  moved; rebase it after the sync, not before.
- **#4742 — keep incomplete Markdown formatted while streaming.** Open at
  snapshot start, merged by 06:49. Arrives by sync — do not carry.
- #4736 (archived Codex workspaces keep focus), #4756 (rejected plans
  collapsed), #4758 (Android clipboard paste). Arrive by sync.

## Reconcile status

No PR from the 09-07 reconcile table merged; every verdict stands. #3145 is
still stale (last update 2026-08-10). The next session's queue keeps the
handover's order, with two new inputs: #4633 *is* §0, and #4719 heads the
cancellation-plan items.

Upstream still shows no movement on side conversations — nothing in the 108
commits or the new PRs re-derives it. The cost side moved instead: #4435,
#4577 and `e34aea2` keep growing the plugin timeline surface the feature
lives in, so each release the port gets bigger. Sync soon.

## Basket

Manifest changes made 2026-09-12 (the file's own header carries the running
log):

- **BASE pin v0.8.0-beta.1 → v0.8.0.** beta.1 predates 31 commits including
  #4629; a build on the old pin misses them. The bump re-resolves every
  carried line, so the first build on it is a full re-verify.
- **#4113 (steer forwarding)** annotated with its upstream twin #4633. Delete
  the line the day #4633 merges or `custom` lands §0 — whichever is first.
- **`investigate-severe-bug` (#4442)** annotated: still open, base still
  `0859a67ab`, branch now 6 commits (added an initial-prompt fix and a
  file-observer native-events fix).
- Nothing dropped: no manifest line merged this week. #4391 was grab-next,
  never carried — it is in the base now; strike it from any pending grab list.

## Housekeeping

- The reseat-scaffold note first written here was overtaken the same evening —
  see the addendum.
- The 09-07 sweep and the reconcile handover live on branch
  `docs/upstream-prs-2026-09-07` (origin PR #2), not on `custom` — but
  `custom`'s README already references both files. Merge #2 or move the files
  before the references rot further. This doc sits on
  `docs/upstream-prs-2026-09-12`, stacked on that branch, so its
  cross-references resolve. Both docs branches fork off pre-sync `custom`; the
  sync rebase happened underneath them, so merging them into the new `custom`
  is a real merge, not a fast-forward.

## While this sweep was being written (addendum, 2026-09-12 evening)

The v0.8.0 sync landed on `custom` while this doc was being written: a
concurrent session rebased `custom` onto the stable tag (`b8e24677e`) between
14:48 and 18:25, left `backup/custom-pre-v0.8.0`, pruned the companion
worktree, and recorded the sync in [upstream-sync.md](upstream-sync.md) — a
new `→ v0.8.0` row and a widened lesson: the rot is not only exhaustive maps,
it is any contract the fork widened that upstream keeps calling (new call
sites in files the fork never touched).

What this changes in the sections above:

- The reseat scaffold was overtaken, and the first version of this bullet was
  wrong. The branch's two fixes landed on `custom` byte-identical — merging
  the branch into the new `custom` is a no-op: same tree OID — NOOP included.
  The NOOP was right: `useSubagentsForParent` returns `providerRows` alone
  once `providerParentSubagentId` is set, so no side-conversation row ever
  reaches a nested provider track. The trap is real, though:
  `selectSideConversationsForParent` ignores that param, which makes the
  opposite conclusion easy to reach. The sync record first said "wire it for
  real"; the same evening's correction flipped it — check the hook's return,
  not the selector ([upstream-sync.md](upstream-sync.md) → `v0.8.0` row).
  The branch is superseded; its manifest line is deleted per its own delete
  condition.
- The Basket section's `custom` line is rewritten too: merging `custom` into
  the basket build is no longer a sync event. The manifest's other 2026-09-12
  changes (BASE → v0.8.0, the #4113/#4633 annotation, the severe-bug status)
  stand.

What does not change: the sync is onto the stable tag and upstream main is
already 16 commits past it, boudra-heavy as ever. The open-PR list, the
reconcile verdicts, and the #4633/#4719 items all stand. The verification bar
from [upstream-sync.md](upstream-sync.md) — build, then
`server/authorization/index.test.ts` — applies to what landed today, and that
session's post-sync edits were still in flight in this checkout when this
addendum was committed, so treat "green" as unproven until it reports.
