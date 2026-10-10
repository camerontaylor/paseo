import type { PersistStorage } from "zustand/middleware";

export const DRAFT_PERSIST_INTERVAL_MS = 200;
export interface PersistenceScheduler {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface DraftPersistStorage<T> extends PersistStorage<T> {
  flush: () => Promise<void>;
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

  let pending: { name: string; value: Parameters<typeof storage.setItem>[1] } | null = null;
  let timer: unknown = null;
  let lastWriteAt = -Infinity;
  // Writes serialize: an explicit flush awaits any in-flight write before its
  // own, and a failed write retains its payload (unless a newer checkpoint
  // arrived) so the next flush retries it.
  let inFlight: Promise<void> | null = null;
  let lastFailure: {
    error: unknown;
    payload: { name: string; value: Parameters<typeof storage.setItem>[1] };
  } | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      scheduler.cancel(timer);
      timer = null;
    }
  };
  const SYNC_DONE = Symbol("draft-flush-sync");
  // Writes the pending (or previously failed) checkpoint. Returns SYNC_DONE
  // when the storage completed synchronously, so idle flushes keep their
  // same-tick side effects; otherwise the storage's own promise.
  const performWrite = (): Promise<void> | typeof SYNC_DONE => {
    console.log(
      "[pw-probe] performWrite, pending text:",
      (pending?.value as { state?: { text?: string } } | null)?.state?.text,
    );
    const failed = lastFailure;
    lastFailure = null;
    const write = pending ?? failed?.payload ?? null;
    pending = null;
    if (!write) {
      return SYNC_DONE;
    }
    lastWriteAt = scheduler.now();
    try {
      const outcome = storage.setItem(write.name, write.value);
      // A synchronously-completing storage keeps the flush same-tick; an
      // async one is awaited with failure retention.
      if (outcome instanceof Promise) {
        return outcome.then(
          () => undefined,
          (error: unknown) => {
            retainFailedWrite(write, error);
            throw error;
          },
        );
      }
      return SYNC_DONE;
    } catch (error) {
      retainFailedWrite(write, error);
      throw error;
    }
  };
  const retainFailedWrite = (
    write: { name: string; value: Parameters<typeof storage.setItem>[1] },
    error: unknown,
  ): void => {
    // Retain the failed payload unless a newer checkpoint replaced it, and
    // record the failure: an explicit flush re-attempts and surfaces it
    // instead of hiding it behind a console warning.
    if (pending === null) {
      pending = { name: write.name, value: write.value };
    }
    lastFailure = { error, payload: { name: write.name, value: write.value } };
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (inFlight !== null) {
      return inFlight
        .catch(() => {})
        .then(() => {
          inFlight = null;
          return flush();
        });
    }
    const outcome = performWrite();
    if (outcome === SYNC_DONE) {
      return Promise.resolve();
    }
    inFlight = outcome;
    void outcome.catch(() => {});
    return outcome;
  };

  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      console.log(
        "[pw-probe] setItem dispatch, pending text:",
        (value as { state?: { text?: string } }).state?.text,
      );
      pending = { name, value };
      const delay = DRAFT_PERSIST_INTERVAL_MS - (scheduler.now() - lastWriteAt);
      if (delay <= 0) {
        return flush();
      }
      timer ??= scheduler.schedule(() => {
        timer = null;
        flush().catch(() => {
          // A timer-triggered failure is recorded; the next explicit flush
          // re-attempts the retained payload and surfaces the failure.
        });
      }, delay);
    },
    removeItem: (name) => {
      cancelTimer();
      pending = null;
      lastWriteAt = scheduler.now();
      return storage.removeItem(name);
    },
    flush,
  };
}
