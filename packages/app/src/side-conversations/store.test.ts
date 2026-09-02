import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  refreshSideConversations,
  sideConversationKey,
  sideConversationTitle,
  useSideConversationStore,
  type SideConversationRecord,
} from "./store";

function record(
  parentAgentId: string,
  threadId: string,
  question = "What changed?",
): SideConversationRecord {
  return {
    parentAgentId,
    threadId,
    items: [{ type: "user_message", text: question }],
    pendingQuestion: null,
    lastAnswer: null,
  };
}

function threadIds(serverId: string, parentAgentId: string): string[] {
  const prefix = `${serverId}\0${parentAgentId}\0`;
  return [...useSideConversationStore.getState().records]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value.threadId);
}

describe("side conversation store", () => {
  beforeEach(() => useSideConversationStore.setState({ records: new Map() }));

  it("isolates snapshots by server, parent, and thread", () => {
    const snapshot = {
      parentAgentId: "parent",
      threadId: "thread",
      items: [{ type: "user_message" as const, text: "What changed?" }],
      pendingQuestion: "What changed?",
      lastAnswer: null,
    };

    useSideConversationStore.getState().applySnapshot("server-a", snapshot);
    useSideConversationStore.getState().applySnapshot("server-b", snapshot);

    expect(useSideConversationStore.getState().records).toHaveLength(2);
    expect(
      useSideConversationStore
        .getState()
        .records.get(sideConversationKey("server-a", "parent", "thread")),
    ).toEqual(snapshot);
  });

  it("uses the first question as the title", () => {
    expect(
      sideConversationTitle({
        parentAgentId: "parent",
        threadId: "thread",
        items: [
          { type: "user_message", text: "First question" },
          { type: "assistant_message", text: "First answer" },
          { type: "user_message", text: "Follow-up" },
        ],
        pendingQuestion: null,
        lastAnswer: null,
      }),
    ).toBe("First question");
  });

  it("removes one thread and leaves its siblings and other servers alone", () => {
    const store = useSideConversationStore.getState();
    store.applySnapshot("server-a", record("parent", "thread-1"));
    store.applySnapshot("server-a", record("parent", "thread-2"));
    store.applySnapshot("server-b", record("parent", "thread-1"));

    store.remove("server-a", "parent", "thread-1");

    expect(threadIds("server-a", "parent")).toEqual(["thread-2"]);
    expect(threadIds("server-b", "parent")).toEqual(["thread-1"]);
  });

  it("keeps the same records object when the removed thread was never held", () => {
    const store = useSideConversationStore.getState();
    store.applySnapshot("server-a", record("parent", "thread-1"));
    const before = useSideConversationStore.getState().records;

    store.remove("server-a", "parent", "missing");

    expect(useSideConversationStore.getState().records).toBe(before);
  });

  it("clears every thread a parent owns without touching other parents", () => {
    const store = useSideConversationStore.getState();
    store.applySnapshot("server-a", record("parent", "thread-1"));
    store.applySnapshot("server-a", record("parent", "thread-2"));
    store.applySnapshot("server-a", record("other-parent", "thread-3"));

    store.clearParent("server-a", "parent");

    expect(threadIds("server-a", "parent")).toEqual([]);
    expect(threadIds("server-a", "other-parent")).toEqual(["thread-3"]);
  });

  it("replaces a parent's threads with the daemon's list", () => {
    const store = useSideConversationStore.getState();
    store.applySnapshot("server-a", record("parent", "stale"));
    store.applySnapshot("server-a", record("parent", "kept", "Old question"));
    store.applySnapshot("server-a", record("other-parent", "untouched"));

    store.replaceList("server-a", "parent", [
      record("parent", "kept", "New question"),
      record("parent", "fresh"),
    ]);

    expect(threadIds("server-a", "parent")).toEqual(["kept", "fresh"]);
    expect(threadIds("server-a", "other-parent")).toEqual(["untouched"]);
    expect(
      useSideConversationStore
        .getState()
        .records.get(sideConversationKey("server-a", "parent", "kept"))?.items,
    ).toEqual([{ type: "user_message", text: "New question" }]);
  });

  it("hydrates a parent from one list request and shares an in-flight one", async () => {
    const listSideConversations = vi.fn().mockResolvedValue({
      requestId: "req-1",
      parentAgentId: "parent",
      threads: [record("parent", "thread-1")],
      error: null,
    });
    const client = { listSideConversations } as unknown as DaemonClient;

    await Promise.all([
      refreshSideConversations(client, "server-a", "parent"),
      refreshSideConversations(client, "server-a", "parent"),
    ]);

    expect(listSideConversations).toHaveBeenCalledTimes(1);
    expect(threadIds("server-a", "parent")).toEqual(["thread-1"]);

    await refreshSideConversations(client, "server-a", "parent");
    expect(listSideConversations).toHaveBeenCalledTimes(2);
  });
});
