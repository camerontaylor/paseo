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
>
> 2. **Make degraded-state recovery generation-safe and non-recursive.** `emitState` normally schedules persistence (`agent-manager.ts:5243–5247`), so failure/recovery notifications must use `{ persist: false }`. Define when recovery clears the flag: only a successful write covering the retained capture generation qualifies. An older successful write must not clear a newer failure. Cover overlapping writes, and ensure synchronous persistence failures cannot bypass the chosen error policy.
>
> 3. **Enforce the declared transport bounds.** Source pagination uses `options.limit ?? 50` (`global-stream.ts:47`), while s1 permits 100. Clamp server pages to 50 without narrowing the wire schema. Specify read-time bounds for oversized legacy text/answers, preserving stored payloads. Test requested limit 100 and oversized persisted entries.
>
> 4. **Correct and complete the capability evidence.** Your discovery invalidates my earlier assumption that server-side companion stripping already existed. Optional nested fields can remain compatible through released-schema stripping; adding stripping is not required solely for this change. Prove actual emitted snapshots parse through the relevant released snapshot schema, not only an extracted question schema. For capability-absent sessions, test **both list and update requests**, including no mutation and no new response type. Use deterministic processing barriers for absence assertions.
>
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
>
> 2. **Cover every persistence path and completion ordering.** Your classifier remains in `enqueueBackgroundPersist`, while explicit mutations call `persistSnapshot` directly (`agent-manager.ts:4239–4250`). Specify degraded-state handling for those failures and successful recovery writes too. Track the highest failed generation monotonically: a late older failure must not replace a newer failure sequence. Test both reordered failure completions and an explicit successful recovery. Clearing must follow a write that actually covers retained captures.
>
> 3. **Define manual identity and legacy behavior precisely.** Source Q&A creation generates a fresh UUID, so "existing target id" does not yet provide an editable Q&A identity. State which actions support upsert and how identity is selected before cap enforcement. Exercise both real RPC handlers—not two differently shaped calls to the same helper. Also declare any change to legacy empty/whitespace text behavior; the carried append path accepted it, whereas the source engine rejects it.
>
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
>
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
