import { describe, expect, it } from "vitest";
import { sideConversationKey, type SideConversationRecord } from "@/side-conversations/store";
import {
  buildSendBackText,
  collectThreadReplies,
  findThreadAnchorMessageId,
  latestAssistantReply,
  threadAnchorKey,
} from "./model";

function conversation(
  parentAgentId: string,
  threadId: string,
  question: string,
  answer?: string,
): SideConversationRecord {
  return {
    parentAgentId,
    threadId,
    items: [
      { type: "user_message", text: question },
      ...(answer ? [{ type: "assistant_message" as const, text: answer }] : []),
    ],
    pendingQuestion: null,
    lastAnswer: answer
      ? { status: "answered", content: answer, synthetic: false, threading: "single_shot" }
      : null,
  };
}

describe("threaded side-conversation model", () => {
  it("anchors by stable message id and falls back to epoch and sequence", () => {
    expect(
      threadAnchorKey({
        boundaryMessageId: " message-1 ",
        boundaryCursor: { epoch: "epoch-1", seq: 7 },
      }),
    ).toBe("message-1");
    expect(threadAnchorKey({ boundaryCursor: { epoch: "epoch-1", seq: 7 } })).toBe(
      "cursor:epoch-1:7",
    );
    expect(threadAnchorKey({})).toBeNull();
  });

  it("finds only retained assistant anchors and reports removed anchors as unavailable", () => {
    const items = [
      {
        id: "assistant-row",
        kind: "assistant_message",
        messageId: "message-1",
        text: "answer",
        timelineCursor: { epoch: "epoch-1", seq: 9 },
      },
      {
        id: "user-row",
        kind: "user_message",
        messageId: "user-1",
        text: "question",
        timelineCursor: { epoch: "epoch-1", seq: 8 },
      },
    ] as unknown as import("@/types/stream").StreamItem[];

    expect(findThreadAnchorMessageId(items, "message-1")).toBe("message-1");
    expect(findThreadAnchorMessageId(items, "cursor:epoch-1:9")).toBe("message-1");
    expect(findThreadAnchorMessageId(items, "message-removed")).toBeNull();
    expect(findThreadAnchorMessageId(items, "cursor:old-epoch:9")).toBeNull();
  });

  it("collects only conversations with matching persisted origins", () => {
    const conversations = new Map([
      [
        sideConversationKey("host-a", "parent-a", "thread-a"),
        conversation("parent-a", "thread-a", "First question"),
      ],
      [
        sideConversationKey("host-a", "parent-a", "thread-b"),
        conversation("parent-a", "thread-b", "Second question"),
      ],
      [
        sideConversationKey("host-b", "parent-a", "thread-a"),
        conversation("parent-a", "thread-a", "Other host"),
      ],
      [
        sideConversationKey("host-a", "parent-b", "thread-c"),
        conversation("parent-b", "thread-c", "Other parent"),
      ],
    ]);
    const origins = {
      [sideConversationKey("host-a", "parent-a", "thread-a")]: {
        parentAgentId: "parent-a",
        anchor: "message-1",
      },
      [sideConversationKey("host-a", "parent-a", "thread-b")]: {
        parentAgentId: "parent-a",
        anchor: "message-1",
      },
      [sideConversationKey("host-a", "parent-b", "thread-c")]: {
        parentAgentId: "parent-b",
        anchor: "message-1",
      },
    };

    const replies = collectThreadReplies({
      conversations,
      origins,
      serverId: "host-a",
      parentAgentId: "parent-a",
    });

    expect(replies.get("message-1")?.map((reply) => reply.threadId)).toEqual([
      "thread-a",
      "thread-b",
    ]);
    expect(replies.has("message-2")).toBe(false);
    expect(replies.get("message-2")).toBeUndefined();
    expect(replies.get("message-1")?.some((reply) => reply.title === "Other host")).toBe(false);
  });

  it("returns only a completed latest assistant answer for queueing", () => {
    expect(latestAssistantReply(conversation("parent", "thread", "Q", "A"))).toBe("A");
    expect(
      latestAssistantReply({
        ...conversation("parent", "thread", "Q", "A"),
        pendingQuestion: "Follow-up",
      }),
    ).toBeNull();
    expect(latestAssistantReply(conversation("parent", "thread", "Q"))).toBeNull();
  });

  it("quotes the answer with a bounded thread reference", () => {
    expect(
      buildSendBackText({ threadTitle: "Why?", threadId: "thread-1", reply: "One\n\nTwo" }),
    ).toBe('From the side conversation "Why?" (Paseo thread thread-1):\n\n> One\n>\n> Two');
    expect(
      buildSendBackText({
        threadTitle: "Why?",
        threadId: "thread-1",
        reply: "a".repeat(2500),
      }).length,
    ).toBeLessThan(2200);
  });
});
