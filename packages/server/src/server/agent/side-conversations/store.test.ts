import { describe, expect, it } from "vitest";
import { SideConversationStore } from "./store.js";

describe("SideConversationStore", () => {
  it("isolates threads and appends answered exchanges", () => {
    const store = new SideConversationStore();
    store.begin("parent", "one", "first?");
    store.complete("parent", "one", {
      status: "answered",
      content: "first",
      synthetic: false,
      threading: "threaded",
    });
    store.begin("parent", "two", "other?");
    expect(store.history("parent", "one")).toEqual([{ question: "first?", answer: "first" }]);
    expect(store.history("parent", "two")).toEqual([]);
    expect(store.timeline("parent", "one")).toEqual([
      { type: "user_message", text: "first?" },
      { type: "assistant_message", text: "first" },
    ]);
  });

  it("deletes every thread for a parent only, and reports what it removed", () => {
    const store = new SideConversationStore();
    store.begin("parent", "one", "one?");
    store.begin("parent", "two", "two?");
    store.begin("other", "one", "other?");
    expect(store.deleteParent("parent")).toEqual([
      { type: "remove", parentAgentId: "parent", threadId: "one" },
      { type: "remove", parentAgentId: "parent", threadId: "two" },
    ]);
    expect(store.get("parent", "one")).toBeNull();
    expect(store.get("parent", "two")).toBeNull();
    expect(store.get("other", "one")?.pendingQuestion).toBe("other?");
    expect(store.deleteParent("parent")).toEqual([]);
  });

  it("lists only the threads belonging to a parent", () => {
    const store = new SideConversationStore();
    store.begin("parent", "one", "one?");
    store.begin("parent", "two", "two?");
    store.begin("other", "one", "other?");
    expect(store.list("parent").map((record) => record.threadId)).toEqual(["one", "two"]);
    expect(store.list("nobody")).toEqual([]);
  });

  it("returns null instead of throwing when there is nothing to complete", () => {
    const store = new SideConversationStore();
    const answer = {
      status: "answered" as const,
      content: "late",
      synthetic: false,
      threading: "threaded" as const,
    };

    expect(store.complete("parent", "missing", answer)).toBeNull();

    store.begin("parent", "one", "one?");
    store.deleteParent("parent");
    expect(store.complete("parent", "one", answer)).toBeNull();
    expect(store.get("parent", "one")).toBeNull();

    store.begin("parent", "two", "two?");
    expect(store.complete("parent", "two", answer)?.lastAnswer).toEqual(answer);
    expect(store.complete("parent", "two", answer)).toBeNull();
    expect(store.timeline("parent", "two")).toEqual([
      { type: "user_message", text: "two?" },
      { type: "assistant_message", text: "late" },
    ]);
  });

  it("shows synthetic answers without reusing them as provider history", () => {
    const store = new SideConversationStore();
    store.begin("parent", "thread", "question?");
    store.complete("parent", "thread", {
      status: "answered",
      content: "degraded answer",
      synthetic: true,
      threading: "single_shot",
    });

    expect(store.timeline("parent", "thread")).toEqual([
      { type: "user_message", text: "question?" },
      { type: "assistant_message", text: "degraded answer" },
    ]);
    expect(store.history("parent", "thread")).toEqual([]);
  });
});
