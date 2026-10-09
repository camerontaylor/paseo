import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
// The static graph resolves the AsyncStorage alias; the fresh graphs below are
// pointed at this same stub instance via doMock.
import AsyncStorageStub from "../../../test-stubs/async-storage";

import { QUEUE_OUTBOX_MAX_ATTEMPTS, type PendingQueueEnqueue } from "./model";

const STORE_KEY = "paseo-queue-outbox";

type OutboxModule = typeof import("./index");

// The store and these helpers share one stub instance across every fresh graph.
const stub = AsyncStorageStub;

function entry(overrides: Partial<PendingQueueEnqueue> = {}): PendingQueueEnqueue {
  return {
    serverId: "server-1",
    agentId: "agent-1",
    itemId: "item-1",
    text: "hello",
    intent: "queue",
    images: [],
    attachments: [],
    composerAttachments: [],
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

function snapshotWith(itemId: string): AgentQueueSnapshot {
  return {
    agentId: "agent-1",
    revision: 1,
    items: [
      {
        id: itemId,
        text: "hello",
        intent: "queue",
        deliveryState: "pending",
        attempts: 0,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

function seedStorage(entries: PendingQueueEnqueue[]): void {
  stub.setItem(
    STORE_KEY,
    JSON.stringify({
      state: { entries: Object.fromEntries(entries.map((e) => [e.itemId, e])) },
      version: 1,
    }),
  );
}

async function readPersistedEntries(): Promise<Record<string, PendingQueueEnqueue>> {
  const raw = await stub.getItem(STORE_KEY);
  if (raw === null) return {};
  const decoded = JSON.parse(raw) as { state?: { entries?: Record<string, PendingQueueEnqueue> } };
  return decoded.state?.entries ?? {};
}

/**
 * Injects failures and hangs into the backing storage. The outbox holds the
 * stub object, so swapping `setItem` redirects every persistence write.
 */
function controlStorage() {
  const original = stub.setItem.bind(stub);
  const originalGetItem = stub.getItem.bind(stub);
  let failNext = 0;
  let healthyBeforeFail = Number.POSITIVE_INFINITY;
  let hangNext = 0;
  let failNextGetItem = 0;
  const releaseHooks: Array<() => void> = [];
  const wrapped = (key: string, value: string): Promise<void> => {
    if (hangNext > 0) {
      hangNext -= 1;
      return new Promise<void>((resolve) => {
        releaseHooks.push(() => {
          void original(key, value);
          resolve();
        });
      });
    }
    if (failNext > 0) {
      failNext -= 1;
      return Promise.reject(new Error("Simulated storage failure"));
    }
    if (healthyBeforeFail <= 0) {
      return Promise.reject(new Error("Simulated storage failure"));
    }
    healthyBeforeFail -= 1;
    return original(key, value);
  };
  const wrappedGetItem = (key: string): Promise<string | null> => {
    if (failNextGetItem > 0) {
      failNextGetItem -= 1;
      return Promise.reject(new Error("Simulated read failure"));
    }
    return originalGetItem(key);
  };
  stub.setItem = wrapped as typeof stub.setItem;
  stub.getItem = wrappedGetItem as typeof stub.getItem;
  return {
    failNextCalls(count: number) {
      failNext = count;
    },
    failNextReads(count: number) {
      failNextGetItem = count;
    },
    /** Passes the next `count` writes, then fails everything until restored. */
    failAfterHealthy(count: number) {
      healthyBeforeFail = count;
    },
    hangNextCalls(count: number) {
      hangNext = count;
    },
    pendingHooks() {
      return releaseHooks.length;
    },
    releaseHanging() {
      for (const release of releaseHooks.splice(0)) release();
    },
    restore() {
      stub.setItem = original as typeof stub.setItem;
      stub.getItem = originalGetItem as typeof stub.getItem;
    },
  };
}

/**
 * Every test loads a fresh module graph: the module-level write chain, the
 * volatile park fence, and the in-flight lanes cannot leak between tests, and
 * a fresh import doubles as the restart/crash simulation.
 */
async function loadOutbox(seed?: PendingQueueEnqueue[]): Promise<OutboxModule> {
  vi.resetModules();
  // The AsyncStorage alias does not survive vi.resetModules(): the re-evaluated
  // graph would capture the real (native) module. Point the specifier at the
  // shared stub for this graph only.
  vi.doMock("@react-native-async-storage/async-storage", () => ({
    default: AsyncStorageStub,
    clearAsyncStorageStub: () => {},
  }));
  // Seed between the mock registration and the store creation so the store's
  // automatic rehydration reads it.
  if (seed) seedStorage(seed);
  return await import("./index");
}

function createClient(sends: string[], failItemIds: ReadonlySet<string> = new Set()) {
  return {
    enqueueAgentMessage: async (input: { itemId: string }) => {
      sends.push(input.itemId);
      if (failItemIds.has(input.itemId)) {
        throw new Error("transport not connected");
      }
      return snapshotWith(input.itemId);
    },
  };
}

const pristineSetItem = AsyncStorageStub.setItem.bind(AsyncStorageStub);
const pristineGetItem = AsyncStorageStub.getItem.bind(AsyncStorageStub);

beforeEach(() => {
  AsyncStorageStub.clear();
  AsyncStorageStub.getItem = pristineGetItem as typeof AsyncStorageStub.getItem;
});

afterEach(() => {
  // A test that escaped a rejection skips its own restore; never leak the
  // failing wrapper into later tests.
  stub.setItem = pristineSetItem as typeof stub.setItem;
  stub.getItem = pristineGetItem as typeof stub.getItem;
});

describe("queue outbox store durability", () => {
  test("add survives a rehydrate that lands after the write", async () => {
    // The write is issued before rehydration has been awaited; the hydration
    // gate must hold it until the persisted entries are in place.
    const { useQueueOutboxStore } = await loadOutbox([entry({ itemId: "seeded" })]);
    const pending = useQueueOutboxStore.getState().add(entry({ itemId: "fresh" }));
    await useQueueOutboxStore.persist.rehydrate();
    await pending;

    const keys = Object.keys(useQueueOutboxStore.getState().entries);
    expect(keys.sort()).toEqual(["fresh", "seeded"]);
  });

  test("a storage failure during add rolls the entry back and reports the error", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }))).rejects.toThrow(
      "Simulated storage failure",
    );

    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("removeDurably persists the deletion across a reload", async () => {
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    await useQueueOutboxStore.getState().removeDurably("item-1");

    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    expect(reloaded.useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
  });

  test("removeDurably restores the entry when its write fails", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().removeDurably("item-1")).rejects.toThrow(
      "Simulated storage failure",
    );

    expect(useQueueOutboxStore.getState().entries["item-1"]?.text).toBe("hello");
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("a failed removeDurably followed by a re-add converges after reload", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1", text: "old" }));
    storage.failNextCalls(1);
    await expect(useQueueOutboxStore.getState().removeDurably("item-1")).rejects.toThrow();
    storage.restore();

    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1", text: "new" }));

    const persisted = await readPersistedEntries();
    expect(persisted["item-1"]?.text).toBe("new");
  });

  test("a rejected write does not poison the chain for later writes", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    storage.failNextCalls(1);
    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "doomed" }))).rejects.toThrow();
    storage.restore();

    await useQueueOutboxStore.getState().add(entry({ itemId: "healthy" }));

    const persisted = await readPersistedEntries();
    expect(persisted["doomed"]).toBeUndefined();
    expect(persisted["healthy"]?.itemId).toBe("healthy");
  });

  test("interleaved durable mutations converge after reload", async () => {
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    await Promise.all([
      useQueueOutboxStore.getState().bumpAttemptsDurably("item-1"),
      useQueueOutboxStore.getState().removeDurably("item-1"),
    ]);

    const persisted = await readPersistedEntries();
    expect(persisted["item-1"]).toBeUndefined();
  });

  test("a failed bump keeps the in-memory increment and reports the error", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().bumpAttemptsDurably("item-1")).rejects.toThrow();

    // The unpersisted increment can only over-count toward the park cap.
    expect(useQueueOutboxStore.getState().entries["item-1"]?.attempts).toBe(1);
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("entriesForServer hides every entry of an agent with a write in flight", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    storage.hangNextCalls(1);
    const pending = useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    // Wait until the write is actually hung: the agent is excluded from the
    // listing for as long as its entry is mid-write.
    await vi.waitFor(() => expect(storage.pendingHooks()).toBe(1));
    expect(useQueueOutboxStore.getState().entriesForServer("server-1")).toEqual([]);

    storage.releaseHanging();
    await pending;
    const listed = useQueueOutboxStore.getState().entriesForServer("server-1");
    expect(listed.map((item) => item.itemId)).toEqual(["item-1"]);
  });

  test("entriesForServer excludes a whole agent when a later entry has a write in flight", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    // Persist one row per agent before the hang: agent-a's older row and
    // agent-b's row are both eligible until agent-a's newer write lands.
    await useQueueOutboxStore.getState().add(entry({ itemId: "old-row", createdAt: 1 }));
    await useQueueOutboxStore
      .getState()
      .add(entry({ itemId: "agent-b-row", agentId: "agent-b", createdAt: 3 }));
    storage.hangNextCalls(1);
    const pending = useQueueOutboxStore.getState().add(entry({ itemId: "new-row", createdAt: 2 }));
    await vi.waitFor(() => expect(storage.pendingHooks()).toBe(1));

    // The agent's earlier, already-listed entry is held back with the newer
    // in-flight one, while the other agent stays eligible.
    const listed = useQueueOutboxStore
      .getState()
      .entriesForServer("server-1")
      .map((item) => item.itemId);
    expect(listed).toEqual(["agent-b-row"]);

    storage.releaseHanging();
    await pending;
    // The store stamps createdAt at write time: old-row, agent-b-row,
    // new-row in insertion order.
    expect(
      useQueueOutboxStore
        .getState()
        .entriesForServer("server-1")
        .map((item) => item.itemId),
    ).toEqual(["old-row", "agent-b-row", "new-row"]);
  });

  test("flush waits for outbox hydration before listing entries", async () => {
    const { flushQueueOutboxForServer } = await loadOutbox([entry({ itemId: "seeded" })]);
    const sends: string[] = [];

    // Issued before rehydration has been awaited.
    const pending = flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends),
      applySnapshot: () => {},
    });
    await pending;

    expect(sends).toEqual(["seeded"]);
  });

  test("concurrent flushes for one server do not double-send", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    const sends: string[] = [];
    const client = createClient(sends);

    await Promise.all([
      flushQueueOutboxForServer({ serverId: "server-1", client, applySnapshot: () => {} }),
      flushQueueOutboxForServer({ serverId: "server-1", client, applySnapshot: () => {} }),
    ]);

    expect(sends).toEqual(["item-1"]);
  });

  test("the eighth failure parks the entry durably across a reload", async () => {
    const { flushQueueOutboxForServer } = await loadOutbox([
      entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 }),
    ]);
    const sends: string[] = [];
    const exhausted: string[] = [];

    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends, new Set(["item-1"])),
      applySnapshot: () => {},
      onEntryExhausted: (failed) => exhausted.push(failed.itemId),
    });
    expect(exhausted).toEqual(["item-1"]);

    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    expect(reloaded.useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
    const laterSends: string[] = [];
    await reloaded.flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(laterSends),
      applySnapshot: () => {},
    });
    expect(laterSends).toEqual([]);
  });

  test("the eighth failure with failing storage sends no ninth time", async () => {
    const storage = controlStorage();
    // The probe and the attempt reservation persist; the park write fails.
    const { flushQueueOutboxForServer } = await loadOutbox([
      entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 }),
    ]);
    const sends: string[] = [];

    storage.failAfterHealthy(2);
    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends, new Set(["item-1"])),
      applySnapshot: () => {},
    });
    expect(sends).toEqual(["item-1"]);

    // Still-failing storage: the probe gates the flush before any send.
    await expect(
      flushQueueOutboxForServer({
        serverId: "server-1",
        client: createClient(sends),
        applySnapshot: () => {},
      }),
    ).rejects.toThrow("Simulated storage failure");
    expect(sends).toEqual(["item-1"]);

    // Restart with recovered storage: the entry is parked on sight, not sent.
    storage.restore();
    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    await reloaded.flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends),
      applySnapshot: () => {},
    });
    expect(sends).toEqual(["item-1"]);
    expect(reloaded.useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
  });

  test("a failed park write keeps the in-memory fence and reports the error", async () => {
    const storage = controlStorage();
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().markFailedDurably("item-1")).rejects.toThrow();

    expect(useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("a failed explicit retry keeps the park fence: no send from the retry or a later flush", async () => {
    const storage = controlStorage();
    const { flushQueueOutboxForServer, retryFailedOutboxEntry, useQueueOutboxStore } =
      await loadOutbox([entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 })]);
    storage.failNextCalls(1);
    const sends: string[] = [];

    await expect(
      retryFailedOutboxEntry({
        itemId: "item-1",
        client: createClient(sends),
        applySnapshot: () => {},
      }),
    ).rejects.toThrow("Simulated storage failure");
    expect(sends).toEqual([]);
    expect(useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
    expect(useQueueOutboxStore.getState().entries["item-1"]?.attempts).toBe(
      QUEUE_OUTBOX_MAX_ATTEMPTS,
    );

    // Healthy storage again, so the probe succeeds and this isolates the fence.
    storage.restore();
    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends),
      applySnapshot: () => {},
    });
    expect(sends).toEqual([]);
  });

  test("a successful explicit retry clears the fence and delivers on the retried flush", async () => {
    const { retryFailedOutboxEntry, useQueueOutboxStore } = await loadOutbox([
      entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 }),
    ]);
    const sends: string[] = [];

    await retryFailedOutboxEntry({
      itemId: "item-1",
      client: createClient(sends),
      applySnapshot: () => {},
    });

    expect(sends).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
  });

  test("a flush whose persistence probe fails sends nothing", async () => {
    const storage = controlStorage();
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);
    const sends: string[] = [];

    await expect(
      flushQueueOutboxForServer({
        serverId: "server-1",
        client: createClient(sends),
        applySnapshot: () => {},
      }),
    ).rejects.toThrow("Simulated storage failure");

    expect(sends).toEqual([]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeDefined();
    expect(useQueueOutboxStore.getState().storageError).not.toBeNull();
    storage.restore();
  });

  test("a successful probe precedes a normal flush", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    useQueueOutboxStore.getState().reportStorageError("item-1");
    const sends: string[] = [];

    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(sends),
      applySnapshot: () => {},
    });

    expect(sends).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().storageError).toBeNull();
  });

  test("a deferred write, a concurrent probe, and an add converge after reload", async () => {
    const storage = controlStorage();
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    const idleClient = createClient([]);

    // Order 1: the mutation's write hangs; the flush's probe chains behind it.
    storage.hangNextCalls(1);
    const add = useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    await vi.waitFor(() => expect(storage.pendingHooks()).toBe(1));
    const flush1 = flushQueueOutboxForServer({
      serverId: "server-other",
      client: idleClient,
      applySnapshot: () => {},
    });
    storage.releaseHanging();
    await Promise.all([add, flush1]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeDefined();

    // Order 2: the probe's write hangs; the add chains behind it.
    storage.hangNextCalls(1);
    const flush2 = flushQueueOutboxForServer({
      serverId: "server-other",
      client: idleClient,
      applySnapshot: () => {},
    });
    await vi.waitFor(() => expect(storage.pendingHooks()).toBe(1));
    const add2 = useQueueOutboxStore.getState().add(entry({ itemId: "item-2" }));
    storage.releaseHanging();
    await Promise.all([flush2, add2]);

    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    const keys = Object.keys(reloaded.useQueueOutboxStore.getState().entries);
    expect(keys.sort()).toEqual(["item-1", "item-2"]);
  });

  test("a crash between reservation and send persists the reservation and stays bounded", async () => {
    const { flushQueueOutboxForServer } = await loadOutbox([
      entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 2 }),
    ]);
    let releaseSend: (snapshot: AgentQueueSnapshot) => void = () => {};
    const sends: string[] = [];
    const hangingClient = {
      enqueueAgentMessage: (input: { itemId: string }) => {
        sends.push(input.itemId);
        return new Promise<AgentQueueSnapshot>((resolve) => {
          releaseSend = () => resolve(snapshotWith(input.itemId));
        });
      },
    };
    const flush = flushQueueOutboxForServer({
      serverId: "server-1",
      client: hangingClient,
      applySnapshot: () => {},
    });
    flush.catch(() => {});

    // Deterministic barrier: the reservation is durable while the send is
    // still hanging, so the persisted increment preceded the send.
    await vi.waitFor(() => expect(stub.getItem(STORE_KEY)).resolves.toContain('"attempts":7'));
    expect(sends).toEqual(["item-1"]);

    // Crash: the fresh module graph drops the lane's store. The abandoned
    // lane's closures are still alive, so its storage access is sunk — it
    // must not touch restarted state.
    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    stub.setItem = (() => Promise.resolve()) as typeof stub.setItem;
    releaseSend(snapshotWith("item-1"));

    // The recovered process sees the persisted reservation and sends at most
    // one more time — the cap holds across the crash.
    const laterSends: string[] = [];
    await reloaded.flushQueueOutboxForServer({
      serverId: "server-1",
      client: createClient(laterSends),
      applySnapshot: () => {},
    });
    expect(laterSends).toEqual(["item-1"]);
  });
});

describe("queue outbox hydration failures", () => {
  test("a rejected read rejects waiting operations instead of pending forever", async () => {
    const storage = controlStorage();
    // Read #1 fails the automatic hydration at import; read #2 fails the
    // recovery attempt the gate issues, which is the one with a waiter.
    storage.failNextReads(2);
    const { useQueueOutboxStore } = await loadOutbox();

    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }))).rejects.toThrow(
      "Unable to load saved queued messages",
    );
    expect(useQueueOutboxStore.getState().storageError).not.toBeNull();
    storage.restore();
  });

  test("a failed read recovers once storage heals", async () => {
    const storage = controlStorage();
    storage.failNextReads(2);
    const { useQueueOutboxStore } = await loadOutbox();
    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "blocked" }))).rejects.toThrow(
      "Unable to load saved queued messages",
    );
    storage.restore();

    await useQueueOutboxStore.getState().add(entry({ itemId: "healed" }));
    expect(useQueueOutboxStore.getState().entries["healed"]?.itemId).toBe("healed");
  });
});
