import type {
  AgentTimelineItem,
  SideAnswer,
  SideConversationExchange,
} from "../agent-sdk-types.js";

export interface SideConversationRecord {
  parentAgentId: string;
  threadId: string;
  exchanges: SideConversationExchange[];
  items: AgentTimelineItem[];
  pendingQuestion: string | null;
  lastAnswer: SideAnswer | null;
}

export type SideConversationStoreEvent =
  | { type: "update"; record: SideConversationRecord }
  | { type: "remove"; parentAgentId: string; threadId: string };

function key(parentAgentId: string, threadId: string): string {
  return `${parentAgentId}\0${threadId}`;
}

export class SideConversationStore {
  private readonly records = new Map<string, SideConversationRecord>();

  begin(parentAgentId: string, threadId: string, question: string): SideConversationRecord {
    const existing = this.get(parentAgentId, threadId);
    const record: SideConversationRecord = {
      parentAgentId,
      threadId,
      exchanges: existing?.exchanges ?? [],
      items: [...(existing?.items ?? []), { type: "user_message", text: question }],
      pendingQuestion: question,
      lastAnswer: null,
    };
    this.records.set(key(parentAgentId, threadId), record);
    return record;
  }

  /**
   * Returns `null` when the record is gone or already completed. A parent can be wiped mid-flight
   * (reload, archive, history clear), so the answer arriving for a record that no longer exists is
   * a normal race, not an error — callers still have an answer to return to the asker.
   */
  complete(
    parentAgentId: string,
    threadId: string,
    answer: SideAnswer,
  ): SideConversationRecord | null {
    const record = this.records.get(key(parentAgentId, threadId));
    if (!record?.pendingQuestion) {
      return null;
    }
    const exchanges =
      answer.status === "answered" && !answer.synthetic
        ? [...record.exchanges, { question: record.pendingQuestion, answer: answer.content }]
        : record.exchanges;
    const items =
      answer.status === "answered"
        ? [...record.items, { type: "assistant_message" as const, text: answer.content }]
        : record.items;
    const completed = { ...record, exchanges, items, pendingQuestion: null, lastAnswer: answer };
    this.records.set(key(parentAgentId, threadId), completed);
    return completed;
  }

  get(parentAgentId: string, threadId: string): SideConversationRecord | null {
    return this.records.get(key(parentAgentId, threadId)) ?? null;
  }

  list(parentAgentId: string): SideConversationRecord[] {
    return [...this.records.values()].filter((record) => record.parentAgentId === parentAgentId);
  }

  history(parentAgentId: string, threadId: string): readonly SideConversationExchange[] {
    return this.get(parentAgentId, threadId)?.exchanges ?? [];
  }

  timeline(parentAgentId: string, threadId: string): AgentTimelineItem[] {
    return this.get(parentAgentId, threadId)?.items ?? [];
  }

  deleteParent(parentAgentId: string): SideConversationStoreEvent[] {
    const events: SideConversationStoreEvent[] = [];
    for (const record of this.list(parentAgentId)) {
      this.records.delete(key(parentAgentId, record.threadId));
      events.push({ type: "remove", parentAgentId, threadId: record.threadId });
    }
    return events;
  }
}
