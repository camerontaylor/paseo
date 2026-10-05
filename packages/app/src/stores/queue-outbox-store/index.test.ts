import { describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  hold: undefined as Promise<void> | undefined,
  reads: new Map<string, Promise<void>>(),
  failWriteKey: undefined as string | undefined,
  failOnceKey: undefined as string | undefined,
  draftHold: undefined as Promise<void> | undefined,
  outboxHold: undefined as Promise<void> | undefined,
  failRemovalItem: undefined as string | undefined,
  failDispatchMarkerItem: undefined as string | undefined,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      const value = storage.values.get(key) ?? null;
      await storage.reads.get(key);
      return value;
    },
    setItem: async (key: string, value: string) => {
      const failOnce = key === storage.failOnceKey;
      if (failOnce) storage.failOnceKey = undefined;
      if (key === "paseo-drafts") await storage.draftHold;
      if (key === "paseo-queue-outbox") {
        await storage.outboxHold;
        if (
          storage.failDispatchMarkerItem &&
          JSON.parse(value).state.entries[storage.failDispatchMarkerItem]?.routingDispatchHeld ===
            false
        ) {
          storage.failDispatchMarkerItem = undefined;
          throw new Error("dispatch marker failed");
        }
        if (storage.failRemovalItem && !JSON.parse(value).state.entries[storage.failRemovalItem])
          throw new Error("removal failed");
      }
      await storage.hold;
      if (failOnce || key === storage.failWriteKey) throw new Error("checkpoint failed");
      storage.values.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.values.delete(key);
    },
  },
}));

async function resetPersistedModules() {
  const { flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  await flushDraftPersistStorageDurably().catch(() => {});
  vi.resetModules();
}

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
    await resetPersistedModules();
    const restarted = (await import("./index")).useQueueOutboxStore;
    await restarted.persist.rehydrate();
    expect(restarted.getState().entriesForAgent("server", "agent")).toEqual([
      { ...entry, attempts: 0, createdAt: expect.any(Number) },
    ]);
  }, 15000);
});

it("cannot dispatch an entry while its write is pending or after that write fails", async () => {
  await resetPersistedModules();
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
  await resetPersistedModules();
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
  await resetPersistedModules();
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
  await resetPersistedModules();
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
  await resetPersistedModules();
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
    await resetPersistedModules();
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

it("overlapping acknowledgements checkpoint restored ownership before publishing a receipt", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  const record = useDraftStore.getState().drafts[key];
  await useQueueOutboxStore.getState().add({
    serverId: "host",
    agentId: "chat",
    itemId: "overlap",
    text: "continue",
    routingOrigin: true,
    routingDraftVersion: record?.version,
    routingDraftUpdatedAt: record?.updatedAt,
    images: [],
    attachments: [],
    composerAttachments: [],
  });
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  storage.failOnceKey = "paseo-drafts";
  const snapshot = { agentId: "chat", revision: 1, items: [] };
  const first = useQueueOutboxStore
    .getState()
    .acknowledge("overlap", snapshot)
    .catch(() => "failed");
  await new Promise((done) => setTimeout(done, 20));
  const second = useQueueOutboxStore
    .getState()
    .acknowledge("overlap", snapshot)
    .then(() => useQueueOutboxStore.getState().removeDurably("overlap"));
  expect(useQueueOutboxStore.getState().acknowledgements.overlap).toBeUndefined();
  release();
  expect(await first).toBe("failed");
  await second;
  storage.draftHold = undefined;
  await flushDraftPersistStorageDurably();
  await resetPersistedModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(restarted.getState().entries.overlap).toBeUndefined();
  expect(drafts.getState().getDraftInput(key)?.text ?? "").toBe("");
});

it("sending within the draft throttle checkpoints ownership before dispatch and cold recovery", async () => {
  await resetPersistedModules();
  storage.values.clear();
  const { useQueueOutboxStore } = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  await useDraftStore.persist.rehydrate();
  await useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "old" });
  await flushDraftPersistStorageDurably();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "new" });
  const record = useDraftStore.getState().drafts[key];
  let release!: () => void;
  storage.draftHold = new Promise<void>((done) => {
    release = done;
  });
  const enqueueAgentMessage = vi.fn(async () => {
    throw new Error("lost response");
  });
  const input = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "Chat",
      excerpt: "",
      confidence: 1,
    },
    text: "new",
    isHostEligible: () => true,
    itemId: "fast-send",
    draftVersion: record!.version,
    draftUpdatedAt: record!.updatedAt,
    client: { enqueueAgentMessage },
    outbox: useQueueOutboxStore.getState(),
    applySnapshot: () => {},
  };
  const sending = deliverRoutedPrompt(input).catch((error: Error) => error.message);
  await new Promise((done) => setTimeout(done, 20));
  expect(enqueueAgentMessage).not.toHaveBeenCalled();
  expect(useQueueOutboxStore.getState().entries["fast-send"]).toBeUndefined();
  release();
  expect(await sending).toBe("lost response");
  storage.draftHold = undefined;
  await resetPersistedModules();
  const restarted = (await import("./index")).useQueueOutboxStore;
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(restarted.getState().entries["fast-send"]).toMatchObject({
    routingDraftVersion: drafts.getState().drafts[key]?.version,
    routingDraftUpdatedAt: drafts.getState().drafts[key]?.updatedAt,
    text: "new",
  });
  expect(drafts.getState().getDraftInput(key)?.text).toBe("new");
  await restarted.getState().removeDurably("fast-send");
  storage.failWriteKey = "paseo-drafts";
  await expect(
    deliverRoutedPrompt({ ...input, itemId: "unsaved-send", outbox: restarted.getState() }),
  ).rejects.toThrow("checkpoint failed");
  storage.failWriteKey = undefined;
  expect(enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(restarted.getState().entries["unsaved-send"]).toBeUndefined();
  expect(drafts.getState().getDraftInput(key)?.text).toBe("new");
});

async function routingDispatchFixture(itemId: string) {
  await resetPersistedModules();
  storage.values.clear();
  const outbox = await import("./index");
  const { useDraftStore, flushDraftPersistStorageDurably } = await import("@/stores/draft-store");
  const { SESSION_ROUTING_DRAFT_KEY: key } = await import("@/stores/draft-keys");
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  await useDraftStore.persist.rehydrate();
  await outbox.useQueueOutboxStore.persist.rehydrate();
  useDraftStore.getState().editDraftText({ draftKey: key, text: "continue" });
  await flushDraftPersistStorageDurably();
  const record = useDraftStore.getState().drafts[key]!;
  const enqueueAgentMessage = vi.fn(async (_entry: { itemId: string; text: string }) => ({
    agentId: "chat",
    revision: 1,
    items: [],
  }));
  const input = {
    recipient: {
      serverId: "host",
      agentId: "chat",
      workspaceId: "workspace",
      projectId: "project",
      projectViewKey: "view",
      hostLabel: "M5",
      projectName: "Paseo",
      title: "Chat",
      excerpt: "",
      confidence: 1,
    },
    text: "continue",
    itemId,
    draftVersion: record.version,
    draftUpdatedAt: record.updatedAt,
    client: { enqueueAgentMessage },
    outbox: outbox.useQueueOutboxStore.getState(),
    isHostEligible: () => true,
    applySnapshot: () => {},
  };
  return { ...outbox, useDraftStore, key, record, input, enqueueAgentMessage, deliverRoutedPrompt };
}

for (const checkpoint of ["draft", "outbox"] as const) {
  it(`host exclusion while ${checkpoint} storage waits cannot dispatch now or on reconnect`, async () => {
    const fixture = await routingDispatchFixture(`excluded-${checkpoint}`);
    let eligible = true;
    let release!: () => void;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    if (checkpoint === "draft") storage.draftHold = hold;
    else storage.outboxHold = hold;
    const sending = fixture
      .deliverRoutedPrompt({ ...fixture.input, isHostEligible: () => eligible })
      .catch((error: Error) => error.message);
    await new Promise((done) => setTimeout(done, 20));
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(fixture.useQueueOutboxStore.getState().entriesForServer("host")).toEqual([]);
    eligible = false;
    release();
    expect(await sending).toContain("excluded");
    storage.draftHold = undefined;
    storage.outboxHold = undefined;
    await fixture.flushQueueOutboxForServer({
      serverId: "host",
      client: fixture.input.client,
      applySnapshot: () => {},
    });
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
    expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
    expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(fixture.record);
    await resetPersistedModules();
    const restarted = await import("./index");
    await restarted.useQueueOutboxStore.persist.rehydrate();
    await restarted.flushQueueOutboxForServer({
      serverId: "host",
      client: fixture.input.client,
      applySnapshot: () => {},
    });
    expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
  });
}

it("failed durable release of an excluded fresh item stays held through reload", async () => {
  const fixture = await routingDispatchFixture("excluded-removal");
  let eligible = true;
  let release!: () => void;
  storage.outboxHold = new Promise<void>((done) => {
    release = done;
  });
  const sending = fixture
    .deliverRoutedPrompt({ ...fixture.input, isHostEligible: () => eligible })
    .catch((error: Error) => error.message);
  await new Promise((done) => setTimeout(done, 20));
  eligible = false;
  storage.failRemovalItem = fixture.input.itemId;
  release();
  expect(await sending).toBe("removal failed");
  storage.outboxHold = undefined;
  storage.failRemovalItem = undefined;
  expect(
    fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).not.toHaveBeenCalled();
  expect(
    restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
  await restarted.useQueueOutboxStore.getState().removeDurably(fixture.input.itemId);
});

for (const rejection of ["direct", "reconnect"] as const) {
  it(`${rejection} rejection publishes no release when durable removal fails`, async () => {
    const fixture = await routingDispatchFixture(`failed-${rejection}`);
    const { AgentQueueDestinationChangedError } =
      await import("@getpaseo/client/internal/daemon-client");
    if (rejection === "reconnect") {
      fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
      await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
    }
    fixture.enqueueAgentMessage.mockRejectedValue(new AgentQueueDestinationChangedError());
    storage.failRemovalItem = fixture.input.itemId;
    try {
      if (rejection === "direct")
        await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("removal failed");
      else
        await expect(
          fixture.flushQueueOutboxForServer({
            serverId: "host",
            client: fixture.input.client,
            applySnapshot: () => {},
          }),
        ).rejects.toThrow("removal failed");
      expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeTruthy();
      expect(
        fixture.useQueueOutboxStore.getState().rejections[fixture.input.itemId],
      ).toBeUndefined();
      expect(fixture.useDraftStore.getState().drafts[fixture.key]).toEqual(fixture.record);
      await resetPersistedModules();
      const restarted = await import("./index");
      const drafts = (await import("@/stores/draft-store")).useDraftStore;
      await restarted.useQueueOutboxStore.persist.rehydrate();
      await drafts.persist.rehydrate();
      expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toMatchObject({
        itemId: fixture.input.itemId,
        routingDraftVersion: fixture.record.version,
        routingDraftUpdatedAt: fixture.record.updatedAt,
      });
      expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
      storage.failRemovalItem = undefined;
      const restartedClient = await import("@getpaseo/client/internal/daemon-client");
      fixture.enqueueAgentMessage.mockRejectedValue(
        new restartedClient.AgentQueueDestinationChangedError(),
      );
      await restarted.flushQueueOutboxForServer({
        serverId: "host",
        client: fixture.input.client,
        applySnapshot: () => {},
      });
      expect(
        restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId],
      ).toBeUndefined();
      expect(
        restarted.useQueueOutboxStore.getState().rejections[fixture.input.itemId],
      ).toBeTruthy();
    } finally {
      storage.failRemovalItem = undefined;
    }
  });
}

it("a successful RPC acknowledgement survives failed dispatch-marker persistence without a pushed snapshot", async () => {
  const fixture = await routingDispatchFixture("ack-with-failed-marker");
  storage.failDispatchMarkerItem = fixture.input.itemId;
  expect(await fixture.deliverRoutedPrompt(fixture.input)).toEqual({ queued: false });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  expect(fixture.useQueueOutboxStore.getState().acknowledgements[fixture.input.itemId]).toEqual({
    queued: false,
  });
  expect(fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(drafts.getState().getDraftInput(fixture.key)?.text ?? "").toBe("");
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
});

it("an uncertain RPC with failed marker recovers through explicit same-ID retry without unholding unsent items", async () => {
  const fixture = await routingDispatchFixture("unknown-with-failed-marker");
  storage.failDispatchMarkerItem = fixture.input.itemId;
  fixture.enqueueAgentMessage.mockRejectedValueOnce(new Error("response lost"));
  await expect(fixture.deliverRoutedPrompt(fixture.input)).rejects.toThrow("response lost");
  expect(
    fixture.useQueueOutboxStore.getState().entries[fixture.input.itemId]?.routingDispatchHeld,
  ).toBe(true);
  await resetPersistedModules();
  const restarted = await import("./index");
  const drafts = (await import("@/stores/draft-store")).useDraftStore;
  await restarted.useQueueOutboxStore.persist.rehydrate();
  await drafts.persist.rehydrate();
  expect(drafts.getState().drafts[fixture.key]).toEqual(fixture.record);
  await restarted.flushQueueOutboxForServer({
    serverId: "host",
    client: fixture.input.client,
    applySnapshot: () => {},
  });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(1);
  const { deliverRoutedPrompt } = await import("@/components/sidebar/session-routing/delivery");
  expect(
    await deliverRoutedPrompt({
      ...fixture.input,
      outbox: restarted.useQueueOutboxStore.getState(),
    }),
  ).toEqual({ queued: false });
  expect(fixture.enqueueAgentMessage).toHaveBeenCalledTimes(2);
  expect(fixture.enqueueAgentMessage.mock.calls.map(([entry]) => entry)).toEqual([
    expect.objectContaining({
      itemId: fixture.input.itemId,
      text: "continue",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
    }),
    expect.objectContaining({
      itemId: fixture.input.itemId,
      text: "continue",
      expectedWorkspaceId: "workspace",
      expectedProjectId: "project",
    }),
  ]);
  expect(restarted.useQueueOutboxStore.getState().entries[fixture.input.itemId]).toBeUndefined();
});
