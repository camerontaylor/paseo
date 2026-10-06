import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

// Uses the installed Codex account and real Luna; excluded from default unit CI by suffix.
test("Luna reads workspace evidence through a CLI and wakes it without exposing an agent tab", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "snooze-luna-"));
  const logger = createTestLogger();
  const file = join(cwd, "ready.txt");
  await writeFile(file, "READY\n");
  const daemon = await createTestPaseoDaemon({
    agentClients: { codex: new CodexAppServerAgentClient(logger) },
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    const created = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (!created.workspace) throw new Error(created.error ?? "No workspace");
    const id = created.workspace.id;
    await client.setWorkspaceSnooze(id, {
      mode: "ai",
      prompt:
        "Read ready.txt in this workspace with a CLI tool. Unsnooze if its entire content is READY followed by a newline. Do not change anything.",
      intervalHours: 1,
    });
    await expect
      .poll(
        async () => {
          const snooze = (await client.fetchWorkspaces({})).entries.find(
            (entry) => entry.id === id,
          )?.snooze;
          return snooze === null || Boolean(snooze?.lastCheck);
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(
      (await client.fetchWorkspaces({})).entries.find((entry) => entry.id === id)?.snooze,
    ).toBeNull();
    const activity = await client.getBackgroundActivity();
    const check = activity.requests.find((request) => request.snoozeCheck);
    expect(check).toMatchObject({
      workspaceId: id,
      cwd: created.workspace.workspaceDirectory,
      status: "completed",
      attempts: [
        { provider: "codex", configuredModel: expect.stringMatching(/^gpt-(6|5\.6)-luna$/) },
      ],
    });
    if (!check?.attempts[0]) throw new Error("Missing checker transcript");
    const transcript = await client.getBackgroundActivity(check.attempts[0].conversationId);
    expect(
      transcript.rows.some(
        (row) => row.event.type === "timeline" && row.event.item.type === "tool_call",
      ),
    ).toBe(true);
    expect((await client.fetchAgents({})).entries).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("READY\n");
    await client.removeProject(created.workspace.projectId);
  } finally {
    await client.close();
    await daemon.close();
    await rm(cwd, { recursive: true, force: true });
  }
}, 150_000);
