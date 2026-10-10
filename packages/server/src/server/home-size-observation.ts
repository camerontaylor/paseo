import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

export interface HomeSizeObservationOptions {
  /**
   * Injectable barriers for tests. Production always reads the real
   * filesystem; tests wrap the REAL calls with deferred promises only.
   */
  deps?: {
    readdir?: typeof fs.readdir;
    stat?: typeof fs.stat;
  };
  /** Deferred start gate (tests): the walk cannot begin until it resolves. */
  gate?: Promise<void>;
  scheduleDelayMs?: number;
}

export interface HomeSizeObservation {
  /** Cancels the scheduled timer and aborts an active walk. */
  cancel(): void;
}

interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface StatLike {
  size: number;
}

/**
 * Deferred, non-blocking one-shot home-size observation at daemon start.
 * Deliberately grows-disk homes make the number worth logging, never worth a
 * boot-blocking recursive scan: the walk is scheduled off the startup path,
 * runs sequentially (one directory in flight), never follows symlinks, and
 * cancels deterministically on daemon shutdown.
 */
export function observeHomeSize(
  home: string,
  logger: Logger,
  options?: HomeSizeObservationOptions,
): HomeSizeObservation {
  const controller = new AbortController();
  const readdir = options?.deps?.readdir ?? fs.readdir.bind(fs);
  const stat = options?.deps?.stat ?? fs.stat.bind(fs);
  const timer = setTimeout(() => {
    void runWalk().catch(() => undefined);
  }, options?.scheduleDelayMs ?? 0);
  timer.unref();

  const runWalk = async (): Promise<void> => {
    if (options?.gate) {
      await options.gate;
      if (controller.signal.aborted) return;
    }
    let bytes = 0;
    let files = 0;
    const stack: string[] = [home];
    while (stack.length > 0) {
      if (controller.signal.aborted) return;
      const dir = stack.pop()!;
      let dirents: DirentLike[];
      try {
        dirents = (await readdir(dir, { withFileTypes: true })) as DirentLike[];
      } catch (error) {
        logger.debug({ err: error, dir }, "daemon.home_size_error");
        return;
      }
      if (controller.signal.aborted) return;
      for (const dirent of dirents) {
        // Symlinks are never followed and never stat'd: the observation is
        // best-effort and must not chase cycles or leave the home.
        if (dirent.isSymbolicLink()) continue;
        const entryPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        let fileStat: StatLike;
        try {
          fileStat = await stat(entryPath);
        } catch (error) {
          logger.debug({ err: error, path: entryPath }, "daemon.home_size_error");
          return;
        }
        if (controller.signal.aborted) return;
        bytes += fileStat.size;
        files += 1;
      }
    }
    if (controller.signal.aborted) return;
    logger.info({ home, bytes, files }, "daemon.home_size");
  };

  return {
    cancel() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
