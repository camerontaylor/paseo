import { describe, expect, it } from "vitest";
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

describe("draft persistence durability", () => {
  function createFailingPersistence() {
    let nowMs = 0;
    let scheduled: { callback: () => void; dueAt: number } | null = null;
    const persisted: Record<string, string> = {};
    let failNextWrites = 0;
    const writeLog: string[] = [];
    const storage: PersistStorage<DraftState> = {
      getItem: (name): StorageValue<DraftState> | null =>
        persisted[name]
          ? (JSON.parse(persisted[name]) as {
              state?: { text?: string };
            } as StorageValue<DraftState>)
          : null,
      setItem: (name, value) => {
        writeLog.push((value as { state: { text: string } }).state.text);
        if (failNextWrites > 0) {
          failNextWrites -= 1;
          return Promise.reject(new Error("Simulated write failure"));
        }
        persisted[name] = JSON.stringify(value);
        return Promise.resolve();
      },
      removeItem: (name) => {
        delete persisted[name];
        return Promise.resolve();
      },
    };
    const scheduler: PersistenceScheduler = {
      now: () => nowMs,
      schedule: (callback, delayMs) => {
        scheduled = { callback, dueAt: nowMs + delayMs };
        return 1;
      },
      cancel: () => {
        scheduled = null;
      },
    };
    const drafts = createDraftPersistStorage(storage, scheduler);
    return {
      drafts,
      save: (text: string) => void drafts.setItem("drafts", { state: { text } }),
      failNextWrites: (count: number) => {
        failNextWrites = count;
      },
      writtenTexts: () => writeLog,
      storedText: async () => {
        const raw = persisted["drafts"];
        if (!raw) return null;
        return (JSON.parse(raw) as { state?: { text?: string } }).state?.text ?? null;
      },
      advance: (ms: number) => {
        nowMs += ms;
        if (scheduled && scheduled.dueAt <= nowMs) {
          const { callback } = scheduled;
          scheduled = null;
          callback();
        }
      },
    };
  }

  it("a flush awaits an in-flight write and a deferred debounced write", async () => {
    const drafts = createFailingPersistence();
    drafts.save("first");
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    drafts.save("second");
    // No timer tick: the explicit flush must still persist the pending write.
    await drafts.drafts.flush();
    expect(await drafts.storedText()).toBe("second");
  });

  it("a rejected write propagates and retains the payload for retry", async () => {
    const drafts = createFailingPersistence();
    // Warm the debouncer so the doomed save takes the deferred (timer) path.
    drafts.save("warm");
    await drafts.drafts.flush();
    drafts.failNextWrites(1);
    drafts.save("doomed");
    await expect(drafts.drafts.flush()).rejects.toThrow("Simulated write failure");
    // The payload is retained: once storage heals, the next flush persists it.
    await drafts.drafts.flush();
    expect(await drafts.storedText()).toBe("doomed");
  });

  it("a failed older write does not replace a newer pending checkpoint", async () => {
    const drafts = createFailingPersistence();
    drafts.save("warm");
    await drafts.drafts.flush();
    drafts.failNextWrites(1);
    drafts.save("older");
    const first = drafts.drafts.flush();
    drafts.save("newer");
    await expect(first).rejects.toThrow("Simulated write failure");
    await drafts.drafts.flush();
    // The newer checkpoint won: the retry persisted it, not the failed older one.
    expect(await drafts.storedText()).toBe("newer");
    // warm + older (failed) + newer (the retained-newer retry).
    expect(drafts.writtenTexts()).toEqual(["warm", "older", "newer"]);
  });

  it("a timer-triggered failure is surfaced by the next explicit flush", async () => {
    const drafts = createFailingPersistence();
    drafts.save("warm");
    await drafts.drafts.flush();
    drafts.save("timer-failed");
    drafts.save("timer-failed-2");
    drafts.failNextWrites(2);
    drafts.advance(DRAFT_PERSIST_INTERVAL_MS);
    // The timer write failed and was recorded (no unhandled rejection).
    await expect(drafts.drafts.flush()).rejects.toThrow("Simulated write failure");
    // Healed: the explicit flush persists the retained payload.
    await drafts.drafts.flush();
    expect(await drafts.storedText()).toBe("timer-failed-2");
  });

  it("concurrent flushes serialize behind one another", async () => {
    const drafts = createFailingPersistence();
    drafts.save("one");
    const first = drafts.drafts.flush();
    drafts.save("two");
    const second = drafts.drafts.flush();
    await Promise.all([first, second]);
    expect(await drafts.storedText()).toBe("two");
    expect(drafts.writtenTexts()).toEqual(["one", "two"]);
  });
});
