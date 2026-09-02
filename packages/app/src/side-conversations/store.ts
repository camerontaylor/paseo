import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { create } from "zustand";

export type SideConversationRecord = Extract<
  SessionOutboundMessage,
  { type: "agent.side_conversation.update" }
>["payload"];

interface SideConversationState {
  records: Map<string, SideConversationRecord>;
  applySnapshot(serverId: string, record: SideConversationRecord): void;
  /**
   * One list response owns everything the daemon still holds for that parent, so threads it
   * dropped while this client was away disappear with the same call that hydrates the rest.
   */
  replaceList(
    serverId: string,
    parentAgentId: string,
    threads: readonly SideConversationRecord[],
  ): void;
  remove(serverId: string, parentAgentId: string, threadId: string): void;
}

export function sideConversationKey(
  serverId: string,
  parentAgentId: string,
  threadId: string,
): string {
  return `${serverId}\0${parentAgentId}\0${threadId}`;
}

export function sideConversationParentPrefix(serverId: string, parentAgentId: string): string {
  return `${serverId}\0${parentAgentId}\0`;
}

export function sideConversationTitle(record: SideConversationRecord): string {
  const firstQuestion = record.items.find((item) => item.type === "user_message");
  return firstQuestion?.type === "user_message" ? firstQuestion.text : "";
}

type SideConversationClient = Pick<DaemonClient, "fetchSideConversationTimeline">;
type SideConversationListClient = Pick<DaemonClient, "listSideConversations">;

export async function refreshSideConversation(
  client: SideConversationClient,
  serverId: string,
  parentAgentId: string,
  threadId: string,
): Promise<void> {
  const snapshot = await client.fetchSideConversationTimeline(parentAgentId, threadId);
  useSideConversationStore.getState().applySnapshot(serverId, snapshot);
}

const pendingListRequests = new WeakMap<SideConversationListClient, Map<string, Promise<void>>>();

export function refreshSideConversations(
  client: SideConversationListClient,
  serverId: string,
  parentAgentId: string,
): Promise<void> {
  const requestKey = `${serverId}\0${parentAgentId}`;
  let clientRequests = pendingListRequests.get(client);
  if (!clientRequests) {
    clientRequests = new Map();
    pendingListRequests.set(client, clientRequests);
  }
  const pending = clientRequests.get(requestKey);
  if (pending) return pending;

  const request = client
    .listSideConversations(parentAgentId)
    .then((payload) => {
      useSideConversationStore.getState().replaceList(serverId, parentAgentId, payload.threads);
      return undefined;
    })
    .finally(() => {
      clientRequests?.delete(requestKey);
    });
  clientRequests.set(requestKey, request);
  return request;
}

export const useSideConversationStore = create<SideConversationState>((set) => ({
  records: new Map(),
  applySnapshot(serverId, record) {
    set((state) => {
      const records = new Map(state.records);
      records.set(sideConversationKey(serverId, record.parentAgentId, record.threadId), record);
      return { records };
    });
  },
  replaceList(serverId, parentAgentId, threads) {
    set((state) => {
      const prefix = sideConversationParentPrefix(serverId, parentAgentId);
      const records = new Map([...state.records].filter(([key]) => !key.startsWith(prefix)));
      for (const thread of threads) {
        records.set(sideConversationKey(serverId, parentAgentId, thread.threadId), thread);
      }
      return { records };
    });
  },
  remove(serverId, parentAgentId, threadId) {
    set((state) => {
      const key = sideConversationKey(serverId, parentAgentId, threadId);
      if (!state.records.has(key)) return state;
      const records = new Map(state.records);
      records.delete(key);
      return { records };
    });
  },
}));
