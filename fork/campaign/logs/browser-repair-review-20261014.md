# Sol browser-repair review, 2026-10-14 (verbatim)


**ADVANCE — C2-BROWSER-EXC-1 at `d2407b79b445ce4da02791715f5253a45f3f6265`.**

Verified the two-file diff against its parent: literal Stream identity/label; all five-item orders; three independently asserted Schedules moves; exact persisted visibility; reload coverage; and the approved all-items-off fixture addition. Existing shortcut, footer and plugin assertions remain.

The per-test `120_000` timeout is accepted: it extends the overall execution budget without changing assertions or individual acceptance conditions, and matches sibling flows. Complete-file **4/4** and green hooks are accepted on report; I ran no builds or tests. This advances the C2 repair only, not publication.

For C1, the source supports the reconnect diagnosis, with important qualifications.

1. **Reconnect trigger is disconnected from the application handler.** The client consumes handshake server-info, marks the connection connected and restores subscriptions (`daemon-client.ts:7117–7132`). Owned-subscription routes were cleared on disconnect (`connection/owned.ts:213–217`); delivery to those observers requires a routed `subscriptionId` (`:202–205`). The untagged handshake therefore does not reach the app’s `onFeed("status", …)` flush handler (`session-context.tsx:619–641`). Restoring the event subscription supplies only request/subscription identities (`session.ts:2773–2776`), not a replacement server-info snapshot. The app’s corresponding snapshot callback is empty (`session-context.tsx:567`).

   This applies to **owned-subscription hosts**. Legacy subscriptions have a separate status-matching delivery path (`connection/legacy.ts:252–255`), so the worker’s subscriptionId-only statement is not universally true.

2. **The trigger gap predates C1 and the release integration.** Frozen tmad already uses this event-subscription status handler, empty snapshot callback and reconnect-flush assumption. The owned/legacy routing files are unchanged between frozen tmad and this candidate. C1 changes the flush adapter/error handling, not that trigger. Thus this is a **pre-existing carried-queue reconnect defect**, exposed more clearly by C1’s pending-row controls; it is not attributable to upstream0.11.2 integration.

   Durable payload retention is supported by the reported storage assertions; automatic progress is broken. In real use, unacknowledged entries can remain stranded after reconnect. A later **routed server-info update** can flush them; an unrelated agent status event cannot. Another queue submission invokes the server-wide flush (`composer/actions.ts:603–623`), as do explicit retry paths. App restart alone is **not a guaranteed remedy** on an owned-subscription host—the same handshake delivery gap exists. Parked entries still require explicit retry.

3. **Minimal production options, owned by C1 queue durability:**
   - Prefer an app-level reconciliation trigger when the runtime becomes connected **and current handshake information confirms `durableAgentQueueV1`**. Reuse the existing adapter/flush; retain reservations, parking, hydration and agent-lane fences. Cover already-connected mounting and reconnect during an outstanding flush.
   - Alternatively, consume handshake server-info through an explicit client observer and invoke the same reconciliation. This is precise but introduces lifecycle/subscription work.
   - Replaying handshake status through every owned event subscription is broader client-contract work. I would avoid it for this queue fix.

   None of these options is implementation authorization; Cameron’s production-design sign-off remains required.

4. **`30e6769e8` preserves the right acceptance, but its recovery orchestration is defective.** Same-agent dispatch is serialized and awaits each enqueue response (`queue-outbox-store/model.ts:250–260,292–325`). The test waits for **both** reconnect enqueues before releasing the first response; that blocks the second dispatch. Additionally, releasing response1 shifts the held-response array, so subsequent `waitForQueueEnqueueResponse(2)` waits for two remaining responses (`agent-message-gate.ts:213–222`).

   Correct sequencing must be: first reconnect enqueue → first real acknowledgement → release → second enqueue → second acknowledgement → release. Use cumulative response identities or the correct remaining-queue index. Also inspect broadcasts: a queue-update snapshot may acknowledge an entry before its correlated response is released, so “response held means nothing acknowledged” is not guaranteed. Preserve the durable-storage proof and original final acceptance.

   These test defects do **not** explain the reported absence of even the first reconnect enqueue; they would prevent successful completion after the production trigger is repaired.

The duplicate-row observation remains **unclassified**, not dismissed as a flake. The unchanged body at `agent-message-submission.spec.ts:1163–1205` exercises a different gate; the repair has no demonstrated direct cause. Three failures versus one baseline pass are insufficient attribution. Settle it with controlled repeated runs of the same isolated flow on both exact SHAs, then correlate the two rendered rows with timeline/message identities, client-message IDs, queue snapshots and canonical/optimistic reconciliation. A fast-host pass alone would not disprove a timing-sensitive duplicate-row defect. Keep the exact one-row assertion and retain this as a separate release investigation.
