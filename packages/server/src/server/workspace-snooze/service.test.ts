import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "../workspace-registry.js";
import { WorkspaceSnoozeService } from "./service.js";
import type { WorkspaceSnoozeResult } from "@getpaseo/protocol/workspace-snooze";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(
  check: () => Promise<WorkspaceSnoozeResult> = async () => ({
    status: "blocked",
    reason: "CI is running",
  }),
) {
  const dir = await mkdtemp(join(tmpdir(), "workspace-snooze-"));
  const logger = createTestLogger();
  const file = join(dir, "workspaces.json");
  const registry = new FileBackedWorkspaceRegistry(file, logger);
  await registry.initialize();
  let now = Date.parse("2026-10-06T10:00:00Z");
  for (const workspaceId of ["one", "two"])
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId,
        projectId: "project",
        cwd: dir,
        kind: "worktree",
        displayName: workspaceId,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      }),
    );
  const wakes: string[] = [];
  const service = new WorkspaceSnoozeService({
    registry,
    logger,
    now: () => now,
    check,
    wake: async (workspace) => {
      wakes.push(workspace.workspaceId);
    },
  });
  cleanup.push(async () => {
    await service.stop();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    service,
    registry,
    wakes,
    file,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("a persisted timed snooze wakes once after downtime and keeps same-directory workspaces independent", async () => {
  const f = await fixture();
  await f.service.set("one", {
    mode: "time",
    wakeAt: "2026-10-06T11:00:00.000Z",
    timezone: "Europe/Prague",
  });
  const restarted = new FileBackedWorkspaceRegistry(f.file, f.logger);
  await restarted.initialize();
  expect((await restarted.get("one"))?.snooze?.config.mode).toBe("time");
  expect((await restarted.get("two"))?.snooze).toBeUndefined();
  f.advance(86_400_000);
  await Promise.all([f.service.runDue(), f.service.runDue()]);
  expect((await f.registry.get("one"))?.snooze).toBeNull();
  expect(f.wakes).toEqual(["one"]);
});
test("blocked and failed checks stay hidden and reschedule from completion without catch-up bursts", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    if (calls === 2) throw new Error("CLI unavailable");
    return { status: "blocked", reason: "CI is running" };
  });
  await f.service.set("one", { mode: "ai", prompt: "CI passes", intervalHours: 1 });
  await f.service.runDue();
  expect((await f.registry.get("one"))?.snooze?.lastCheck).toMatchObject({
    status: "blocked",
    reason: "CI is running",
  });
  f.advance(86_400_000);
  await f.service.runDue();
  await f.service.runDue();
  expect(calls).toBe(2);
  expect((await f.registry.get("one"))?.snooze).toMatchObject({
    nextCheckAt: "2026-10-07T11:00:00.000Z",
    lastCheck: { status: "unknown", reason: "CLI unavailable" },
  });
  expect(f.wakes).toEqual([]);
});
test("unblocked evidence wakes an AI snooze", async () => {
  const f = await fixture(async () => ({ status: "unblocked", reason: "CI passed" }));
  await f.service.set("one", { mode: "ai", prompt: "CI passes", intervalHours: 24 });
  await f.service.runDue();
  expect(f.wakes).toEqual(["one"]);
  expect((await f.registry.get("one"))?.snooze).toBeNull();
});
test("editing a snooze while a check runs discards its late unblocked result", async () => {
  let resolve!: (value: WorkspaceSnoozeResult) => void;
  const pending = new Promise<WorkspaceSnoozeResult>((done) => {
    resolve = done;
  });
  let started!: () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  const f = await fixture(async () => {
    started();
    return pending;
  });
  await f.service.set("one", { mode: "ai", prompt: "CI passes", intervalHours: 1 });
  const check = f.service.runDue();
  await running;
  await f.service.set("one", { mode: "time", wakeAt: "2026-10-07T10:00:00.000Z", timezone: "UTC" });
  resolve({ status: "unblocked", reason: "CI passed" });
  await check;
  expect((await f.registry.get("one"))?.snooze?.config.mode).toBe("time");
  expect(f.wakes).toEqual([]);
});
test("archiving cancels snoozes and past dates are rejected", async () => {
  const f = await fixture();
  await expect(
    f.service.set("one", { mode: "time", wakeAt: "2026-10-05T10:00:00.000Z", timezone: "UTC" }),
  ).rejects.toThrow("future");
  await f.service.set("one", { mode: "ai", prompt: "CI passes", intervalHours: 1 });
  await f.registry.archive("one", "2026-10-06T10:00:00.000Z");
  await f.service.runDue();
  expect((await f.registry.get("one"))?.snooze).toBeNull();
  expect(f.wakes).toEqual([]);
});

test("one slow AI check does not block a due timed workspace or overlap another AI run", async () => {
  let resolve!: (value: WorkspaceSnoozeResult) => void;
  const pending = new Promise<WorkspaceSnoozeResult>((done) => {
    resolve = done;
  });
  let started!: () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    started();
    return pending;
  });
  await f.service.set("one", { mode: "ai", prompt: "CI passes", intervalHours: 1 });
  await f.service.set("two", { mode: "time", wakeAt: "2026-10-06T11:00:00.000Z", timezone: "UTC" });
  const check = f.service.runDue();
  await running;
  f.advance(3_600_000);
  await f.service.runDue();
  expect(f.wakes).toEqual(["two"]);
  expect(calls).toBe(1);
  resolve({ status: "blocked", reason: "Still running" });
  await check;
});
