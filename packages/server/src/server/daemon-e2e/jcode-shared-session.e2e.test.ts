import { spawn } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { expect, test, vi } from "vitest";

// Explicit executable provenance is required: no accidental shared-daemon access.
// Released v0.99.1004+fork.p199 lacks the Stop fix; CI builds source 39fb7620589835d0c7f1a47653ab74f594b56eaa.
const binary = process.env.JCODE_E2E_BINARY;

test("jcode shares import, prompts, steering and Stop with an independent native peer", async () => {
  if (!binary || !path.isAbsolute(binary))
    throw new Error(
      "Set JCODE_E2E_BINARY to an absolute, pinned jcode executable (CI uses 39fb762)",
    );
  const root = await mkdtemp(path.join(tmpdir(), "paseo-jcode-shared-"));
  const socketPath = path.join(root, "jcode.sock");
  const pending: ServerResponse[] = [];
  const requests: Array<{ messages?: Array<{ role: string; content: unknown }> }> = [];
  const model = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.url?.endsWith("/models")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "e2e-model", object: "model" }] }));
      return;
    }
    const completion = JSON.parse(body);
    // jcode also asks for background session summaries when an attachment closes.
    // Tool-free summary completions must not consume a foreground response gate.
    if (!completion.tools?.length) {
      if (completion.stream === true) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(
          `data: ${JSON.stringify({ id: "auxiliary-e2e", choices: [{ index: 0, delta: { content: "E2E session" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: "auxiliary-e2e",
          object: "chat.completion",
          model: "e2e-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "E2E session" },
              finish_reason: "stop",
            },
          ],
        }),
      );
      return;
    }
    requests.push(completion);
    pending.push(response);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const address = model.address();
  if (!address || typeof address === "string") throw new Error("Missing fake model port");
  const env = {
    ...process.env,
    JCODE_NO_TELEMETRY: "1",
    JCODE_HOME: path.join(root, "home"),
    JCODE_RUNTIME_DIR: root,
    JCODE_OPENAI_COMPAT_API_BASE: `http://127.0.0.1:${address.port}/v1`,
    JCODE_OPENAI_COMPAT_DEFAULT_MODEL: "e2e-model",
    OPENAI_COMPAT_API_KEY: "isolated-test-key",
  };
  const logs: string[] = [];
  const child = spawn(
    binary,
    ["--socket", socketPath, "--provider", "openai-compatible", "--model", "e2e-model", "serve"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (data) => logs.push(String(data)));
  child.stderr.on("data", (data) => logs.push(String(data)));
  let paseo: Awaited<ReturnType<typeof createTestPaseoDaemon>> | undefined;
  let client: DaemonClient | undefined;
  let peer: Socket | undefined;
  const events: Array<Record<string, unknown>> = [];
  const reply = (text: string) => {
    const response = pending.shift()!;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ id: "chat-e2e", object: "chat.completion.chunk", model: "e2e-model", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chat-e2e", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  };
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw new Error(logs.join(""));
          return existsSync(socketPath);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    peer = connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      peer!.once("connect", resolve);
      peer!.once("error", reject);
    });
    createInterface({ input: peer }).on("line", (line) => events.push(JSON.parse(line)));
    peer.write(
      `${JSON.stringify({ type: "subscribe", id: 1, supports_turn_identity: true, working_dir: root, client_instance_id: "e2e-peer" })}\n`,
    );
    await expect
      .poll(() => events.find((event) => event.type === "session"))
      .toMatchObject({ session_id: expect.any(String) });
    peer.write(`${JSON.stringify({ type: "message", id: 2, content: "BASELINE" })}\n`);
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("BASELINE-ANSWER");
    await expect
      .poll(
        () =>
          events.filter((event) => event.type === "turn_event" && event.end === "completed").length,
        { timeout: 15_000 },
      )
      .toBe(1);
    await mkdir(path.join(root, "bin"));
    await symlink(binary, path.join(root, "bin/jcode"));
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("JCODE_") || key === "OPENAI_COMPAT_API_KEY") vi.stubEnv(key, value);
    }
    vi.stubEnv("JCODE_SOCKET", socketPath);
    vi.stubEnv("PATH", `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`);
    paseo = await createTestPaseoDaemon({ pluginsEnabled: true });
    client = new DaemonClient({ url: `ws://127.0.0.1:${paseo.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const repo = fileURLToPath(new URL("../../../../..", import.meta.url));
    await client.installDirectoryPlugin(path.join(repo, "plugins/jcode-provider"));
    const sessionId = events.find((event) => event.type === "session")!.session_id;
    const imported = await client.importAgent({
      providerId: "jcode",
      providerHandleId: `plugin:${JSON.stringify({ version: 1, data: { sessionId } })}`,
      cwd: root,
    });
    const timeline = await client.fetchAgentTimeline(imported.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    expect(
      timeline.entries
        .map((entry) => entry.item)
        .filter((item) => item.type === "user_message")
        .map((item) => item.text),
    ).toEqual(["BASELINE"]);
    const users = async () => {
      const page = await client!.fetchAgentTimeline(imported.id, {
        direction: "tail",
        limit: 0,
        projection: "canonical",
      });
      return page.entries
        .map((entry) => entry.item)
        .filter((item) => item.type === "user_message")
        .map((item) => item.text);
    };
    await client.sendMessage(imported.id, "FOREGROUND");
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    peer.write(
      `${JSON.stringify({ type: "soft_interrupt", id: 3, content: "REVERSE-STEER", urgent: true })}\n`,
    );
    // Injection occurs at the provider safe point. Release the response before awaiting it.
    reply("FOREGROUND-INTERMEDIATE");
    await expect
      .poll(users, { timeout: 15_000 })
      .toEqual(["BASELINE", "FOREGROUND", "REVERSE-STEER"]);
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("REVERSE-ANSWER");
    expect((await client.waitForFinish(imported.id, 15_000)).status).toBe("idle");
    peer.write(`${JSON.stringify({ type: "message", id: 4, content: "PEER-TURN" })}\n`);
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    const forward = client.sendMessage(imported.id, "FORWARD-STEER", {
      activeTurnBehavior: "steer",
    });
    reply("PEER-INTERMEDIATE");
    await forward;
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("FORWARD-ANSWER");
    expect((await client.waitForFinish(imported.id, 15_000)).status).toBe("idle");
    expect(await users()).toEqual([
      "BASELINE",
      "FOREGROUND",
      "REVERSE-STEER",
      "PEER-TURN",
      "FORWARD-STEER",
    ]);
    expect(
      events.filter((event) => event.type === "turn_event" && event.end === "cancelled"),
    ).toEqual([]);

    peer.write(`${JSON.stringify({ type: "message", id: 5, content: "STOP-TURN" })}\n`);
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    const toolResponse = pending.shift()!;
    toolResponse.writeHead(200, { "Content-Type": "text/event-stream" });
    toolResponse.end(
      `data: ${JSON.stringify({ id: "tool-e2e", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "stop-bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "sleep 30" }) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "tool-e2e", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
    await expect
      .poll(
        () =>
          events.some(
            (event) =>
              event.type === "turn_event" &&
              (event.event as { type?: string; id?: string }).type === "tool_exec" &&
              (event.event as { id?: string }).id === "stop-bash",
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    const stoppedTurn = events.findLast((event) => event.type === "turn_started")!.identity;
    await client.cancelAgent(imported.id);
    await expect
      .poll(
        () =>
          events
            .filter((event) => event.type === "turn_event" && event.end === "cancelled")
            .map((event) => event.identity),
        { timeout: 5_000 },
      )
      .toEqual([stoppedTurn]);
    peer.write(`${JSON.stringify({ type: "message", id: 6, content: "RELOAD-SURVIVES" })}\n`);
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    const refreshed = await Promise.race([
      client.refreshAgent(imported.id),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("refresh did not resolve while peer response held")),
          5_000,
        ),
      ),
    ]);
    expect(refreshed).toMatchObject({ agentId: imported.id });
    expect((await client.fetchAgent({ agentId: imported.id })).agent.status).toBe("running");
    const afterReloadSteer = client.sendMessage(imported.id, "AFTER-RELOAD-STEER", {
      activeTurnBehavior: "steer",
    });
    reply("RELOAD-INTERMEDIATE");
    await afterReloadSteer;
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("RELOAD-ANSWER");
    expect((await client.waitForFinish(imported.id, 15_000)).status).toBe("idle");
    expect(
      events.filter((event) => event.type === "turn_event" && event.end === "cancelled"),
    ).toHaveLength(1);
    await client.archiveAgent(imported.id);
    peer.write(
      `${JSON.stringify({ type: "message", id: 7, content: "PASEO-CLOSED-PEER-ALIVE" })}\n`,
    );
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("PEER-INDEPENDENT");
    await expect
      .poll(
        () =>
          events.filter((event) => event.type === "turn_event" && event.end === "completed").length,
      )
      .toBe(5);
    peer.destroy();
    const reopened = await client.importAgent({
      providerId: "jcode",
      providerHandleId: `plugin:${JSON.stringify({ version: 1, data: { sessionId } })}`,
      cwd: root,
    });
    await client.sendMessage(reopened.id, "PEER-CLOSED-PASEO-ALIVE");
    await expect.poll(() => pending.length, { timeout: 15_000 }).toBe(1);
    reply("PASEO-INDEPENDENT");
    expect((await client.waitForFinish(reopened.id, 15_000)).status).toBe("idle");
    expect(requests).toHaveLength(10);
    expect(
      events.find((event) => event.type === "turn_started" && event.user_content === "PEER-TURN"),
    ).toMatchObject({ origin: { kind: "client", client_instance_id: "e2e-peer" } });
    expect(
      events.find((event) => event.type === "turn_started" && event.user_content === "FOREGROUND"),
    ).toMatchObject({
      origin: { kind: "client", client_instance_id: expect.stringMatching(/^acp-/) },
    });
    const replayed = await client.fetchAgentTimeline(reopened.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    const originalBaseline = timeline.entries
      .filter((entry) => entry.item.type === "user_message" && entry.item.text === "BASELINE")
      .map((entry) => entry.item.id);
    expect(
      replayed.entries
        .filter((entry) => entry.item.type === "user_message" && entry.item.text === "BASELINE")
        .map((entry) => entry.item.id),
    ).toEqual(originalBaseline);
  } catch (error) {
    throw new Error(
      `${String(error)}\n${logs.join("")}\n${JSON.stringify(events)}\nREQUESTS:${JSON.stringify(requests.map((request) => request.messages?.slice(-1)))}`,
      {
        cause: error,
      },
    );
  } finally {
    for (const response of pending) response.destroy();
    peer?.destroy();
    child.kill("SIGTERM");
    await client?.close();
    await paseo?.close();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
