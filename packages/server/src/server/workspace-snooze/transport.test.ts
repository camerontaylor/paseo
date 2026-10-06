import { afterEach, expect, test } from "vitest";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../test-utils/daemon-test-context.js";
import type { PushPayload } from "../push/index.js";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

let context: DaemonTestContext | undefined;
afterEach(async () => {
  await context?.cleanup();
});
test("snooze RPCs publish directory state and a due workspace emits one wake notification", async () => {
  const pushes: PushPayload[] = [];
  context = await createDaemonTestContext({
    pushNotificationSender: {
      send: async (payload) => {
        pushes.push(payload);
      },
    },
  });
  const { client, daemon } = context;
  const created = await client.createWorkspace({
    source: { kind: "directory", path: daemon.paseoHome },
  });
  if (!created.workspace) throw new Error(created.error ?? "No workspace");
  const workspaceId = created.workspace.id;
  const feed = client.observeEvents(["workspace.snooze.woke"], { notifications: true });
  const wakes: SessionOutboundMessage[] = [];
  feed.subscribe({
    snapshot: () => {},
    update: (event) => {
      wakes.push(event);
    },
  });
  await feed.ready;
  await client.setWorkspaceSnooze(workspaceId, {
    mode: "time",
    wakeAt: new Date(Date.now() + 1000).toISOString(),
    timezone: "UTC",
  });
  expect(
    (await client.fetchWorkspaces({})).entries.find((workspace) => workspace.id === workspaceId)
      ?.snooze?.config.mode,
  ).toBe("time");
  await expect.poll(() => pushes.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => wakes.length).toBe(1);
  expect(pushes[0].data).toMatchObject({ workspaceId });
  expect(wakes[0]).toMatchObject({
    type: "workspace.snooze.woke",
    payload: { workspaceId, shouldNotify: false },
  });
  expect(
    (await client.fetchWorkspaces({})).entries.find((workspace) => workspace.id === workspaceId)
      ?.snooze,
  ).toBeNull();
  await feed.release();
  await client.removeProject(created.workspace.projectId);
}, 30_000);

test("unavailable Luna remains snoozed with an inspectable failed background check", async () => {
  context = await createDaemonTestContext();
  const { client, daemon } = context;
  const created = await client.createWorkspace({
    source: { kind: "directory", path: daemon.paseoHome },
  });
  if (!created.workspace) throw new Error(created.error ?? "No workspace");
  const workspaceId = created.workspace.id;
  await client.setWorkspaceSnooze(workspaceId, {
    mode: "ai",
    prompt: "CI passes",
    intervalHours: 24,
  });
  await expect
    .poll(
      async () =>
        (await client.fetchWorkspaces({})).entries.find((workspace) => workspace.id === workspaceId)
          ?.snooze?.lastCheck?.status,
    )
    .toBe("unknown");
  const activity = await client.getBackgroundActivity();
  expect(activity.requests.filter((request) => request.snoozeCheck)).toMatchObject([
    {
      workspaceId,
      status: "failed",
      attempts: [{ provider: "codex", configuredModel: "gpt-6-luna" }],
    },
  ]);
  await client.setWorkspaceSnooze(workspaceId, null);
  await client.removeProject(created.workspace.projectId);
}, 30_000);
