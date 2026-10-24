import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { getFullAccessConfig } from "./daemon-e2e/agent-configs.js";

test("reports connected device outbox counts, resolves agent IDs, and clears on disconnect", async () => {
  const daemon = await createTestPaseoDaemon();
  const cwd = mkdtempSync(path.join(tmpdir(), "paseo-queue-inspect-"));
  const phone = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: "inspection-phone",
  });
  const reader = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await phone.connect();
    await reader.connect();
    expect(reader.getLastServerInfoMessage()?.features?.deliveryInspect).toBe(true);
    const workspace = await reader.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (!workspace.workspace) throw new Error(workspace.error ?? "Workspace creation failed");
    const agent = await reader.createAgent({
      ...getFullAccessConfig("codex"),
      cwd,
      workspaceId: workspace.workspace.id,
      title: "Inspection test",
    });
    await expect(reader.inspectAgentDelivery("missing-agent")).rejects.toThrow();
    await phone.reportClientOutbox({
      agentId: agent.id,
      deviceLabel: "Phone",
      platform: "ios",
      pending: 1,
      failed: 2,
      uncertain: 3,
      oldestCreatedAt: "2026-10-24T00:00:00.000Z",
    });
    const inspection = await reader.inspectAgentDelivery(agent.id.slice(0, 12));
    expect(inspection.agentId).toBe(agent.id);
    expect(inspection.queue?.agentId).toBe(agent.id);
    expect(inspection.deviceReports).toEqual([
      expect.objectContaining({
        clientId: "inspection-phone",
        pending: 1,
        failed: 2,
        uncertain: 3,
      }),
    ]);
    await phone.close();
    await vi.waitFor(async () => {
      expect((await reader.inspectAgentDelivery(agent.id)).deviceReports).toEqual([]);
    });
  } finally {
    await phone.close().catch(() => undefined);
    await reader.close().catch(() => undefined);
    await daemon.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30_000);
