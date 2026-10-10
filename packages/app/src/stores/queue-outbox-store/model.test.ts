import { describe, expect, test } from "vitest";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import {
  flushQueueOutbox,
  QUEUE_OUTBOX_MAX_ATTEMPTS,
  type PendingQueueEnqueue,
  type QueueOutboxAccess,
} from "./model";

function pendingEntry(overrides: Partial<PendingQueueEnqueue> = {}): PendingQueueEnqueue {
  return {
    serverId: "server-1",
    agentId: "agent-1",
    itemId: "item-1",
    text: "hello",
    intent: "queue",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

function snapshotWith(...itemIds: string[]): AgentQueueSnapshot {
  return {
    agentId: "agent-1",
    revision: 1,
    items: itemIds.map((id) => ({
      id,
      text: "hello",
      intent: "queue",
      deliveryState: "pending",
      attempts: 0,
      createdAt: "2026-01-01T00:00:00Z",
    })),
  };
}

interface Harness {
  outbox: QueueOutboxAccess;
  entries: Map<string, PendingQueueEnqueue>;
  bumped: string[];
  markedFailed: string[];
}

function createOutbox(initial: PendingQueueEnqueue[]): Harness {
  const entries = new Map(initial.map((entry) => [entry.itemId, entry]));
  const bumped: string[] = [];
  const markedFailed: string[] = [];
  return {
    entries,
    bumped,
    markedFailed,
    outbox: {
      list: (serverId) =>
        [...entries.values()]
          .filter((entry) => entry.serverId === serverId)
          .sort((a, b) => a.createdAt - b.createdAt),
      remove: (itemId) => {
        entries.delete(itemId);
      },
      bumpAttempts: (itemId) => {
        bumped.push(itemId);
        const entry = entries.get(itemId);
        if (entry) {
          entries.set(itemId, { ...entry, attempts: entry.attempts + 1 });
        }
      },
      markFailed: (itemId) => {
        markedFailed.push(itemId);
        const entry = entries.get(itemId);
        if (entry) {
          entries.set(itemId, { ...entry, failedAt: 1 });
        }
      },
    },
  };
}

describe("flushQueueOutbox", () => {
  test("re-sends entries oldest first and clears them on ack", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "item-2", createdAt: 2 }),
      pendingEntry({ itemId: "item-1", createdAt: 1 }),
    ]);
    const sent: string[] = [];
    const applied: AgentQueueSnapshot[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: (snapshot) => applied.push(snapshot),
    });

    expect(sent).toEqual(["item-1", "item-2"]);
    expect(harness.entries.size).toBe(0);
    expect(applied).toHaveLength(2);
  });

  test("only flushes entries for the requested server", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "item-1", serverId: "server-1" }),
      pendingEntry({ itemId: "item-2", serverId: "server-2" }),
    ]);
    const sent: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(sent).toEqual(["item-1"]);
    expect([...harness.entries.keys()]).toEqual(["item-2"]);
  });

  test("re-sends the entry verbatim, including its admission intent", async () => {
    const harness = createOutbox([pendingEntry({ intent: "steer_strict" })]);
    const sent: Array<{ itemId: string; intent: string; text: string }> = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push({ itemId: input.itemId, intent: input.intent, text: input.text });
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(sent).toEqual([{ itemId: "item-1", intent: "steer_strict", text: "hello" }]);
  });

  test("a failed send keeps the entry and bumps its attempt count", async () => {
    const harness = createOutbox([pendingEntry()]);

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async () => {
          throw new Error("transport not connected");
        },
      },
      applySnapshot: () => {},
    });

    expect(harness.bumped).toEqual(["item-1"]);
    expect(harness.entries.get("item-1")?.attempts).toBe(1);
  });

  test("an entry that exhausts its attempts stays visible as failed and is reported", async () => {
    const harness = createOutbox([pendingEntry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 })]);
    const exhausted: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async () => {
          throw new Error("still broken");
        },
      },
      applySnapshot: () => {},
      onEntryExhausted: (entry) => exhausted.push(entry.itemId),
    });

    // An undelivered prompt is never dropped silently: the entry stays with its
    // full payload until an explicit retry or discard.
    expect(harness.entries.size).toBe(1);
    expect(harness.entries.get("item-1")?.failedAt).toBeDefined();
    expect(exhausted).toEqual(["item-1"]);
  });

  test("a failed entry is not re-flushed by later flushes", async () => {
    const harness = createOutbox([
      pendingEntry({ failedAt: 1, attempts: QUEUE_OUTBOX_MAX_ATTEMPTS }),
    ]);
    const sent: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: {
        ...harness.outbox,
        list: (serverId) =>
          harness.outbox.list(serverId).filter((entry) => entry.failedAt === undefined),
      },
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          return snapshotWith(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(sent).toEqual([]);
    expect(harness.entries.size).toBe(1);
  });

  test("an entry that succeeds on a later flush is removed", async () => {
    const harness = createOutbox([pendingEntry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 2 })]);
    let calls = 0;
    const flush = () =>
      flushQueueOutbox({
        serverId: "server-1",
        outbox: harness.outbox,
        client: {
          enqueueAgentMessage: async (input) => {
            calls += 1;
            if (calls === 1) {
              throw new Error("transient");
            }
            return snapshotWith(input.itemId);
          },
        },
        applySnapshot: () => {},
      });

    await flush();
    expect(harness.entries.get("item-1")?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS - 1);

    await flush();
    expect(harness.entries.size).toBe(0);
  });
});

describe("flushQueueOutbox per-agent lanes", () => {
  function laneSnapshot(itemId: string): AgentQueueSnapshot {
    return {
      agentId: "agent-1",
      revision: 1,
      items: [
        {
          id: itemId,
          text: "hello",
          intent: "queue",
          deliveryState: "pending",
          attempts: 0,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
  }

  test("a failed send blocks later items for that agent only — another agent still flushes", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "blocked-1", agentId: "agent-a", createdAt: 1 }),
      pendingEntry({ itemId: "blocked-2", agentId: "agent-a", createdAt: 2 }),
      pendingEntry({ itemId: "other-1", agentId: "agent-b", createdAt: 3 }),
    ]);
    const sent: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          if (input.itemId === "blocked-1") throw new Error("agent-a transport down");
          return laneSnapshot(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    // agent-a's lane stops at the failed predecessor; agent-b's lane advances.
    expect(sent.sort()).toEqual(["blocked-1", "other-1"]);
    expect(harness.entries.has("blocked-2")).toBe(true);
    expect(harness.entries.has("other-1")).toBe(false);
  });

  test("an entry removed mid-flush is not sent", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "gone" }),
      pendingEntry({ itemId: "stays", createdAt: 2 }),
    ]);
    const sent: string[] = [];
    const client = {
      enqueueAgentMessage: async (input: { itemId: string }) => {
        sent.push(input.itemId);
        if (input.itemId === "gone") {
          // A racing acknowledgement removes the entry while its lane runs.
          harness.entries.delete("gone");
          harness.entries.delete("stays");
        }
        return laneSnapshot(input.itemId);
      },
    };

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client,
      applySnapshot: () => {},
    });

    expect(sent).toEqual(["gone"]);
  });

  test("a parked entry is skipped by a lane that listed it earlier", async () => {
    const harness = createOutbox([
      pendingEntry({ itemId: "first", createdAt: 1 }),
      pendingEntry({ itemId: "second", createdAt: 2 }),
    ]);
    const sent: string[] = [];

    await flushQueueOutbox({
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async (input) => {
          sent.push(input.itemId);
          if (input.itemId === "first") {
            // The predecessor exhausts its retries and parks mid-flight.
            harness.entries.set("first", {
              ...harness.entries.get("first")!,
              failedAt: 1,
              attempts: QUEUE_OUTBOX_MAX_ATTEMPTS,
            });
            throw new Error("transport down");
          }
          return laneSnapshot(input.itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(sent).toEqual(["first"]);
    expect(harness.entries.get("second")?.failedAt).toBeUndefined();
  });

  test("concurrent flushes park exactly once", async () => {
    const harness = createOutbox([pendingEntry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 })]);
    const exhausted: string[] = [];
    const input = {
      serverId: "server-1",
      outbox: harness.outbox,
      client: {
        enqueueAgentMessage: async () => {
          throw new Error("still broken");
        },
      },
      applySnapshot: () => {},
      onEntryExhausted: (failed: PendingQueueEnqueue) => exhausted.push(failed.itemId),
    };

    await Promise.all([flushQueueOutbox(input), flushQueueOutbox(input)]);

    expect(exhausted).toEqual(["item-1"]);
  });
});
