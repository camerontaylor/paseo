import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";

import { AgentQueueStore, type AgentQueueJournalEntry, type StoredQueuedMessage } from "./store.js";

function storedItem(id: string, text = "keep this message"): StoredQueuedMessage {
  return {
    id,
    text,
    intent: "queue",
    deliveryState: "pending",
    attempts: 0,
    attemptSeq: 0,
    createdAt: new Date().toISOString(),
  };
}

test("journals complete queue states before they can be replaced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-journal-"));
  const store = new AgentQueueStore(dir);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [storedItem("message-1")],
    }));
    await store.mutate("agent-1", (current) => ({ ...current, items: [] }));

    const journalPath = join(dir, "agent-1.journal.jsonl");
    const entries = (await readFile(journalPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AgentQueueJournalEntry);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.after.items[0]?.text).toBe("keep this message");
    expect(entries[1]?.before.items[0]?.text).toBe("keep this message");
    expect(entries[1]?.after.items).toEqual([]);
    expect((await store.get("agent-1")).items).toEqual([]);
    // Windows reports synthesized POSIX mode bits; this assertion is meaningful
    // only where the 0600 mode used when opening the journal is enforced.
    if (process.platform !== "win32") {
      expect((await stat(journalPath)).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps a previous journal when the current journal reaches its size limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-journal-rotate-"));
  const store = new AgentQueueStore(dir, 200);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [storedItem("message-1", "original")],
    }));
    await store.mutate("agent-1", (current) => ({ ...current, items: [] }));
    const previous = await readFile(join(dir, "agent-1.journal.previous.jsonl"), "utf8");
    const current = await readFile(join(dir, "agent-1.journal.jsonl"), "utf8");
    expect(JSON.parse(previous.trim()).after.items[0].text).toBe("original");
    expect(JSON.parse(current.trim()).before.items[0].text).toBe("original");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal entries describe image bytes instead of copying them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-journal-image-"));
  const store = new AgentQueueStore(dir);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [
        {
          ...storedItem("message-1"),
          images: [{ id: "img-1", mimeType: "image/png", fileName: null, data: "QUFBQQ==" }],
        },
      ],
    }));

    const journal = await readFile(join(dir, "agent-1.journal.jsonl"), "utf8");
    expect(journal).not.toContain("QUFBQQ==");
    // The queue file still holds the payload: delivery and get_item_images need it.
    expect(await readFile(join(dir, "agent-1.json"), "utf8")).toContain("QUFBQQ==");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the queue file is written atomically with 0600 permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-perms-"));
  const store = new AgentQueueStore(dir);
  try {
    await store.mutate("agent-1", (current) => ({
      ...current,
      items: [storedItem("message-1")],
    }));
    await store.mutate("agent-1", (current) => ({ ...current, items: [] }));

    // The empty rewrite must not reset permissions either.
    if (process.platform !== "win32") {
      expect((await stat(join(dir, "agent-1.json"))).mode & 0o077).toBe(0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mutation naming a stale revision is rejected and changes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-revision-"));
  const store = new AgentQueueStore(dir);
  try {
    const first = await store.mutate("agent-1", (current) => ({
      ...current,
      items: [storedItem("message-1")],
    }));
    const staleRevision = first.queue.revision - 1;

    await expect(
      store.mutateWithExpectedRevision("agent-1", staleRevision, (current) => ({
        ...current,
        items: [storedItem("message-2")],
      })),
    ).rejects.toMatchObject({
      code: "queue_revision_conflict",
      expectedRevision: staleRevision,
      actualRevision: first.queue.revision,
    });

    // The rejected write must not land or bump the revision.
    const after = await store.get("agent-1");
    expect(after.revision).toBe(first.queue.revision);
    expect(after.items.map((item) => item.id)).toEqual(["message-1"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mutation naming the current revision applies and bumps the revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-revision-ok-"));
  const store = new AgentQueueStore(dir);
  try {
    const first = await store.mutate("agent-1", (current) => ({
      ...current,
      items: [storedItem("message-1")],
    }));

    const second = await store.mutateWithExpectedRevision(
      "agent-1",
      first.queue.revision,
      (current) => ({ ...current, items: [] }),
    );

    expect(second.changed).toBe(true);
    expect(second.queue.revision).toBe(first.queue.revision + 1);
    expect(second.queue.items).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ids lists the agents with persisted queues and delete removes the journal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-ids-"));
  const store = new AgentQueueStore(dir);
  try {
    await store.mutate("agent-1", (current) => ({ ...current, items: [storedItem("m-1")] }));
    await store.mutate("agent-2", (current) => ({ ...current, items: [storedItem("m-2")] }));

    expect(await store.ids()).toEqual(["agent-1", "agent-2"]);

    await store.delete("agent-1");
    expect(await store.ids()).toEqual(["agent-2"]);
    await expect(stat(join(dir, "agent-1.journal.jsonl"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown agent parses as an empty queue at revision 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "paseo-queue-empty-"));
  const store = new AgentQueueStore(dir);
  try {
    expect(await store.get("agent-unknown")).toEqual({
      agentId: "agent-unknown",
      revision: 0,
      items: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
