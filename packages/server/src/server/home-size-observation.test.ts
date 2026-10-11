import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { observeHomeSize } from "./home-size-observation.js";
import { promises as fs } from "node:fs";

describe("home size observation", () => {
  let home: string;
  let infos: Array<Record<string, unknown>> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  const makeLogger = () => {
    infos = [];
    const logger = createTestLogger();
    vi.spyOn(logger, "info").mockImplementation((obj) => {
      infos.push(obj as Record<string, unknown>);
      return logger;
    });
    vi.spyOn(logger, "debug").mockImplementation(() => logger);
    return logger;
  };

  const seed = () => {
    home = mkdtempSync(join(tmpdir(), "home-size-"));
    writeFileSync(join(home, "a.log"), "x".repeat(100));
    mkdirSync(join(home, "nested"));
    writeFileSync(join(home, "nested", "b.json"), "{}");
    // Outside the home: a symlinked file must not be counted.
    const outside = mkdtempSync(join(tmpdir(), "home-size-outside-"));
    writeFileSync(join(outside, "big"), "y".repeat(10_000));
    symlinkSync(join(outside, "big"), join(home, "linked"));
    return { outside };
  };

  it("logs the byte total without following symlinks, and resolves independently of startup", async () => {
    seed();
    const logger = makeLogger();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const observation = observeHomeSize(home, logger, { gate, scheduleDelayMs: 0 });
    // Startup independence: the call returns while the gate is still closed.
    await Promise.resolve();
    expect(infos).toEqual([]);
    openGate();
    await vi.waitFor(() => {
      expect(infos).toHaveLength(1);
    });
    const info = infos[0] as { bytes: number; files: number };
    expect(info.bytes).toBe(100 + 2); // a.log + nested/b.json; symlink excluded
    expect(info.files).toBe(2);
    observation.cancel();
  });

  it("cancels before the walk starts when shutdown wins", async () => {
    seed();
    const logger = makeLogger();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const observation = observeHomeSize(home, logger, { gate, scheduleDelayMs: 0 });
    observation.cancel();
    openGate();
    await Promise.resolve();
    await Promise.resolve();
    expect(infos).toEqual([]);
  });

  it("cancels during an active walk: no further traversal, no publication", async () => {
    seed();
    const logger = makeLogger();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let readdirCalls = 0;
    let releaseReaddir!: () => void;
    const firstReaddir = new Promise<void>((resolve) => {
      releaseReaddir = resolve;
    });
    const observation = observeHomeSize(home, logger, {
      gate,
      scheduleDelayMs: 0,
      deps: {
        // Wraps the REAL readdir; the first call holds a deferred barrier.
        readdir: async (dir, opts) => {
          readdirCalls += 1;
          if (readdirCalls === 1) await firstReaddir;
          return fs.readdir(dir, opts);
        },
      },
    });
    openGate();
    await vi.waitFor(() => {
      expect(readdirCalls).toBe(1);
    });
    observation.cancel();
    releaseReaddir();
    await Promise.resolve();
    await Promise.resolve();
    expect(readdirCalls).toBe(1);
    expect(infos).toEqual([]);
  });
});
