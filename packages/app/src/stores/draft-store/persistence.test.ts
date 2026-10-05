import { describe, expect, it, vi } from "vitest";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import {
  createDraftPersistStorage,
  DRAFT_PERSIST_INTERVAL_MS,
  type PersistenceScheduler,
} from "./persistence";

interface DraftState {
  text: string;
}

function createDraftPersistence() {
  let nowMs = 0;
  let saved: StorageValue<DraftState> | null = null;
  let scheduled: { callback: () => void; dueAt: number } | null = null;
  const storage: PersistStorage<DraftState> = {
    getItem: () => saved,
    setItem: (_name, value) => {
      saved = value;
    },
    removeItem: () => {
      saved = null;
    },
  };
  const scheduler: PersistenceScheduler = {
    now: () => nowMs,
    schedule: (callback, delayMs) => (scheduled = { callback, dueAt: nowMs + delayMs }),
    cancel: () => {
      scheduled = null;
    },
  };
  const drafts = createDraftPersistStorage(storage, scheduler);

  return {
    save(text: string) {
      drafts.setItem("drafts", { state: { text } });
    },
    remove() {
      drafts.removeItem("drafts");
    },
    flush() {
      return drafts.flush();
    },
    advance(ms: number) {
      nowMs += ms;
      if (scheduled && scheduled.dueAt <= nowMs) {
        const { callback } = scheduled;
        scheduled = null;
        callback();
      }
    },
    text() {
      return saved?.state.text ?? null;
    },
  };
}

describe("draft persistence", () => {
  it("checkpoints the first change and the latest change in each interval", () => {
    const drafts = createDraftPersistence();

    drafts.save("a");
    drafts.save("ab");
    drafts.save("abc");
    expect(drafts.text()).toBe("a");

    drafts.advance(DRAFT_PERSIST_INTERVAL_MS - 1);
    expect(drafts.text()).toBe("a");

    drafts.advance(1);
    expect(drafts.text()).toBe("abc");
  });

  it("does not restore a pending draft after storage is cleared", () => {
    const drafts = createDraftPersistence();

    drafts.save("first checkpoint");
    drafts.save("pending checkpoint");
    drafts.remove();
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);

    expect(drafts.text()).toBeNull();
  });

  it("continues checkpointing the latest change across consecutive intervals", () => {
    const drafts = createDraftPersistence();

    drafts.save("first");
    drafts.save("first interval");
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    expect(drafts.text()).toBe("first interval");

    drafts.save("second");
    drafts.save("second interval");
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    expect(drafts.text()).toBe("second interval");
  });

  it("flushes the latest pending change before the interval ends", async () => {
    const drafts = createDraftPersistence();

    drafts.save("first checkpoint");
    drafts.save("pending checkpoint");
    await drafts.flush();

    expect(drafts.text()).toBe("pending checkpoint");
  });
});

it("strict routing flush reports a failed background checkpoint and retries the latest value", async () => {
  let saved: StorageValue<DraftState> | null = null;
  let fail = false;
  const storage: PersistStorage<DraftState> = {
    getItem: () => saved,
    setItem: async (_name, value) => {
      if (fail) throw new Error("disk full");
      saved = value;
    },
    removeItem: () => {
      saved = null;
    },
  };
  const drafts = createDraftPersistStorage(storage);
  await drafts.setItem("drafts", { state: { text: "continue" } });
  fail = true;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    drafts.setItem("drafts", { state: { text: "" } });
    await expect(drafts.flushDurably()).rejects.toThrow("disk full");
    expect((await drafts.getItem("drafts"))?.state.text).toBe("continue");
    fail = false;
    await drafts.flushDurably();
    expect((await drafts.getItem("drafts"))?.state.text).toBe("");
  } finally {
    warning.mockRestore();
  }
});

it("strict checkpoints stay ordered behind a background write added while waiting", async () => {
  const writes: Array<{ text: string; release: () => void }> = [];
  let saved = "initial";
  const storage: PersistStorage<DraftState> = {
    getItem: () => ({ state: { text: saved } }),
    setItem: (_name, value) =>
      new Promise<void>((done) => {
        writes.push({
          text: value.state.text,
          release: () => {
            saved = value.state.text;
            done();
          },
        });
      }),
    removeItem: () => {},
  };
  const drafts = createDraftPersistStorage(storage);
  const first = drafts.setItem("drafts", { state: { text: "old" } });
  const durable = drafts.flushDurably();
  drafts.setItem("drafts", { state: { text: "" } });
  const laterBackground = drafts.flush();
  expect(writes.map((write) => write.text)).toEqual(["old"]);
  writes[0]?.release();
  await first;
  await vi.waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.text).toBe("");
  let confirmed = false;
  const confirming = durable.then(() => {
    confirmed = true;
    return undefined;
  });
  expect(confirmed).toBe(false);
  writes[1]?.release();
  await laterBackground;
  await vi.waitFor(() => expect(writes).toHaveLength(3));
  expect(writes[2]?.text).toBe("");
  writes[2]?.release();
  await confirming;
  expect(saved).toBe("");
  expect(confirmed).toBe(true);
});
