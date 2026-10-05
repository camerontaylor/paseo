import { describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  hold: undefined as Promise<void> | undefined,
  reads: new Map<string, Promise<void>>(),
  failWriteKey: undefined as string | undefined,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      const value = storage.values.get(key) ?? null;
      await storage.reads.get(key);
      return value;
    },
    setItem: async (key: string, value: string) => {
      await storage.hold;
      if (key === storage.failWriteKey) throw new Error("checkpoint failed");
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.values.delete(key);
    },
  },
}));

describe("durable outbox acceptance", () => {
  it("confirms storage before returning and restores the payload in a fresh store", async () => {
    storage.values.clear();
    const { useQueueOutboxStore } = await import("./index");
    await useQueueOutboxStore.persist.rehydrate();
    let release!: () => void;
    storage.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted = false;
    const entry = {
      serverId: "server",
      agentId: "agent",
      itemId: "stable-id",
      text: "restart recovery",
      images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
      attachments: [],
      composerAttachments: [],
    };
    const adding = useQueueOutboxStore
      .getState()
      .add(entry)
      .then(() => {
        accepted = true;
        return undefined;
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(accepted).toBe(false);
    expect(storage.values.has("paseo-queue-outbox")).toBe(false);
    release();
    await adding;
    storage.hold = undefined;
    vi.resetModules();
    const restarted = (await import("./index")).useQueueOutboxStore;
    await restarted.persist.rehydrate();
    expect(restarted.getState().entriesForAgent("server", "agent")).toEqual([
      { ...entry, attempts: 0, createdAt: expect.any(Number) },
    ]);
  }, 15000);
});

it("cannot dispatch an entry while its write is pending or after that write fails", async () => {
  vi.resetModules();
  storage.values.clear();
  storage.hold = undefined;
  const { useQueueOutboxStore, flushQueueOutboxForServer } = await import("./index");
  await useQueueOutboxStore.persist.rehydrate();
  let reject!: (error: Error) => void;
  storage.hold = new Promise<void>((_, rejectWrite) => {
    reject = rejectWrite;
  });
  const adding = useQueueOutboxStore.getState().add({
    serverId: "server",
    agentId: "agent",
    itemId: "unsaved",
    text: "draft",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  const failed = adding.catch((error: Error) => error.message);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const enqueueAgentMessage = vi.fn(async () => ({ agentId: "agent", revision: 1, items: [] }));
  await flushQueueOutboxForServer({
    serverId: "server",
    client: { enqueueAgentMessage },
    applySnapshot: () => {},
  });
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  storage.hold = undefined;
  reject(new Error("storage full"));
  expect(await failed).toBe("storage full");
  await flushQueueOutboxForServer({
    serverId: "server",
    client: { enqueueAgentMessage },
    applySnapshot: () => {},
  });
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  expect(useQueueOutboxStore.getState().entriesForAgent("server", "agent")).toEqual([]);
});

it("keeps durable entries for other agents eligible during a pending write", async () => {
  vi.resetModules();
  storage.values.clear();
  storage.hold = undefined;
  const { useQueueOutboxStore } = await import("./index");
  await useQueueOutboxStore.persist.rehydrate();
  const store = useQueueOutboxStore.getState();
  await store.add({
    serverId: "server",
    agentId: "agent-b",
    itemId: "durable-b",
    text: "ready",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let release!: () => void;
  storage.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = useQueueOutboxStore.getState().add({
    serverId: "server",
    agentId: "agent-a",
    itemId: "pending-a",
    text: "saving",
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(
    useQueueOutboxStore
      .getState()
      .entriesForServer("server")
      .map((entry) => entry.itemId),
  ).toEqual(["durable-b"]);
  release();
  await pending;
  storage.hold = undefined;
});

it("late routing acknowledgement cannot clear a new identical draft after ownership changes", async () => {
  storage.hold = undefined;
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY } = await import("@/stores/draft-keys");
  await useQueueOutboxStore.persist.rehydrate();
  await useDraftStore.persist.rehydrate();
  const drafts = useDraftStore.getState();
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  const version = useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]?.version;
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "old-routing",
    text: "continue",
    images: [],
    attachments: [],
    composerAttachments: [],
    routingOrigin: true,
    routingDraftVersion: version,
    routingDraftUpdatedAt: useDraftStore.getState().drafts[SESSION_ROUTING_DRAFT_KEY]?.updatedAt,
  });
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "" });
  drafts.editDraftText({ draftKey: SESSION_ROUTING_DRAFT_KEY, text: "continue" });
  await useQueueOutboxStore
    .getState()
    .acknowledge("old-routing", { agentId: "chat", revision: 1, items: [] });
  expect(useDraftStore.getState().getDraftInput(SESSION_ROUTING_DRAFT_KEY)?.text).toBe("continue");
  expect(useQueueOutboxStore.getState().acknowledgements["old-routing"]).toEqual({ queued: false });
});

it("cold-start acknowledgement waits for actual outbox and draft reads before removing ownership", async () => {
  vi.resetModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "cold-accepted",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let releaseDraft!: () => void;
  let releaseOutbox!: () => void;
  storage.reads.set(
    "paseo-drafts",
    new Promise((done) => {
      releaseDraft = done;
    }),
  );
  storage.reads.set(
    "paseo-queue-outbox",
    new Promise((done) => {
      releaseOutbox = done;
    }),
  );
  vi.resetModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  let finished = false;
  const accepting = restarted
    .getState()
    .acknowledge("cold-accepted", { agentId: "chat", revision: 1, items: [] })
    .then(() => restarted.getState().removeDurably("cold-accepted"))
    .then(() => {
      finished = true;
      return undefined;
    });
  try {
    await new Promise((done) => setTimeout(done, 0));
    expect(finished).toBe(false);
    expect(
      JSON.parse(storage.values.get("paseo-queue-outbox")!).state.entries["cold-accepted"],
    ).toBeTruthy();
    releaseOutbox();
    await new Promise((done) => setTimeout(done, 20));
    expect(finished).toBe(false);
    expect(restarted.getState().acknowledgements["cold-accepted"]).toBeUndefined();
    releaseDraft();
    await accepting;
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
    expect(JSON.parse(storage.values.get("paseo-drafts")!).state.drafts[key].input.text).toBe("");
    expect(restarted.getState().entries["cold-accepted"]).toBeUndefined();
    expect(restarted.getState().acknowledgements["cold-accepted"]).toEqual({ queued: false });
  } finally {
    releaseDraft();
    releaseOutbox();
    storage.reads.clear();
  }
});

it("failed routing draft checkpoint retains original ownership through reload and retry", async () => {
  vi.resetModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "checkpoint-owned",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  storage.failWriteKey = "paseo-drafts";
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(
      useQueueOutboxStore
        .getState()
        .acknowledge("checkpoint-owned", { agentId: "chat", revision: 1, items: [] }),
    ).rejects.toThrow("checkpoint failed");
    expect(useQueueOutboxStore.getState().acknowledgements["checkpoint-owned"]).toBeUndefined();
    expect(useQueueOutboxStore.getState().entries["checkpoint-owned"]).toBeTruthy();
    expect(useDraftStore.getState().drafts[key]).toEqual(record);
    vi.resetModules();
    const restarted = await import("./index");
    const drafts = (await import("@/stores/draft-store")).useDraftStore;
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await drafts.persist.rehydrate();
    expect(drafts.getState().getDraftInput(key)?.text).toBe("continue");
    expect(
      restarted.useQueueOutboxStore.getState().entries["checkpoint-owned"]?.routingDraftVersion,
    ).toBe(drafts.getState().drafts[key]?.version);
    storage.failWriteKey = undefined;
    const enqueueAgentMessage = vi.fn(async (_entry: { itemId: string; text: string }) => ({
      agentId: "chat",
      revision: 1,
      items: [],
    }));
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client: { enqueueAgentMessage },
      applySnapshot: () => {},
    });
    expect(enqueueAgentMessage).toHaveBeenCalledTimes(1);
    expect(enqueueAgentMessage.mock.calls[0]?.[0]).toMatchObject({
      itemId: "checkpoint-owned",
      text: "continue",
    });
    expect(restarted.useQueueOutboxStore.getState().entries["checkpoint-owned"]).toBeUndefined();
    expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
  } finally {
    storage.failWriteKey = undefined;
    warning.mockRestore();
  }
});
