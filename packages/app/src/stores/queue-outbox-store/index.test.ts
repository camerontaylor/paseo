import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";

import { QUEUE_OUTBOX_MAX_ATTEMPTS, type PendingQueueEnqueue } from "./model";

const STORE_KEY = "paseo-queue-outbox";

type OutboxModule = typeof import("./index");

interface OutboxAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

// One persisted-data plane per test; each fresh module graph gets its own
// adapter view over it. Two graphs can share data (crash simulation) while
// one graph's writer is disabled without touching the other's.
let persistedData: Map<string, string>;

function makeAdapter(): OutboxAdapter {
  return {
    getItem: async (key) => persistedData.get(key) ?? null,
    setItem: async (key, value) => {
      persistedData.set(key, value);
    },
    removeItem: async (key) => {
      persistedData.delete(key);
    },
  };
}

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

function seedInto(adapter: OutboxAdapter, entries: PendingQueueEnqueue[]): void {
  void adapter
    .setItem(
      STORE_KEY,
      JSON.stringify({
        state: { entries: Object.fromEntries(entries.map((e) => [e.itemId, e])) },
        version: 1,
      }),
    )
    .then(() => undefined);
}

async function readPersistedEntries(
  adapter: OutboxAdapter,
): Promise<Record<string, PendingQueueEnqueue>> {
  const raw = await adapter.getItem(STORE_KEY);
  if (raw === null) return {};
  const decoded = JSON.parse(raw) as { state?: { entries?: Record<string, PendingQueueEnqueue> } };
  return decoded.state?.entries ?? {};
}

/**
 * Injects failures and hangs into the backing storage. The outbox holds the
 * stub object, so swapping `setItem` redirects every persistence write.
 */
function controlStorage(adapter: OutboxAdapter) {
  const original = adapter.setItem.bind(adapter);
  const originalGetItem = adapter.getItem.bind(adapter);
  let failNext = 0;
  let healthyBeforeFail = Number.POSITIVE_INFINITY;
  let hangNext = 0;
  let healthyReadsBeforeFail = Number.POSITIVE_INFINITY;
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
  adapter.setItem = wrapped as typeof adapter.setItem;
  adapter.getItem = (async (key: string) => {
    if (healthyReadsBeforeFail <= 0) {
      throw new Error("Simulated read failure");
    }
    healthyReadsBeforeFail -= 1;
    return originalGetItem(key);
  }) as typeof adapter.getItem;
  return {
    failNextCalls(count: number) {
      failNext = count;
    },
    /** Every read fails until restore. */
    failAllReads() {
      healthyReadsBeforeFail = 0;
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
      adapter.setItem = original as typeof adapter.setItem;
      adapter.getItem = originalGetItem as typeof adapter.getItem;
    },
  };
}

/**
 * Every test loads a fresh module graph: the module-level write chain, the
 * volatile park fence, and the in-flight lanes cannot leak between tests, and
 * a fresh import doubles as the restart/crash simulation.
 */
async function loadOutbox(
  seed?: PendingQueueEnqueue[],
  configureAdapter?: (adapter: OutboxAdapter) => void,
): Promise<OutboxModule & { adapter: OutboxAdapter }> {
  vi.resetModules();
  // The AsyncStorage alias does not survive vi.resetModules(): the re-evaluated
  // graph would capture the real (native) module. Hand each graph its own
  // adapter over the shared data plane, so one graph's writer can be disabled
  // without touching another graph's.
  const adapter = makeAdapter();
  configureAdapter?.(adapter);
  vi.doMock("@react-native-async-storage/async-storage", () => ({
    default: adapter,
    clearAsyncStorageStub: () => {},
  }));
  // Seed between the mock registration and the store creation so the store's
  // automatic rehydration reads it.
  if (seed) seedInto(adapter, seed);
  const mod = await import("./index");
  return { ...mod, adapter };
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

beforeEach(() => {
  persistedData = new Map();
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
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1", text: "old" }));
    storage.failNextCalls(1);
    await expect(useQueueOutboxStore.getState().removeDurably("item-1")).rejects.toThrow();
    storage.restore();

    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1", text: "new" }));

    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]?.text).toBe("new");
  });

  test("a rejected write does not poison the chain for later writes", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
    storage.failNextCalls(1);
    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "doomed" }))).rejects.toThrow();
    storage.restore();

    await useQueueOutboxStore.getState().add(entry({ itemId: "healthy" }));

    const persisted = await readPersistedEntries(adapter);
    expect(persisted["doomed"]).toBeUndefined();
    expect(persisted["healthy"]?.itemId).toBe("healthy");
  });

  test("interleaved durable mutations converge after reload", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    await Promise.all([
      useQueueOutboxStore.getState().bumpAttemptsDurably("item-1"),
      useQueueOutboxStore.getState().removeDurably("item-1"),
    ]);

    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]).toBeUndefined();
  });

  test("a failed bump keeps the in-memory increment and reports the error", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().bumpAttemptsDurably("item-1")).rejects.toThrow();

    // The unpersisted increment can only over-count toward the park cap.
    expect(useQueueOutboxStore.getState().entries["item-1"]?.attempts).toBe(1);
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("entriesForServer hides every entry of an agent with a write in flight", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    // The probe and the attempt reservation persist; the park write fails.
    const { flushQueueOutboxForServer: flushNoNinth, adapter } = await loadOutbox([
      entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1 }),
    ]);
    const storage = controlStorage(adapter);
    const sends: string[] = [];

    storage.failAfterHealthy(2);
    await flushNoNinth({
      serverId: "server-1",
      client: createClient(sends, new Set(["item-1"])),
      applySnapshot: () => {},
    });
    expect(sends).toEqual(["item-1"]);

    // Still-failing storage: the probe gates the flush before any send.
    await expect(
      flushNoNinth({
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
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    storage.failNextCalls(1);

    await expect(useQueueOutboxStore.getState().markFailedDurably("item-1")).rejects.toThrow();

    expect(useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    storage.restore();
  });

  test("a failed explicit retry keeps the park fence: no send from the retry or a later flush", async () => {
    const { flushQueueOutboxForServer, retryFailedOutboxEntry, useQueueOutboxStore, adapter } =
      await loadOutbox([entry({ attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 })]);
    const storage = controlStorage(adapter);
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
    const { flushQueueOutboxForServer, useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    const { flushQueueOutboxForServer, useQueueOutboxStore, adapter } = await loadOutbox();
    const storage = controlStorage(adapter);
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
    const { flushQueueOutboxForServer, adapter } = await loadOutbox([
      entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 2 }),
    ]);
    let releaseSend: (snapshot: AgentQueueSnapshot) => void = () => {};
    const sends: string[] = [];
    const hangingClient = {
      enqueueAgentMessage: (input: { itemId: string }) => {
        sends.push(input.itemId);
        // The reservation provably precedes this send: the persisted count is
        // already on disk inside the enqueue callback, before any promise is
        // returned.
        const persisted = JSON.parse(persistedData.get(STORE_KEY) ?? "{}") as {
          state?: { entries?: Record<string, { attempts?: number }> };
        };
        expect(persisted.state?.entries?.["item-1"]?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS - 1);
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

    // Deterministic barrier: the send has been invoked while still hanging.
    await vi.waitFor(() => expect(sends).toEqual(["item-1"]));

    // Crash: the fresh module graph gets its own adapter over the same data
    // plane. The abandoned graph's writer is disabled — only its adapter — so
    // its late closures cannot touch restarted storage.
    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    adapter.setItem = (() => Promise.resolve()) as typeof adapter.setItem;
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
  // Reads #1 and #2 fail: the automatic hydration at import, and the recovery
  // attempt the gate issues — the one carrying a waiter.
  const failFirstReads =
    (count: number) =>
    (adapter: OutboxAdapter): void => {
      const originalGet = adapter.getItem.bind(adapter);
      let calls = 0;
      adapter.getItem = (async (key: string) => {
        calls += 1;
        if (calls <= count) throw new Error("Simulated read failure");
        return originalGet(key);
      }) as typeof adapter.getItem;
    };

  test("a rejected read rejects waiting operations instead of pending forever", async () => {
    const { useQueueOutboxStore } = await loadOutbox(undefined, failFirstReads(2));

    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }))).rejects.toThrow(
      "Unable to load saved queued messages",
    );
    expect(useQueueOutboxStore.getState().storageError).not.toBeNull();
  });

  test("a failed read recovers once storage heals", async () => {
    const { useQueueOutboxStore } = await loadOutbox(undefined, failFirstReads(2));
    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "blocked" }))).rejects.toThrow(
      "Unable to load saved queued messages",
    );

    // The next gated call re-attempts hydration; the read now succeeds.
    await useQueueOutboxStore.getState().add(entry({ itemId: "healed" }));
    expect(useQueueOutboxStore.getState().entries["healed"]?.itemId).toBe("healed");
  });

  test("a storage-error write during a failed hydration never erases saved payloads", async () => {
    const saved = entry({ itemId: "saved", text: "survives" });
    const { useQueueOutboxStore } = await loadOutbox([saved], failFirstReads(2));

    // The gate rejects and reports storageError. The persisted write of that
    // state change must be skipped: memory holds no entries yet, and writing
    // them would replace the saved payload with an empty set.
    await expect(useQueueOutboxStore.getState().add(entry({ itemId: "blocked" }))).rejects.toThrow(
      "Unable to load saved queued messages",
    );
    const midPayload = JSON.parse(persistedData.get(STORE_KEY) ?? "{}") as {
      state?: { entries?: Record<string, unknown> };
    };
    expect(Object.keys(midPayload.state?.entries ?? {})).toEqual(["saved"]);

    // Recover: the read succeeds, the saved payload is intact, and the new
    // entry joins it in storage.
    await useQueueOutboxStore.getState().add(entry({ itemId: "fresh" }));
    const keys = Object.keys(useQueueOutboxStore.getState().entries);
    expect(keys.sort()).toEqual(["fresh", "saved"]);
    const payload = JSON.parse(persistedData.get(STORE_KEY) ?? "{}") as {
      state?: { entries?: Record<string, unknown> };
    };
    expect(Object.keys(payload.state?.entries ?? {}).sort()).toEqual(["fresh", "saved"]);
  });
});

describe("queue outbox tombstones", () => {
  test("requestRemoval persists the tombstone across a reload", async () => {
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1" }),
      removalRequested: true,
    });

    expect(useQueueOutboxStore.getState().entries["item-1"]?.removalRequested).toBe(true);

    const reloaded = await loadOutbox();
    await reloaded.useQueueOutboxStore.persist.rehydrate();
    expect(reloaded.useQueueOutboxStore.getState().entries["item-1"]?.removalRequested).toBe(true);
  });

  test("a tombstoned entry flushes as a removal, never an enqueue", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1" }),
      removalRequested: true,
    });

    const enqueues: string[] = [];
    const removals: string[] = [];
    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          enqueues.push(input.itemId);
          return snapshotWith(input.itemId);
        },
        removeQueuedAgentMessage: async (agentId, itemId) => {
          removals.push(itemId);
          return snapshotWith(itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(enqueues).toEqual([]);
    expect(removals).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
  });

  test("a cancellation racing acknowledgement survives until the host confirms removal", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    let releaseEnqueue: ((snapshot: AgentQueueSnapshot) => void) | null = null;
    const enqueues: string[] = [];
    const removals: string[] = [];
    const flush = flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          enqueues.push(input.itemId);
          return new Promise<AgentQueueSnapshot>((resolve) => {
            releaseEnqueue = () => resolve(snapshotWith(input.itemId));
          });
        },
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          return snapshotWith(itemId);
        },
      },
      applySnapshot: () => {},
    });

    // Deterministic barrier: the enqueue has been invoked and hangs.
    await vi.waitFor(() => expect(enqueues).toEqual(["item-1"]));

    // The user cancels while the enqueue is in flight: a durable tombstone.
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1", text: "hello" }),
      removalRequested: true,
    });
    releaseEnqueue!(snapshotWith("item-1"));
    await flush;

    // The raced tombstone forced the host removal before the entry settled.
    expect(enqueues).toEqual(["item-1"]);
    expect(removals).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
  });

  test("a snapshot containing the item does not clear a tombstoned entry", async () => {
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1" }),
      removalRequested: true,
    });

    await useQueueOutboxStore.getState().removeDurably("item-1", true);

    expect(useQueueOutboxStore.getState().entries["item-1"]?.removalRequested).toBe(true);
  });

  test("a failed removal keeps the tombstone, records the failure, and parks at the cap", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox([
      entry({
        itemId: "item-1",
        removalRequested: true,
        removalFailedAt: 1,
        attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1,
      }),
    ]);
    const enqueues: string[] = [];
    const removals: string[] = [];
    const exhausted: string[] = [];

    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          enqueues.push(input.itemId);
          return snapshotWith(input.itemId);
        },
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          throw new Error("removal transport down");
        },
      },
      applySnapshot: () => {},
      onEntryExhausted: (failed) => exhausted.push(failed.itemId),
    });

    // Never re-enqueued; the failure outcome is recorded; the cap parks it.
    expect(enqueues).toEqual([]);
    expect(removals).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["item-1"]?.removalRequested).toBe(true);
    expect(useQueueOutboxStore.getState().entries["item-1"]?.removalFailedAt).toBeDefined();
    expect(useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBeDefined();
    expect(exhausted).toEqual(["item-1"]);
  });

  test("requestRemoval of an unknown id creates a synthetic tombstone", async () => {
    const { useQueueOutboxStore } = await loadOutbox();

    await useQueueOutboxStore.getState().requestRemoval({
      serverId: "server-1",
      agentId: "agent-1",
      itemId: "accepted-row",
      text: "host has this",
      intent: "queue",
      images: [],
      attachments: [],
      composerAttachments: [],
      createdAt: 1,
      attempts: 0,
      removalRequested: true,
    });

    expect(useQueueOutboxStore.getState().entries["accepted-row"]?.removalRequested).toBe(true);
  });

  test("a parked tombstone is removed from a host that contains the item", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox([
      entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 }),
    ]);

    // The user cancels the parked row: the fence must lift so the lane can
    // dispatch the host removal.
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 }),
      removalRequested: true,
    });

    const removals: string[] = [];
    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => snapshotWith(input.itemId),
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          return snapshotWith(itemId);
        },
      },
      applySnapshot: () => {},
    });

    expect(removals).toEqual(["item-1"]);
    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
  });

  test("a persistently conflicting dispatch re-reserves per retry and parks at the cap, never nine", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore, adapter } = await loadOutbox([
      entry({ itemId: "item-1", attempts: 6 }),
    ]);
    // The fresh module graph owns the error class: vi.resetModules() makes the
    // file-level import a different constructor than the lane's instanceof.
    const { QueueRevisionConflictError } = await import("./model");
    const dispatches: string[] = [];
    const exhausted: string[] = [];

    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          dispatches.push(input.itemId);
          throw new QueueRevisionConflictError();
        },
      },
      applySnapshot: () => {},
      onEntryExhausted: (failed) => exhausted.push(failed.itemId),
    });

    // attempt seven → eight, never nine: exactly two reserved retries, then
    // the second conflict parks the entry.
    expect(dispatches).toEqual(["item-1", "item-1"]);
    const state = useQueueOutboxStore.getState().entries["item-1"];
    expect(state?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS);
    expect(state?.failedAt).toBeDefined();
    expect(exhausted).toEqual(["item-1"]);
    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS);
    expect(persisted["item-1"]?.failedAt).toBeDefined();
  });

  test("a failed requestRemoval restores the prior park and dispatches nothing", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore, adapter } = await loadOutbox([
      entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 }),
    ]);
    // Armed after load: the seed write must not consume the failure.
    const storage = controlStorage(adapter);
    storage.failNextCalls(1);

    await expect(
      useQueueOutboxStore.getState().requestRemoval({
        ...entry({ itemId: "item-1", attempts: QUEUE_OUTBOX_MAX_ATTEMPTS, failedAt: 1 }),
        removalRequested: true,
      }),
    ).rejects.toThrow("Simulated storage failure");
    storage.restore();

    // The prior park is intact in memory, in storage, and behind the fence.
    const state = useQueueOutboxStore.getState().entries["item-1"];
    expect(state?.removalRequested).toBeUndefined();
    expect(state?.failedAt).toBe(1);
    expect(state?.attempts).toBe(QUEUE_OUTBOX_MAX_ATTEMPTS);
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]?.failedAt).toBe(1);
    expect(persisted["item-1"]?.removalRequested).toBeUndefined();

    // The restored park fences the flush: no removal escapes automatically.
    const removals: string[] = [];
    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => snapshotWith(input.itemId),
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          return snapshotWith(itemId);
        },
      },
      applySnapshot: () => {},
    });
    expect(removals).toEqual([]);
    expect(useQueueOutboxStore.getState().entries["item-1"]?.failedAt).toBe(1);
  });

  test("a failed cancellation blocks its agent's lane while another agent advances", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox([
      entry({
        itemId: "doomed-removal",
        agentId: "agent-1",
        attempts: QUEUE_OUTBOX_MAX_ATTEMPTS - 1,
        removalRequested: true,
      }),
      entry({ itemId: "other-agent-item", agentId: "agent-2" }),
    ]);
    const enqueues: string[] = [];
    const removals: string[] = [];

    await flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          enqueues.push(input.itemId);
          return snapshotWith(input.itemId);
        },
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          throw new Error("removal transport down");
        },
      },
      applySnapshot: () => {},
    });

    // agent-1's failed removal parks at the cap (7 → 8); agent-2 drains.
    expect(removals).toEqual(["doomed-removal"]);
    expect(enqueues).toEqual(["other-agent-item"]);
    const doomed = useQueueOutboxStore.getState().entries["doomed-removal"];
    expect(doomed?.removalRequested).toBe(true);
    expect(doomed?.removalFailedAt).toBeDefined();
    expect(doomed?.failedAt).toBeDefined();
    expect(useQueueOutboxStore.getState().entries["other-agent-item"]).toBeUndefined();
  });

  test("cancelling B while A awaits acknowledgement dispatches only B's removal", async () => {
    const { flushQueueOutboxForServer, useQueueOutboxStore } = await loadOutbox([
      entry({ itemId: "item-a", createdAt: 1 }),
      entry({ itemId: "item-b", createdAt: 2 }),
    ]);
    const enqueues: string[] = [];
    const removals: string[] = [];
    let releaseA: (() => void) | null = null;

    const flush = flushQueueOutboxForServer({
      serverId: "server-1",
      client: {
        enqueueAgentMessage: async (input) => {
          enqueues.push(input.itemId);
          if (input.itemId === "item-a") {
            await new Promise<void>((resolve) => {
              releaseA = resolve;
            });
          }
          return snapshotWith(input.itemId);
        },
        removeQueuedAgentMessage: async (_agentId, itemId) => {
          removals.push(itemId);
          return snapshotWith(itemId);
        },
      },
      applySnapshot: () => {},
    });

    // Deterministic barrier: A's enqueue is in flight inside the serialized
    // lane; B then becomes a tombstone.
    await vi.waitFor(() => expect(enqueues).toEqual(["item-a"]));
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-b", createdAt: 2 }),
      removalRequested: true,
    });
    releaseA!();
    await flush;

    // B rode the same lane as a removal — never enqueued.
    expect(enqueues).toEqual(["item-a"]);
    expect(removals).toEqual(["item-b"]);
    expect(useQueueOutboxStore.getState().entries["item-a"]).toBeUndefined();
    expect(useQueueOutboxStore.getState().entries["item-b"]).toBeUndefined();
  });
});

describe("queue outbox discard boundary", () => {
  test("a discard is refused at the serialized boundary when a tombstone raced the confirmation", async () => {
    const { useQueueOutboxStore } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    // The user requests removal while the discard's confirmation dialog is
    // open; the confirm then lands.
    await useQueueOutboxStore.getState().requestRemoval({
      ...entry({ itemId: "item-1" }),
      removalRequested: true,
    });
    await expect(
      useQueueOutboxStore.getState().discardQueuedEntryDurably("item-1"),
    ).rejects.toThrow("queue_removal_pending");

    // The unresolved cancellation survives the attempted discard.
    expect(useQueueOutboxStore.getState().entries["item-1"]?.removalRequested).toBe(true);
    const { useQueueOutboxStore: reloaded } = await loadOutbox();
    await reloaded.persist.rehydrate();
    expect(reloaded.getState().entries["item-1"]?.removalRequested).toBe(true);
  });

  test("a discard of a plain entry removes durably", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));

    await useQueueOutboxStore.getState().discardQueuedEntryDurably("item-1");

    expect(useQueueOutboxStore.getState().entries["item-1"]).toBeUndefined();
    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]).toBeUndefined();
  });

  test("a failed discard write restores the entry and reports the storage error", async () => {
    const { useQueueOutboxStore, adapter } = await loadOutbox();
    await useQueueOutboxStore.getState().add(entry({ itemId: "item-1" }));
    const storage = controlStorage(adapter);
    storage.failNextCalls(1);

    await expect(
      useQueueOutboxStore.getState().discardQueuedEntryDurably("item-1"),
    ).rejects.toThrow("Simulated storage failure");
    storage.restore();

    expect(useQueueOutboxStore.getState().entries["item-1"]?.itemId).toBe("item-1");
    expect(useQueueOutboxStore.getState().storageError?.itemId).toBe("item-1");
    const persisted = await readPersistedEntries(adapter);
    expect(persisted["item-1"]?.itemId).toBe("item-1");
  });
});
