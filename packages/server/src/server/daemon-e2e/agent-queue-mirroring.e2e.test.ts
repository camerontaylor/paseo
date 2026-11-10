import { describe, test, expect, beforeEach, afterEach } from "vitest";
import type { AgentQueueSnapshot, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";

/**
 * Two independent clients against one daemon queue, on the fake provider
 * harness (no real provider credentials). Covers the composer-facing contract
 * from docs/queue-mirroring.md: cross-client mirroring of enqueue, update,
 * reorder and delete, durability across a client reconnect, and receipt-driven
 * delivery that leaves exactly one canonical user row.
 *
 * The agent is parked mid-turn on a fake permission request, which is what
 * keeps a queue item pending while both clients mutate it.
 */

const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

async function waitFor<T>(
  poll: () => T | undefined,
  description: string,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = poll();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function queueEvents(collector: MessageCollector, agentId: string): AgentQueueSnapshot[] {
  return collector.messages
    .filter(
      (message): message is Extract<SessionOutboundMessage, { type: "agent.queue.update" }> =>
        message.type === "agent.queue.update" && message.payload.agentId === agentId,
    )
    .map((message) => message.payload);
}

function permissionRequestFrom(collector: MessageCollector, agentId: string) {
  const message = collector.messages.find(
    (candidate) =>
      candidate.type === "agent_permission_request" && candidate.payload.agentId === agentId,
  );
  return message?.type === "agent_permission_request" ? message.payload.request : undefined;
}

function snapshotWithItemCount(collector: MessageCollector, agentId: string, count: number) {
  return queueEvents(collector, agentId).find((snapshot) => snapshot.items.length === count);
}

function snapshotAtOrPastRevision(
  collector: MessageCollector,
  agentId: string,
  revision: number,
  itemCount: number,
) {
  return queueEvents(collector, agentId).find(
    (snapshot) => snapshot.revision >= revision && snapshot.items.length === itemCount,
  );
}

function snapshotWithItemOrder(
  collector: MessageCollector,
  agentId: string,
  revision: number,
  itemIds: string[],
) {
  const expected = itemIds.join(",");
  return queueEvents(collector, agentId).find(
    (snapshot) =>
      snapshot.revision >= revision && snapshot.items.map((item) => item.id).join(",") === expected,
  );
}

async function waitForEmptyQueue(
  collector: MessageCollector,
  agentId: string,
  afterRevision: number,
): Promise<AgentQueueSnapshot> {
  return await waitFor(
    () =>
      queueEvents(collector, agentId).find(
        (snapshot) => snapshot.items.length === 0 && snapshot.revision > afterRevision,
      ),
    `an empty queue snapshot for ${agentId} past revision ${afterRevision}`,
  );
}

describe("agent queue mirroring e2e", () => {
  let ctx: DaemonTestContext;
  let clientB: DaemonClient;
  let collectorA: MessageCollector;
  let collectorB: MessageCollector;
  let feedsA: ReturnType<DaemonClient["observeEvents"]>;
  let feedsB: ReturnType<DaemonClient["observeEvents"]>;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    clientB = new DaemonClient({
      url: `ws://127.0.0.1:${ctx.daemon.port}/ws`,
      appVersion: "0.1.70",
    });
    await clientB.connect();
    await clientB.fetchAgents({ subscribe: {} });
    collectorA = createMessageCollector(ctx.client);
    collectorB = createMessageCollector(clientB);
    // Subscribable events: permission requests park the fake turn, and queue
    // snapshots broadcast to subscribed capable clients — the app's session
    // context subscribes to exactly these two feeds.
    feedsA = ctx.client.observeEvents(["agent_permission_request", "agent.queue.update"], {
      notifications: true,
    });
    feedsB = clientB.observeEvents(["agent_permission_request", "agent.queue.update"], {
      notifications: true,
    });
    await Promise.all([feedsA.ready, feedsB.ready]);
  });

  afterEach(async () => {
    await Promise.all([feedsA.release(), feedsB.release()]);
    collectorA.unsubscribe();
    collectorB.unsubscribe();
    await ctx.cleanup();
  }, 60000);

  test("mirrors enqueue, update, reorder and delete between two clients and drains to one canonical row", async () => {
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd: "/tmp",
      title: "Queue mirroring",
    });

    // Park the turn on a permission request so the queue item stays pending.
    await ctx.client.sendMessage(agent.id, 'printf "ok" > permission.txt');
    const permissionRequest = await waitFor(
      () => permissionRequestFrom(collectorA, agent.id),
      "the fake permission request",
    );

    // Client B admits a prompt into the daemon queue while the agent is busy.
    const enqueued = await clientB.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    expect(enqueued.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(enqueued.items[0]?.deliveryState).toBe("pending");

    // Client A, which never sent anything, sees the same queue.
    const mirrored = await waitFor(
      () => snapshotAtOrPastRevision(collectorA, agent.id, enqueued.revision, 1),
      "client A to mirror the enqueue",
    );
    expect(mirrored.items[0]?.text).toBe("first");

    // Client B edits the item in place; both devices converge on the new text.
    const updated = await clientB.updateQueuedAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "first (edited)",
      expectedRevision: mirrored.revision,
    });
    expect(updated.items[0]?.text).toBe("first (edited)");

    // A second item from client A, then a reorder from client B.
    await ctx.client.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });
    const withTwo = await waitFor(
      () => snapshotWithItemCount(collectorB, agent.id, 2),
      "client B to mirror the second item",
    );
    const reordered = await clientB.reorderQueuedAgentMessages(
      agent.id,
      ["item-2", "item-1"],
      withTwo.revision,
    );
    expect(reordered.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);

    const mirroredOrder = await waitFor(
      () => snapshotWithItemOrder(collectorA, agent.id, reordered.revision, ["item-2", "item-1"]),
      "client A to mirror the reorder",
    );

    // A reconnecting client reads the same durable queue, then stays connected
    // so the drain below can be observed on a client that never queued anything.
    await ctx.client.close();
    const reconnected = new DaemonClient({
      url: `ws://127.0.0.1:${ctx.daemon.port}/ws`,
      appVersion: "0.1.70",
    });
    let reconnectedCollector: MessageCollector | null = null;
    try {
      await reconnected.connect();
      await reconnected.fetchAgents({ subscribe: {} });
      const reconnectedFeeds = reconnected.observeEvents(
        ["agent_permission_request", "agent.queue.update"],
        { notifications: true },
      );
      await reconnectedFeeds.ready;
      reconnectedCollector = createMessageCollector(reconnected);
      const listed = await reconnected.listQueuedAgentMessages(agent.id);
      expect(listed.items.map((item) => item.id)).toEqual(["item-2", "item-1"]);
      expect(listed.items[1]?.text).toBe("first (edited)");

      // Discard the second item; the first drains when the parked turn ends.
      const afterDelete = await clientB.deleteQueuedAgentMessage(
        agent.id,
        "item-2",
        mirroredOrder.revision,
      );
      expect(afterDelete.items.map((item) => item.id)).toEqual(["item-1"]);

      clientB.respondToPermission(agent.id, permissionRequest.id, {
        behavior: "allow",
      });
      await clientB.waitForFinish(agent.id, 60000);

      // The delivered item is gone from the queue on both live clients.
      await waitForEmptyQueue(collectorB, agent.id, afterDelete.revision);
      const drainedElsewhere = await waitForEmptyQueue(
        reconnectedCollector,
        agent.id,
        afterDelete.revision,
      );
      expect(drainedElsewhere.items).toEqual([]);

      // Delivery created exactly one canonical user row, carrying the edited
      // text — not the original admission, and not a duplicate per device.
      const timeline = await reconnected.fetchAgentTimeline(agent.id, {
        projection: "canonical",
      });
      const userRows = timeline.entries.filter(
        (entry) => entry.item.type === "user_message" && entry.item.text.includes("(edited)"),
      );
      expect(userRows).toHaveLength(1);
    } finally {
      reconnectedCollector?.unsubscribe();
      await reconnected.close();
    }
  }, 120000);

  test("rejects a stale revision with queue_revision_conflict instead of overwriting", async () => {
    const agent = await ctx.client.createAgent({
      provider: "codex",
      model: CODEX_TEST_MODEL,
      thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
      cwd: "/tmp",
      title: "Queue conflicts",
    });

    await ctx.client.sendMessage(agent.id, 'printf "ok" > permission.txt');
    await waitFor(() => permissionRequestFrom(collectorA, agent.id), "the fake permission request");

    const enqueued = await clientB.enqueueAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "original",
      intent: "queue",
    });

    // Client A mutates first; client B's write still carries the older revision.
    await ctx.client.updateQueuedAgentMessage({
      agentId: agent.id,
      itemId: "item-1",
      text: "edited elsewhere",
      expectedRevision: enqueued.revision,
    });

    await expect(
      clientB.updateQueuedAgentMessage({
        agentId: agent.id,
        itemId: "item-1",
        text: "stale overwrite",
        expectedRevision: enqueued.revision,
      }),
    ).rejects.toThrow("queue_revision_conflict");

    const listed = await clientB.listQueuedAgentMessages(agent.id);
    expect(listed.items[0]?.text).toBe("edited elsewhere");
  }, 120000);
});
