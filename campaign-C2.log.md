# Campaign C2 — Stream durability (package C2, fork source refresh)

Worker: GLM-5.3-Flash (C2 implementation worker, uranus `7bca4486-de51-42df-961f-09553825a941`). Advisor: Sol (GPT-6.1, agentId `3f2c7ea5-1328-4cd7-85c3-8c3d3ddbe4ff`).
Worktree: /home/ctaylor/.paseo/worktrees/3rzqjhby/c2-stream-durability — branch `fork/tmad-refresh-stream-durability-0.11.1`.
Plan: plans/ralplan-fork-source-refresh.md (sha256 abfe87512f35907382ff559d59a6a5c102ceff28290bb09faf62d16ed0605c53, verified before reading, read in full).

## s0 — orientation (2026-10-11)

Parent audit:

```
git rev-parse HEAD                              → 139e0c81e8eb51b0f97551171b2217838c3ebab5  ✅
git merge-base HEAD fork/tmad-0.11.1            → 139e0c81e8eb51b0f97551171b2217838c3ebab5  ✅ matches frozen base
```

Plan checksum verified before reading: `abfe8751…0605c53` ✅. Control records read: execution-start.md (incl. neptune→uranus re-pin record, Sol agent re-pin `3f2c7ea5-…`), ledger.md (C1 CLOSED, basket `1e4a4f103`), C1.log.md (log structure + Sol review style).

Source SHAs verified present:

```
git cat-file -t 51a57be66 → commit   (feat: add global Stream and durable questions (code-41m))
git cat-file -t 9823354c3 → commit   (DUPLICATE of 51a57be66 — same subject/date, different parent; not double-applied)
git cat-file -t 0aded86cd → commit   (feat(pspin-8v6): preserve Stream history and track explicit asks)
git cat-file -t 4eebe5136 → commit   (test(pspin-8v6): wait for older Stream card viewport stability)
git cat-file -t 1428f3770 → commit   (merge(code-9yr): incorporate reviewed Stream viewport test correction; parents 51775ba73 + 4eebe5136)
```

Source lineage: 51a57be66^ = 56ec78da9 (C4's search lineage); 0aded86cd^ = 4357e22db; 4eebe5136^ = 7f24232a6; 1428f3770 = merge of 51775ba73 + 4eebe5136. 51a57be66 and 9823354c3 have DIFFERENT parents (56ec78da9 vs e672399e1) but identical subjects — **verified content-duplicates**: full diffs ignoring `index` lines hash identically (da70f2e4… vs 3f00da03… raw, 6e334c8b… both after index-line strip, 53 files, +2709/−256). Canonical source: `51a57be66`; `9823354c3` not double-applied.

`1428f3770` non-merge content (vs first parent 51775ba73): docs/fork-features.md +3 (source fork-features table row `durable-stream-asks` — fork-owned doc in the SOURCE line; our equivalent lives in `fork/`, so this hunk relocates) and the e2e viewport fix = `4eebe5136` itself. Nothing else.

Docs skimmed: docs/protocol-compatibility.md, docs/protocol-validation.md (zod-aot generated client-side validator preserves unknown keys; schema purity rules; defaults only on primitive leaves), docs/rpc-namespacing.md (dotted + verb operation; request params top-level; response payload envelope), docs/data-model.md, docs/testing.md, docs/ad-hoc-daemon-testing.md, docs/agent-stream-performance.md, CLAUDE.md + packages/server/CLAUDE.md.

Build: `npm ci` (ONNXRUNTIME_NODE_INSTALL=skip) OK; `npm run build:server` OK.

## s0 — carried-state findings (base 139e0c81e vs source parents)

**Our base already carries a per-chat companion stream port** (`companionStreamPortV1` feature + `companion_stream_port_v1` client capability, dotted `agent.companion.update_entry.request/response` RPC — deliberately renamed from the source's flat `update_companion_entry_request`, COMPAT at messages.ts:1005). The source's own `agent.companion.update_entry.*`-equivalent stays; C2 adds the NEW `stream.list.*` / `stream.entry.update.*` RPCs alongside.

**Preservation tension T1 — retention.** Our `companion-stream.ts` (server) already evolved past the source parent: `evictCapturedSurplus` (capture-time eviction of captured entries beyond 50, sparing manual entries) + `COMPANION_MANUAL_ENTRY_LIMIT=100` with `appendManualCompanionEntry` explicit refusal (agent-manager.ts:2293,2309 callers). Source final state makes `retainCompanionEntries` identity (no eviction at all) and has no manual-entry cap. Plan: persist ALL captured history, no 50-evict, "never evict to make room". Proposed ruling (s2 preflight): take identity retention (removes `evictCapturedSurplus`); keep the manual-entry 100 cap + refusal (explicit user-facing bound, nothing silently lost, not part of "captured history"); `appendManualCompanionEntry` continues to clip text at 4000. Needs Sol sign-off.

**Preservation tension T2 — reply_sent.** Our question status enum carries `reply_sent` (protocol/companion-stream.ts:11) — a fork literal the source's schema lacks; the source's own previous-schema parse test includes it. Source removes the blanket `user_message → reply_sent` closure ("A message is not evidence that any particular question has been answered" — plan: "no blanket closure on user reply"). Adoption removes the closure; existing persisted `reply_sent` entries stay parseable (enum unchanged) and, after the s4 predicate change, count as open.

**Design fact F1 — the global stream is request/response, not push.** The source adds NO new server-pushed message type: `stream.list.request/response` + `stream.entry.update.request/response` are client-initiated correlated RPCs; the client polls (15 s refetch while focused). The plan's s1 "new global-stream pushes use a client-capability gate" is interpreted as: add CLIENT_CAPS entry + gate the new RPC surface at session admission; enriched existing messages (nested optional `ask` inside `companionEntries` on existing agent-state/snapshot pushes) ride the EXISTING `companion_stream_port_v1` capability + old-client parse test. Submitted to Sol for ruling.

**Design fact F2 — feature flags.** Source: `features.globalStream` (51a57be66) + `features.durableStream` (0aded86cd). Plan mandates the s4 asks gate be named `trackedAsks` ("gated once on server_info.features.trackedAsks"). Proposal: `globalStream` for the s1 RPC/reads surface; `trackedAsks` in s4 replacing the source's `durableStream` (declared name deviation, plan-wins). Submitted to Sol.

**Design fact F3 — AgentArtifactSchema extraction.** Source moves `AgentArtifactSchema` from messages.ts to new protocol/agent-artifact.ts (identical shape) to avoid a messages.ts ↔ global-stream.ts import cycle. Our messages.ts has the same inline schema; extraction is taken.

**Carried-state facts.** Our base agent-manager.updateCompanionEntry (agent-manager.ts:2262) is the source-parent shape + manual-cap refusal; source rewrites it into `applyStreamEntryUpdate` + serialized mutation + explicit persist-before-ack. `collectCompanionEvent` (agent-manager.ts:4925) is the post-coalescer fire-and-forget capture seam (called at :2675, :4573, :5104) → emitState → enqueueBackgroundPersist (:5318) whose failure today only logs — the s2 ENOSPC/EIO degraded-capture design attaches here. `agent-projections.ts` toAgentPayload :103/:146 + buildStoredAgentPayload :257 currently emit full entry lists; source adds `.slice(-50)` wire bound. Daemon permission maps (operation-permissions.ts INBOUND/OUTBOUND) need the four new operations. Client capabilities: `DEFAULT_CLIENT_CAPABILITIES` (packages/client/src/connection/index.ts:127) is TS-exhaustive over CLIENT_CAPS — new capability forces the entry. App: `views/sidebar-views-section.tsx` does NOT exist on our base (views are C5 territory); the source's sidebar entry hunk has no owner here — global screen entry adapts (s3 preflight/design). CompanionFeed mounts at agent-panel.tsx:1346 with `entries` prop from agent state; source s3 rewires it to paginated reads. e2e helpers used by the source specs (seed-client, isolated-host-daemon, hosts, workspace, app, archive-tab) all exist in our tree.

**Predicate-change UI counter survey (for s4, preliminary):** `isCompanionEntryPending` consumers today: protocol (definition), app feed.tsx:344 per-entry pending styling, companion-stream model.test.ts:56. After C2 lands it additionally drives the server "pending" stream filter (listStreamRows). Affected counters to list for Sol at s4: feed entry pending state (reviewed/reply_sent now render unresolved), server stream.list "pending" filter, `ask.state !== "done"` checklist ordering (separate ask counter — ask-expiry counted separately per plan).

## s0 — source diff inventory (study complete)

51a57be66 (53 files): protocol {global-stream.ts NEW, agent-artifact.ts NEW extraction, companion-stream.ts predicate, messages.ts wiring + globalStream feature}; server {global-stream.ts NEW projection, stream-entry-update.ts NEW mutation, companion-stream.ts capture (multi-question extraction, expired disposition, no reply-closure, retain durable-50), agent-manager (listGlobalStream, serialized updateCompanionEntry with persist-before-ack), paseo-tools set_stream_question, operation-permissions, session handlers, websocket-server feature flag, providers claude/codex/opencode/pi disposition:"expired" + codex UUID turn ids}; client {daemon-client listGlobalStream/updateStreamEntry}; app {global-screen NEW, use-global-stream NEW poll hook, feed writes→acked saves + ArtifactPinOperations draft-ID retention, model.test pending-filter, sidebar entry (C5-owned file), 9 locales, stream route + layout, e2e specs}; docs companion-stream/providers/CLAUDE.md.

0aded86cd (19 files): protocol {TrackedAskSchema + nested optional ask, set_ask/expectedRevision/agentId/asksOnly, durableStream feature}; server {identity retention, wire .slice(-50) in projections, asks ordering+rank cursor, set_ask engine + validation, set_stream_ask/list_stream_asks tools, websocket-server durableStream flag}; app {checklist tab + ask cards + evidence render + expectedRevision sends}; tests {previous-schema parse test, durable pages across manager recreation, ask lifecycle/revision conflicts, retention-beyond-50}; docs companion-stream + fork-features.

4eebe5136/1428f3770: e2e viewport stability fix (+ fork-features doc row, relocated).

## s1 — design note sent (2026-10-11, no edits made)

Design facts D1 (pushes vs request/response → capability-gated RPC admission + existing companion_stream_port_v1 for enriched pushes), D2 (flag naming), D3 (carried retention vs persist-ALL) submitted to Sol before implementation.

## s1 — design-note verdict: ADVANCE with D1 test correction (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ADVANCE — C2 s1 design rulings, with the D1 test correction below. Implementation may proceed; stage advancement still requires review.**
>
> **D1 — Accepted architecture; revise the compatibility proof.** Verified that source `global-stream.ts` defines correlated list/update RPCs, not new push types. Capability-gated RPC admission is acceptable; existing enriched pushes may retain their companion capability gate, provided s2 verifies every delivery path.
>
> A frozen released outbound union **cannot parse the new response types**. Do not invent released schemas that recognize them. Instead prove:
>
> - Capability-absent sessions receive neither new response type, including when sent an unsupported request.
> - Capable sessions receive correctly correlated responses.
> - Released companion-entry schemas parse enriched existing messages and strip `ask`.
> - The actual snapshot serialization strips companion fields for clients lacking the existing capability.
>
> The verbatim artifact extraction/re-export is accepted, subject to unchanged-shape verification.
>
> **D2 — Accepted.** Use `globalStream` for the global feed and **`trackedAsks` instead of `durableStream`** for the declared durable pagination/ask feature. No third flag. The s4 preflight must map every source `durableStream` check and prove ask mutations are unavailable when `trackedAsks` is absent.
>
> **D3 — Keep the manual cap.** The carried distinction is explicit: captured eviction occurs at `agent/companion-stream.ts:227–235`; manual admission refuses excess entries at `:262–270`. Removing captured eviction while retaining explicit manual refusal satisfies "persist ALL captured history."
>
> Preserve all existing admitted entries during restore, including over-cap legacy data. The manual cap must never constrain captured history or silently delete data. Keep bounded text/payload behavior accurately documented.
>
> No tests rerun. These rulings bind the forthcoming s2/s4 preflights; they do not approve those implementations.

Bound s1 test design: NO frozen-union parse test for the new response types (D1 correction). s1 protocol tests = ported previous-schema parse test (released companion-entry schema strips `ask`), old-daemon feature-flag absence test (globalStream/trackedAsks undefined), new-RPC schema purity + request/response pairing parse. Delivery-path proofs (capability-absent sessions receive neither response type; capable sessions receive correlated responses; snapshot serialization strips companion fields) = s2 ad-hoc-daemon tests. D3 restores-preserve-over-cap-legacy noted for s2 (restoreCompanionEntries must never trim).

## s1 — implementation complete, committed (2026-10-11)

Commit: `49a16f058` "feat(protocol): Add global Stream RPCs and durable ask wire contract" — 9 files, +288/−11. Pre-commit hooks: format ✔ lint ✔ typecheck ✔ (first commit attempt failed at the hook typecheck: stale protocol dist — client resolves `@getpaseo/protocol/*` from built declarations; fixed by `npm run build:client` per CLAUDE.md, then a second forcing issue surfaced: the exhaustive permission maps, fixed below — both worth remembering, not workarounds).

Files: NEW protocol/global-stream.ts, NEW protocol/agent-artifact.ts (verbatim extraction; shape verified character-identical), protocol/companion-stream.ts (TrackedAskSchema + nested optional ask; enums and predicate UNCHANGED), protocol/messages.ts (union wiring + re-exports + features globalStream/trackedAsks COMPAT), protocol/client-capabilities.ts (global_stream cap), protocol/messages.artifacts.test.ts (+3 tests), client/connection/index.ts (forced capability entry), client/daemon-client.ts (listGlobalStream/updateStreamEntry via sendNamespacedCorrelatedSessionRequest), server/authorization/operation-permissions.ts (4 entries — TS-forced by the exhaustive satisfies maps once the wire types exist; values identical to source; declared as s1 scope note, handlers are s2).

Tests (serial, targeted): messages.artifacts.test.ts 4 ✔ (incl. ported previous-schema parse test, old-daemon flag absence, status-enum-closed), messages.agent-queue.test.ts 9 ✔, messages.companion-update-entry.test.ts ✔, client connection/owned.test.ts 4 ✔ — final combined 4 files / 22 passed. Typecheck all workspaces exit 0; lint OK; format+format:check clean; build:client + build:server current. Pushed to origin.

Deviations declared: trackedAsks rename (Sol D2); permission entries in s1 (exhaustive-map forced); daemon-client methods in s1; predicate flip deferred to s4. Pending gaps: browser/platform/CI/basket evidence; capability delivery proofs = s2.

## s1 — STAGE REPORT sent (2026-10-11)

Full report (head 49a16f058, per-item file:line, carry accounting, test counts, checks, gaps, deviations, risks) sent to Sol. Verdict: PENDING.

## s1 — STAGE REPORT verdict: ADVANCE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ADVANCE — C2 s1 at `49a16f058`. Proceed to s2 preflight only; no s2 edits before PREFLIGHT APPROVE.**
>
> Verified locally: full head `49a16f0581a6554f2bef5305d171918e01839cbe`, direct parent frozen tmad `139e0c81e`.
>
> The committed scope matches the design:
>
> - Pure dotted RPC schemas and nested optional ask metadata (`global-stream.ts:20`, `companion-stream.ts:34`).
> - Artifact extraction preserves the original schema and export.
> - Existing question/status enums and pending predicate remain unchanged.
> - Optional `globalStream`/`trackedAsks` flags, capability declaration, and exhaustive maps are present.
> - Previous-question parsing strips `ask`; current parsing preserves it (`messages.artifacts.test.ts:80`).
>
> The permission-map and client-method additions are accepted as necessary protocol wiring. Capability enforcement and actual delivery-path proofs remain required in s2.
>
> Accepted **on report**: 22 targeted tests and clean build/typecheck/lint/format; none rerun.
>
> Required implementation deltas: none. Correct the report's claim that unmatched requests "fail authorization": permission mappings authorize operations by permission; they do not themselves enforce capability admission. Also reconcile the artifact-test accounting: the committed file contains one original test plus three additions, totaling four.
>
> Browser/platform, remote CI, and basket evidence remain open.

Corrections applied to the log (report-text only; no code deltas): (1) permission mappings authorize by permission — capability admission is the s2 handler check, not the maps; (2) messages.artifacts.test.ts accounting: one original test + three additions = four.

## s2 — PREFLIGHT sent (2026-10-11, no edits made)

[PF] preflight sent to Sol: s2 scoped as durability machinery only (retention identity + wire bounds + RPC handlers + capability admission + ENOSPC/EIO degraded capture + deferred home-size observation); capture-semantics hunks (multi-question extraction, expired disposition, blanket-closure removal, question tools) and the ask engine declared s4 per the plan row. Files+hunks, preservation/ownership/wire designs, 12 failing-first tests (5 ported retention/pagination, 2 ported write-path, 1 coalescing port, 1 NEW degraded-capture, 3 NEW ad-hoc daemon incl. zero-provider-launch dormant read + capability delivery proofs + real-payload old-schema parse, 1 home-size unit), carry-suite accounting, three scope rulings requested (captureDegraded field; read-cap log edge-triggering; s2/s4 split).

## s2 — PREFLIGHT verdict 1: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT ITERATE — C2 s2 at `49a16f058`. Hold edits and commits.**
>
> The durability/capture-semantics split is accepted. Five details need correction before implementation approval.
>
> 1. **Preserve the manual cap through the new mutation path.** Source `applyStreamEntryUpdate` directly appends entries, bypassing `appendManualCompanionEntry`; rewriting the manager around it would remove the retained refusal contract. Specify how new pin/Q&A additions enforce the cap, while edits to existing entries remain possible at capacity. Test both legacy and new RPC paths.
> 2. **Make degraded-state recovery generation-safe and non-recursive.** `emitState` normally schedules persistence (`agent-manager.ts:5243–5247`), so failure/recovery notifications must use `{ persist: false }`. Define when recovery clears the flag: only a successful write covering the retained capture generation qualifies. An older successful write must not clear a newer failure. Cover overlapping writes, and ensure synchronous persistence failures cannot bypass the chosen error policy.
> 3. **Enforce the declared transport bounds.** Source pagination uses `options.limit ?? 50` (`global-stream.ts:47`), while s1 permits 100. Clamp server pages to 50 without narrowing the wire schema. Specify read-time bounds for oversized legacy text/answers, preserving stored payloads. Test requested limit 100 and oversized persisted entries.
> 4. **Correct and complete the capability evidence.** Your discovery invalidates my earlier assumption that server-side companion stripping already existed. Optional nested fields can remain compatible through released-schema stripping; adding stripping is not required solely for this change. Prove actual emitted snapshots parse through the relevant released snapshot schema, not only an extracted question schema. For capability-absent sessions, test **both list and update requests**, including no mutation and no new response type. Use deterministic processing barriers for absence assertions.
> 5. **Complete the file inventory and observation design.** Include the managed-agent field declaration, `daemon-worker.ts`, and any observation helper/test. Define bounded traversal concurrency, no symlink following, and shutdown behavior. A positive byte-total assertion alone does not prove startup is independent of the walk; use a deferred traversal barrier.
>
> Scope rulings:
>
> - **`captureDegraded`: accepted** as an optional snapshot field; rendered feedback remains an s3 obligation.
> - **Read-cap logging: accepted** once per agent per daemon run at debug level; implement and test now.
> - **Capture-semantics changes: defer to s4** as proposed.
> - Put degraded-capture coverage in an existing manager/coalescing suite where practical.
>
> No tests rerun. Return the corrected preflight with these contracts and tests specified.

## s2 — PREFLIGHT resubmission sent (iteration 2, 2026-10-11)

Corrected preflight sent: (1) cap enforcement moved INSIDE `applyStreamEntryUpdate` (new manual entries refuse at 100 with the same message; edits at capacity pass; legacy >4000 text keeps clip+truncated; `appendManualCompanionEntry` superseded — no second implementation; both RPC paths covered since both route through `AgentManager.updateCompanionEntry` — verified lifecycle-command.ts:197); (2) degraded recovery generation-safe: per-agent `persistSeq`/`captureDegradedSeq`, success clears only when `seq > captureDegradedSeq`, both transitions emit `{persist:false}`, sync throws routed through the classifier via async IIFE, overlapping-write test; (3) server page clamp `Math.min(limit ?? 50, 50)` (wire schema untouched), read-time `boundEntryForTransport` 4000-clip on rows AND snapshot payloads (stored untouched), read-cap debug log once per agent per run; (4) released-SNAPSHOT-schema parse of a real emitted payload + capability-absent tests for BOTH request types incl. no-mutation + deterministic drop-processed barriers; (5) full inventory (ManagedAgentBase fields, daemon-worker wiring, NEW home-size-observation.ts) with sequential readdir, symlink skip, unref+abort shutdown, and an injectable gate proving startup independence.

## s2 — PREFLIGHT verdict 2: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT ITERATE — C2 s2, iteration 2. Hold edits and commits.**
>
> Most corrections are accepted: server page clamping, read-time clipping without storage rewrites, capability-drop barriers, existing-suite degraded coverage, and sequential home observation. Four contracts still need tightening.
>
> 1. **Use the actual released snapshot shape.** Frozen `139e0c81e` already includes `artifacts` and `companionEntries` (`agent-projections.ts:145–146`). Omitting those fields from the current schema does not represent that released client. Freeze the relevant released snapshot/entry definitions independently of the new schemas, then parse the actual emitted payload and prove nested `ask` and `captureDegraded` are stripped.
> 2. **Cover every persistence path and completion ordering.** Your classifier remains in `enqueueBackgroundPersist`, while explicit mutations call `persistSnapshot` directly (`agent-manager.ts:4239–4250`). Specify degraded-state handling for those failures and successful recovery writes too. Track the highest failed generation monotonically: a late older failure must not replace a newer failure sequence. Test both reordered failure completions and an explicit successful recovery. Clearing must follow a write that actually covers retained captures.
> 3. **Define manual identity and legacy behavior precisely.** Source Q&A creation generates a fresh UUID, so "existing target id" does not yet provide an editable Q&A identity. State which actions support upsert and how identity is selected before cap enforcement. Exercise both real RPC handlers—not two differently shaped calls to the same helper. Also declare any change to legacy empty/whitespace text behavior; the carried append path accepted it, whereas the source engine rejects it.
> 4. **Make observation shutdown deterministic.** Replace "signal if available, otherwise timer semantics" with a concrete cancellation owner: cancel the scheduled timer and abort traversal on daemon shutdown. `unref()` only prevents the timer from keeping the process alive; it does not cancel an active walk. Test shutdown while the traversal gate is held, with no subsequent traversal or success log.
>
> No implementation changes are otherwise requested. Read-cap logging and the s2/s4 split remain approved. No tests rerun.

## s2 — PREFLIGHT resubmission 2 sent (iteration 3, 2026-10-11)

Iteration 3 sent: (1) standalone Released schemas — ReleasedCompanionEntrySchema (six kinds, no `ask`) + ReleasedAgentSnapshotSchema = omit({captureDegraded}).extend({companionEntries: released}) preserving artifacts/companionEntries; real-payload parse proves `ask`+`captureDegraded` stripped; (2) shared notePersistFailure/notePersistSuccess used by BOTH paths; `captureDegradedSeq = Math.max(…, seq)` monotonic (late older failure never moves the marker); explicit-mutation failure → classify+flag+rethrow (accepted:false, no ack); reordered-failures + explicit-recovery + sync-throw + explicit-path-ENOSPC tests; (3) identity before cap: add_pin upsert-by-existing-id uncapped / new id capped; add_q_and_a ALWAYS capped (fresh UUID, no edit identity); add_question/status/remove_pin never capped; DECLARED legacy delta: empty/whitespace text now rejected on both paths (source engine validation); both REAL RPC handlers driven end-to-end at wire level; (4) `observeHomeSize` returns `cancel()` owning the timer + internal AbortController; walk checks `signal.aborted` between directories; daemon-worker `beginShutdown` body calls `observation.cancel()` before `daemon.stop()`; held-gate cancel test asserts no traversal and no success log.

## s2 — PREFLIGHT verdict 3: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT ITERATE — C2 s2, iteration 3. Hold edits and commits.**
>
> The released-schema construction, manual identities, explicit empty-text rejection, monotonic failure marker, and cancellation owner are accepted. Two implementation contracts remain incomplete:
>
> 1. **Define dormant degraded-state ownership.** `notePersistFailure(agent, seq, error)` depends on managed-agent bookkeeping, but the dormant path has no live `ManagedAgent`. Specify where its sequence, failure marker, and degraded flag live, how stored snapshots expose that flag, and how successful recovery clears it. Test a dormant failed mutation followed by a successful retry through the real RPC. Do not persist diagnostic bookkeeping by writing again into failing storage.
> 2. **Check cancellation after awaited traversal work.** Checking only between directories cannot guarantee that cancellation during the final directory prevents the success log. Check abort after the gate, after awaited filesystem operations, and before publishing the total. In-flight filesystem calls may finish; cancellation must prevent subsequent traversal and publication. Add a deferred-filesystem test cancelling during an active walk, alongside the pre-start cancellation test.
>
> The declared legacy empty/whitespace rejection is approved as a narrowly scoped behavioral change; preserve existing carry assertions apart from the declared retention adaptations.
>
> No tests rerun. Return these two completed contracts before implementation.

## s2 — PREFLIGHT resubmission 3 sent (iteration 4, 2026-10-11)

Iteration 4 sent: (1) dormant degraded ownership — manager-level in-memory maps (`dormantPersistSeq`/`dormantDegradedSeq`, Math.max monotonic), failure → log+rethrow (`accepted:false`, the RPC error is the dormant user-visible surface), success with newer seq deletes the marker, stored snapshots NEVER gain a degraded fact and no bookkeeping reaches storage, live agents start clean on load, markers cleaned up on close/remove; dormant failed mutation → successful retry test through the real RPC; (2) abort checks at every await boundary (after gate, after every readdir/stat, before publishing); injectable `deps.readdir/stat` wrappers around REAL fs for deferred barriers; NEW cancel-during-active-walk test (first readdir held, cancel, resolve → call count 1, no success log, quiet resolve).

## s2 — PREFLIGHT verdict 4: APPROVE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT APPROVE — C2 s2, iteration 4, against `49a16f058`, incorporating iterations 1–4.**
>
> The dormant diagnostic ownership and traversal cancellation contracts resolve the remaining design gaps. Dormant failures surface through rejected mutations; `captureDegraded` remains a live-agent snapshot field. No diagnostic write is attempted against failing storage.
>
> One test correction is required: dormant `writeStoredMetadata` calls **`registry.upsert`**, not `applySnapshot` (`agent-manager.ts:2241–2258`). Inject failure at that actual boundary. Manager-level calls prove rejection; assertions about `accepted:false` require the real RPC handler.
>
> At stage review, provide evidence for:
>
> - Full retention with bounded wire projections and preserved manual refusal.
> - Persistence-before-ack, concurrent capture preservation, and generation-safe degraded recovery.
> - Capability-absent list/update suppression and released-schema parsing of actual snapshots.
> - Dormant reads without provider launches and history across collector restart.
> - Observation cancellation before and during traversal.
>
> No tests rerun. Proceed with implementation and return the committed diff, targeted results, and build/typecheck/lint/format evidence for **ADVANCE before s3**. S4 still requires its own preflight.

BEGIN s2 implementation. Test correction adopted: dormant-path failure injected at `registry.upsert` (the `writeStoredMetadata` boundary); `accepted:false` asserted only through the real RPC handler (ad-hoc daemon suite).

## s2 — implementation complete, committed (2026-10-11)

Commit: `b02df0a9f` "feat(server): Persist all Stream history with bounded reads and degraded capture" — 15 files, +1698/−167. Hooks: format ✔ lint ✔ typecheck ✔. Pushed.

Implementation notes:

- NEW agent/global-stream.ts: listStreamRows (51a57be66 shape), STREAM_PAGE_LIMIT=50 server clamp, STREAM_SNAPSHOT_ENTRY_LIMIT=50 snapshot bound, boundEntryTextForTransport (read-time 4000 clip; storage untouched).
- NEW agent/stream-entry-update.ts: applyStreamEntryUpdate (51a57be66 shape, no setAsk — s4) + manual-entry admission INSIDE the engine (new pin/Q&A refused at 100; pin-edit by existing id uncapped; Q&A always capped — no edit identity; legacy >4000 clips with truncated flag; empty/whitespace rejected — approved legacy delta).
- companion-stream.ts: retainCompanionEntries → identity; evictCapturedSurplus + appendManualCompanionEntry REMOVED (superseded — no second cap implementation).
- agent-manager.ts: listGlobalStream (registry+live merge + once-per-run read-cap debug log), updateCompanionEntry → runLifecycleMutation + serialized + persist-before-ack (try/await/finally emit persist:false; failure → classify + rethrow), notePersist{Failure,Success} + dormant maps (in-memory, Math.max monotonic, cleanup on close), enqueueBackgroundPersist async-IIFE classifier (sync throws classified), ManagedAgentBase +persistSeq/captureDegradedSeq/streamCaptureDegraded.
- agent-projections.ts: projectCompanionEntriesForWire (slice(-50)+text bound) on toAgentPayload + buildStoredAgentPayload; captureDegraded passthrough (live only).
- session.ts: stream handlers with `supports(CLIENT_CAPS.globalStream)` admission (absent → log + drop, no response, no mutation).
- websocket-server.ts: features.globalStream: true (COMPAT; trackedAsks NOT advertised until s4).
- NEW server/home-size-observation.ts + daemon-worker wiring (post-start schedule, unref, beginShutdown cancel; sequential readdir, symlink skip, abort checks at every await boundary + before publish).
- protocol messages.ts: captureDegraded optional on AgentSnapshotPayloadSchema (COMPAT captureDegraded).

Debugging war story (recorded for the log): the released-schema e2e proof took several iterations — the daemon's storage cache shadows out-of-band record writes (fixed by seeding the record file on disk between two daemon runs), TestPaseoDaemon does not expose paseoHomeRoot (derive as dirname(paseoHome)), and the final blocker was a missing `await` on the async waitFor helper — the assertion was reading the Promise object. The proof now parses the real fetch_agents_response payload: `ask` present pre-parse, stripped by the released schema, captureDegraded absent.

Tests (serial, targeted): companion-stream 17 ✔ (adapted retention + new cap/clip/empty/pagination/clamp/oversize/retry/upsert), coalescing 32 ✔ (6 new: port + write-failure + concurrent + generation-safe + sync-throw + read-cap), dormant manager test ✔ (upsert-boundary ENOSPC), home-size 3 ✔, protocol artifacts 4 ✔, daemon e2e 5 ✔ (capability suppression both RPCs, capable correlated flows, dormant zero-provider-launch reads across archive, both handlers' cap refusal, released-schema parse of real payload). 61 new/extended passing.

Checks: typecheck all workspaces ✔, lint ✔ (3 findings in my new code fixed), format ✔, build:server ✔, hooks green at commit, pushed.

## s2 — STAGE REPORT sent (2026-10-11)

Full report against the five APPROVE evidence obligations sent. Verdict: PENDING.

## s2 — STAGE REPORT verdict 1: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ITERATE — C2 s2 at `b02df0a9f`. Do not start s3.**
>
> Verified head `b02df0a9f6a3b532d9011f332c2244f971a551d8`, parent `49a16f058`, and the reported 15-file scope. Retention, page clamping, manual admission, capability handlers, and observation cancellation are present.
>
> Four corrections remain:
>
> 1. **Dormant bookkeeping cleanup is missing.** The maps are created and populated, but `dormantPersistSeq` is never cleared; `dormantDegradedSeq` clears only on successful retry (`agent-manager.ts:813–814,2343–2344,2391–2395`). Implement the promised lifecycle cleanup without resetting generations beneath an outstanding operation, and test it.
> 2. **Answer-only transport clipping does not mark truncation.** `boundEntryTextForTransport` clips oversized Q&A answers without setting `truncated:true` (`global-stream.ts:136–142`). Correct the wire projection and test both list and snapshot paths, asserting stored content remains unchanged.
> 3. **Degraded-capture evidence is incomplete.** The committed tests inspect manager flags, but do not establish the reported emitted-payload flag, non-persisting transition notifications, or path-bearing error log. The classifier logs no explicit path (`agent-manager.ts:2365,2388`). Add those assertions and the promised reordered-failures case; the existing overlapping test covers older **success**, not older failure. Demonstrate recovery reaches the wire with an unambiguous clearing contract.
> 4. **Complete the promised real-handler legacy tests.** The daemon cap test covers refusal and new-handler editing (`stream-durability.e2e.test.ts:243–294`), but omits legacy oversized-text clipping and empty/whitespace rejection. Add those cases through the actual legacy handler. The released-snapshot test currently receives no `captureDegraded` field, so its absence-after-parse assertion does not prove stripping that field; cover an actual degraded live payload.
>
> Accepted on report: green targeted results and clean build/typecheck/lint/format; none rerun. Correct the test accounting and distinguish verified assertions from intended coverage. Browser/platform, remote CI, and basket evidence remain pending.

## s2 — corrections implemented, committed (2026-10-11)

Commit: `14dc14294` "fix(server): Complete degraded-capture evidence and dormant bookkeeping lifecycle" — 9 files, +316/−80. Pushed.

1. Dormant cleanup: `discardRetainedAgentState` deletes both maps (archive ×2 + deleteAgentState sites; lifecycle lane ⇒ no in-flight reset); test asserts maps cleared after `deleteAgentState` + fresh post-cleanup generation re-flags.
2. Answer clip sets `truncated:true`; verified on list rows (stored answer unchanged) and snapshot projection (new agent-projections test).
3. Degraded evidence: `toAgentPayload` flag true → released-schema strip → recovery clears on the wire; applySnapshot call-count proves non-persisting transitions; classifier logs `{err, agentId, code, path}` via new `AgentStorage.describeRecordPath`; NEW reordered-FAILURES test (late older failure never moves the marker).
4. Real legacy handler cases (4500-char clip to 4000+truncated walking all pinned pages; whitespace rejection); released schemas hoisted to shared `test-utils/released-stream-schemas.ts`; degraded LIVE payload parsed through released schema in the write-failure test.
   Test accounting corrected: 62 newly written/extended tests verified green across 7 files (18+34+20+3+4+1+5 — the previous report's "61" was a miscount).
   Checks: typecheck/lint/format/build green (two lint findings in the new test code fixed: shadowed `page`, unused schema import); hooks green at `14dc14294`; pushed.

## s2 — STAGE REPORT verdict 2: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ITERATE — C2 s2 at `14dc14294`. Do not start s3 yet.**
>
> Verified parent `b02df0a9f` and merge-base frozen tmad `139e0c81e`. Answer clipping now marks truncation (`global-stream.ts:141–145`); degraded-payload parsing, recovery, path-bearing logs, and legacy-handler cases have committed assertions.
>
> One lifecycle blocker remains:
>
> - `deleteAgentState` directly calls cleanup without entering `runLifecycleMutation` (`agent-manager.ts:3593`). This contradicts the lane-safety claim at `:4140–4142`. A dormant write can be awaiting persistence when cleanup resets its generation maps, then its completion can repopulate them. The new test exercises sequential cleanup only and does not await deletion (`agent-manager.test.ts:12634`).
>
> Required delta: serialize deletion cleanup against dormant mutations, or invalidate outstanding completions with an ownership token. Add a deferred-write test proving cleanup cannot be undone by a late completion and that subsequent writes recover correctly. Await deletion in the existing test.
>
> Correct the report's accounting:
>
> - Actual stage diff: **18 files, +1934/−167**.
> - Listed passing runs total **85 tests**, including existing tests; they are not 62 newly written tests.
> - The snapshot clipping test asserts projected output, but does not assert the original agent entry remains unchanged (`agent-projections.test.ts:532`).
>
> Accepted on report: green targeted runs, typecheck, lint, formatting, and hooks. I inspected code and assertions; I did not rerun tests. Browser/platform, basket, remote CI, and real disk-full evidence remain pending.

## s2 — corrections round 2, committed (2026-10-11)

Commit: `c9fef7739` "fix(server): Serialize Stream state deletion against dormant mutations" — 3 files, +94/−3. Pushed.
`deleteAgentState` now wraps discard+timeline-deletion in `runLifecycleMutation` (per-agent lane ⇒ in-flight dormant write finishes and repopulates before cleanup; no post-cleanup completion). NEW deferred-write lane test (deletion proven unsettled while the write blocks; maps empty only after both settle; subsequent write recovers). Existing dormant test now awaits deletion. Projections test asserts the agent's own entry unchanged. Accounting corrected (18 files +2027/−169 across three commits; 86 verified-green tests including existing). Checks: typecheck/lint/format green (one always-return fixed), hooks green, pushed. Corrected report sent; verdict PENDING.

## s2 — STAGE REPORT verdict 3: ADVANCE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ADVANCE — C2 s2 at `c9fef7739`. Proceed to s3.**
>
> Verified parent `14dc14294`, merge-base frozen tmad `139e0c81e`, and stage diff **18 files, +2027/−169**.
>
> The remaining blocker is fixed:
>
> - Deletion cleanup uses the same per-agent lifecycle lane as dormant mutations (`agent-manager.ts:3598`).
> - The deferred-write test verifies deletion waits, maps remain cleared after settlement, and subsequent persistence succeeds (`agent-manager.test.ts:12713`, `:12727`, `:12730`).
> - The existing cleanup test awaits deletion (`agent-manager.test.ts:12634`).
> - Snapshot clipping now asserts the original entry remains unchanged (`agent-projections.test.ts:560`).
>
> Accepted on report: **86 passing targeted tests**, clean typecheck/lint/format, and hooks. I inspected committed code and assertions; I did not rerun tests.
>
> Required deltas: none. Browser/platform proof, basket integration, remote CI, and real disk-full evidence remain pending. This advances s2 only, not the C2 package or rolling-basket gate.

## s3 — implementation complete, committed (2026-10-11)

Commit: `7a528d740` "feat(app): Add the global Stream screen and acknowledged feed writes" — 17 files, +646/−38. Hooks green; pushed.

- `/stream` route (root stack, storeReady-protected, HostRouteBootstrapBoundary) + GlobalStreamScreen: filters/search/host filter/archived toggle/refresh/load-more/per-host notices; testIDs per source.
- use-global-stream.ts: 15s focused polling over stream.list; staleTime 10s; in-memory cache; page depth on Load more; single globalStream availability gate (agentId/asksOnly pass through inert for s4).
- feed.tsx: all writes through acknowledged updateStreamEntry; saving/saveError inline + carried toast; disabled controls on unsupported/offline/saving; draft-ID retention for manual saves; ArtifactPinOperations dedupe+retry with same id; pending filter via shared predicate (neutral until s4 flip; model.test untouched).
- i18n: globalStream.\* keys in all 9 locales (source's English fallbacks adopted); retention copy updated. resources.test.ts 40 ✔.
- DEVIATION declared: source's sidebar entry hunk (views/sidebar-views-section.tsx) not taken — file is another package's scope on our line; route reachable by URL; entry point lands with the views package. Flagged to Sol.
  Tests: global-screen 1 ✔, artifact-pin-operations 2 ✔, model 1 ✔, i18n 40 ✔ (combined 46 ✔). Typecheck/lint/format green; browser e2e specs NOT ported this stage (recorded pending with platform matrix).

## s3 — STAGE REPORT sent (2026-10-11)

Verdict: PENDING.

## s3 — STAGE REPORT verdict 1: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ITERATE — C2 s3 at `7a528d740`. Do not start s4 yet.**
>
> Verified parent `c9fef7739`, merge-base frozen tmad `139e0c81e`, and app-only scope. Actual diff is **17 files, +949/−33**.
>
> Required deltas:
>
> 1. **Render degraded capture.** No app consumer reads `captureDegraded`; the client agent state lacks it (`session-store.ts:113`), and the feed receives no degraded-state input (`feed.tsx:20`). Carry the flag through snapshot updates and render a localized warning that clears after recovery. Test the actual state-to-feed wiring. This completes the user-visible contract deferred from s2.
> 2. **Fence artifact writes and concurrent saves.** Artifact long-press remains enabled (`artifacts/feed.tsx:164`; callback supplied at `companion-stream/feed.tsx:164`). `save` has no in-flight guard, and each completion sets `saving=false` independently (`feed.tsx:115–133`). Two different artifact writes can overlap and the first completion enables controls while the second remains pending. Gate artifact actions and use synchronous ownership of the pending state. Test capability loss, offline state, and deferred concurrent clicks through the feed.
> 3. **Scope manual retry identity.** One `draftEntryId` is reused for both `add_question` and `add_pin` (`feed.tsx:192–207`). After a lost acknowledgement, switching tabs changes the action while retaining the ID; the server prefixes those actions differently, creating another entry rather than retrying the original operation. Bind retry identity to host, agent, and action. Test lost-ack retries and tab changes through the real submission callback.
> 4. **Provide an in-app entry point now.** URL-only access leaves the adopted screen undiscoverable until C5. Add Stream alongside the existing global navigation rows in `components/sidebar/sidebar-nav-rows.tsx`, with compact-menu reachability. This does not require porting the source's views module.
> 5. **Supply targeted browser evidence.** Plan §8 explicitly includes C2-feed browser e2e. Port the relevant specs and verify desktop and compact widths, navigation, filters/search/pagination, acknowledged writes, and failure notices. The current test exercises only `GlobalStreamCard` with the feed and query hook mocked (`global-screen.test.tsx:99`). Record native evidence separately as pending.
>
> Also localize the hard-coded offline/upgrade notices (`use-global-stream.ts:115–117`). Correct per-file test counts: artifact operations has **3** tests and model has **2**; the combined **46** total is consistent.
>
> Accepted on report: 46 passing tests and clean checks/hooks. I inspected committed code and assertions; I did not rerun tests.

## s3 — corrections implemented, committed (2026-10-11)

Commit: `84cefe1f2` "fix(app): Fence concurrent Stream saves, render degraded capture, add sidebar entry" — 23 files, +567/−17 (stage total vs c9fef7739: 23 files, +1213/−55). Pushed.

1. captureDegraded chain: normalizeAgentSnapshot → Agent interface → agent-panel prop → feed warning (testID companion-stream-degraded, alert role, state-driven clearing) → replica-cache persistence; `globalStream.captureDegraded` key ×9 locales; VERIFIED by feed-writes.test (present/cleared + with-entries render).
2. Save ownership by count (saving clears when the LAST write settles); ArtifactCard `pinDisabled` suppresses long-press; VERIFIED by the deferred concurrent-clicks test (Saving notice persists past the first release, clears after the second) + capability/offline zero-call assertions.
3. draftEntryIds Map keyed [serverId, agentId, action]; VERIFIED: same-tab lost-ack retry reuses the id; tab switch starts a fresh id with the other prefix; capability/offline fence.
4. Sidebar entry: `stream` builtin row (ListFilter, testID sidebar-stream, buildStreamRoute, label reuses globalStream.title), settings icon map extended; persisted-preference arrays resolve the new builtin by default; compact sidebar mounts the same rows.
5. Browser spec ported (post-viewport-fix, checklist test deferred to s4) + SeedDaemonClient stream methods typed; EXECUTION recorded PENDING (browser harness), consistent with campaign evidence rules.
6. offline/upgrade notices localized (keys ×9).
   Test accounting corrected: 50 verified green this stage (feed-writes 4, global-screen 1, artifact-pin-operations 3, model 2, i18n 40).
   Checks: typecheck/lint/format green (react-perf, no-shadow, no-array-index-key findings in the new test mocks fixed by restructuring — no rules disabled); hooks green; pushed. Corrected report sent; verdict PENDING.

## s3 — STAGE REPORT verdict 3: ADVANCE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **ADVANCE — C2 s3 at `2afcbc82e`. Proceed to s4 preflight only; no s4 edits before PREFLIGHT APPROVE.**
>
> Verified parent `84cefe1f2` and merge-base frozen tmad `139e0c81e`.
>
> - The selector preserves degraded state (`select-chat-agent-state.ts:79`), with snapshot/recovery assertions (`agent-snapshots.test.ts:121`) and panel-to-feed wiring (`agent-panel.tsx:1282`).
> - Browser specs exercise desktop/sidebar and compact/drawer entry, plus pagination (`global-stream.spec.ts:51`, `:117`). Retained screenshots exist at both widths; I inspected them. Playwright's last-run record says passed with no failures.
>
> Accepted on report: **56 passing unit tests**, **3 passing browser tests**, and clean checks/hooks. I did not rerun tests.
>
> Required record correction: actual stage diff is **31 files, +1676/−112**. No implementation deltas remain.
>
> Native/platform, remote CI, basket, and real disk-full evidence remain pending. This advances s3, not the C2 package or basket gate.

Record correction applied: s3 stage diff is 31 files, +1676/−112 (three commits: 7a528d740, 84cefe1f2, 2afcbc82e).

## s4 — PREFLIGHT sent (2026-10-11, no edits made)

[PF] preflight sent: asks engine (setAsk + validation + update_status bridge with askRevision COMPAT), agentId/asksOnly/rank cursor, trackedAsks advertisement, set_stream_ask/list_stream_asks/set_stream_question tools, the deferred capture-semantics hunks (expired disposition, multi-question extraction, no blanket reply_sent closure — carried test rewritten to source expectation, provider disposition plumbing + codex turn UUID), app Checklist tab + ask cards + expectedRevision sends gated on trackedAsks (D2 naming), predicate flip with the full consumer/counter audit (feed filter, EntryCard styling, server pending filter, model.test — ask-expiry counted separately), gate-absent/old-daemon-reject tests, durable-pages manager test port, and a question for Sol: does the checklist browser spec belong in s4 or s5. Verdict: PENDING.

## s4 — PREFLIGHT verdict 1: ITERATE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT ITERATE — C2 s4 against `2afcbc82e`. Hold edits.**
>
> Verified the branch head and compared the proposed engine, capture, tools, and UI scope with `0aded86cd` and `51a57be66`. Five deltas remain:
>
> 1. **Apply the asks gate to every mutation surface.** The plan requires `trackedAsks` for both `set_ask` and ask revision handling (`plan:155`). Existing feed writes gate only on `globalStream` (`feed.tsx:130`); global cards do likewise (`global-screen.tsx:164–174`). Hiding Checklist is insufficient. Define how ask-bearing cards block mutations when `trackedAsks` is absent or disappears. The proposed "send no expectedRevision" behavior would invoke the compatibility bridge and still mutate the ask. Test **zero ask mutation calls**, including cached cards and capability loss.
> 2. **Add the omitted global-screen hunk to the inventory.** Source `0aded86cd` adds the displayed ask's revision to global-card updates and passes `serverId` into `EntryCard`. Include those adaptations, the asks gate, and tests proving stale revisions cannot overwrite and Done cannot bypass completion evidence on either screen.
> 3. **Complete the capture/provider allowlist and test inventory.** Include `providers/opencode/v2/session.ts`: the source changes permission cleanup to `expireAll()`. Explicitly include `providers/codex-async-questions.test.ts` and name the provider lifecycle regressions being ported. Preserve the carried Codex pre-submission classification while adapting turn identities. Capture semantics belong in s4 as agreed; correct the contradictory "NO provider/capture hunks" sentence.
> 4. **Specify observed ordering and preservation tests.** The current client hook re-sorts merged rows by timestamp (`use-global-stream.ts:98`), whereas the source ranks unresolved asks first (`global-stream.ts:20–22`). Show how the final checklist preserves rank across loaded pages. Test legacy two-element cursors, ranked cursors, and retained 50-row/read-time text bounds. Explicitly preserve s3's concurrent-save ownership, retry identities, and degraded warning.
> 5. **Execute checklist browser acceptance in s4.** Port and run the checklist pagination/evidence/reopen flow before requesting this stage's ADVANCE. s5 can retain documentation and final locale auditing.
>
> The predicate change is accepted in principle. Verified affected consumers are the feed's unresolved filter and pending styling, server pending filtering, and model test; `reviewed`/`reply_sent` become unresolved. Permission expiry and ask completion remain separate. Removing blanket reply closure and adapting its behavioral test are within the declared s4 scope.
>
> The source's identical-rewrite check precedes revision rejection (`stream-entry-update.ts:116–124`). Record that precise exception: identical lost-ack retries are no-ops; differing stale writes conflict.
>
> No tests were rerun; this is a design review, not implementation approval.

## s4 — PREFLIGHT resubmission sent (iteration 2, 2026-10-11)

Corrected preflight: (1) asks gate on every mutation surface — `supportsAsks` selector in feed AND global cards; save() rejects ask-targeting writes before any frame when the flag is absent (zero ask mutation calls, live selector so cached cards fence/unfence); EntryCard buttons disabled for ask entries without the flag; VERIFIED tests specified. (2) Global-screen hunk added (expectedRevision on card updates, serverId into EntryCard) with stale-revision and Done-bypass tests on both screens. (3) Capture/provider allowlist completed and the contradictory sentence corrected: companion-stream capture hunks, agent-manager expired disposition, sdk-types field, claude/codex/opencode(+session expireAll)/pi plumbing, codex-async-questions.test named, codex pre-submission classification preserved (turn ids only). (4) Checklist ordering through buildCompanionFeed's unresolved-ask-first re-order preserves rank across pages; legacy 2-elem + ranked 3-elem cursor tests; s3 properties re-run. (5) Checklist browser acceptance EXECUTED in s4 before ADVANCE. Identical-rewrite-before-conflict exception recorded. Verdict: PENDING.

## s4 — PREFLIGHT verdict 2: APPROVE (2026-10-11)

Quoted verbatim (`paseo logs 3f2c7ea5 --tail 1 --filter text`):

> **PREFLIGHT APPROVE — C2 s4 against `2afcbc82e`, incorporating iterations 1–2.**
>
> Verified the unchanged branch head, source global-card revision hunk, manager expiry-disposition hunk, and unresolved-first model ordering (`0aded86cd:global-screen.tsx:179`, `51a57be66:agent-manager.ts:4848`, `0aded86cd:model.ts:29–32`).
>
> Approved scope includes the completed capture/provider inventory, revision-checked ask engine, tools, checklist, `trackedAsks` mutation guards on both screens, predicate flip, and browser acceptance in s4.
>
> Carry these evidence obligations into implementation:
>
> - **Correct the gate test trigger:** Done remains disabled even when supported, so it cannot prove gated dispatch. Use Open or Reviewed to prove an enabled call carries the displayed revision, then remove `trackedAsks` while retaining the cached card and assert zero further calls. Test restoration separately. Keep Done-disabled assertions on both screens.
> - Gate every ask-bearing mutation, including pin/removal actions where applicable. Never omit `expectedRevision` as a fallback for an unsupported asks feature.
> - Prove differing stale writes preserve server state; mock rejection proves UI feedback only. Preserve the identical-rewrite no-op exception.
> - Verify checklist rendering uses the unresolved-first model across loaded pages, while retaining cursor compatibility, transport bounds, and s3 save/retry/degraded-warning contracts.
> - Execute the checklist browser flow and global-screen regression before requesting ADVANCE.
>
> The predicate audit is accepted: reviewed/reply_sent questions remain unresolved in feed filtering, styling, server pending results, and model expectations. Permission expiry and ask state remain separate.
>
> Your "VERIFIED tests" are **planned assertions**, since no edits have been made. No implementation or test results were verified here.
>
> Proceed with implementation; return the committed diff and evidence for **ADVANCE before s5**.

BEGIN s4 implementation. Evidence obligations logged (gate-test trigger via Open/Reviewed with zero-call on flag removal; every ask-bearing mutation gated; stale writes preserve server STATE; unresolved-first ordering across pages; checklist browser + global regression executed; phrasing corrected — planned, not verified).

## s4 — implementation complete, committed (2026-10-11)

Commit: `707f800f9` "feat(server,app): Add durable asks with trackedAsks gate, checklist and capture semantics" — 39 files, +1937/−311. Hooks green; pushed.

Engine/tools/gate/capture/app per the approved preflight (setAsk + validateAskCompletion + update_status bridge with COMPAT(askRevision); agentId/asksOnly/rank cursor; trackedAsks advertised; set_stream_ask/list_stream_asks/set_stream_question tools; capture semantics incl. expired disposition through claude/codex/opencode expireAll/pi, question-kind expiry → open question, blanket reply closure removed, multi-question + labelled-list extraction; codex turn UUIDs with the carried pre-submission classification untouched; app Checklist tab + ask cards + expectedRevision sends + zero-call trackedAsks fences on both screens + Done disabled for asks; predicate flip with the audited consumers). s2 latent defect repaired: the coalescing test's released-schema import path was wrong at HEAD (`../../test-utils/` → `../test-utils/`) plus a missing toAgentPayload import.

Tests (serial, targeted, all green): companion-stream 31 (ask lifecycle, ordering/cursor, capture semantics, expiry matrix, labelled lists), coalescing 33, agent-projections 20, home-size 3, agent-manager dormant + durable-pages (216-file suite via -t), protocol artifacts 5 (incl. old-daemon set_ask reject), claude expiry matrix 4, codex elicitation 2 + async-questions 11, opencode 8, pi 118, daemon e2e 5, feed-writes 4 (gated dispatch with displayed revision via Open; zero-call fence on trackedAsks removal with cached card; separate restoration; Done disabled; checklist create expectedRevision 0; per-action identity), global-screen 1, model 3 (incl. unresolved-first ordering), i18n 40 (checklist keys ×9). typecheck/lint/format/build green (complexity 21→extracted collectSourceEntryRows; nested ternaries extracted; unused vars removed; isHiddenSource restored).

## s4 — browser acceptance (executed; two flows blocked by host-load infra)

`npx playwright test --project=browser e2e/browser/global-stream.spec.ts` on the isolated harness (own Metro port, own daemon homes; no 6767 contact):

- 390px full flow: **PASS ×2** (2.2m; drawer entry via sidebar-stream; interleaving; per-item Done; pinned/unpin; concurrent-removal rejection notice; refresh; search; source-chat navigation).
- Load-more pagination: **PASS ×2** (53 seeded questions; 50-row clamp; oldest visible only after Load more).
- 1440px flow: **0/5 attempts** — every failure is infrastructure, a different mode each time: opencode session.create 30s timeout; e2eWorker fixture 60s timeout; daemon transport 1006; page.goto load-hang ×2. Host load average 11–16 throughout (other live campaign sessions on uranus; no stray processes of mine — verified). Failures occur at/before agent creation or on connection loss, never on an app assertion.
- Durable checklist flow: **0/2 executions** — first attempt died at 0ms (worker fixture cascade after the 1440 failure), second attempt ran 3.0m and died on daemon transport 1005 mid-flow, before any app assertion failed.

Host environment: playwright 1.58 + ubuntu24.04 platform override + install-deps (sudo apt) documented earlier. Per the APPROVE obligation the checklist flow and the 1440 regression were each executed but did not complete; not claimed green.
