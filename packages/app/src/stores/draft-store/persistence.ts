import type { PersistStorage } from "zustand/middleware";

export const DRAFT_PERSIST_INTERVAL_MS = 200;
export interface PersistenceScheduler {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface DraftPersistStorage<T> extends PersistStorage<T> {
  flush: () => Promise<void>;
  flushDurably: () => Promise<void>;
}

let nextSystemTimerId = 0;
const systemTimers = new Map<number, ReturnType<typeof setTimeout>>();
const systemScheduler: PersistenceScheduler = {
  now: Date.now,
  schedule: (callback, delayMs) => {
    const id = nextSystemTimerId++;
    systemTimers.set(
      id,
      setTimeout(() => {
        systemTimers.delete(id);
        callback();
      }, delayMs),
    );
    return id;
  },
  cancel: (handle) => {
    if (typeof handle !== "number") return;
    const timer = systemTimers.get(handle);
    if (timer === undefined) return;
    clearTimeout(timer);
    systemTimers.delete(handle);
  },
};

export function createDraftPersistStorage<T>(
  storage: PersistStorage<T>,
  scheduler?: PersistenceScheduler,
): DraftPersistStorage<T>;
export function createDraftPersistStorage<T>(
  storage: PersistStorage<T> | undefined,
  scheduler?: PersistenceScheduler,
): DraftPersistStorage<T> | undefined;
export function createDraftPersistStorage<T>(
  storage: PersistStorage<T> | undefined,
  scheduler: PersistenceScheduler = systemScheduler,
): DraftPersistStorage<T> | undefined {
  if (!storage) {
    return undefined;
  }

  interface Checkpoint {
    name: string;
    value: Parameters<typeof storage.setItem>[1];
  }
  let pending: Checkpoint | null = null;
  let timer: unknown = null;
  let latestWrite: Checkpoint | null = null;
  const writesInFlight = new Set<Promise<void>>();
  let lastWriteInFlight: Promise<void> | null = null;
  let lastWriteAt = -Infinity;

  const cancelTimer = () => {
    if (timer !== null) {
      scheduler.cancel(timer);
      timer = null;
    }
  };
  const writeCheckpoint = async (write: Checkpoint): Promise<void> => {
    lastWriteAt = scheduler.now();
    const previous = lastWriteInFlight;
    const result = previous
      ? previous.catch(() => {}).then(() => storage.setItem(write.name, write.value))
      : storage.setItem(write.name, write.value);
    if (result === undefined) return;
    const attempt = Promise.resolve(result).then(() => undefined);
    lastWriteInFlight = attempt;
    writesInFlight.add(attempt);
    try {
      await attempt;
    } finally {
      writesInFlight.delete(attempt);
      if (lastWriteInFlight === attempt) lastWriteInFlight = null;
    }
  };
  const flush = async (): Promise<void> => {
    cancelTimer();
    const write = pending;
    pending = null;
    if (!write) return;
    try {
      await writeCheckpoint(write);
    } catch (error) {
      console.warn("[DraftStore] Failed to persist draft checkpoint", error);
    }
  };
  const flushDurably = async (): Promise<void> => {
    cancelTimer();
    // Routing retains its outbox item until the current checkpoint is durable.
    // Wait for background attempts, then rewrite the latest value even when a
    // background attempt already consumed it or failed without a pending timer.
    await Promise.allSettled(writesInFlight);
    cancelTimer();
    const write = pending ?? latestWrite;
    pending = null;
    if (write) await writeCheckpoint(write);
  };

  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      pending = { name, value };
      latestWrite = pending;
      const delay = DRAFT_PERSIST_INTERVAL_MS - (scheduler.now() - lastWriteAt);
      if (delay <= 0) {
        return flush();
      }
      timer ??= scheduler.schedule(() => {
        void flush();
      }, delay);
    },
    removeItem: (name) => {
      cancelTimer();
      pending = null;
      latestWrite = null;
      lastWriteAt = scheduler.now();
      return storage.removeItem(name);
    },
    flush,
    flushDurably,
  };
}
