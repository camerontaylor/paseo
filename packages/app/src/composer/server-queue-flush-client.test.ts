import { afterEach, describe, expect, it } from "vitest";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createServerQueueFlushClient } from "./server-queue-flush-client";
import { useSessionStore } from "@/stores/session-store";

const agentId = "agent-1";

function snapshotWith(itemId: string, revision: number): AgentQueueSnapshot {
  return {
    agentId,
    revision,
    items: [
      {
        id: itemId,
        text: "hello",
        intent: "queue",
        deliveryState: "pending",
        attempts: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function initializeTestSession(): void {
  useSessionStore.getState().initializeSession("test-server", null as unknown as DaemonClient);
}

afterEach(() => {
  useSessionStore.getState().clearSession("test-server");
});

describe("createServerQueueFlushClient", () => {
  it("resolves each dispatched agent's revision from the session store", async () => {
    initializeTestSession();
    useSessionStore.getState().applyAgentQueueSnapshot("test-server", {
      ...snapshotWith("item-1", 4),
      agentId: "agent-1",
    });
    useSessionStore.getState().applyAgentQueueSnapshot("test-server", {
      ...snapshotWith("item-2", 7),
      agentId: "agent-2",
    });

    const checked: Array<[string, number]> = [];
    const client = {
      enqueueAgentMessage: async () => snapshotWith("x", 1),
      updateQueuedAgentMessage: async () => snapshotWith("x", 1),
      reorderQueuedAgentMessages: async () => snapshotWith("x", 1),
      deleteQueuedAgentMessage: async (
        removedAgentId: string,
        _itemId: string,
        revision: number,
      ) => {
        checked.push([removedAgentId, revision]);
        return { agentId: removedAgentId, revision, items: [] };
      },
      retryQueuedAgentMessage: async () => snapshotWith("x", 1),
      listQueuedAgentMessages: async () => snapshotWith("x", 1),
      getQueuedAgentMessageImages: async () => [],
    };
    const adapter = createServerQueueFlushClient({ client, serverId: "test-server" });

    await adapter.removeQueuedAgentMessage!("agent-1", "item-1");
    await adapter.removeQueuedAgentMessage!("agent-2", "item-2");

    // agent-1's removal used agent-1's revision; agent-2's used agent-2's —
    // not the mounted agent's revision for both.
    expect(checked).toEqual([
      ["agent-1", 4],
      ["agent-2", 7],
    ]);
  });

  it("a conflict refreshes the DISPATCHED agent's queue, not the mounted one", async () => {
    initializeTestSession();
    const listed: string[] = [];
    const applied: string[] = [];
    const client = {
      enqueueAgentMessage: async () => snapshotWith("x", 1),
      updateQueuedAgentMessage: async () => snapshotWith("x", 1),
      reorderQueuedAgentMessages: async () => snapshotWith("x", 1),
      deleteQueuedAgentMessage: async () => {
        throw new Error("queue_revision_conflict");
      },
      retryQueuedAgentMessage: async () => snapshotWith("x", 1),
      listQueuedAgentMessages: async (listedAgentId: string) => {
        listed.push(listedAgentId);
        return { ...snapshotWith("item-9", 42), agentId: listedAgentId };
      },
      getQueuedAgentMessageImages: async () => [],
    };
    const adapter = createServerQueueFlushClient({ client, serverId: "test-server" });

    await expect(adapter.removeQueuedAgentMessage!("agent-2", "item-2")).rejects.toThrow(
      "queue_revision_conflict",
    );

    expect(listed).toEqual(["agent-2"]);
    expect(
      useSessionStore.getState().sessions["test-server"]?.queuedMessageRevisions.get("agent-2"),
    ).toBe(42);
    void applied;
  });
});
