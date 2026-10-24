import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

/** Exercises the actual WebSocket admission boundary after a route was selected on an older directory. */
test("a routed queue intent cannot enter a moved, archived, or missing destination after reconnect", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-route-destination-"));
  const cwd = path.join(root, "work");
  mkdirSync(cwd);
  const daemon = await createTestPaseoDaemon({ paseoHomeRoot: root, cleanup: false });
  let client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const first = await client.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Original",
    });
    const second = await client.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Moved",
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const original = first.workspace!;
    const moved = second.workspace!;
    expect(moved.id).not.toBe(original.id);
    const agent = await client.createAgent({
      provider: "codex",
      model: "gpt-5.4-mini",
      thinkingOptionId: "low",
      cwd,
      workspaceId: original.id,
      title: "Route target",
    });
    const originalIntent = {
      agentId: agent.id,
      itemId: "route-item-one",
      text: "The prompt must stay in the original draft",
      intent: "queue" as const,
      expectedWorkspaceId: original.id,
      expectedProjectId: original.projectId,
    };

    // The app is disconnected when the host moves the agent. Its persisted intent still
    // carries the original workspace and project IDs when the connection returns.
    await client.close();
    const record = await daemon.daemon.agentStorage.get(agent.id);
    expect(record).not.toBeNull();
    await daemon.daemon.agentManager.closeAgent(agent.id);
    await daemon.daemon.agentStorage.upsert({ ...record!, workspaceId: moved.id });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    await expect(client.enqueueAgentMessage(originalIntent)).rejects.toMatchObject({
      name: "AgentQueueDestinationChangedError",
    });
    expect((await client.listQueuedAgentMessages(agent.id)).items).toEqual([]);
    // A reconnect or a duplicate flush keeps the same stable item ID and remains rejected.
    await expect(client.enqueueAgentMessage(originalIntent)).rejects.toMatchObject({
      name: "AgentQueueDestinationChangedError",
    });
    expect((await client.listQueuedAgentMessages(agent.id)).items).toEqual([]);

    await client.archiveWorkspace(moved.id);
    await expect(
      client.enqueueAgentMessage({
        ...originalIntent,
        expectedWorkspaceId: moved.id,
        expectedProjectId: moved.projectId,
      }),
    ).rejects.toMatchObject({ name: "AgentQueueDestinationChangedError" });
    expect((await client.listQueuedAgentMessages(agent.id)).items).toEqual([]);

    await expect(
      client.enqueueAgentMessage({
        ...originalIntent,
        agentId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ name: "AgentQueueDestinationChangedError" });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(root, { recursive: true, force: true });
  }
});
