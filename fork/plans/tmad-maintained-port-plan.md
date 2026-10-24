# Maintained tmad feature ports

Status: planning consensus reached with Opus 5.5; implementation has not started.
Date: 2026-10-02.

## Outcome

Carry the useful `tmad4000/paseo` features as independently removable Desvio inputs. Keep receiving source Stream fixes and UI improvements without importing the source fork's release machinery or replacing our `custom` and infi implementations.

Stream is the first complete feature to port. Persistent message queues and voice follow-ups are a separate delivery sequence. A Stream triage queue contains captured moments; a message queue contains prompts awaiting delivery. Neither should create a dependency on the other.

This plan authorizes no deployment. The next implementation step is the baseline and extraction rehearsal below. Production manifest edits, publication, and switching the daemon follow a reviewed implementation.

## Evidence and baseline

| Input | Snapshot checked on 2026-10-02 | How to use it |
| --- | --- | --- |
| Desvio release base | `v0.11.0-beta.3`, commit `6166a7aca5e3184e8ab505caad28f6a595816414` | Initial parent for independent ports. |
| Our custom branch | `cbd1210c7d15fbdaac02cab8375cdcf2dd6bd234` | Current custom behavior and integration requirements. |
| Source main | `f0d5507d21cf7f6d86c792d235f3c27156a27d7a` | Frozen intake snapshot; version reservations are excluded. |
| Source integration | `51fb7693d`, source PR #21 | Rebuilt upstream changes and fork features together; never import this entire commit. |
| Current Desvio manifest | `~/.paseo-fork/manifest.txt` | Community carries, then custom, then IP-01 through IP-14. Preserve this order. |
| Build branch | `mine` | Disposable and moving during concurrent work. Capture a successful assembly for verification; do not author against its current tip. |

The source integration did not retain the claimed release as a Git ancestor. The merge base between the source snapshot and our current release is `dd8a111c30dcc6457a7c4eddaddc5346967fa57f`. A direct tree comparison now touches 1,158 paths, including unrelated upstream differences. That is evidence against merging source main; it is not a count of feature files or expected conflicts.

Use the source's declared `v0.10.0-beta.1` integration tree to identify fork content, then adapt that content to our pinned release. Feature code in the integration commit needs extraction even when its original PR is known. Earlier PR patches are provenance and useful change boundaries, not guaranteed patches against beta.3.

The research worktree is older than `custom`. Read current files using the pinned refs or a fresh worktree. Re-resolve these snapshots when implementation starts because custom and the manifest may have moved.

Source references: [branch policy](https://github.com/tmad4000/paseo/blob/f0d5507d21cf7f6d86c792d235f3c27156a27d7a/FORK.md), [integration PR #21](https://github.com/tmad4000/paseo/pull/21), [Stream pins #19](https://github.com/tmad4000/paseo/pull/19), [voice follow-ups #23](https://github.com/tmad4000/paseo/pull/23), [queue controls #25](https://github.com/tmad4000/paseo/pull/25), [busy send choices #32](https://github.com/tmad4000/paseo/pull/32).

Local constraints: [fork ownership](../README.md), [upstream sync](../upstream-sync.md), [protocol compatibility](../../docs/protocol-compatibility.md), [timeline ownership](../../docs/timeline-sync.md), [route ownership](../../docs/expo-router.md), and [infi work items](infi-pc-intake-work-items.md). Read current versions from custom before implementation; the infi intake's original base is historical.

## Decisions

1. Maintain a curated port, with a frozen source snapshot and a source-to-port ledger.
2. Preserve the source Stream modules, component boundaries, models, tests, and interaction design where compatible. Adapt shared host boundaries rather than rebuilding the feed.
3. Keep Stream as one complete vertical slice on a tracked branch. Separate persistent queue, queue UI, voice runtime, and unrelated standalone features.
4. Append new branches after the existing manifest. Their position does not establish independence; ancestry and actual runtime dependencies do.
5. Start Stream at the pinned upstream release. Start queue at a frozen custom commit, and queue UI/voice at their explicit prerequisite branches, so their own tests exercise our cancellation and submission contracts. Keep feature implementation commits out of custom. Put unavoidable Stream integration in an explicitly paired bridge if it cannot live in the independent feature branch.
6. Preserve existing send, cancellation, tab, route, and protocol contracts. Adopt source improvements into existing owners when a capability already exists here.

### Branch order alternatives

| Option | Advantages | Cost and restriction | Decision |
| --- | --- | --- | --- |
| Release-based port appended after current carries | Existing merge contexts stay stable for the initial addition; ancestry contains only upstream and the port; easy feature removal. | Shared files may need adapted merges or a small bridge; source sync still needs review. | Default. |
| Release-based port before custom | Custom integrates against the feature first; can be useful if custom is deliberately being redesigned to consume it. | Inserting changes subsequent merge contexts. Recorded resolutions may stop matching or remain textually applicable while becoming semantically wrong. Requires validating the entire suffix. | Viable, but no demonstrated benefit for initial intake. |
| Port based on custom and appended after custom | Matches existing infi intake practice; tests exercise custom-dependent behavior before assembly. | Captures a custom ancestor; cannot move ahead of custom while preserving branch independence. Need to audit inherited custom changes on later sync/removal. | Selected for queue/voice, whose correctness depends on custom; record the floor. |
| Merge source main | Receives all source changes directly. | Imports squashed upstream history, conflicting older implementations, branding and releases. Removal couples all features. | Rejected. |

Do not merge custom or mine into a release-based port to solve an assembly conflict. That imports the other layer into its ancestry. An adaptation in a source branch must also compile on its declared base; otherwise use a small coupled bridge after the dependencies.

Later upstream upgrades should merge the newly pinned upstream release into the Stream port and merge the updated custom branch into the queue root, then update dependent branches in order. Review each resulting feature delta against its declared base and rerun its gates. Keep source synchronization and base upgrades in separate review batches. Preserve existing local port commit identities; do not repeatedly regenerate every branch from a squash. If custom history is rewritten, re-anchor dependent ports explicitly and audit for superseded custom code; an ordinary merge is not sufficient.

Reconsider an earlier Stream position only after measured recurring conflicts justify it. A base upgrade is a convenient time to compare both orders, but does not make reordering free or guarantee that every rerere entry is invalid. Require isolated assembly, semantic review and removal evidence for the proposed order before changing the live manifest.

## Branch and removal contract

Proposed branch names are stable ownership boundaries, not branches created by this planning task.

| ID | Branch | Contents | Required branches |
| --- | --- | --- | --- |
| TM-01 | `intake/tmad-stream-flow` | Stream capture, storage, optional wire contract, artifacts, feed, pins, triage and Chat/Stream interaction. | None beyond its pinned release. |
| TM-01B | `intake/tmad-stream-bridge` | Only custom/infi adaptations that cannot compile in TM-01 alone. Create only if rehearsal establishes a need; cut from custom plus declared prerequisites and append immediately after TM-01. | TM-01 and the specific custom/infi owners it adapts. |
| TM-02 | `intake/tmad-message-queue` | Durable daemon queue, explicit API, idempotency, receipts and storage recovery; cut from pinned custom. | Its recorded custom floor. |
| TM-03 | `intake/tmad-queue-ui` | Durable outbox, edit/reorder/send controls, queue mirroring, explicit composer modes. | TM-02. |
| TM-04 | `intake/tmad-voice-flow` | Voice attachment lifecycle, queued speech, playback recovery and failure feedback. | TM-02; TM-03 only for shared UI that is actually required. |
| TM-05 | `intake/tmad-voice-mute` | Verbal input mute/unmute with visible capture state. | TM-04 unless verified separable. |
| TM-06 | `intake/tmad-ios-background-voice` | Native iOS background capture changes. | TM-04 and compatible native audio implementation. |
| TM-07 | `intake/tmad-native-find` | Reconciled native Find wrapper, matches and viewport on the existing search model/RPC; cut from `v0.11.0-beta.3`. | No Stream dependency in either direction; removal group Native Find. |
| TM-08+ | One branch per selected standalone feature | CLI daemon target, CLI tab opening, or other chosen enhancements. | Record per feature. |

Dependent branches may start from their prerequisite feature branch. That dependency remains present even if its manifest line is removed. Maintain a removal group listing every dependent branch and bridge; commenting only the prerequisite is insufficient.

Initial append block, once each branch passes acceptance:

```text
# Existing community, custom and infi lines retain their current order.
intake/tmad-stream-flow       # TM-01; source snapshot; verified base; removal group Stream.
# intake/tmad-stream-bridge   # TM-01B; only if required; removal group Stream.
# Add queue and voice lines later, in dependency order, after their own gates.
```

Stream removal means disabling TM-01 and TM-01B, if present. No unrelated queue, voice, infi or custom branch may depend on Stream. Native Find removal means disabling TM-07 alone; both features must work when the other is absent. Queue removal disables TM-02, TM-03, TM-04 and their descendants. A queue-plus-voice bundle is removable together; each component is not necessarily independently runnable.

Record each branch's base SHA, allowed ancestors, runtime requirements, and removal group beside its ledger entry. Compare its commits and delta against the declared base before adding it. A branch claiming release independence fails this check if custom, mine, or another unrecorded carry is an ancestor.

## Scope and duplication decisions

| Feature | Source | Disposition |
| --- | --- | --- |
| Stream/artifact feed, discoverability, pins and triage | #1, #10, #16, #19, reconciled by #21 | First delivery; preserve the complete interaction flow and source tests. |
| Durable follow-up queue, edit/send-now/recovery and visible send choices | #23–26, #30–32 | Next delivery sequence; adapt admission semantics before importing UI defaults. |
| Voice lifecycle, playback and failure recovery | #13–15, #22–23 | Follow durable queue; separate device verification from daemon tests. |
| Verbal mute/unmute | #17 | Optional voice follow-up, with capture semantics visible to the user. |
| iOS background dictation | #14 | Separate native build and physical-device gate. |
| Remember default CLI daemon | #8 | Independent small port after checking current CLI support. |
| CLI-created sessions open tabs | #5 | Separate API/tab-policy review; preserve custom subagent close behavior. |
| Native chat search wrapper | #11/#21 | Current custom's native `chat-find/index.tsx` is a no-op stub; web search exists. Port the reconciled native wrapper and viewport using the existing search model/RPC on its own branch. Preserve native Find in Chat through the tab menu. The current source panel has Chat/Stream segments, so native Find is not a strict Stream dependency. |
| Recent-focus Back | #9 | Existing infi navigation history owns this. Add a missing mobile control there only if needed; exclude the duplicate history store. |
| Stream pins | #19 | Distinct from IP-11's scroll-following prompt pin; both can coexist without sharing selection state. |
| Sidebar filtering/recency/unread/tab sorting | #25, #27, #33 | Defer until Stream is stable; reconcile with IP-09/10/12 and upstream attention behavior in a separate branch. |
| Summary default and Quiet tool calls | #34 | Optional. Existing tool presentation is the owner; do not add model summaries from infi. Quiet has a known approved-command visibility gap in the source PR; resolve before adopting it. |
| Long user message clamp | #18 | Optional standalone presentation change if still missing upstream. |
| Provider startup/ACP rejection messages | source post-#21 changes | Evaluate as independent fixes against current upstream; no automatic inclusion in Stream. |
| Branding, app identifiers, TestFlight, auto-updater, source CI, version reservations | #20/#21/#28/#29/#35 and fork build files | Excluded. Use our established packaging and release channel. |

The [Quiet PR](https://github.com/tmad4000/paseo/pull/34) explicitly records that a successful approved command can disappear after approval resolves. Importing the source's latest code is therefore not an acceptance criterion by itself.

## Source tracking

Create `fork/plans/tmad-port-work-items.md` on custom during implementation as the single owner of tracking status. Keep this plan for the integration decision; put ongoing status and operational steps in the ledger. Link it from fork/README.md. Documentation belongs on custom so disabling a feature preserves its provenance and removal record. Mark removed features disabled; retain their rows.

Each selected source change has:

- Source repository, PR, full commit SHA or range, and effective source snapshot.
- Feature ID, source paths, test paths, and local branch.
- Disposition: applied unchanged, adapted, upstream already supplies it, intentionally excluded, or deferred.
- Source blob ID for every core file, local blob ID, any path mapping, and an explicit exception when our adaptation changes the contents.
- Local commit SHA after commit, adaptation rationale, dependencies, and the verification artifact.

Keep three distinct markers: last source head inspected, last source head fully classified, and the effective source snapshot for each ported feature. A skipped source commit still gets a disposition. Advancing the classified cursor does not mean every feature has incorporated that head.

Use `Source-Repo`, `Source-Commit`, and `Port-Feature` trailers on imported/adapted commits. A combined extraction cites all relevant source commits; a rewritten adaptation records why. Keep local-only fixes as separate commits so later source fixes can be recognized and compared.

Preserve source directories such as `companion-stream/` and `artifacts/` unless our architecture requires a move. If a move is required, keep a path mapping. Maintain a seam table for source agent-panel integration, accepted-event capture, storage/projections, protocol delivery, and file navigation. This table owns the differences that future updates must revisit.

Core files are unchanged between #21 and the inspected source head. They are not all unchanged between #19 and #21: the reconciliation updates the feeds and collectors and adds artifact backfill coverage. Use the reconciled source snapshot for fidelity checks. For unadapted files, the source and local blob IDs should match. For changed files, record the intentional delta and its tests instead of asserting byte equality. Shared connection files include `agent-panel.tsx`, `workspace-tab-menu.ts`, `segmented-control.tsx`, `turn-footer.tsx`, `message.tsx`, and `agent-stream/view.tsx`; review their Stream-specific changes alongside infi's plan, prompt-pin and file-link changes.

The tab menu is an explicit shared seam: custom adds subagent/side-conversation behavior and source adds View Stream/Find actions. Preserve both, and record TM-01B if their integration needs a custom-dependent implementation.

### Update loop

1. Fetch source main into a research ref and record its SHA. Keep the previous reviewed SHA available. If history was rewritten, compare snapshots and PRs; do not assume a linear range.
2. Review every new source commit/PR, including integration commits. First-parent history identifies merged batches; blob comparisons detect changes despite squash/rewrite. Path filters find likely changes, but new files and shared helpers must be considered too. Check upstream's pinned release for equivalent features first.
3. Classify the whole range in the ledger. Keep the source and upstream sync batches separate.
4. Apply selected changes on a scratch branch from the relevant maintained port. Use `cherry-pick -x` when the complete patch fits; otherwise extract selected hunks and cite the full source change. Never cherry-pick the source's mixed upstream integration wholesale, including with `-m`.
5. Carry source tests, then run the relevant seam tests and UI checks. Review local fix overlaps before accepting source replacements.
6. Assemble against a frozen copy of the current manifest and refs. Inspect both conflicts and clean merges in shared files. Use rerere for repeated resolutions, then review what it staged.
7. Fast-forward the maintained port only after its review passes. Update the effective snapshot and verification entry. Rebuild the reviewed production basket through the normal process; source fetch alone must never change the shipped port.

At the initial port, rehearse this loop on a real historical update: port Stream's feature content at PR #19 (`af247e4f4`), then apply only the Stream changes from `af247e4f4..51fb7693d` through the intended seams. This changes five core files by 200 additions and 65 deletions: the two feeds, collector, companion-stream and artifact backfill test. Compare the resulting core blobs against `51fb7693d`; record intentional local differences. Extract the relevant shared-file changes too, without importing the rest of #21. The endpoint is the reconciled content selected for delivery, not throwaway pre-feature code. Record changed paths, conflicts and adaptation effort as the first evidence that tracking remains economical.

For UI fidelity, capture the frozen source snapshot and the port in the same states on desktop and compact web. Include native source reference captures where practical and require native evidence for our port. Compare the captures side by side: Chat/Stream switching, reply controls, pins/triage, artifacts, tab actions, long entries, errors and loading states. Record every visible difference as an intended adaptation or a defect. Hash parity cannot prove that a changed host panel preserves layout, reachability, gestures or focus.

Reassess the architecture if successive Stream improvements repeatedly require changing the same host integration code. Prefer a narrower host interface or one contained adapter over duplicating Stream. Do not add abstractions merely to anticipate changes that have not occurred.

No unattended updater or schedule is created by this plan. Check source during upstream syncs and before a feature release; a later automation can report candidates without promoting them.

## Compatibility contracts

### Stream

- Capture accepted canonical live events after existing stream coalescing. Do not reconstruct invented historical outcomes or create a second timeline owner.
- Preserve bounded source moments and excerpt sizes, stable identities and ordering, persisted pins, triage state, and reconnect behavior. Verify pin and manual-entry bounds explicitly. Decide an explicit bound for artifact path metadata after measuring current storage; bounded captured moments alone do not bound pins or the whole record.
- Keep Chat mounted while switching to Stream. Preserve drafts, attachments, scroll position and the active agent. A Stream selection returns to the correct existing Chat control; it must not automatically send an answer or cancel work.
- Preserve questions, permissions, plans, final responses, failure outcomes and file links. Stream remains a projection of daemon facts; selecting a moment cannot grant permission or infer agent state.
- Keep artifact containment and file-open rules from current custom/IP-01. Do not restore recursive `fs.watch`; read the file-observation constraints first. End-turn scans need bounded work and explicit limits on attribution when other processes change files.
- Wire fields are optional. Gate Stream once on our daemon feature `companionStreamPortV1`; release observations when the owning view closes. Old clients must not receive unknown top-level events.
- Rename the source flat `update_companion_entry_request`/response to `agent.companion.update_entry.request`/response and record the mapping. Give mutations `workspace.write`, read operations `workspace.read`, and responses their matching permission; update every authorization map and client capability default. Do not advertise the source's `companionStream` capability for our renamed RPC contract: a source-built client would otherwise try an unsupported flat operation. Verify both cross-fork connections stay parse-compatible but correctly gate the unsupported feature. Tag necessary compatibility code with our release version and expiry rather than copying the source's version claim.
- Review errors and localization while preserving source layout. Surface failed mutations; do not retain silent catch blocks for pins or triage actions.

### Queue and composer

- Preserve the current behavior of old `send_agent_message_request` calls with no new queue intent: they go through the existing beta.3 receipt-backed interrupt path, including deduplication. The source currently queues omitted `activeTurnBehavior` and that path omits the receipt service; do not copy either change into our daemon. Durable queue admission requires explicit client intent.
- Define explicit queue and strict steering operations/capabilities. New enum values must not be sent to an old daemon. New requests and responses use the current dotted names and have exhaustive authorization entries and client defaults.
- If a port changes the source queue or voice feature contract, use a distinct capability/version and record its source mapping. Never advertise a source capability while accepting different requests or acknowledgement semantics under it.
- A queue item is durably accepted once by stable identity. Queue revisions govern edits, reorder and deletion. A stale device cannot silently overwrite another device's edit.
- Uncertain dispatch remains visible for reconciliation. Removal waits for a correlated receipt. Refused steering never interrupts a turn and never deletes the queued item. Automatic retry must not resend an item whose provider acceptance is unknown.
- Review the capped dedup horizon and crash points between admission, provider dispatch, receipt and queue removal. Repeated reconnect cannot create duplicate turns.
- Preserve the item after the source outbox's eight-attempt limit. Use a visible failed/pending state with explicit retry or discard; no silent deletion of an undelivered prompt.
- Define startup recovery: load existing queue state without dispatching during daemon initialization; after agents/providers are ready, resume only items known never dispatched. Hold ambiguous claims for inspection. Archived agents retain their queue and do not auto-run; deleting an agent removes its queue through the normal lifecycle.
- Treat queue persistence and journal as user data. Bound journal bytes and rotations, file permissions, image payloads and queue length. Avoid copying image bytes into repeated journal snapshots where a stable attachment reference suffices. Retention and recovery invariants must remain testable.
- The canonical app submission owner remains `dispatchComposerAgentMessage`. Introduce a queue admission action without creating a submitted timeline row prematurely; drain/send-now acknowledgement reconciles into the existing identity system. The server's accepted prompt creates one canonical user row. Speech and reconnect follow the same boundary.
- Existing local queues keep their existing meaning against old hosts. A capability gate must not portray them as durable cross-device queues. Follow the repo's dated COMPAT convention for any retained transition path.

### Voice and lifecycle

- Attach/detach, mute, playback interruption, transport loss and STT failure do not cancel the agent, pending permissions, children or side conversations. Agent interruption remains an explicit command.
- Speech gets a stable queue item ID and truthful queued/sent/error feedback. Voice does not claim provider delivery from a local transcript or socket send.
- Retain attachment ownership and transport-generation checks across reconnects; a different device cannot seize an active recording session accidentally.
- Verbal mute leaves capture active to hear unmute. Show that state clearly; hardware capture stop remains a separate action. Validate local STT/VAD and speech echo behavior before promoting verbal control.
- Preserve the custom ACP/GJC admission and cancellation fences and upstream provider-wrapper forwarding. A source manager merge that loses these fences fails even if TypeScript passes.
- Native background claims require a rebuilt native binary and physical-device evidence. Simulator or browser layout checks cannot establish microphone capture, audible playback or background behavior.

### Existing custom/infi flow

- Side conversations retain their own panel and routing semantics. Stream and voice must not convert side questions into foreground sends.
- Use the existing route/tab navigation owners. No parallel focus history store, startup restore loop, or duplicate route deck.
- Opening a subagent uses the existing per-client tab/open-label rules. Closing its tab must not archive the subagent; root-agent close follows the existing archive policy. Audit any source MCP close-tab implementation against this.
- Prompt pin, plan copy/handoff, recent agents, status pulse and source-aware file links retain their behavior with Stream on and off. The source branch may not silently replace these carries through a clean merge.
- Use distinct labels: Stream's persistent notes are `Stream pins`; IP-11's scroll-following context is `Pinned prompt`. Keep their state and actions separate, with localized labels matching the glossary. Preserve the source panel's Chat/Stream flow; native Find continues through the existing tab-menu/search owner, not a resurrected search scaffold.

## Delivery sequence

### P0 — freeze and prove the baseline

Owner: integrator. Deliver a snapshot record before feature code changes.

1. Freeze base, custom, source head, manifest order and every resolved carry SHA. Save the current successful assembly if one exists; do not follow moving mine during experiments.
2. Assemble the baseline in a separate clone with its own config, index, rerere cache, branch and build tree. A worktree shares repo state and is not sufficient isolation for a Desvio order experiment. Do not point scratch tooling at `~/.paseo-fork`'s live build tree.
3. Run baseline build/typecheck/lint and the relevant existing composer/lifecycle/navigation checks. Record pre-existing failures separately. A failing baseline is not evidence against the port.
4. Extract the source delta and classify selected features, duplicate behavior, build files and source-only dependencies. Confirm licensing/attribution for the copied files from the repository license.

Exit: reproducible baseline; input SHA list; feature/file map; no unknown branch ancestry.

### P1 — Stream extraction and maintenance rehearsal

Owner: Stream porter. Deliver TM-01 and its provenance, with no production manifest edit.

1. Start from the pinned release. Extract the reconciled Stream and artifact vertical slice rather than replaying all historical source ancestry.
2. Preserve modules and tests; add the smallest host seams necessary for current event capture, observations, storage, file navigation and the panel host.
3. Complete the PR19-to-#21 source-update rehearsal described above. Show where source UI changes apply unchanged and where adapters need updates; verify the final content against the reconciled snapshot.
4. Verify standalone compilation and focused tests. Merge into the frozen baseline assembly; resolve semantic interactions with custom and IP-01/09/10/11/12.
5. Create TM-01B only if a custom/infi adaptation cannot compile independently. Its scope and removal coupling must be explicit.
6. Capture matched source and port desktop/compact browser evidence and compare it side by side, classifying every visible difference. Then capture native evidence for the actual carried navigation and control surfaces, with native source references where practical. Check locale parity, including Korean and every locale in the current app. Use the source Stream doc's manual scenarios as a starting point and add current pins/triage behavior that the older prose omits.

Exit: source snapshot parity for selected Stream behaviors; maintenance rehearsal recorded; no queue dependency; preservation of existing custom/infi flows.

### P2 — prove independent removal

Owner: integrator. Deliver with/without assembly evidence.

1. Build the frozen baseline plus Stream. Build the same baseline with every Stream removal-group line absent. Preserve all unrelated line order and SHAs.
2. Confirm the disabled assembly's application source tree matches the original baseline, excluding explicitly recorded documentation changes. The merge histories may differ; compare trees and behavior.
3. Run the affected existing composer/navigation/subagent checks on the removal assembly. Confirm no compile-time imports or runtime calls remain dependent on Stream.
4. Expect data loss on a feature-free rollback: beta.3's agent storage uses a stripping `z.object` schema, and an ordinary record rewrite can discard `companionEntries`. Our default rollback policy is to back up agent records and export the Stream fields before disabling it; do not add a permanent generic-storage change to custom for this port. Confirm the loss and recovery using copied development data. Recovery restores only Stream fields for matching agent IDs after re-enabling; it must not replace newer non-Stream metadata with an old complete record. Document the backup/export and merge procedure before first promotion. A user can intentionally discard this feature data when removing the feature permanently.
5. Queue/voice later require their own removal-group exercise, with pending items present. Disabling the feature must not dispatch or delete those items.

Exit: exact removal group, verified baseline restoration and explicit persisted-data rollback behavior.

### P3 — durable queue foundation

Owner: queue porter. Deliver TM-02 on the frozen custom base before queue UI or voice admission changes. Its focused tests run against the actual custom cancellation boundary, not an upstream-only stand-in.

1. Write the explicit API/legacy behavior contract and reuse the current authorization, receipt and observation conventions.
2. Port persistence, atomic updates, revisions, claims and delivery acknowledgement. Address retry/dedup/startup/journal risks in the source implementation before exposing the feature.
3. Prove restart, ambiguous send, refused strict steer, image round-trip, concurrent edits and archive/delete behavior with focused service/daemon tests.
4. Verify old app/CLI/SDK requests against the new daemon and new feature-gated clients against an old daemon.

Exit: durable queue contract established without changing legacy sends or cancellation.

### P4 — queue UI and cross-device behavior

Owner: composer porter. Deliver TM-03.

1. Port outbox and controls through current composer/submission ownership. Preserve draft attachments and editing recovery.
2. Exercise two independent clients: enqueue/edit/reorder/delete, reconnect, queue mirroring and receipt-driven transition to one canonical submitted row.
3. Keep explicit Steer, Queue and Interrupt affordances. Choose the typed-send default after comparing source defaults with our current behavior; do not infer this product choice from a source merge.
4. Test retry exhaustion and uncertain delivery as visible recoverable states.

Exit: user-visible state matches durable acceptance and provider delivery; no duplicate row, lost item or accidental interrupt.

### P5 — voice in staged branches

Owner: voice porter. Deliver TM-04, followed separately by TM-05/TM-06 if selected.

1. Port lifecycle decoupling and playback/error recovery against current runtime owners.
2. Add speech-to-queue admission with stable identity and real queued/sent feedback.
3. Prove running-turn, pending-permission, subagent and side-conversation survival through voice attach/detach and transport failure.
4. Run focused real-provider proofs. Verify core behavior on Claude, Codex and our custom ACP/GJC paths; claim support only for providers exercised. Add another provider when its implementation differs at the seam.
5. Exercise physical microphone, playback, echo, lock/background/foreground, reconnect and owner contention on supported native platforms. iOS background work has its own native binary gate; Android foreground support must not inherit an iOS background claim.

Exit: explicit per-provider/per-platform evidence. Unsupported or untested native options remain unpromoted.

### P6 — standalone ports and promotion

Port TM-07 Native Find from the pinned release with its own provenance and removal group. Verify it against the existing search service, including history loading, selected-row reveal/highlight, tab-menu invocation and cleanup on panel hide. Build/check both Stream without Native Find and Native Find without Stream. Then port the chosen CLI/navigation/presentation extras separately, after checking upstream and infi overlap. Each branch gets provenance, acceptance and a removal group before appending it.

Before promotion, update the ledger with final inputs, local commits, tests, screenshots, device evidence, known limits and removability. Present the exact manifest additions and built artifacts for review. A push to mine publishes; production restart on 6767 needs the user's permission. Do neither as part of this plan or its experiments.

## Verification matrix

Run only relevant test files, serially where they are resource intensive. Extend existing suites and use their scripts. Never run the full local test suite. After implementation changes, rebuild owning packages, then run typecheck and lint. Format through npm scripts before commits.

| Boundary | Required evidence |
| --- | --- |
| Stream model/capture/storage | Source companion model, server companion and artifact collector suites; pin/triage persistence, bounds and live-event ordering. |
| Protocol | Source artifact/Stream schema cases adapted to current schemas; generated validator build; old-client parsing and no unknown push delivery; capability-absent client behavior. |
| Authorization | Existing `packages/server/src/server/authorization/index.test.ts` and operation map checks for every added operation and event. |
| Stream UI | Matched source/port desktop and compact captures plus port native evidence: needs-a-reply, questions/permissions/plans, pins/triage, long entries, errors, file navigation, draft/scroll preservation and reconnect. Every visible difference classified. |
| Native Find | Native search model/RPC integration, loaded and historical match reveal, tab menu and hidden-panel cleanup; separate removal, with/without Stream checks. |
| Existing UI carries | Current plan copy/handoff, prompt pin, recent agents, navigation, status pulse, subagent tab close and side-conversation suites on the integrated assembly. |
| Queue | Source store/service/send-or-queue suites and daemon mirroring e2e, adapted for our explicit legacy contract and recovery behavior. |
| Composer | Existing actions/submit/queue-sync plus outbox model; two-client receipt, attachment and identity checks. |
| Cancellation/provider wrappers | Existing custom agent-manager, ACP/GJC and provider-wrapper tests; focused live-provider proof of refusal without turn replacement. |
| Voice | Source voice runtime/failure/session/turn-controller tests; running-agent survival and real microphone/playback/reconnection evidence. |
| Build/removal | Standalone feature build; isolated full basket build/typecheck/lint; removal assembly and copied-data re-enable exercise. |

Resolve actual filenames from the target branch before dispatch. Useful source paths include `packages/app/src/companion-stream/model.test.ts`, `packages/server/src/server/agent/companion-stream.test.ts`, `packages/server/src/server/agent/artifacts/collector.test.ts`, `packages/server/src/server/agent-queue/{store,service,send-or-queue}.test.ts`, `packages/server/src/server/daemon-e2e/agent-queue-mirroring.e2e.test.ts`, and `packages/app/src/stores/queue-outbox-store/model.test.ts`.

Use `npx vitest run <specific-file> --bail=1` only under the appropriate existing test config. Browser/native checks use the existing npm scripts and harnesses described in [QA](../../docs/qa.md) and [mobile testing](../../docs/mobile-testing.md). Save command, commit inputs, result and evidence paths; a historical green result does not verify a new base.

## Failure scenarios and response

| Failure | Detection | Response |
| --- | --- | --- |
| Source UI polish repeatedly conflicts with rewritten host code | Historical update rehearsal and later seam-change records. | Preserve more source layout and narrow the adapter. Defer the update rather than copy a partial flow. |
| A clean merge loses custom cancellation or submission identity | Focused ACP/GJC, provider-wrapper and canonical-row checks on the assembled tree. | Fix the owning port/bridge; do not patch mine or hide the fix in custom. |
| Old clients send different actions after queue import | Mixed-version tests, including absent activeTurnBehavior. | Restore legacy semantics and add explicit capability-gated intent. |
| Rerere stages an obsolete resolution | Review replayed diffs and execute affected tests. | Forget and relearn the specific resolution in the experiment clone first; never wipe the whole live cache. |
| Removing one manifest line leaves imported code through descendants | Ancestry audit and removal-group rebuild. | Remove the full declared dependency group; reduce accidental ancestry before promotion. |
| Rollback strips persisted pins or abandons queued prompts | Expected stripping in beta.3 storage; copied-data downgrade/re-enable exercise. | Back up/export feature data before rollback; restore only feature fields after re-enabling, preserving newer ordinary metadata. Export/recover pending prompts before disabling queue delivery. |
| Source main update pulls another upstream snapshot | Full range classification and file/base delta review. | Extract selected feature changes; upgrade our upstream base separately. |

## Completion and consensus

This planning task is complete when the plan identifies the selected feature boundaries, tracking workflow, branch/order decision, delivery steps, acceptance evidence, and rollback constraints, and the Opus advisor explicitly agrees after reviewing revisions.

Implementation readiness is separate: P0/P1 must establish current baseline and maintenance feasibility before adding a port to the live manifest. Product choices for optional features and the typed-send default remain explicit decisions at their delivery stage; they do not block the Stream plan.

Advisor: Opus 5.5, agent `7f4ace4b-f384-47a6-a7c0-7b6803203360`.
Review record:

- First discussion: agreed on curated ports and appending; Opus recommended custom-based queue/voice and content hashes for Stream tracking. Incorporated both.
- Evidence corrections: reconciled Stream files differ from PR19; native Find uses the retained upstream search model rather than the removed scaffold; rerere entries can still replay after reordering; feature-free storage can strip optional data. Opus accepted all four corrections.
- Final review: Opus gave APPROVE conditional on a real PR19-to-#21 rehearsal, matched source/port UI captures, and an explicit Native Find branch/base/removal group. All three requirements are incorporated above. Opus stated no further review was needed once they were included.
- Additional recommendations incorporated: verb-based RPC naming, distinct feature capability, explicit tab-menu seam, and the expected-loss rollback policy.
- Confirmation after edits: Opus reread every condition and recommendation in the saved file, explicitly confirmed consensus, and reported no remaining blockers. P0/P1 remain implementation gates.

Planning checks: no application source, live manifest or daemon was changed. This worktree lacks local `tsgo`/`oxfmt` executables; attempted typecheck failed before compilation, and lint reported errors in untouched existing files. The npm formatter explicitly excludes `fork/**/*.md`, so the plan is outside that formatting gate. No runtime compatibility or UI parity claim is made by this planning task; those remain P0–P6 acceptance work.
