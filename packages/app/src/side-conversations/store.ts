import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const SideConversationOriginSchema = z.strictObject({
  parentAgentId: z.string(),
  anchor: z.string(),
});
const SideConversationSendBackSchema = z.strictObject({
  answer: z.string(),
  itemId: z.string(),
  status: z.enum(["pending", "queued", "failed"]),
});
const PersistedOriginsSchema = z.strictObject({
  origins: z.record(z.string(), SideConversationOriginSchema),
  sendBacks: z.record(z.string(), SideConversationSendBackSchema).optional(),
});
const originStorage = createValidatedPersistStorage(AsyncStorage, PersistedOriginsSchema);
const originRemovalsDuringHydration = new Set<string>();

export interface SideConversationOrigin {
  parentAgentId: string;
  anchor: string;
}

export type SideConversationRecord = Extract<
  SessionOutboundMessage,
  { type: "agent.side_conversation.update" }
>["payload"];

interface SideConversationState {
  originsHydrated: boolean;
  records: Map<string, SideConversationRecord>;
  origins: Record<string, SideConversationOrigin>;
  sendBacks: Record<
    string,
    { answer: string; itemId: string; status: "pending" | "queued" | "failed" }
  >;
  applySnapshot(serverId: string, record: SideConversationRecord): void;
  /**
   * One list response owns everything the daemon still holds for that parent, so threads it
   * dropped while this client was away disappear with the same call that hydrates the rest.
   *
   * Threads the daemon has never held are kept. A thread id is minted client-side and stays
   * unknown to the daemon until its first question, and fetching an unknown one answers with an
   * empty snapshot rather than an error — so the store holds a content-free placeholder that no
   * list response will ever mention. Sweeping those out would make a brand-new conversation
   * report itself as removed.
   */
  replaceList(
    serverId: string,
    parentAgentId: string,
    threads: readonly SideConversationRecord[],
  ): void;
  remove(serverId: string, parentAgentId: string, threadId: string): void;
  setOrigin(
    serverId: string,
    parentAgentId: string,
    threadId: string,
    origin: SideConversationOrigin,
  ): void;
  removeOrigin(serverId: string, parentAgentId: string, threadId: string): void;
  prepareSendBack(
    serverId: string,
    parentAgentId: string,
    threadId: string,
    answer: string,
    proposedItemId: string,
  ): string;
  updateSendBackStatus(
    serverId: string,
    parentAgentId: string,
    threadId: string,
    itemId: string,
    status: "pending" | "queued" | "failed",
  ): void;
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

export function mergeSideConversationOrigins(
  persisted: unknown,
  current: Readonly<Record<string, SideConversationOrigin>>,
  removedDuringHydration: Iterable<string>,
): Record<string, SideConversationOrigin> {
  const parsed = PersistedOriginsSchema.safeParse(persisted);
  const origins = parsed.success ? { ...parsed.data.origins, ...current } : { ...current };
  for (const key of removedDuringHydration) delete origins[key];
  return origins;
}

export function mergeSideConversationSendBacks(
  persisted: unknown,
  current: Readonly<
    Record<string, { answer: string; itemId: string; status: "pending" | "queued" | "failed" }>
  >,
  removedDuringHydration: Iterable<string>,
): Record<string, { answer: string; itemId: string; status: "pending" | "queued" | "failed" }> {
  const parsed = PersistedOriginsSchema.safeParse(persisted);
  const sendBacks = {
    ...(parsed.success ? (parsed.data.sendBacks ?? {}) : {}),
    ...current,
  };
  for (const key of removedDuringHydration) delete sendBacks[key];
  return sendBacks;
}

/**
 * True for a thread the daemon has no record of. The daemon seeds both `items` and
 * `pendingQuestion` the moment a thread is asked its first question, so a record carrying
 * neither can only be the empty snapshot returned for an id it has never seen.
 */
export function isUnaskedSideConversation(record: SideConversationRecord): boolean {
  return record.items.length === 0 && !record.pendingQuestion && !record.lastAnswer;
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

export const useSideConversationStore = create<SideConversationState>()(
  persist(
    (set, get) => ({
      records: new Map(),
      originsHydrated: false,
      origins: {},
      sendBacks: {},
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
          const records = new Map(
            [...state.records].filter(
              ([key, record]) => !key.startsWith(prefix) || isUnaskedSideConversation(record),
            ),
          );
          const retainedKeys = new Set(
            threads.map((thread) => sideConversationKey(serverId, parentAgentId, thread.threadId)),
          );
          const origins = { ...state.origins };
          const sendBacks = { ...state.sendBacks };
          for (const [key, record] of state.records) {
            if (
              key.startsWith(prefix) &&
              !retainedKeys.has(key) &&
              !isUnaskedSideConversation(record)
            ) {
              delete origins[key];
              delete sendBacks[key];
              originRemovalsDuringHydration.add(key);
            }
          }
          for (const thread of threads) {
            records.set(sideConversationKey(serverId, parentAgentId, thread.threadId), thread);
          }
          return { records, origins, sendBacks };
        });
      },
      remove(serverId, parentAgentId, threadId) {
        const key = sideConversationKey(serverId, parentAgentId, threadId);
        originRemovalsDuringHydration.add(key);
        set((state) => {
          const records = new Map(state.records);
          const hadRecord = records.delete(key);
          const origins = withoutOrigin(state.origins, key);
          const sendBacks = withoutKey(state.sendBacks, key);
          if (!hadRecord && origins === state.origins && sendBacks === state.sendBacks)
            return state;
          return { records, origins, sendBacks };
        });
      },
      setOrigin(serverId, parentAgentId, threadId, origin) {
        const key = sideConversationKey(serverId, parentAgentId, threadId);
        originRemovalsDuringHydration.delete(key);
        set((state) => ({ origins: { ...state.origins, [key]: origin } }));
      },
      removeOrigin(serverId, parentAgentId, threadId) {
        const key = sideConversationKey(serverId, parentAgentId, threadId);
        originRemovalsDuringHydration.add(key);
        set((state) => {
          const origins = withoutOrigin(state.origins, key);
          return origins === state.origins ? state : { origins };
        });
      },
      prepareSendBack(serverId, parentAgentId, threadId, answer, proposedItemId) {
        const key = sideConversationKey(serverId, parentAgentId, threadId);
        const current = get().sendBacks[key];
        const itemId = current?.answer === answer ? current.itemId : proposedItemId;
        set((state) => ({
          sendBacks: {
            ...state.sendBacks,
            [key]: { answer, itemId, status: "pending" },
          },
        }));
        return itemId;
      },
      updateSendBackStatus(serverId, parentAgentId, threadId, itemId, status) {
        const key = sideConversationKey(serverId, parentAgentId, threadId);
        set((state) => {
          const current = state.sendBacks[key];
          if (!current || current.itemId !== itemId || current.status === status) return state;
          return {
            sendBacks: {
              ...state.sendBacks,
              [key]: { ...current, status },
            },
          };
        });
      },
    }),
    {
      name: "side-conversation-origins",
      storage: originStorage,
      partialize: (state) => ({ origins: state.origins, sendBacks: state.sendBacks }),
      merge: (persisted, current) => {
        return {
          ...current,
          origins: mergeSideConversationOrigins(
            persisted,
            current.origins,
            originRemovalsDuringHydration,
          ),
          sendBacks: mergeSideConversationSendBacks(
            persisted,
            current.sendBacks,
            originRemovalsDuringHydration,
          ),
        };
      },
      onRehydrateStorage: () => () => {
        originRemovalsDuringHydration.clear();
        useSideConversationStore.setState({ originsHydrated: true });
      },
    },
  ),
);

function withoutOrigin(
  origins: Record<string, SideConversationOrigin>,
  key: string,
): Record<string, SideConversationOrigin> {
  return withoutKey(origins, key);
}

function withoutKey<T>(items: Record<string, T>, key: string): Record<string, T> {
  if (!(key in items)) return items;
  const next = { ...items };
  delete next[key];
  return next;
}
