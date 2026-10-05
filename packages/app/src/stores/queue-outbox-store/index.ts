import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { SESSION_ROUTING_DRAFT_KEY } from "@/stores/draft-keys";
import {
  flushQueueOutbox,
  PendingQueueEnqueueSchema,
  serializeQueueOperation,
  type PendingQueueEnqueue,
  type QueueOutboxFlushClient,
} from "./model";

export {
  QUEUE_OUTBOX_MAX_ATTEMPTS,
  type PendingQueueEnqueue,
  type QueueOutboxFlushClient,
} from "./model";

const PersistedQueueOutboxSchema = z.object({
  entries: z.record(z.string(), PendingQueueEnqueueSchema),
});

type PersistedQueueOutbox = z.infer<typeof PersistedQueueOutboxSchema>;

interface QueueOutboxActions {
  recoverRoutingDraft: () => Promise<void>;
  getEntry: (itemId: string) => Promise<PendingQueueEnqueue | undefined>;
  markRoutingDispatched: (itemId: string) => Promise<void>;
  rejections: Record<string, string>;
  reject: (itemId: string, message: string) => void;
  acknowledgements: Record<string, { queued: boolean }>;
  acknowledge: (itemId: string, snapshot: AgentQueueSnapshot) => Promise<boolean>;
  add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
  remove: (itemId: string) => void;
  removeDurably: (itemId: string, preserveRemovalIntent?: boolean) => Promise<void>;
  requestRemoval: (entry: PendingQueueEnqueue) => Promise<void>;
  bumpAttempts: (itemId: string) => void;
  bumpAttemptsDurably: (itemId: string) => Promise<void>;
  entriesForServer: (serverId: string) => PendingQueueEnqueue[];
  entriesForAgent: (serverId: string, agentId: string) => PendingQueueEnqueue[];
}

type QueueOutboxStore = PersistedQueueOutbox & QueueOutboxActions;

function sortByCreation(entries: PendingQueueEnqueue[]): PendingQueueEnqueue[] {
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

const writesInFlight = new Set<string>();
let pendingWrite: Promise<void> = Promise.resolve();
const persistedStorage = createValidatedPersistStorage(AsyncStorage, PersistedQueueOutboxSchema);
const durableStorage: typeof persistedStorage = {
  ...persistedStorage,
  setItem: (name, value) => {
    pendingWrite = pendingWrite
      .catch(() => {})
      .then(async () => {
        await persistedStorage.setItem(name, value);
        return undefined;
      });
    void pendingWrite.catch(() => {});
    return pendingWrite;
  },
};

let hydrationInFlight: Promise<void> | undefined;
export async function awaitOutboxHydration(): Promise<void> {
  if (useQueueOutboxStore.persist.hasHydrated()) return;
  hydrationInFlight ??= Promise.resolve(useQueueOutboxStore.persist.rehydrate())
    .then(() => {
      if (!useQueueOutboxStore.persist.hasHydrated())
        throw new Error("Unable to load saved queued messages");
      return undefined;
    })
    .finally(() => {
      hydrationInFlight = undefined;
    });
  await hydrationInFlight;
  if (!useQueueOutboxStore.persist.hasHydrated())
    throw new Error("Unable to load saved queued messages");
}

/**
 * The durable outbox for daemon-owned queue writes. Entries are keyed by item
 * id (unique across servers by construction) and survive app restarts, so an
 * enqueue that never reached the daemon is retried instead of lost.
 */
export const useQueueOutboxStore = create<QueueOutboxStore>()(
  persist(
    (set, get) => ({
      entries: {},
      recoverRoutingDraft: async () => {
        await awaitOutboxHydration();
        const { useDraftStore, awaitDraftHydration } = await import("@/stores/draft-store");
        await awaitDraftHydration();
        const itemId =
          useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]?.routingClear?.itemId;
        if (!itemId) return;
        await serializeQueueOperation(JSON.stringify(["routing-ack", itemId]), async () => {
          const draft = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
          const clear = draft?.routingClear;
          if (
            !draft ||
            !clear ||
            clear.itemId !== itemId ||
            draft.version !== clear.version ||
            draft.updatedAt !== clear.updatedAt
          )
            return;
          const entry = get().entries[itemId];
          if (
            !entry?.routingOrigin ||
            get().acknowledgements[itemId] ||
            entry.routingDraftVersion === undefined ||
            entry.routingDraftUpdatedAt === undefined
          )
            return;
          const version = entry.routingDraftVersion;
          const updatedAt = entry.routingDraftUpdatedAt;
          useDraftStore.setState((state) => ({
            drafts: {
              ...state.drafts,
              [SESSION_ROUTING_DRAFT_KEY]: {
                input: { ...draft.input, text: entry.text },
                lifecycle: "active",
                version,
                updatedAt,
              },
            },
          }));
        });
      },
      getEntry: async (itemId) => {
        await awaitOutboxHydration();
        return serializeQueueOperation("queue-outbox-mutation", async () => get().entries[itemId]);
      },
      markRoutingDispatched: (itemId) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          const entry = get().entries[itemId];
          if (!entry?.routingDispatchHeld) return;
          const dispatched = { ...entry, routingDispatchHeld: false };
          writesInFlight.add(itemId);
          set((state) => ({ entries: { ...state.entries, [itemId]: dispatched } }));
          try {
            await pendingWrite;
          } catch (error) {
            if (get().entries[itemId] === dispatched)
              set((state) => ({ entries: { ...state.entries, [itemId]: entry } }));
            await pendingWrite.catch(() => {});
            throw error;
          } finally {
            writesInFlight.delete(itemId);
          }
        }),
      rejections: {},
      reject: (itemId, message) =>
        set((state) => ({
          rejections: {
            ...Object.fromEntries(Object.entries(state.rejections).slice(-255)),
            [itemId]: message,
          },
        })),
      acknowledgements: {},
      acknowledge: (itemId, snapshot) =>
        serializeQueueOperation(JSON.stringify(["routing-ack", itemId]), async () => {
          await awaitOutboxHydration();
          const entry = get().entries[itemId];
          if (!entry) return Boolean(get().acknowledgements[itemId]);
          if (entry.removalRequested) return false;
          if (entry?.routingOrigin) {
            const { useDraftStore, awaitDraftHydration, flushDraftPersistStorageDurably } =
              await import("@/stores/draft-store");
            await awaitDraftHydration();
            const draft = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
            let clearedDraft: typeof draft | undefined;
            if (
              draft?.version === entry.routingDraftVersion &&
              draft?.updatedAt === entry.routingDraftUpdatedAt
            ) {
              const { editDraftRecordText } = await import("@/stores/draft-store/state");
              if (useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY] === draft) {
                const next = editDraftRecordText(draft, "", Date.now(), true);
                const cleared = {
                  ...next,
                  routingClear: { itemId, version: next.version, updatedAt: next.updatedAt },
                };
                clearedDraft = cleared;
                useDraftStore.setState((state) => ({
                  drafts: { ...state.drafts, [SESSION_ROUTING_DRAFT_KEY]: cleared },
                }));
              }
            }
            try {
              await flushDraftPersistStorageDurably();
            } catch (error) {
              if (
                draft &&
                clearedDraft &&
                useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY] === clearedDraft
              )
                useDraftStore.setState((state) => ({
                  drafts: { ...state.drafts, [SESSION_ROUTING_DRAFT_KEY]: draft },
                }));
              throw error;
            }
          }
          const queued = snapshot.items.some((item) => item.id === itemId);
          set((state) => {
            const kept = Object.entries(state.acknowledgements).slice(-255);
            const acknowledgements = Object.fromEntries(kept);
            acknowledgements[itemId] = { queued };
            return { acknowledgements };
          });
          return true;
        }),

      add: async (entry) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          await awaitOutboxHydration();
          if (entry.routingOrigin && !get().entries[entry.itemId]) {
            const { useDraftStore, awaitDraftHydration, flushDraftPersistStorageDurably } =
              await import("@/stores/draft-store");
            await awaitDraftHydration();
            const draft = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY];
            if (
              !draft ||
              draft.version !== entry.routingDraftVersion ||
              draft.updatedAt !== entry.routingDraftUpdatedAt ||
              draft.input.text !== entry.text
            )
              throw new Error("The submitted draft changed. Send it again.");
            await flushDraftPersistStorageDurably();
            if (useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY] !== draft)
              throw new Error("The submitted draft changed. Send it again.");
          }
          writesInFlight.add(entry.itemId);
          set((state) => ({
            entries: {
              ...state.entries,
              [entry.itemId]: { ...entry, createdAt: Date.now(), attempts: 0 },
            },
          }));
          try {
            await pendingWrite;
          } catch (error) {
            get().remove(entry.itemId);
            throw error;
          } finally {
            writesInFlight.delete(entry.itemId);
          }
        }),

      remove: (itemId) => {
        set((state) => {
          if (!(itemId in state.entries)) {
            return state;
          }
          const entries = { ...state.entries };
          delete entries[itemId];
          return { entries };
        });
      },

      requestRemoval: (entry) =>
        serializeQueueOperation(JSON.stringify(["routing-ack", entry.itemId]), () =>
          serializeQueueOperation("queue-outbox-mutation", async () => {
            await awaitOutboxHydration();
            const previous = get().entries[entry.itemId];
            writesInFlight.add(entry.itemId);
            set((state) => ({
              entries: {
                ...state.entries,
                [entry.itemId]: { ...(previous ?? entry), removalRequested: true, attempts: 0 },
              },
            }));
            try {
              await pendingWrite;
            } catch (error) {
              set((state) => {
                const entries = { ...state.entries };
                if (previous) entries[entry.itemId] = previous;
                else delete entries[entry.itemId];
                return { entries };
              });
              await pendingWrite.catch(() => {});
              throw error;
            } finally {
              writesInFlight.delete(entry.itemId);
            }
          }),
        ),

      removeDurably: (itemId, preserveRemovalIntent = false) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          const entry = get().entries[itemId];
          if (!entry || (preserveRemovalIntent && entry.removalRequested)) return;
          get().remove(itemId);
          try {
            await pendingWrite;
          } catch (error) {
            set((state) => ({ entries: { ...state.entries, [itemId]: entry } }));
            await pendingWrite.catch(() => {});
            throw error;
          }
          if (entry.routingOrigin && entry.removalRequested) {
            set((state) => {
              const acknowledgements = { ...state.acknowledgements };
              delete acknowledgements[itemId];
              return { acknowledgements };
            });
            get().reject(itemId, "Delivery canceled.");
          }
        }),

      bumpAttempts: (itemId) => {
        set((state) => {
          const entry = state.entries[itemId];
          if (!entry) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [itemId]: { ...entry, attempts: entry.attempts + 1 },
            },
          };
        });
      },

      bumpAttemptsDurably: (itemId) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          get().bumpAttempts(itemId);
          await pendingWrite;
        }),

      entriesForServer: (serverId) => {
        const blockedAgents = new Set<string>();
        return sortByCreation(
          Object.values(get().entries).filter((entry) => entry.serverId === serverId),
        ).filter((entry) => {
          if (
            writesInFlight.has(entry.itemId) ||
            (entry.routingDispatchHeld && !entry.removalRequested)
          )
            blockedAgents.add(entry.agentId);
          return !blockedAgents.has(entry.agentId);
        });
      },

      entriesForAgent: (serverId, agentId) =>
        sortByCreation(
          Object.values(get().entries).filter(
            (entry) => entry.serverId === serverId && entry.agentId === agentId,
          ),
        ),
    }),
    {
      name: "paseo-queue-outbox",
      version: 1,
      storage: durableStorage,
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);

export async function flushQueueOutboxForServer(input: {
  serverId: string;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  onRetryLimit?: (entry: PendingQueueEnqueue) => void;
}): Promise<void> {
  await awaitOutboxHydration();
  const store = useQueueOutboxStore.getState();
  await flushQueueOutbox({
    ...input,
    onRejected: (entry, message) => store.reject(entry.itemId, message),
    onAcknowledged: async (entry, snapshot) => {
      await store.acknowledge(entry.itemId, snapshot);
    },
    outbox: {
      list: (serverId) => useQueueOutboxStore.getState().entriesForServer(serverId),
      get: (itemId) => useQueueOutboxStore.getState().entries[itemId],
      remove: store.removeDurably,
      bumpAttempts: store.bumpAttemptsDurably,
    },
  });
}
