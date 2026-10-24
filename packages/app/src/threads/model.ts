import { sideConversationKey, type SideConversationRecord } from "@/side-conversations/store";
import type { StreamItem, TimelinePosition } from "@/types/stream";

/** The parent and exact assistant reply a side conversation was opened from. */
export interface ThreadOrigin {
  parentAgentId: string;
  anchor: string;
}

export type ThreadAnchor =
  | { kind: "message"; messageId: string }
  | { kind: "cursor"; epoch: string; seq: number };

export function parseThreadAnchor(anchor: string): ThreadAnchor | null {
  if (anchor.startsWith("cursor:")) {
    const parts = anchor.slice("cursor:".length).split(":");
    const seqText = parts.pop();
    const epoch = parts.join(":");
    const seq = Number(seqText);
    return epoch && Number.isSafeInteger(seq) && seq >= 0 ? { kind: "cursor", epoch, seq } : null;
  }
  return anchor.trim() ? { kind: "message", messageId: anchor.trim() } : null;
}

/** A reply's stable key, using its retained message id or its timeline position. */
export function threadAnchorKey(boundary: {
  boundaryMessageId?: string;
  boundaryCursor?: TimelinePosition;
}): string | null {
  if (boundary.boundaryMessageId?.trim()) return boundary.boundaryMessageId.trim();
  if (boundary.boundaryCursor) {
    return `cursor:${boundary.boundaryCursor.epoch}:${boundary.boundaryCursor.seq}`;
  }
  return null;
}

export function findThreadAnchorMessageId(
  items: readonly StreamItem[],
  anchor: string,
): string | null {
  const parsed = parseThreadAnchor(anchor);
  if (!parsed) return null;
  const item = items.find((candidate) => {
    if (candidate.kind !== "assistant_message") return false;
    if (parsed.kind === "message") {
      return candidate.messageId === parsed.messageId || candidate.id === parsed.messageId;
    }
    return (
      candidate.timelineCursor?.epoch === parsed.epoch &&
      candidate.timelineCursor.seq === parsed.seq
    );
  });
  return item?.kind === "assistant_message" ? (item.messageId ?? item.id) : null;
}

export interface ThreadReply {
  threadId: string;
  title: string;
}

export type ThreadRepliesByAnchor = ReadonlyMap<string, readonly ThreadReply[]>;

export const NO_THREAD_REPLIES: ThreadRepliesByAnchor = new Map();

/**
 * Side conversation origins are app presentation metadata. They keep the existing
 * side-conversation parent/thread identity and never change daemon agent parentage.
 */
export function collectThreadReplies(input: {
  conversations: ReadonlyMap<string, SideConversationRecord>;
  origins: Readonly<Record<string, ThreadOrigin>>;
  serverId: string;
  parentAgentId: string;
}): ThreadRepliesByAnchor {
  const byAnchor = new Map<string, ThreadReply[]>();
  for (const [key, conversation] of input.conversations) {
    if (key !== sideConversationKey(input.serverId, input.parentAgentId, conversation.threadId))
      continue;
    if (conversation.parentAgentId !== input.parentAgentId) continue;
    const origin = input.origins[key];
    if (!origin || origin.parentAgentId !== input.parentAgentId) continue;
    const firstQuestion = conversation.items.find((item) => item.type === "user_message");
    if (!firstQuestion || firstQuestion.type !== "user_message") continue;
    const reply: ThreadReply = {
      threadId: conversation.threadId,
      title: firstQuestion.text.trim() || conversation.threadId.slice(0, 8),
    };
    const replies = byAnchor.get(origin.anchor);
    if (replies) replies.push(reply);
    else byAnchor.set(origin.anchor, [reply]);
  }
  if (byAnchor.size === 0) return NO_THREAD_REPLIES;
  for (const replies of byAnchor.values()) {
    replies.sort((left, right) => left.threadId.localeCompare(right.threadId));
  }
  return byAnchor;
}

/** The latest completed assistant answer, if the side conversation has one. */
export function latestAssistantReply(
  record: SideConversationRecord | null | undefined,
): string | null {
  if (!record || record.pendingQuestion) return null;
  for (let index = record.items.length - 1; index >= 0; index -= 1) {
    const item = record.items[index];
    if (item?.type === "assistant_message" && item.text.trim()) return item.text.trim();
  }
  return null;
}

export const SEND_BACK_MAX_CHARS = 2000;

export function buildSendBackText(input: {
  threadTitle: string;
  threadId: string;
  reply: string;
}): string {
  const trimmed = input.reply.trim();
  const clipped =
    trimmed.length > SEND_BACK_MAX_CHARS
      ? `${trimmed.slice(0, SEND_BACK_MAX_CHARS).trimEnd()}…`
      : trimmed;
  const quoted = clipped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return [
    `From the side conversation "${input.threadTitle}" (Paseo thread ${input.threadId}):`,
    "",
    quoted,
  ].join("\n");
}
