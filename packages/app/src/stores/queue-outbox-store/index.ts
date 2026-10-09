import { create } from "zustand";
import { persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  flushQueueOutbox,
  serializeQueueOperation,
  PendingQueueEnqueueSchema,
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

interface QueueOutboxState {
  entries: Record<string, PendingQueueEnqueue>;
  /**
   * The last queue-storage write failure, surfaced so the queue track can show
   * a rendered, actionable error instead of leaving a silent persistence gap.
   * Never persisted — it describes this process's storage health only.
   */
  storageError: { itemId: string | null; at: number } | null;
}

interface QueueOutboxActions {
  /** Persists the entry before resolving; rolls the in-memory entry back when the write fails. */
  add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
  remove: (itemId: string) => void;
  removeDurably: (itemId: string) => Promise<void>;
  bumpAttempts: (itemId: string) => void;
  /** The pre-send attempt reservation: resolving means the increment is persisted. */
  bumpAttemptsDurably: (itemId: string) => Promise<void>;
  markFailed: (itemId: string) => void;
  markFailedDurably: (itemId: string) => Promise<void>;
  retryEntry: (itemId: string) => void;
  /** The explicit retry reset; the park fence clears only once the reset persists. */
  retryEntryDurably: (itemId: string) => Promise<void>;
  reportStorageError: (itemId: string | null) => void;
  clearStorageError: () => void;
  entriesForServer: (serverId: string) => PendingQueueEnqueue[];
  entriesForAgent: (serverId: string, agentId: string) => PendingQueueEnqueue[];
}

type QueueOutboxStore = QueueOutboxState & QueueOutboxActions;

function sortByCreation(entries: PendingQueueEnqueue[]): PendingQueueEnqueue[] {
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

const writesInFlight = new Set<string>();
/**
 * Waiters held while hydration is in flight. Zustand's persist reports a
 * failed READ through `onRehydrateStorage` without firing the finish
 * listeners, so without this list a rejected read would leave every gated
 * operation pending forever.
 */
const hydrationWaiters: Array<(failure: Error) => void> = [];
let hydrationFailure: Error | undefined;
function failHydrationWaiters(): void {
  hydrationFailure = new Error("Unable to load saved queued messages");
  for (const notify of hydrationWaiters.splice(0)) notify(hydrationFailure);
}
/**
 * In-process fence for entries whose park write failed: failedAt stays in
 * memory and the volatile fence keeps them out of every flush listing even
 * though storage never recorded the park. Cleared only when the park or an
 * explicit retry reset persists.
 */
const parkedVolatile = new Set<string>();
let pendingWrite: Promise<void> = Promise.resolve();
/**
 * The validated storage seam under the write chain. Failures injected here (in
 * tests) flow through the chain and surface to the awaiting mutation, never to
 * zustand's fire-and-forget reference.
 */
export const outboxPersistedStorage = createValidatedPersistStorage(
  AsyncStorage,
  PersistedQueueOutboxSchema,
);
const durableStorage: typeof outboxPersistedStorage = {
  ...outboxPersistedStorage,
  setItem: (name, value) => {
    // Each write chains behind the previous one but resolves on its own: the
    // caller's promise carries only its own write's outcome, and a rejection
    // never poisons the chain for the writes queued behind it. The void catch
    // keeps zustand's fire-and-forget setItem reference from becoming an
    // unhandled rejection — awaiters decide how failures surface.
    const write = pendingWrite
      .catch(() => {})
      .then(async () => {
        await outboxPersistedStorage.setItem(name, value);
        return undefined;
      });
    pendingWrite = write;
    void write.catch(() => {});
    return write;
  },
};

/**
 * Holds every mutation and flush until the persisted entries are in memory.
 * Waiting on `onFinishHydration` (instead of calling `rehydrate()` again)
 * matters: a second rehydrate bumps zustand's hydration version and silently
 * aborts the run in flight. A read that never completes keeps the gate closed —
 * no mutation or send may run against an unknown durable state.
 */
function awaitOutboxHydration(): Promise<void> {
  const persistApi = useQueueOutboxStore.persist;
  if (persistApi.hasHydrated()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (hydrationFailure) {
      // A failed read is recoverable: re-attempt hydration for this caller.
      hydrationFailure = undefined;
      void persistApi.rehydrate();
    }
    let unsubscribe: () => void = () => {};
    const waiter = (failure: Error) => {
      unsubscribe();
      reject(failure);
    };
    hydrationWaiters.push(waiter);
    unsubscribe = persistApi.onFinishHydration(() => {
      unsubscribe();
      const index = hydrationWaiters.indexOf(waiter);
      if (index !== -1) hydrationWaiters.splice(index, 1);
      if (persistApi.hasHydrated()) {
        resolve();
      } else {
        reject(hydrationFailure ?? new Error("Unable to load saved queued messages"));
      }
    });
    // Hydration may have completed between the first check and subscribing.
    if (persistApi.hasHydrated()) {
      unsubscribe();
      const index = hydrationWaiters.indexOf(waiter);
      if (index !== -1) hydrationWaiters.splice(index, 1);
      resolve();
    }
  });
}

/**
 * Proves storage health before an automatic flush sends anything: a no-op
 * rewrite whose payload is captured synchronously with the set(). The
 * serialized write chain executes in set() order, so the probe can never
 * overwrite a later mutation with an older snapshot — the final persisted
 * state always equals the last set's value. A failed probe sends nothing.
 */
function probeOutboxStorage(): Promise<void> {
  useQueueOutboxStore.setState((state) => ({ entries: { ...state.entries } }));
  return pendingWrite;
}

/**
 * The durable outbox for daemon-owned queue writes. Entries are keyed by item
 * id (unique across servers by construction) and survive app restarts, so an
 * enqueue that never reached the daemon is retried instead of lost. Every
 * mutation awaits the serialized write chain: `add` rolls back when its write
 * fails (the draft survives because the composer clears only after this
 * resolves), removal restores the entry, and park/retry fences hold even when
 * their writes fail.
 */
export const useQueueOutboxStore = create<QueueOutboxStore>()(
  persist(
    (set, get) => ({
      entries: {},
      storageError: null,

      add: async (entry) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          try {
            await awaitOutboxHydration();
          } catch (error) {
            get().reportStorageError(entry.itemId);
            throw error;
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
            get().reportStorageError(entry.itemId);
            throw error;
          } finally {
            writesInFlight.delete(entry.itemId);
          }
          get().clearStorageError();
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

      removeDurably: (itemId) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          try {
            await awaitOutboxHydration();
          } catch (error) {
            get().reportStorageError(itemId);
            throw error;
          }
          const entry = get().entries[itemId];
          if (!entry) return;
          get().remove(itemId);
          try {
            await pendingWrite;
          } catch (error) {
            // Restore only when no newer mutation replaced the entry meanwhile.
            if (!get().entries[itemId]) {
              set((state) => ({ entries: { ...state.entries, [itemId]: entry } }));
            }
            get().reportStorageError(itemId);
            throw error;
          }
          get().clearStorageError();
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
          try {
            await awaitOutboxHydration();
          } catch (error) {
            get().reportStorageError(itemId);
            throw error;
          }
          get().bumpAttempts(itemId);
          try {
            await pendingWrite;
          } catch (error) {
            // The unpersisted increment stays in memory: it can only
            // over-count toward the park cap, never under-count it.
            get().reportStorageError(itemId);
            throw error;
          }
          get().clearStorageError();
        }),

      markFailed: (itemId) => {
        set((state) => {
          const entry = state.entries[itemId];
          if (!entry) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [itemId]: { ...entry, failedAt: Date.now() },
            },
          };
        });
      },

      markFailedDurably: (itemId) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          try {
            await awaitOutboxHydration();
          } catch (error) {
            get().reportStorageError(itemId);
            throw error;
          }
          const previous = get().entries[itemId];
          if (!previous || previous.failedAt !== undefined) return;
          // The fence is set before the write so a failing write can never
          // leave the entry eligible for automatic delivery.
          get().markFailed(itemId);
          parkedVolatile.add(itemId);
          try {
            await pendingWrite;
          } catch (error) {
            get().reportStorageError(itemId);
            throw error;
          }
          // The persisted failedAt supersedes the volatile fence.
          parkedVolatile.delete(itemId);
          get().clearStorageError();
        }),

      retryEntry: (itemId) => {
        set((state) => {
          const entry = state.entries[itemId];
          if (!entry) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [itemId]: { ...entry, attempts: 0, failedAt: undefined },
            },
          };
        });
      },

      retryEntryDurably: (itemId) =>
        serializeQueueOperation("queue-outbox-mutation", async () => {
          try {
            await awaitOutboxHydration();
          } catch (error) {
            get().reportStorageError(itemId);
            throw error;
          }
          const entry = get().entries[itemId];
          if (!entry) return;
          if (entry.failedAt === undefined && !parkedVolatile.has(itemId)) return;
          const parked = { attempts: entry.attempts, failedAt: entry.failedAt };
          get().retryEntry(itemId);
          try {
            await pendingWrite;
          } catch (error) {
            // An unpersisted retry must not lift the park fence.
            set((state) => {
              const current = state.entries[itemId];
              if (!current) return state;
              return {
                entries: {
                  ...state.entries,
                  [itemId]: {
                    ...current,
                    attempts: parked.attempts,
                    failedAt: parked.failedAt,
                  },
                },
              };
            });
            get().reportStorageError(itemId);
            throw error;
          }
          parkedVolatile.delete(itemId);
          get().clearStorageError();
        }),

      reportStorageError: (itemId) => {
        set({ storageError: { itemId, at: Date.now() } });
      },

      clearStorageError: () => {
        if (get().storageError !== null) {
          set({ storageError: null });
        }
      },

      entriesForServer: (serverId) => {
        // An agent with ANY durable write in flight is excluded wholesale, so
        // a flush can never race that write with its own dispatch — including
        // the agent's older entries that were listed before the write started.
        const blockedAgents = new Set<string>();
        for (const entry of Object.values(get().entries)) {
          if (writesInFlight.has(entry.itemId)) blockedAgents.add(entry.agentId);
        }
        return sortByCreation(
          Object.values(get().entries).filter(
            (entry) =>
              entry.serverId === serverId &&
              entry.failedAt === undefined &&
              !parkedVolatile.has(entry.itemId) &&
              !blockedAgents.has(entry.agentId),
          ),
        );
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
      onRehydrateStorage: () => (_state, error) => {
        if (error) failHydrationWaiters();
      },
    },
  ),
);

/**
 * Retries one failed entry — the explicit user action — without touching any
 * other pending entry for the server. The park fence clears only after the
 * retry reset persists, so a failed reset leaves the entry parked and nothing
 * is sent.
 */
export async function retryFailedOutboxEntry(input: {
  itemId: string;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}): Promise<void> {
  const store = useQueueOutboxStore.getState();
  const entry = store.entries[input.itemId];
  if (!entry) return;
  if (entry.failedAt === undefined && !parkedVolatile.has(input.itemId)) return;
  await store.retryEntryDurably(input.itemId);
  await flushQueueOutbox({
    serverId: entry.serverId,
    outbox: {
      list: () => {
        const current = useQueueOutboxStore.getState().entries[input.itemId];
        return current && current.failedAt === undefined && !parkedVolatile.has(input.itemId)
          ? [current]
          : [];
      },
      remove: useQueueOutboxStore.getState().removeDurably,
      bumpAttempts: useQueueOutboxStore.getState().bumpAttemptsDurably,
      markFailed: useQueueOutboxStore.getState().markFailedDurably,
    },
    client: input.client,
    applySnapshot: input.applySnapshot,
  });
}

/**
 * Flushes this store's un-acked enqueues for one server. Called on every
 * (re)connect that advertises the durable queue feature. A persistence probe
 * runs first: with storage failing, nothing is sent and no attempt is
 * consumed. Dispatch is serialized per agent, so concurrent calls cannot
 * double-send. Failed entries are skipped: retrying one is an explicit user
 * decision, never an automatic side effect of a reconnect.
 */
export async function flushQueueOutboxForServer(input: {
  serverId: string;
  client: QueueOutboxFlushClient;
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
  onEntryExhausted?: (entry: PendingQueueEnqueue) => void;
}): Promise<void> {
  try {
    await awaitOutboxHydration();
  } catch (error) {
    useQueueOutboxStore.getState().reportStorageError(null);
    throw error;
  }
  try {
    await probeOutboxStorage();
  } catch (error) {
    useQueueOutboxStore.getState().reportStorageError(null);
    throw error;
  }
  const store = useQueueOutboxStore.getState();
  await flushQueueOutbox({
    ...input,
    outbox: {
      list: (serverId) => useQueueOutboxStore.getState().entriesForServer(serverId),
      remove: store.removeDurably,
      bumpAttempts: store.bumpAttemptsDurably,
      markFailed: store.markFailedDurably,
    },
  });
}
