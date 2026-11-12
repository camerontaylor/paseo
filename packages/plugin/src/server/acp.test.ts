import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  ProviderCapability,
  ProviderConnection,
  ProviderEvent,
  ProviderInput,
} from "./provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAcpProvider, type AcpOptions, type AcpStreamMessage } from "./acp.js";

// Captured from camerontaylor/jcode 101858d8bc38328cd1bcc148e3973b9cb499a7d6, tests/fixtures/acp.
function jcodeCorpusUpdates(name: string, throughResponse?: number): SessionUpdate[] {
  const records = readFileSync(new URL(`./fixtures/jcode/${name}.jsonl`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const boundary =
    throughResponse === undefined
      ? records.length
      : records.findIndex((record) => record.dir === "a2c" && record.msg.id === throughResponse) +
        1;
  return records.slice(0, boundary).flatMap((record) => {
    return record.dir === "a2c" && record.msg.method === "session/update"
      ? [record.msg.params.update as SessionUpdate]
      : [];
  });
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function fakeAcp(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-acp-test-"));
  temporaryDirectories.push(directory);
  const executable = path.join(directory, "agent.cjs");
  await writeFile(executable, source, "utf8");
  return executable;
}

async function connect(
  executable: string,
  capabilities: string[],
  transformers?: Parameters<typeof runAcpProvider>[0]["transformers"],
): Promise<{ connection: ProviderConnection; events: ProviderEvent[] }> {
  const registration = runAcpProvider({
    id: "test-acp",
    label: "Test ACP",
    command: [process.execPath, executable],
    transformers,
  });
  const connection = await registration.connect({ versions: [1], capabilities });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  return { connection, events };
}

function openInput(
  settings: Record<string, string> = {},
): Extract<ProviderInput, { type: "session.open" }> {
  return {
    type: "session.open",
    requestId: "open-1",
    sessionId: "session-1",
    config: { cwd: "/repo", env: {}, mcpServers: {}, settings, persist: true },
    history: "skip",
  };
}

async function waitForEvent(
  events: ProviderEvent[],
  predicate: (event: ProviderEvent) => boolean,
): Promise<ProviderEvent> {
  await expect.poll(() => events.find(predicate), { timeout: 3_000 }).toBeTruthy();
  return events.find(predicate)!;
}

type AcpRequestMessage = Extract<AcpStreamMessage, { id: string | number | null; method: string }>;

interface ConnectorInstance {
  readonly requests: AcpRequestMessage[];
  readsCanceled: boolean;
  writesClosed: boolean;
  closeFromAgent(): void;
  request(method: string, params: unknown): Promise<unknown>;
  respond(request: AcpRequestMessage, result: unknown): void;
  reject(request: AcpRequestMessage, message: string): void;
  notify(method: string, params: unknown): void;
}

interface ConnectorResponse {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface ConnectorHarnessOptions {
  capabilities?: Record<string, unknown>;
  configOptions?: unknown[];
  /** Session updates the agent streams for a prompt (keyed by its text) before ending the turn. */
  promptUpdates?(promptText: string): unknown[];
  handleMessage?(instance: ConnectorInstance, message: AcpStreamMessage): boolean;
  handleRequest?(instance: ConnectorInstance, request: AcpRequestMessage): boolean;
}

function countRequests(instance: ConnectorInstance, method: string): number {
  return instance.requests.filter((request) => request.method === method).length;
}

function countRequestedMethod(instances: ConnectorInstance[], method: string): number {
  return instances.reduce((total, instance) => total + countRequests(instance, method), 0);
}

function countTerminatedTurns(events: ProviderEvent[], turnId: string): number {
  return events.filter(
    (event) =>
      event.type === "session.turn" && event.state !== "started" && event.turnId === turnId,
  ).length;
}

function turnLifecycle(events: ProviderEvent[]): { started: string[]; ended: string[] } {
  const started = new Set<string>();
  const ended = new Set<string>();
  for (const event of events) {
    if (event.type !== "session.turn") continue;
    if (event.state === "started") started.add(event.turnId);
    else ended.add(event.turnId);
  }
  return { started: [...started].sort(), ended: [...ended].sort() };
}

function receiveConnectorMessage(
  instance: ConnectorInstance,
  message: AcpStreamMessage,
  options?: ConnectorHarnessOptions,
): void {
  if (!("method" in message)) return;
  if ("id" in message) instance.requests.push(message as AcpRequestMessage);
  if (options?.handleMessage?.(instance, message)) return;
  if (!("id" in message)) return;
  const request = message as AcpRequestMessage;
  if (request.method === "_jcode/detach") {
    instance.respond(request, {});
    return;
  }
  if (options?.handleRequest?.(instance, request)) return;
  respondToConnectorRequest(instance, request, options);
}

function respondToConnectorRequest(
  instance: ConnectorInstance,
  request: AcpRequestMessage,
  options?: ConnectorHarnessOptions,
): void {
  if (request.method === "initialize") {
    instance.respond(request, {
      protocolVersion: request.params
        ? (request.params as { protocolVersion: number }).protocolVersion
        : PROTOCOL_VERSION,
      agentCapabilities: options?.capabilities ?? {},
    });
  } else if (request.method === "session/new" || request.method === "session/load") {
    instance.respond(request, {
      sessionId: "connector-session",
      modes: null,
      configOptions: options?.configOptions ?? [],
    });
  } else if (request.method === "session/prompt") {
    const { prompt } = request.params as { prompt: Array<{ type: string; text?: string }> };
    const promptText = prompt.find((part) => part.type === "text")?.text ?? "";
    for (const update of options?.promptUpdates?.(promptText) ?? []) {
      instance.notify("session/update", { sessionId: "connector-session", update });
    }
    instance.respond(request, { stopReason: "end_turn" });
  } else if (request.method === "session/close") {
    instance.respond(request, {});
  } else if (request.method === "session/set_config_option") {
    const params = request.params as { configId: string; value: string | boolean };
    instance.respond(request, {
      configOptions: (options?.configOptions ?? []).map((option) =>
        (option as { id?: string }).id === params.configId
          ? Object.assign({}, option, { currentValue: params.value })
          : option,
      ),
    });
  }
}

function connectorHarness(options?: ConnectorHarnessOptions) {
  const instances: ConnectorInstance[] = [];
  const connector = () => {
    let controller!: ReadableStreamDefaultController<AcpStreamMessage>;
    let requestSequence = 0;
    const responses = new Map<number, ConnectorResponse>();
    const instance: ConnectorInstance = {
      requests: [],
      readsCanceled: false,
      writesClosed: false,
      closeFromAgent: () => controller.close(),
      request: (method, params) => {
        const response = new Promise<unknown>((resolve, reject) => {
          requestSequence += 1;
          responses.set(requestSequence, { resolve, reject });
          controller.enqueue({ jsonrpc: "2.0", id: requestSequence, method, params });
        });
        void response.catch(() => undefined);
        return response;
      },
      respond: (request, result) => controller.enqueue({ jsonrpc: "2.0", id: request.id, result }),
      reject: (request, message) =>
        controller.enqueue({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message } }),
      notify: (method, params) => controller.enqueue({ jsonrpc: "2.0", method, params }),
    };
    instances.push(instance);
    const readable = new ReadableStream<AcpStreamMessage>({
      start(value) {
        controller = value;
      },
      cancel() {
        instance.readsCanceled = true;
      },
    });
    const writable = new WritableStream<AcpStreamMessage>({
      write(message) {
        if (!("method" in message)) {
          if (typeof message.id !== "number") return;
          const response = responses.get(message.id);
          if (!response) return;
          responses.delete(message.id);
          if ("error" in message) {
            response.reject(
              new Error(
                message.error.data === undefined
                  ? message.error.message
                  : `${message.error.message}: ${JSON.stringify(message.error.data)}`,
              ),
            );
          } else response.resolve(message.result);
          return;
        }
        receiveConnectorMessage(instance, message, options);
      },
      close() {
        instance.writesClosed = true;
      },
      abort() {
        instance.writesClosed = true;
      },
    });
    return { readable, writable };
  };
  return { connector, instances };
}

const basicAgent = `const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: [] } }), 150);
  else if (message.method === "session/prompt") send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
});`;

describe("runAcpProvider", () => {
  it("spawns the daemon-resolved launch for probes, catalogues, listing, and sessions", async () => {
    const executable = await fakeAcp(`
if (process.env.LAUNCH_TOKEN !== "resolved" || process.env.CLAUDECODE || process.env.PASEO_NODE_ENV) process.exit(1);
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  let result;
  if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion, agentCapabilities: { sessionCapabilities: { list: {} } } };
  else if (message.method === "session/new") result = { sessionId: "native", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "resolved", options: [{ value: "resolved", name: process.env.SESSION_TOKEN || "probe" }] }] };
  else if (message.method === "session/list") result = { sessions: [] };
  else return;
  send({ jsonrpc: "2.0", id: message.id, result });
});`);
    const registration = runAcpProvider({
      id: "launch-acp",
      label: "Launch ACP",
      command: ["missing-default-command"],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "session.list"],
      launch: { command: process.execPath, args: [executable], env: { LAUNCH_TOKEN: "resolved" } },
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({ type: "catalog", requestId: "catalog" });
      expect(await waitForEvent(events, (event) => event.type === "catalog")).toMatchObject({
        catalog: { models: [{ id: "resolved", label: "probe" }] },
      });
      await connection.send({ type: "sessions", requestId: "list" });
      expect(await waitForEvent(events, (event) => event.type === "sessions")).toMatchObject({
        sessions: [],
      });
      const input = openInput();
      input.config.env = { SESSION_TOKEN: "session" };
      await connection.send(input);
      expect(await waitForEvent(events, (event) => event.type === "session.config")).toMatchObject({
        config: { models: [{ id: "resolved", label: "session" }] },
      });
    } finally {
      await connection.close();
    }
  });

  it("still reports initialization failures for workspace-only global discovery", async () => {
    let unavailable = false;
    const { connector } = connectorHarness({
      handleRequest(instance, request) {
        if (unavailable && request.method === "initialize") {
          instance.reject(request, "Bridge unavailable");
          return true;
        }
        return false;
      },
    });
    const registration = runAcpProvider({
      id: "workspace-acp",
      label: "Workspace ACP",
      connector,
      acpOptions: { workspaceOnlyCatalog: true },
    });
    const connection = await registration.connect({ versions: [1], capabilities: [] });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      unavailable = true;
      await connection.send({ type: "catalog", requestId: "global" });
      expect(await waitForEvent(events, (event) => event.type === "request.failed")).toMatchObject({
        requestId: "global",
        error: { message: expect.stringContaining("Bridge unavailable") },
      });
      expect(events.some((event) => event.type === "catalog")).toBe(false);
    } finally {
      await connection.close();
    }
  });

  it("rejects connection cleanly when the ACP executable does not exist", async () => {
    const registration = runAcpProvider({
      id: "missing-acp",
      label: "Missing ACP",
      command: [path.join(tmpdir(), `missing-acp-${process.pid}`)],
      acpOptions: { startupTimeoutMs: 250 },
    });

    await expect(
      registration.connect({ versions: [1], capabilities: ["prompt.message"] }),
    ).rejects.toThrow(/ENOENT|spawn/u);
  });

  it("accepts an official ACP SDK stream connector instead of a command", async () => {
    const connector = () => {
      const clientToAgent = new TransformStream();
      const agentToClient = new TransformStream();
      const agent: Agent = {
        initialize: async () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
        newSession: async () => ({ sessionId: "sdk-session", modes: null, configOptions: [] }),
        prompt: async () => ({ stopReason: "end_turn" }),
        cancel: async () => undefined,
      };
      const agentConnection = new AgentSideConnection(() => agent, {
        writable: agentToClient.writable,
        readable: clientToAgent.readable,
      });
      void agentConnection;
      return {
        writable: clientToAgent.writable,
        readable: agentToClient.readable,
      };
    };
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector,
    });

    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());

    await waitForEvent(events, (event) => event.type === "session.ready");
    expect(connection.capabilities).toEqual(["prompt.message"]);
    await connection.close();
  });

  it("keeps auto_accept local when opening and configuring an ACP session", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission", "session.configure"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.config.settings = { auto_accept: true };
    await connection.send(input);
    await waitForEvent(events, (event) => event.type === "session.ready");
    expect(
      harness.instances[1]!.requests.filter(
        (request) => request.method === "session/set_config_option",
      ),
    ).toEqual([]);
    await expect(
      harness.instances[1]!.request("session/request_permission", {
        sessionId: "connector-session",
        toolCall: {
          toolCallId: "auto",
          title: "Tool",
          kind: "execute",
          status: "pending",
          content: [],
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      }),
    ).resolves.toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
    await connection.send({
      type: "session.configure",
      requestId: "configure-auto",
      sessionId: "session-1",
      changes: { settings: { auto_accept: false } },
    });
    expect(
      harness.instances[1]!.requests.filter(
        (request) => request.method === "session/set_config_option",
      ),
    ).toEqual([]);
    const latestConfig = () => events.findLast((event) => event.type === "session.config");
    await expect.poll(latestConfig).toMatchObject({
      config: {
        settings: [expect.objectContaining({ id: "auto_accept", value: false })],
      },
    });
    await connection.close();
  });

  it("rejects unsupported tool policy even with auto_accept enabled", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission", "session.configure"],
    });
    const input = openInput();
    input.config.settings = { auto_accept: true };
    input.config.toolPolicy = { preapproved: [] };
    await expect(connection.send(input)).rejects.toThrow(
      "Provider does not support permission.tool_policy",
    );
    expect(harness.instances).toHaveLength(1);
    await connection.close();
  });

  it("keeps advertised tool policy ahead of local auto-accept", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission", "session.configure"],
    });
    // The adapter does not advertise exact tool policy yet. Simulate that future
    // advertisement to exercise runtime precedence beyond the admission guard.
    (connection.capabilities as ProviderCapability[]).push("permission.tool_policy");
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.config.settings = { auto_accept: true };
    input.config.toolPolicy = { preapproved: [] };
    try {
      await connection.send(input);
      await waitForEvent(events, (event) => event.type === "session.ready");
      expect(events.findLast((event) => event.type === "session.config")).toMatchObject({
        config: { settings: [expect.objectContaining({ id: "auto_accept", value: false })] },
      });
      const result = harness.instances[1]!.request("session/request_permission", {
        sessionId: "connector-session",
        toolCall: {
          toolCallId: "policy",
          title: "Tool",
          kind: "execute",
          status: "pending",
          content: [],
          rawInput: {},
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      });
      await waitForEvent(events, (event) => event.type === "session.permission");
      await connection.send({
        type: "session.permission",
        sessionId: "session-1",
        permissionId: "permission:policy",
        response: { behavior: "deny" },
      });
      await expect(result).resolves.toEqual({ outcome: { outcome: "selected", optionId: "no" } });
    } finally {
      await connection.close();
    }
  });

  it("keeps ambiguous allow choices in permission mediation", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission", "session.configure"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.config.settings = { auto_accept: true };
    await connection.send(input);
    await waitForEvent(events, (event) => event.type === "session.ready");
    const result = harness.instances[1]!.request("session/request_permission", {
      sessionId: "connector-session",
      toolCall: {
        toolCallId: "guard",
        title: "Tool",
        kind: "execute",
        status: "pending",
        content: [],
        rawInput: {},
      },
      options: [
        { optionId: "a", name: "A", kind: "allow_once" },
        { optionId: "b", name: "B", kind: "allow_once" },
      ],
    });
    await waitForEvent(events, (event) => event.type === "session.permission");
    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:guard",
      response: { behavior: "deny" },
    });
    await expect(result).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    await connection.close();
  });

  it("maps permission behavior to the first matching ACP option", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    const allow = harness.instances[1]!.request("session/request_permission", {
      sessionId: "connector-session",
      toolCall: {
        toolCallId: "tool-allow",
        title: "Allow tool",
        kind: "execute",
        status: "pending",
        content: [],
        rawInput: {},
      },
      options: [
        { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    await waitForEvent(
      events,
      (event) =>
        event.type === "session.permission" && event.request.id === "permission:tool-allow",
    );
    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:tool-allow",
      response: { behavior: "allow" },
    });
    await expect(allow).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-always" },
    });

    const deny = harness.instances[1]!.request("session/request_permission", {
      sessionId: "connector-session",
      toolCall: {
        toolCallId: "tool-deny",
        title: "Deny tool",
        kind: "execute",
        status: "pending",
        content: [],
        rawInput: {},
      },
      options: [
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
        { optionId: "reject-always", name: "Always reject", kind: "reject_always" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      ],
    });
    await waitForEvent(
      events,
      (event) => event.type === "session.permission" && event.request.id === "permission:tool-deny",
    );
    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:tool-deny",
      response: { behavior: "deny" },
    });
    await expect(deny).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-always" },
    });
    await connection.close();
  });

  it("rejects an explicit ACP permission option with the wrong behavior", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "sdk-acp",
      label: "SDK ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "permission"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    const permission = harness.instances[1]!.request("session/request_permission", {
      sessionId: "connector-session",
      toolCall: {
        toolCallId: "tool-explicit",
        title: "Explicit tool",
        kind: "execute",
        status: "pending",
        content: [],
        rawInput: {},
      },
      options: [
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    await waitForEvent(
      events,
      (event) =>
        event.type === "session.permission" && event.request.id === "permission:tool-explicit",
    );
    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:tool-explicit",
      response: { behavior: "allow", selectedActionId: "missing" },
    });
    await expect(
      waitForEvent(
        events,
        (event) =>
          event.type === "session.runtime_failed" && event.error.message.includes("'missing'"),
      ),
    ).resolves.toBeDefined();

    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:tool-explicit",
      response: { behavior: "allow", selectedActionId: "reject-once" },
    });
    await expect(
      waitForEvent(
        events,
        (event) =>
          event.type === "session.runtime_failed" &&
          event.error.message.includes("'reject-once'") &&
          event.error.message.includes("does not match 'allow' behavior"),
      ),
    ).resolves.toBeDefined();

    await connection.send({
      type: "session.permission",
      sessionId: "session-1",
      permissionId: "permission:tool-explicit",
      response: { behavior: "allow", selectedActionId: "allow-once" },
    });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    await connection.close();
  });

  it("closes both connector directions for the probe and live session", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "owned-acp",
      label: "Owned ACP",
      connector: harness.connector,
    });

    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    expect(harness.instances).toHaveLength(1);
    expect(harness.instances[0]).toMatchObject({ readsCanceled: true, writesClosed: true });

    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    await connection.close();

    expect(harness.instances).toHaveLength(2);
    expect(harness.instances[1]).toMatchObject({ readsCanceled: true, writesClosed: true });
  });

  it("publishes runtime failure on unexpected connector EOF", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "eof-acp",
      label: "EOF ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    harness.instances[1]!.closeFromAgent();

    await expect(
      waitForEvent(events, (event) => event.type === "session.runtime_failed"),
    ).resolves.toMatchObject({
      sessionId: "session-1",
      error: { message: expect.stringContaining("closed") },
    });
    await connection.close();
  });

  it("settles an active auto prompt before admitting its auto replacement", async () => {
    const order: string[] = [];
    let firstPrompt: AcpRequestMessage | null = null;
    let activePrompts = 0;
    let maximumActivePrompts = 0;
    const harness = connectorHarness({
      handleMessage(instance, message) {
        if (!("method" in message)) return false;
        const request = "id" in message ? (message as AcpRequestMessage) : null;
        if (message.method === "session/prompt" && request) {
          const promptNumber = firstPrompt ? "second" : "first";
          order.push(`prompt:${promptNumber}`);
          activePrompts += 1;
          maximumActivePrompts = Math.max(maximumActivePrompts, activePrompts);
          if (!firstPrompt) {
            firstPrompt = request;
          } else {
            activePrompts -= 1;
            instance.respond(request, { stopReason: "end_turn" });
          }
          return true;
        }
        if (message.method === "session/cancel") {
          order.push("cancel");
          activePrompts -= 1;
          instance.respond(firstPrompt!, { stopReason: "cancelled" });
          return true;
        }
        return false;
      },
    });
    const registration = runAcpProvider({
      id: "overlap-acp",
      label: "Overlap ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    await connection.send({
      type: "session.prompt",
      sessionId: "session-1",
      prompt: {
        clientMessageId: "first",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "first" }] },
      },
    });
    await expect.poll(() => countRequests(harness.instances[1]!, "session/prompt")).toBe(1);
    await connection.send({
      type: "session.prompt",
      sessionId: "session-1",
      prompt: {
        clientMessageId: "second",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "second" }] },
      },
    });

    await waitForEvent(
      events,
      (event) =>
        event.type === "session.turn" &&
        event.turnId === "acp:second" &&
        event.state === "completed",
    );
    expect(order).toEqual(["prompt:first", "cancel", "prompt:second"]);
    expect(maximumActivePrompts).toBe(1);
    const firstTerminal = events.findIndex(
      (event) =>
        event.type === "session.turn" && event.turnId === "acp:first" && event.state === "canceled",
    );
    const secondAdmission = events.findIndex(
      (event) => event.type === "session.prompt_result" && event.clientMessageId === "second",
    );
    expect(firstTerminal).toBeGreaterThan(-1);
    expect(firstTerminal).toBeLessThan(secondAdmission);
    await connection.close();
  });

  it.each([
    ["end_turn", "completed", "completed"],
    ["cancelled", "canceled", "canceled"],
  ] as const)(
    "closes a transformer's running tool row when the turn ends with %s",
    async (stopReason, turnState, rowStatus) => {
      const harness = connectorHarness({
        handleMessage(instance, message) {
          if (!("method" in message) || !("id" in message)) return false;
          if (message.method !== "session/prompt") return false;
          instance.notify("vendor/phase", { id: "phase-1", label: "Preparing" });
          instance.respond(message as AcpRequestMessage, { stopReason });
          return true;
        },
      });
      const registration = runAcpProvider({
        id: "vendor-row-acp",
        label: "Vendor row ACP",
        connector: harness.connector,
        transformers: [
          {
            notification(notification) {
              if (notification.method !== "vendor/phase") return null;
              return {
                type: "timeline",
                item: {
                  type: "tool_call",
                  id: "phase-1",
                  callId: "phase-1",
                  name: "Vendor phase",
                  detail: { type: "plain_text", label: "Preparing" },
                  status: "running",
                  error: null,
                },
              };
            },
          },
        ],
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      await connection.send(openInput());
      await waitForEvent(events, (event) => event.type === "session.ready");

      await connection.send({
        type: "session.prompt",
        sessionId: "session-1",
        prompt: {
          clientMessageId: "first",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "first" }] },
        },
      });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === turnState,
      );

      const rows = events.flatMap((event) =>
        event.type === "timeline.item" && event.item.id === "phase-1" ? [event.item] : [],
      );
      expect(rows.map((row) => row.type === "tool_call" && row.status)).toEqual([
        "running",
        rowStatus,
      ]);
      const closed = events.findIndex(
        (event) =>
          event.type === "timeline.item" &&
          event.item.id === "phase-1" &&
          event.item.type === "tool_call" &&
          event.item.status === rowStatus,
      );
      const terminal = events.findIndex(
        (event) => event.type === "session.turn" && event.state === turnState,
      );
      expect(closed).toBeLessThan(terminal);
      // The wire contract only accepts a failed tool call with a non-null error.
      expect(rows.at(-1)).toMatchObject({ error: null });
      await connection.close();
    },
  );

  it("cancels an in-progress ACP tool call with the canceled turn instead of failing it without an error", async () => {
    const harness = connectorHarness({
      handleMessage(instance, message) {
        if (!("method" in message) || !("id" in message)) return false;
        if (message.method !== "session/prompt") return false;
        instance.notify("session/update", {
          sessionId: "connector-session",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Run tests",
            kind: "execute",
            status: "in_progress",
          },
        });
        instance.respond(message as AcpRequestMessage, { stopReason: "cancelled" });
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "cancel-tool-acp",
      label: "Cancel tool ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    await connection.send({
      type: "session.prompt",
      sessionId: "session-1",
      prompt: {
        clientMessageId: "first",
        delivery: "auto",
        input: { type: "message", content: [{ type: "text", text: "first" }] },
      },
    });
    await waitForEvent(
      events,
      (event) => event.type === "session.turn" && event.state === "canceled",
    );

    const rows = events.flatMap((event) =>
      event.type === "timeline.item" && event.item.id === "tool-1" ? [event.item] : [],
    );
    expect(rows.at(-1)).toMatchObject({ type: "tool_call", status: "canceled", error: null });
    await connection.close();
  });

  it.each([
    { counts: null, context: false, expected: [] },
    {
      counts: { totalTokens: 0, inputTokens: 0, outputTokens: 0 },
      context: false,
      expected: [
        {
          turnId: "acp:first",
          usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: undefined },
        },
      ],
    },
    {
      counts: { totalTokens: 18971, inputTokens: 12152, outputTokens: 78, cachedReadTokens: 6741 },
      context: true,
      expected: [
        {
          turnId: undefined,
          usage: { contextWindowUsedTokens: 42, contextWindowMaxTokens: 100, totalCostUsd: 0.25 },
        },
        {
          turnId: "acp:first",
          usage: {
            inputTokens: 12152,
            outputTokens: 78,
            cachedInputTokens: 6741,
            contextWindowUsedTokens: 42,
            contextWindowMaxTokens: 100,
            totalCostUsd: 0.25,
          },
        },
      ],
    },
  ])(
    "forwards prompt-result usage $counts while preserving context updates: $context",
    async ({ counts, context, expected }) => {
      const harness = connectorHarness({
        handleRequest(instance, message) {
          if (message.method !== "session/prompt") return false;
          if (context)
            instance.notify("session/update", {
              sessionId: "connector-session",
              update: {
                sessionUpdate: "usage_update",
                used: 42,
                size: 100,
                cost: { amount: 0.25, currency: "USD" },
              },
            });
          instance.respond(message, {
            stopReason: "end_turn",
            ...(counts ? { usage: counts } : {}),
          });
          return true;
        },
      });
      const registration = runAcpProvider({
        id: "usage-acp",
        label: "Usage ACP",
        connector: harness.connector,
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      try {
        await connection.send(openInput());
        await waitForEvent(events, (event) => event.type === "session.ready");
        await connection.send({
          type: "session.prompt",
          sessionId: "session-1",
          prompt: {
            clientMessageId: "first",
            delivery: "auto",
            input: { type: "message", content: [{ type: "text", text: "hello" }] },
          },
        });
        await waitForEvent(
          events,
          (event) => event.type === "session.turn" && event.state === "completed",
        );
        const usage = events.flatMap((event) =>
          event.type === "session.usage" ? [{ turnId: event.turnId, usage: event.usage }] : [],
        );
        expect(usage).toEqual(expected);
        const lastUsage = events.findLastIndex((event) => event.type === "session.usage");
        const completed = events.findIndex(
          (event) => event.type === "session.turn" && event.state === "completed",
        );
        expect(lastUsage).toBeLessThan(completed);
      } finally {
        await connection.close();
      }
    },
  );

  it.each([
    { current: "selected", requested: "selected", setters: 0 },
    { current: "other", requested: "selected", setters: 1 },
    { current: "", requested: "selected", setters: 1 },
  ])(
    "applies initial model by effective ID ($current -> $requested)",
    async ({ current, requested, setters }) => {
      const harness = connectorHarness({
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: current,
            options: [
              { name: "Selected", value: "selected" },
              { name: "selected", value: "other" },
            ],
          },
        ],
      });
      const registration = runAcpProvider({
        id: "same-model",
        label: "Same model",
        connector: harness.connector,
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      const input = openInput();
      input.config.model = requested;
      try {
        await connection.send(input);
        await waitForEvent(events, (event) => event.type === "session.ready");
        expect(countRequests(harness.instances.at(-1)!, "session/set_config_option")).toBe(setters);
      } finally {
        await connection.close();
      }
    },
  );

  it("retains unchanged attached mode and effort without setters", async () => {
    const harness = connectorHarness({
      handleRequest(instance, request) {
        if (request.method !== "session/new") return false;
        instance.respond(request, {
          sessionId: "connector-session",
          modes: { currentModeId: "safe", availableModes: [{ id: "safe", name: "Safe" }] },
          configOptions: [
            {
              id: "effort",
              name: "Effort",
              category: "thought_level",
              type: "select",
              currentValue: "high",
              options: [{ name: "High", value: "high" }],
            },
          ],
        });
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "same-config",
      label: "Same config",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.config.mode = "safe";
    input.config.thinkingOption = "high";
    try {
      await connection.send(input);
      await waitForEvent(events, (event) => event.type === "session.ready");
      expect(countRequests(harness.instances.at(-1)!, "session/set_config_option")).toBe(0);
      expect(countRequests(harness.instances.at(-1)!, "session/set_mode")).toBe(0);
    } finally {
      await connection.close();
    }
  });

  it("serializes configuration mutations", async () => {
    let releaseMutation: (() => void) | null = null;
    const configOptions = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "a",
        options: [
          { name: "A", value: "a" },
          { name: "B", value: "b" },
        ],
      },
    ];
    const harness = connectorHarness({
      capabilities: { loadSession: true },
      configOptions,
      handleRequest(instance, request) {
        if (request.method !== "session/set_config_option") return false;
        const value = (request.params as { value: string }).value;
        if (value !== "first") return false;
        releaseMutation = () =>
          instance.respond(request, {
            configOptions: configOptions.map((option) =>
              Object.assign({}, option, { currentValue: value }),
            ),
          });
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "lane-acp",
      label: "Lane ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "session.configure"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    await connection.send({
      type: "session.configure",
      requestId: "configure-first",
      sessionId: "session-1",
      changes: { model: "first" },
    });
    await connection.send({
      type: "session.configure",
      requestId: "configure-second",
      sessionId: "session-1",
      changes: { model: "second" },
    });
    await expect
      .poll(() => countRequests(harness.instances[1]!, "session/set_config_option"))
      .toBe(1);
    releaseMutation!();
    await waitForEvent(
      events,
      (event) => event.type === "request.completed" && event.requestId === "configure-second",
    );
    expect(
      events
        .filter(
          (event) => event.type === "request.completed" && event.requestId.startsWith("configure-"),
        )
        .map((event) => (event as Extract<ProviderEvent, { type: "request.completed" }>).requestId),
    ).toEqual(["configure-first", "configure-second"]);

    await connection.close();
  });

  it("keeps local policy configurable without claiming unsupported vendor features", async () => {
    const executable = await fakeAcp(basicAgent);
    const { connection, events } = await connect(executable, [
      "prompt.message",
      "prompt.image",
      "session.configure",
      "session.list",
      "permission.tool_policy",
    ]);

    expect(connection.capabilities).toEqual(["prompt.message", "session.configure"]);
    await connection.send(openInput());
    const opened = await waitForEvent(events, (event) => event.type === "session.opened");
    expect(opened).toMatchObject({ capabilities: ["prompt.message", "session.configure"] });
    await waitForEvent(events, (event) => event.type === "session.ready");
    await connection.send({
      type: "session.configure",
      requestId: "configure-local",
      sessionId: "session-1",
      changes: { settings: { auto_accept: true } },
    });
    await waitForEvent(
      events,
      (event) => event.type === "request.completed" && event.requestId === "configure-local",
    );
    expect(events.findLast((event) => event.type === "session.config")).toMatchObject({
      config: { settings: [expect.objectContaining({ id: "auto_accept", value: true })] },
    });
    await connection.send({
      type: "session.configure",
      requestId: "configure-unsupported",
      sessionId: "session-1",
      changes: { model: "not-advertised" },
    });
    expect(await waitForEvent(events, (event) => event.type === "request.failed")).toMatchObject({
      requestId: "configure-unsupported",
      error: { message: "ACP session does not expose model configuration" },
    });
    await connection.close();
  });

  it("derives optional connection capabilities from ACP initialization", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: {
    protocolVersion: message.params.protocolVersion,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
      sessionCapabilities: { list: {} },
    },
  } });
});`);
    const { connection } = await connect(executable, [
      "prompt.message",
      "prompt.image",
      "session.list",
      "session.persistence",
    ]);

    expect(connection.capabilities).toEqual([
      "prompt.message",
      "prompt.image",
      "session.list",
      "session.persistence",
    ]);
    await connection.close();
  });

  it("acknowledges admission before session creation completes", async () => {
    const executable = await fakeAcp(basicAgent);
    const { connection, events } = await connect(executable, ["prompt.message"]);
    let ready = false;
    const admission = connection.send(openInput()).then(() => {
      ready = true;
      return undefined;
    });

    await admission;
    expect(ready).toBe(true);
    expect(events).toEqual([]);
    await waitForEvent(events, (event) => event.type === "session.ready");
    await connection.close();
  });

  it("rejects provider inputs after the ACP connection closes", async () => {
    const harness = connectorHarness();
    const registration = runAcpProvider({
      id: "closed-acp",
      label: "Closed ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({ versions: [1], capabilities: [] });

    await connection.close();
    await expect(connection.send({ type: "catalog", requestId: "too-late" })).rejects.toThrow(
      "ACP provider connection is closed",
    );
    expect(harness.instances).toHaveLength(1);
  });

  it("waits for delayed session creation and closes its connector after connection close", async () => {
    let delayedNew: AcpRequestMessage | null = null;
    const harness = connectorHarness({
      handleRequest(_instance, request) {
        if (request.method !== "session/new") return false;
        delayedNew = request;
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "delayed-open-acp",
      label: "Delayed open ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await expect.poll(() => delayedNew).not.toBeNull();

    let closeSettled = false;
    const closing = connection.close().then(() => {
      closeSettled = true;
      return undefined;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    harness.instances[1]!.respond(delayedNew!, {
      sessionId: "late-session",
      modes: null,
      configOptions: [],
    });
    await closing;

    expect(harness.instances[1]).toMatchObject({ readsCanceled: true, writesClosed: true });
    expect(events).toEqual([]);
  });

  it("refuses unsupported steering before sending an ACP prompt", async () => {
    const executable = await fakeAcp(basicAgent);
    const { connection, events } = await connect(executable, ["prompt.message"]);
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    await expect(
      connection.send({
        type: "session.prompt",
        sessionId: "session-1",
        prompt: {
          clientMessageId: "steer-1",
          delivery: "steer",
          input: { type: "message", content: [{ type: "text", text: "change course" }] },
        },
      }),
    ).rejects.toThrow("prompt.steer");
    expect(events.some((event) => event.type === "session.prompt_result")).toBe(false);
    await connection.close();
  });

  it("keeps configuration observable state atomic when a later field fails", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let model = "a";
const options = () => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [{ name: "A", value: "a" }, { name: "B", value: "b" }] },
  { id: "verbosity", name: "Verbosity", type: "select", currentValue: "quiet", options: [{ name: "Quiet", value: "quiet" }, { name: "Loud", value: "loud" }] },
];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: options() } });
  else if (message.method === "session/set_config_option" && message.params.configId === "verbosity") send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "verbosity rejected" } });
  else if (message.method === "session/set_config_option") { model = message.params.value; send({ jsonrpc: "2.0", id: message.id, result: { configOptions: options() } }); }
});`);
    const { connection, events } = await connect(executable, [
      "prompt.message",
      "session.configure",
    ]);
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    await connection.send({
      type: "session.configure",
      requestId: "configure-1",
      sessionId: "session-1",
      changes: { model: "b", settings: { verbosity: "loud" } },
    });
    await waitForEvent(
      events,
      (event) => event.type === "request.failed" && event.requestId === "configure-1",
    );
    const configs = events.filter((event) => event.type === "session.config");
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ config: { model: "a" } });
    await connection.close();
  });

  it.each([1, 64])(
    "commits transformer config notifications once and discards them on rollback (%i per response)",
    async (notificationCount) => {
      const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (...messages) => process.stdout.write(messages.map((message) => JSON.stringify(message) + "\\n").join(""));
let model = "a";
const options = () => [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [{ name: "A", value: "a" }, { name: "B", value: "b" }] },
  { id: "late", name: "Late", type: "select", currentValue: "ok", options: [{ name: "Ok", value: "ok" }, { name: "Fail", value: "fail" }] },
];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: options() } });
  else if (message.method === "session/set_config_option" && message.params.configId === "late") send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "late rejected" } });
  else if (message.method === "session/set_config_option") {
    model = message.params.value;
    send(
      ...Array.from({ length: ${notificationCount} }, () => ({ jsonrpc: "2.0", method: "vendor/config", params: { model } })),
      { jsonrpc: "2.0", id: message.id, result: { configOptions: options() } },
    );
  }
});`);
      const transformer = {
        notification(notification: { method: string; params: unknown }) {
          if (notification.method !== "vendor/config") return null;
          const params = notification.params as { model: string };
          return {
            type: "config" as const,
            config: {
              model: params.model,
              models: [{ id: params.model, label: `Transformer ${params.model}` }],
              modes: [],
              thinkingOptions: [],
            },
          };
        },
      };
      const { connection, events } = await connect(
        executable,
        ["prompt.message", "session.configure"],
        [transformer],
      );
      await connection.send(openInput());
      await waitForEvent(events, (event) => event.type === "session.ready");
      const initialConfigCount = events.filter((event) => event.type === "session.config").length;

      await connection.send({
        type: "session.configure",
        requestId: "transformer-initial-failure",
        sessionId: "session-1",
        changes: { model: "b", settings: { late: "fail" } },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "request.failed" && event.requestId === "transformer-initial-failure",
      );
      expect(events.filter((event) => event.type === "session.config")).toHaveLength(
        initialConfigCount,
      );

      await connection.send({
        type: "session.configure",
        requestId: "transformer-success",
        sessionId: "session-1",
        changes: { model: "b" },
      });
      await waitForEvent(
        events,
        (event) => event.type === "request.completed" && event.requestId === "transformer-success",
      );
      let configs = events.filter((event) => event.type === "session.config");
      expect(configs).toHaveLength(initialConfigCount + 1);
      expect(configs.at(-1)).toMatchObject({
        config: {
          model: "b",
          models: [{ label: "Transformer b" }],
          settings: [expect.objectContaining({ id: "auto_accept", value: false })],
        },
      });

      await connection.send({
        type: "session.configure",
        requestId: "transformer-failure",
        sessionId: "session-1",
        changes: { model: "a", settings: { late: "fail" } },
      });
      await waitForEvent(
        events,
        (event) => event.type === "request.failed" && event.requestId === "transformer-failure",
      );
      configs = events.filter((event) => event.type === "session.config");
      expect(configs).toHaveLength(initialConfigCount + 1);
      expect(configs.at(-1)).toMatchObject({ config: { model: "b" } });
      await connection.close();
    },
  );

  it("selects the model control when an agent files several controls under the model category", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let model = "small";
const modes = { currentModeId: "auto", availableModes: [{ id: "auto", name: "Auto" }, { id: "ask", name: "Ask" }] };
const options = () => [
  { id: "provider", name: "Provider", category: "model", type: "select", currentValue: "gateway", options: [{ name: "Gateway", value: "gateway" }, { name: "Local", value: "local" }] },
  { id: "model", name: "Model", category: "model", type: "select", currentValue: model, options: [{ name: "Small", value: "small" }, { name: "Large", value: "large" }] },
  { id: "mode", name: "Session Mode", category: "mode", type: "select", currentValue: "auto", options: [{ name: "Auto", value: "auto" }, { name: "Ask", value: "ask" }] },
  { id: "fast", name: "Fast Mode", category: "model", type: "select", currentValue: "false", options: [{ name: "Off", value: "false" }, { name: "On", value: "true" }] },
];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes, configOptions: options() } });
  else if (message.method === "session/set_config_option") {
    if (message.params.configId === "model") model = message.params.value;
    send({ jsonrpc: "2.0", id: message.id, result: { configOptions: options() } });
  }
});`);
    const { connection, events } = await connect(executable, [
      "prompt.message",
      "session.configure",
    ]);
    await connection.send({ type: "catalog", requestId: "catalog-1" });
    await waitForEvent(events, (event) => event.type === "catalog");
    expect(events.find((event) => event.type === "catalog")).toMatchObject({
      catalog: {
        defaultModel: "small",
        models: [
          { id: "small", label: "Small" },
          { id: "large", label: "Large" },
        ],
      },
    });

    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    await connection.send({
      type: "session.configure",
      requestId: "configure-1",
      sessionId: "session-1",
      changes: { model: "large" },
    });
    await waitForEvent(
      events,
      (event) => event.type === "request.completed" && event.requestId === "configure-1",
    );
    const config = events.findLast((event) => event.type === "session.config");
    expect(config).toMatchObject({ config: { model: "large" } });
    if (config?.type !== "session.config") throw new Error("Expected session.config");
    expect(config.config.settings?.map((setting) => setting.id)).toEqual(["provider", "fast"]);
    await connection.close();
  });

  it("applies opening configuration in the order the agent lists its options", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let provider = "first";
let model = "first-saved";
const saved = { first: "first-saved", second: "second-saved" };
const select = (id, currentValue, values) => ({ id, name: id, category: "model", type: "select", currentValue, options: values.map((value) => ({ name: value, value })) });
const options = () => [
  select("provider", provider, ["first", "second"]),
  select("model", model, ["first-saved", "second-saved", "second-chosen"]),
];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", configOptions: options() } });
  else if (message.method === "session/set_config_option") {
    if (message.params.configId === "provider") { provider = message.params.value; model = saved[provider]; }
    if (message.params.configId === "model") model = message.params.value;
    send({ jsonrpc: "2.0", id: message.id, result: { configOptions: options() } });
  }
});`);
    const { connection, events } = await connect(executable, [
      "prompt.message",
      "session.configure",
    ]);
    const input = openInput({ provider: "second" });

    await connection.send({ ...input, config: { ...input.config, model: "second-chosen" } });

    await waitForEvent(events, (event) => event.type === "session.ready");
    expect(events.findLast((event) => event.type === "session.config")).toMatchObject({
      config: { model: "second-chosen" },
    });
    await connection.close();
  });

  it("gives discovery transformers the discovered session configuration facade", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "catalog-native", modes: null, configOptions: [{ id: "flavor", name: "Flavor", type: "select", currentValue: "mint", options: [{ name: "Mint", value: "mint" }] }] } });
});`);
    let discovered: Readonly<Record<string, unknown>> | null = null;
    const { connection, events } = await connect(
      executable,
      [],
      [
        {
          async discover(catalog, context) {
            discovered = await context.config.read();
            return catalog;
          },
        },
      ],
    );

    await connection.send({ type: "catalog", requestId: "catalog-1" });
    await waitForEvent(events, (event) => event.type === "catalog");
    expect(discovered).toEqual({ flavor: "mint" });
    await connection.close();
  });

  it("drains heavy ACP stderr while initializing", async () => {
    const executable = await fakeAcp(
      `process.stderr.write("x".repeat(2 * 1024 * 1024));\n${basicAgent}`,
    );
    const { connection, events } = await connect(executable, ["prompt.message"]);
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    await connection.close();
  });

  it("publishes runtime failure when the ACP process dies", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: [] } });
    setTimeout(() => process.exit(17), 20);
  }
});`);
    const { connection, events } = await connect(executable, ["prompt.message"]);
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    const failure = await waitForEvent(events, (event) => event.type === "session.runtime_failed");
    expect(failure).toMatchObject({
      sessionId: "session-1",
      error: { message: expect.stringContaining("17") },
    });
    await connection.close();
  });

  it("escalates shutdown when an ACP process ignores SIGTERM", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
process.on("SIGTERM", () => {});
const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: [] } });
});`);
    const { connection, events } = await connect(executable, ["prompt.message"]);
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    const startedAt = Date.now();
    await connection.close();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(Date.now() - startedAt).toBeLessThan(2_500);
  });
});

describe("runAcpProvider streamed chunks without messageId (#4699)", () => {
  interface Chunk {
    kind: "agent_message_chunk" | "agent_thought_chunk";
    text: string;
    messageId?: string;
  }

  it("continues one timeline item per turn instead of one per chunk", async () => {
    const chunksByPrompt: Record<string, Chunk[]> = {
      first: [
        { kind: "agent_message_chunk", text: "- **Current tem" },
        { kind: "agent_message_chunk", text: "perature**: 25°C" },
      ],
      second: [{ kind: "agent_message_chunk", text: "next turn" }],
      // An explicit-id text chunk between two id-less thoughts separates them.
      third: [
        { kind: "agent_thought_chunk", text: "think A" },
        { kind: "agent_message_chunk", text: "say", messageId: "m-explicit" },
        { kind: "agent_thought_chunk", text: "think B" },
      ],
    };
    const harness = connectorHarness({
      promptUpdates: (promptText) =>
        (chunksByPrompt[promptText] ?? []).map((chunk) => {
          const update: Record<string, unknown> = {
            sessionUpdate: chunk.kind,
            content: { type: "text", text: chunk.text },
          };
          if (chunk.messageId) update.messageId = chunk.messageId;
          return update;
        }),
    });
    const registration = runAcpProvider({
      id: "chunk-acp",
      label: "Chunk ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");

    for (const clientMessageId of ["first", "second", "third"]) {
      await connection.send({
        type: "session.prompt",
        sessionId: "session-1",
        prompt: {
          clientMessageId,
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: clientMessageId }] },
        },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === `acp:${clientMessageId}` &&
          event.state === "completed",
      );
    }

    const items = events.flatMap((event) =>
      event.type === "timeline.item" &&
      (event.item.type === "assistant_message" || event.item.type === "reasoning")
        ? [
            {
              id: event.item.id,
              text: event.item.text,
              ...(event.item.type === "assistant_message" && event.item.messageId
                ? { messageId: event.item.messageId }
                : {}),
            },
          ]
        : [],
    );
    expect(items).toEqual([
      { id: "agent_message_chunk:1", text: "- **Current tem" },
      { id: "agent_message_chunk:1", text: "- **Current temperature**: 25°C" },
      { id: "agent_message_chunk:2", text: "next turn" },
      { id: "agent_thought_chunk:3", text: "think A" },
      {
        id: JSON.stringify(["agent_message_chunk", "m-explicit"]),
        messageId: "m-explicit",
        text: "say",
      },
      { id: "agent_thought_chunk:4", text: "think B" },
    ]);
    await connection.close();
  });
});

function textChunk(
  text: string,
  kind: "agent_message_chunk" | "agent_thought_chunk" = "agent_message_chunk",
  messageId?: string,
): SessionUpdate {
  return {
    sessionUpdate: kind,
    content: { type: "text", text },
    ...(messageId === undefined ? {} : { messageId }),
  };
}

async function streamChunkTurns(
  updates: SessionUpdate[],
  ending: "completed" | "canceled" | "failed" = "completed",
) {
  let promptCount = 0;
  const harness = connectorHarness({
    handleRequest(instance, request) {
      if (request.method !== "session/prompt") return false;
      promptCount++;
      for (const update of promptCount === 1 ? updates : [textChunk("Next turn")]) {
        instance.notify("session/update", { sessionId: "connector-session", update });
      }
      if (promptCount === 1 && ending === "failed") instance.reject(request, "Prompt failed");
      else
        instance.respond(request, {
          stopReason: promptCount === 1 && ending === "canceled" ? "cancelled" : "end_turn",
        });
      return true;
    },
  });
  const registration = runAcpProvider({
    id: "chunk-boundaries",
    label: "Chunk boundaries",
    connector: harness.connector,
  });
  const connection = await registration.connect({
    versions: [1],
    capabilities: ["prompt.message"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  try {
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    for (const clientMessageId of ["first", "second"]) {
      await connection.send({
        type: "session.prompt",
        sessionId: "session-1",
        prompt: {
          clientMessageId,
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: clientMessageId }] },
        },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === `acp:${clientMessageId}` &&
          event.state === (clientMessageId === "first" ? ending : "completed"),
      );
    }
    const messages = new Map<string, { type: string; text: string }>();
    for (const event of events) {
      if (
        event.type === "timeline.item" &&
        (event.item.type === "assistant_message" || event.item.type === "reasoning")
      ) {
        messages.set(event.item.id, { type: event.item.type, text: event.item.text });
      }
    }
    return [...messages.values()];
  } finally {
    await connection.close();
  }
}

describe("ACP streamed message boundaries", () => {
  it("keeps reasoning separate from a reply sharing its native message ID", async () => {
    expect(
      await streamChunkTurns([
        textChunk("private ", "agent_thought_chunk", "shared-id"),
        textChunk("reasoning", "agent_thought_chunk", "shared-id"),
        textChunk("public ", "agent_message_chunk", "shared-id"),
        textChunk("reply", "agent_message_chunk", "shared-id"),
      ]),
    ).toEqual([
      { type: "reasoning", text: "private reasoning" },
      { type: "assistant_message", text: "public reply" },
      { type: "assistant_message", text: "Next turn" },
    ]);
  });

  it.each([
    {
      name: "tool call",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool",
        title: "Read",
        kind: "read",
        status: "in_progress",
      },
    },
    { name: "plan", update: { sessionUpdate: "plan", entries: [] } },
    {
      name: "user message",
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "User" } },
    },
  ] satisfies Array<{ name: string; update: SessionUpdate }>)(
    "starts a new message after a $name",
    async ({ update }) => {
      expect(
        await streamChunkTurns([
          textChunk("Before"),
          update,
          textChunk("After "),
          textChunk("boundary"),
        ]),
      ).toEqual([
        { type: "assistant_message", text: "Before" },
        { type: "assistant_message", text: "After boundary" },
        { type: "assistant_message", text: "Next turn" },
      ]);
    },
  );

  it("continues text while an existing tool receives a status update", async () => {
    expect(
      await streamChunkTurns([
        {
          sessionUpdate: "tool_call",
          toolCallId: "tool",
          title: "Read",
          kind: "read",
          status: "in_progress",
        },
        textChunk("Still "),
        { sessionUpdate: "tool_call_update", toolCallId: "tool", status: "completed" },
        textChunk("speaking"),
      ]),
    ).toEqual([
      { type: "assistant_message", text: "Still speaking" },
      { type: "assistant_message", text: "Next turn" },
    ]);
  });

  it("keeps explicit messages separate from neighboring anonymous chunks", async () => {
    expect(
      await streamChunkTurns([
        textChunk("Before"),
        textChunk("Explicit ", "agent_message_chunk", "message"),
        textChunk("message", "agent_message_chunk", "message"),
        textChunk("After"),
      ]),
    ).toEqual([
      { type: "assistant_message", text: "Before" },
      { type: "assistant_message", text: "Explicit message" },
      { type: "assistant_message", text: "After" },
      { type: "assistant_message", text: "Next turn" },
    ]);
  });

  it("continues reasoning but starts a new segment after nontext assistant content", async () => {
    expect(
      await streamChunkTurns([
        textChunk("Think ", "agent_thought_chunk"),
        textChunk("first", "agent_thought_chunk"),
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "image", data: "", mimeType: "image/png" },
        },
        textChunk("Then think", "agent_thought_chunk"),
      ]),
    ).toEqual([
      { type: "reasoning", text: "Think first" },
      { type: "reasoning", text: "Then think" },
      { type: "assistant_message", text: "Next turn" },
    ]);
  });

  it.each(["completed", "canceled", "failed"] as const)(
    "keeps the next turn separate after a %s prompt",
    async (ending) => {
      expect(await streamChunkTurns([textChunk("First "), textChunk("turn")], ending)).toEqual([
        { type: "assistant_message", text: "First turn" },
        { type: "assistant_message", text: "Next turn" },
      ]);
    },
  );
});

function userChunk(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text },
    ...(messageId === undefined ? {} : { messageId }),
  };
}

async function openReplaySession(
  replay: SessionUpdate[],
  history: "replay" | "skip",
): Promise<{
  connection: ProviderConnection;
  events: ProviderEvent[];
  harness: ReturnType<typeof connectorHarness>;
}> {
  const harness = connectorHarness({
    capabilities: { loadSession: true },
    handleRequest(instance, request) {
      if (request.method !== "session/load") return false;
      for (const update of replay) {
        instance.notify("session/update", { sessionId: "connector-session", update });
      }
      instance.respond(request, {
        sessionId: "connector-session",
        modes: null,
        configOptions: [],
      });
      return true;
    },
  });
  const registration = runAcpProvider({
    id: "replay-acp",
    label: "Replay ACP",
    connector: harness.connector,
  });
  const connection = await registration.connect({
    versions: [1],
    capabilities: ["prompt.message", "session.persistence"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  const input = openInput();
  input.persistence = { version: 1, data: { sessionId: "connector-session" } };
  input.history = history;
  await connection.send(input);
  await waitForEvent(events, (event) => event.type === "session.ready");
  return { connection, events, harness };
}

function timelineProjection(events: ProviderEvent[]): Array<Record<string, string>> {
  return events.flatMap((event) => {
    if (event.type !== "timeline.item") return [];
    const item = event.item;
    if (
      item.type === "user_message" ||
      item.type === "assistant_message" ||
      item.type === "reasoning"
    ) {
      return [{ type: item.type, id: item.id, text: item.text }];
    }
    if (item.type === "tool_call") return [{ type: item.type, id: item.id, status: item.status }];
    return [{ type: item.type, id: item.id }];
  });
}

describe("ACP session history replay", () => {
  it("restores the timeline replayed before session/load resolves", async () => {
    const { connection, events } = await openReplaySession(
      [
        userChunk("What is the ", "user-1"),
        userChunk("temperature?", "user-1"),
        textChunk("Checking the sensor", "agent_thought_chunk"),
        {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read sensor",
          kind: "read",
          status: "in_progress",
        },
        { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" },
        textChunk("It is 25°C"),
      ],
      "replay",
    );
    try {
      expect(timelineProjection(events)).toEqual([
        { type: "user_message", id: '["user_message_chunk","user-1"]', text: "What is the " },
        {
          type: "user_message",
          id: '["user_message_chunk","user-1"]',
          text: "What is the temperature?",
        },
        { type: "reasoning", id: "agent_thought_chunk:1", text: "Checking the sensor" },
        { type: "tool_call", id: "tool-1", status: "running" },
        { type: "tool_call", id: "tool-1", status: "completed" },
        { type: "assistant_message", id: "agent_message_chunk:2", text: "It is 25°C" },
      ]);
      const lastReplayed = events.findLastIndex((event) => event.type === "timeline.item");
      const opened = events.findIndex((event) => event.type === "session.opened");
      expect(lastReplayed).toBeLessThan(opened);
    } finally {
      await connection.close();
    }
  });

  it("keeps replayed user, reasoning and reply chunks separate when their native IDs match", async () => {
    const { connection, events } = await openReplaySession(
      [
        userChunk("What is the ", "shared-id"),
        userChunk("temperature?", "shared-id"),
        textChunk("Checking ", "agent_thought_chunk", "shared-id"),
        textChunk("the sensor", "agent_thought_chunk", "shared-id"),
        textChunk("It is ", "agent_message_chunk", "shared-id"),
        textChunk("25°C", "agent_message_chunk", "shared-id"),
      ],
      "replay",
    );
    try {
      const items = new Map(
        events.flatMap((event) =>
          event.type === "timeline.item" ? [[event.item.id, event.item] as const] : [],
        ),
      );
      expect([...items.values()]).toEqual([
        {
          type: "user_message",
          id: '["user_message_chunk","shared-id"]',
          messageId: "shared-id",
          text: "What is the temperature?",
        },
        {
          type: "reasoning",
          id: '["agent_thought_chunk","shared-id"]',
          text: "Checking the sensor",
        },
        {
          type: "assistant_message",
          id: '["agent_message_chunk","shared-id"]',
          messageId: "shared-id",
          text: "It is 25°C",
        },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("continues anonymous user chunks into one message and starts a new one after an agent reply", async () => {
    const { connection, events } = await openReplaySession(
      [
        userChunk("first "),
        userChunk("question"),
        textChunk("answer"),
        userChunk("second question"),
      ],
      "replay",
    );
    try {
      expect(timelineProjection(events)).toEqual([
        { type: "user_message", id: "user_message_chunk:1", text: "first " },
        { type: "user_message", id: "user_message_chunk:1", text: "first question" },
        { type: "assistant_message", id: "agent_message_chunk:2", text: "answer" },
        { type: "user_message", id: "user_message_chunk:3", text: "second question" },
      ]);
    } finally {
      await connection.close();
    }
  });

  it.each([undefined, "provider-native-echo"])(
    "suppresses the own prompt echo with native ID %s",
    async (messageId) => {
      const harness = connectorHarness({
        capabilities: { loadSession: true },
        promptUpdates: (promptText) => [
          {
            sessionUpdate: "user_message_chunk",
            messageId,
            content: { type: "text", text: promptText },
          },
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Acknowledged" } },
        ],
      });
      const registration = runAcpProvider({
        id: "echo-acp",
        label: "Echo ACP",
        connector: harness.connector,
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message", "session.persistence"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      const input = openInput();
      input.persistence = { version: 1, data: { sessionId: "connector-session" } };
      input.history = "replay";
      await connection.send(input);
      await waitForEvent(events, (event) => event.type === "session.ready");

      await connection.send({
        type: "session.prompt",
        sessionId: "session-1",
        prompt: {
          clientMessageId: "echo-1",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "hello" }] },
        },
      });
      try {
        await waitForEvent(
          events,
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp:echo-1" &&
            event.state === "completed",
        );
        expect(timelineProjection(events)).toEqual([
          { type: "user_message", id: "echo-1", text: "hello" },
          { type: "assistant_message", id: "agent_message_chunk:1", text: "Acknowledged" },
        ]);
      } finally {
        await connection.close();
      }
    },
  );

  it("retains distinct equal-text user rows from the real jcode replay corpus", async () => {
    const updates = jcodeCorpusUpdates("11-import-repeated-user-replay-v1", 2);
    const { connection, events } = await openReplaySession(updates, "replay");
    try {
      const users = timelineProjection(events).filter((item) => item.type === "user_message");
      expect(users.map((item) => item.text)).toEqual(["first-user-marker", "first-user-marker"]);
      expect(new Set(users.map((item) => item.id)).size).toBe(2);
    } finally {
      await connection.close();
    }
  });

  it("drops replayed updates when the open request asks to skip history", async () => {
    const { connection, events } = await openReplaySession(
      [userChunk("What is in the README?", "user-1"), textChunk("It describes the project.")],
      "skip",
    );
    try {
      expect(timelineProjection(events)).toEqual([]);
    } finally {
      await connection.close();
    }
  });
});

describe("ACP loaded session configuration", () => {
  const loadedOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "cli-model",
      options: [
        { name: "CLI model", value: "cli-model" },
        { name: "Paseo default", value: "paseo-default" },
      ],
    },
    {
      id: "effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { name: "Low", value: "low" },
        { name: "High", value: "high" },
      ],
    },
  ];

  async function openLoadedSession(config: { model?: string; thinkingOption?: string }) {
    const harness = connectorHarness({
      capabilities: { loadSession: true },
      configOptions: loadedOptions,
    });
    const registration = runAcpProvider({
      id: "loaded-acp",
      label: "Loaded ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "session.configure", "session.persistence"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.persistence = { version: 1, data: { sessionId: "connector-session" } };
    input.config = { ...input.config, ...config };
    await connection.send(input);
    await waitForEvent(events, (event) => event.type === "session.ready");
    const session = harness.instances.at(-1)!;
    const reported = events.findLast((event) => event.type === "session.config") as Extract<
      ProviderEvent,
      { type: "session.config" }
    >;
    return { connection, session, config: reported.config };
  }

  it("keeps the model and thinking option session/load reports when the open names none", async () => {
    const { connection, session, config } = await openLoadedSession({});
    try {
      expect(countRequests(session, "session/load")).toBe(1);
      expect(countRequests(session, "session/set_config_option")).toBe(0);
      expect(config.model).toBe("cli-model");
      expect(config.thinkingOption).toBe("high");
    } finally {
      await connection.close();
    }
  });

  it("still applies a model the open names explicitly", async () => {
    const { connection, session, config } = await openLoadedSession({ model: "paseo-default" });
    try {
      expect(
        session.requests
          .filter((request) => request.method === "session/set_config_option")
          .map((request) => request.params),
      ).toEqual([{ sessionId: "connector-session", configId: "model", value: "paseo-default" }]);
      expect(config.model).toBe("paseo-default");
      expect(config.thinkingOption).toBe("high");
    } finally {
      await connection.close();
    }
  });
});

describe("ACP transformer turn lifecycle", () => {
  const vendorTurnTransformer = {
    notification(notification: { method: string; params: unknown }) {
      if (notification.method !== "vendor/turn") return null;
      const params = notification.params as {
        turnId: string;
        state: "started" | "completed" | "failed" | "canceled";
      };
      return { type: "turn" as const, turnId: params.turnId, state: params.state };
    },
  };

  async function connectVendorTurns(options?: {
    harness?: ConnectorHarnessOptions;
    transformers?: readonly AcpTransformer[];
    acpOptions?: AcpOptions;
    capabilities?: string[];
  }) {
    const harness = connectorHarness(options?.harness);
    const registration = runAcpProvider({
      id: "vendor-turn-acp",
      label: "Vendor turn ACP",
      connector: harness.connector,
      ...(options?.acpOptions === undefined ? {} : { acpOptions: options.acpOptions }),
      transformers: [vendorTurnTransformer, ...(options?.transformers ?? [])],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: options?.capabilities ?? ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    // The probe connection starts first; the live session is the last one.
    const agent = () => {
      const instance = harness.instances.at(-1);
      if (!instance) throw new Error("ACP connector did not start");
      return instance;
    };
    return { connection, events, agent };
  }

  function promptInput(clientMessageId: string) {
    return {
      type: "session.prompt" as const,
      sessionId: "session-1",
      prompt: {
        clientMessageId,
        delivery: "auto" as const,
        input: {
          type: "message" as const,
          content: [{ type: "text" as const, text: clientMessageId }],
        },
      },
    };
  }

  it("publishes subprocess failure before clearing a steer pending after peer completion", async () => {
    const executable = await fakeAcp(`const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
const send = (message, callback) => process.stdout.write(JSON.stringify(message) + "\\n", callback);
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  else if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-1", modes: null, configOptions: [] } });
    send({ jsonrpc: "2.0", method: "vendor/turn", params: { turnId: "peer", state: "started" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "vendor/turn", params: { turnId: "peer", state: "completed" } }, () => process.exit(17));
  }
});`);
    const registration = runAcpProvider({
      id: "subprocess-pending-steer",
      label: "Subprocess pending steer",
      command: [process.execPath, executable],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [
        vendorTurnTransformer,
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send(openInput());
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        ...promptInput("pending-at-exit"),
        prompt: { ...promptInput("pending-at-exit").prompt, delivery: "steer" },
      });
      await waitForEvent(
        events,
        (event) => event.type === "session.pending_work" && !event.pending,
      );
      await waitForEvent(events, (event) => event.type === "session.runtime_failed");
      const terminal = events.findIndex(
        (event) => event.type === "session.turn" && event.state === "completed",
      );
      const failure = events.findIndex((event) => event.type === "session.runtime_failed");
      const cleared = events.findIndex(
        (event) => event.type === "session.pending_work" && !event.pending,
      );
      expect(terminal).toBeGreaterThan(-1);
      expect(failure).toBeGreaterThan(terminal);
      expect(cleared).toBeGreaterThan(failure);
      expect(
        events
          .filter((event) => event.type === "session.pending_work")
          .map((event) => event.pending),
      ).toEqual([true, false]);
      expect(events.filter((event) => event.type === "session.turn")).toHaveLength(2);
      expect(events.filter((event) => event.type === "session.runtime_failed")).toHaveLength(1);
    } finally {
      await connection.close();
    }
  });

  it("admits steers concurrently and lazily opens a rollover turn", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      const opened = events.find((event) => event.type === "session.opened");
      expect(opened?.type === "session.opened" && opened.capabilities).toContain("prompt.steer");
      expect(opened?.type === "session.opened" && opened.capabilities).toContain(
        "session.shared_turns",
      );
      await connection.send(promptInput("first"));
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      await connection.send({
        ...promptInput("steer"),
        prompt: { ...promptInput("steer").prompt, delivery: "steer" },
      });
      const result = await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "steer",
      );
      expect(result.type === "session.prompt_result" && result.result).toEqual({
        type: "steer",
        turnId: "acp:first",
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(2);
      const requests = agent().requests.filter((request) => request.method === "session/prompt");
      agent().respond(requests[0], { stopReason: "end_turn" });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("rollover"),
      });
      agent().respond(requests[1], { stopReason: "end_turn" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:steer" &&
          event.state === "started",
      );
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:steer" &&
          event.state === "completed",
      );
      expect(countRequests(agent(), "session/cancel")).toBe(0);
    } finally {
      await connection.close();
    }
  });

  it("keeps accepted work pending across a peer terminal before rollover output", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer", state: "started" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        ...promptInput("late-steer"),
        prompt: { ...promptInput("late-steer").prompt, delivery: "steer" },
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      agent().notify("vendor/turn", { turnId: "peer", state: "completed" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "completed",
      );
      expect(events.filter((event) => event.type === "session.pending_work")).toEqual([
        { type: "session.pending_work", sessionId: "session-1", pending: true },
      ]);
      expect(events.filter((event) => event.type === "session.turn")).toEqual([
        {
          type: "session.turn",
          sessionId: "session-1",
          turnId: "acp-vendor:peer",
          state: "started",
        },
        {
          type: "session.turn",
          sessionId: "session-1",
          turnId: "acp-vendor:peer",
          state: "completed",
        },
      ]);
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("late output"),
      });
      agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
        stopReason: "end_turn",
      });
      await waitForEvent(
        events,
        (event) => event.type === "session.pending_work" && event.pending === false,
      );
      expect(
        events
          .filter((event) => event.type === "session.turn")
          .map((event) => ({ turnId: event.turnId, state: event.state })),
      ).toEqual([
        { turnId: "acp-vendor:peer", state: "started" },
        { turnId: "acp-vendor:peer", state: "completed" },
        { turnId: "acp:late-steer", state: "started" },
        { turnId: "acp:late-steer", state: "completed" },
      ]);
      expect(
        events.findIndex((event) => event.type === "session.pending_work" && !event.pending),
      ).toBeGreaterThan(
        events.findIndex(
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp:late-steer" &&
            event.state === "completed",
        ),
      );
    } finally {
      await connection.close();
    }
  });

  it.each(["rejected", "connection-closed", "transport-closed"])(
    "clears accepted pending work once after %s without inventing a turn",
    async (ending) => {
      const { connection, events, agent } = await connectVendorTurns({
        capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
        acpOptions: { vendorTurnsAreNeverForeground: true },
        transformers: [
          { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
        ],
        harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
      });
      try {
        agent().notify("vendor/turn", { turnId: "peer", state: "started" });
        await waitForEvent(
          events,
          (event) => event.type === "session.turn" && event.state === "started",
        );
        await connection.send({
          ...promptInput("late"),
          prompt: { ...promptInput("late").prompt, delivery: "steer" },
        });
        await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
        agent().notify("vendor/turn", { turnId: "peer", state: "completed" });
        await waitForEvent(
          events,
          (event) => event.type === "session.turn" && event.state === "completed",
        );
        if (ending === "rejected")
          agent().reject(
            agent().requests.find((request) => request.method === "session/prompt")!,
            "late admission failed",
          );
        else if (ending === "transport-closed") agent().closeFromAgent();
        else await connection.close();
        await waitForEvent(
          events,
          (event) => event.type === "session.pending_work" && event.pending === false,
        );
        expect(
          events
            .filter((event) => event.type === "session.pending_work")
            .map((event) => event.pending),
        ).toEqual([true, false]);
        expect(events.filter((event) => event.type === "session.turn")).toHaveLength(2);
        if (ending === "transport-closed") {
          expect(events.findIndex((event) => event.type === "session.runtime_failed")).toBeLessThan(
            events.findIndex((event) => event.type === "session.pending_work" && !event.pending),
          );
        }
      } finally {
        await connection.close();
      }
    },
  );

  it.each(["origin-first", "steer-first"])(
    "settles two steers without phantom turns (%s)",
    async (order) => {
      const { connection, events, agent } = await connectVendorTurns({
        capabilities: ["prompt.message", "prompt.steer"],
        transformers: [
          { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
        ],
        harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
      });
      try {
        await connection.send(promptInput("origin"));
        await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
        for (const id of ["steer-1", "steer-2"]) {
          await connection.send({
            ...promptInput(id),
            prompt: { ...promptInput(id).prompt, delivery: "steer" },
          });
          const result = await waitForEvent(
            events,
            (event) => event.type === "session.prompt_result" && event.clientMessageId === id,
          );
          expect(result.type === "session.prompt_result" && result.result).toEqual({
            type: "steer",
            turnId: "acp:origin",
          });
        }
        await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(3);
        agent().notify("session/update", {
          sessionId: "connector-session",
          update: { sessionUpdate: "usage_update", used: 10, size: 100 },
        });
        const usage = await waitForEvent(events, (event) => event.type === "session.usage");
        expect(usage.type === "session.usage" && usage.turnId).toBe("acp:origin");
        const requests = agent().requests.filter((request) => request.method === "session/prompt");
        for (const index of order === "origin-first" ? [0, 1, 2] : [2, 1, 0]) {
          agent().respond(requests[index], { stopReason: "end_turn" });
        }
        await waitForEvent(
          events,
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp:origin" &&
            event.state === "completed",
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(events.filter((event) => event.type === "session.turn")).toHaveLength(2);
        expect(countRequests(agent(), "session/cancel")).toBe(0);
      } finally {
        await connection.close();
      }
    },
  );

  it("steers an observed peer turn without creating another terminal", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer", state: "started" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        ...promptInput("steer"),
        prompt: { ...promptInput("steer").prompt, delivery: "steer" },
      });
      const result = await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "steer",
      );
      expect(result.type === "session.prompt_result" && result.result).toEqual({
        type: "steer",
        turnId: "acp-vendor:peer",
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      await connection.send({
        ...promptInput("steering"),
        prompt: { ...promptInput("steering").prompt, delivery: "steer" },
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(2);
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("ste", "echo"),
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("er", "echo"),
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("someone else", "peer-message"),
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("peer output"),
      });
      // A peer message can be a prefix of a pending echo; flush it on the turn boundary.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("st", "peer-prefix"),
      });
      agent().notify("vendor/turn", { turnId: "peer", state: "completed" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "completed",
      );
      agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
        stopReason: "end_turn",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(events.filter((event) => event.type === "session.turn")).toHaveLength(2);
      const userMessages = events.filter(
        (event) => event.type === "timeline.item" && event.item.type === "user_message",
      );
      expect(userMessages).toHaveLength(4);
      expect(
        userMessages.some(
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "user_message" &&
            event.item.text === "someone else",
        ),
      ).toBe(true);
      expect(
        userMessages.some(
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "user_message" &&
            event.item.text === "st",
        ),
      ).toBe(true);
      expect(countRequests(agent(), "session/cancel")).toBe(0);
    } finally {
      await connection.close();
    }
  });

  it("does not suppress a peer message after the steer response", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer"],
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer", state: "started" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        ...promptInput("steer"),
        prompt: { ...promptInput("steer").prompt, delivery: "steer" },
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
        stopReason: "end_turn",
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("steer", "peer"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "user_message" &&
          event.item.messageId === "peer",
      );
    } finally {
      await connection.close();
    }
  });

  it("waits for an active shared prompt instead of canceling it", async () => {
    const { connection, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      await connection.send(promptInput("first"));
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      await connection.send(promptInput("second"));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(countRequests(agent(), "session/cancel")).toBe(0);
      expect(countRequests(agent(), "session/prompt")).toBe(1);
      agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
        stopReason: "end_turn",
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(2);
    } finally {
      await connection.close();
    }
  });

  it("closes while a shared prompt admission is waiting without canceling", async () => {
    const { connection, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    await connection.send(promptInput("first"));
    await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
    await connection.send(promptInput("waiting"));
    await connection.close();
    expect(countRequests(agent(), "session/cancel")).toBe(0);
    expect(countRequests(agent(), "session/prompt")).toBe(1);
  });

  it.each(["close", "transport loss"])(
    "releases a waiting admission after rollover %s",
    async (shutdown) => {
      const { connection, events, agent } = await connectVendorTurns({
        capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
        acpOptions: { vendorTurnsAreNeverForeground: true },
        transformers: [
          { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
        ],
        harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
      });
      try {
        await connection.send(promptInput("origin"));
        await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
        await connection.send({
          ...promptInput("steer"),
          prompt: { ...promptInput("steer").prompt, delivery: "steer" },
        });
        await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(2);
        agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
          stopReason: "end_turn",
        });
        agent().notify("session/update", {
          sessionId: "connector-session",
          update: textChunk("rollover"),
        });
        await waitForEvent(
          events,
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp:steer" &&
            event.state === "started",
        );
        await connection.send(promptInput("waiting"));
        if (shutdown === "transport loss") {
          agent().closeFromAgent();
          await waitForEvent(events, (event) => event.type === "session.runtime_failed");
        }
        await connection.close();
      } finally {
        await connection.close();
      }
    },
  );

  it("requires both steering policies and refuses an idle steer without writing", async () => {
    const disabled = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer"],
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: false }) },
      ],
    });
    const opened = disabled.events.find((event) => event.type === "session.opened");
    expect(opened?.type === "session.opened" && opened.capabilities).not.toContain("prompt.steer");
    await disabled.connection.close();
    const enabled = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer"],
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
    });
    try {
      await enabled.connection.send({
        ...promptInput("idle"),
        prompt: { ...promptInput("idle").prompt, delivery: "steer" },
      });
      const result = await waitForEvent(
        enabled.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "idle",
      );
      expect(result.type === "session.prompt_result" && result.result.type).toBe("failed");
      expect(countRequests(enabled.agent(), "session/prompt")).toBe(0);
    } finally {
      await enabled.connection.close();
    }
  });

  it("respects a policy that forbids stopping an observed turn", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [{ attach: () => ({ stopObservedTurns: false }) }],
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer", state: "started" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        type: "session.interrupt",
        sessionId: "session-1",
        requestId: "stop",
      });
      await waitForEvent(
        events,
        (event) => event.type === "request.failed" && event.requestId === "stop",
      );
      expect(countRequests(agent(), "session/cancel")).toBe(0);
      expect(events.filter((event) => event.type === "session.notice")).toHaveLength(1);
    } finally {
      await connection.close();
    }
  });

  it.each([false, true])("omits configured MCP servers on open (load: %s)", async (load) => {
    const harness = connectorHarness({ capabilities: { loadSession: true } });
    const connection = await runAcpProvider({
      id: "mcp-policy",
      label: "MCP policy",
      connector: harness.connector,
      transformers: [{ initialize: () => ({ sendSessionMcpServers: false }) }],
    }).connect({ versions: [1], capabilities: ["prompt.message", "session.persistence"] });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    const input = openInput();
    input.config.mcpServers = { example: { type: "stdio", command: "example" } };
    if (load) input.persistence = { version: 1, data: { sessionId: "connector-session" } };
    try {
      await connection.send(input);
      await waitForEvent(events, (event) => event.type === "session.ready");
      const instance = harness.instances.at(-1)!;
      const request = instance.requests.find(
        (entry) => entry.method === (load ? "session/load" : "session/new"),
      );
      expect((request!.params as { mcpServers: unknown[] }).mcpServers).toEqual([]);
      const notices = events.filter((event) => event.type === "session.notice");
      expect(notices).toHaveLength(1);
      expect(notices[0].type === "session.notice" && notices[0].notice.description).toContain(
        "example",
      );
    } finally {
      await connection.close();
    }
  });

  it("reports a vendor turn as a namespaced started, timeline, completed sequence", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-1", state: "started" });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("peer output"),
      });
      agent().notify("vendor/turn", { turnId: "peer-1", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-1" &&
          event.state === "completed",
      );

      const sequence = events.flatMap((event) => {
        if (event.type === "session.turn" && event.turnId === "acp-vendor:peer-1") {
          return [`turn:${event.state}`];
        }
        if (event.type === "timeline.item" && event.item.type === "assistant_message") {
          return [`item:${event.item.text}`];
        }
        return [];
      });
      expect(sequence).toEqual(["turn:started", "item:peer output", "turn:completed"]);
    } finally {
      await connection.close();
    }
  });

  it("applies a vendor terminal after the session updates that preceded it on the wire", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-2", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-2" &&
          event.state === "started",
      );

      for (const text of ["one", "two"]) {
        agent().notify("session/update", {
          sessionId: "connector-session",
          update: textChunk(text, "agent_message_chunk", `m-${text}`),
        });
        await waitForEvent(
          events,
          (event) =>
            event.type === "timeline.item" &&
            event.item.type === "assistant_message" &&
            event.item.text === text,
        );
        // Let the client settle, so the write below starts from an idle connection.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      // One write: the last update and the terminal that follows it. The terminal must wait for
      // the update even though the client is idle when the batch arrives.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("three", "agent_message_chunk", "m-three"),
      });
      agent().notify("vendor/turn", { turnId: "peer-2", state: "completed" });

      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-2" &&
          event.state === "completed",
      );
      const terminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-2" &&
          event.state === "completed",
      );
      const applied = events.flatMap((event, index) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text !== undefined
          ? [{ text: event.item.text, index }]
          : [],
      );
      expect(applied.map((item) => item.text)).toEqual(["one", "two", "three"]);
      expect(applied.every((item) => item.index < terminal)).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it("drops a vendor turn that starts while a foreground prompt is active", async () => {
    let promptRequest: AcpRequestMessage | null = null;
    const { connection, events, agent } = await connectVendorTurns({
      harness: {
        handleRequest(instance, request) {
          if (request.method !== "session/prompt") return false;
          promptRequest = request;
          return true;
        },
      },
    });
    try {
      await connection.send(promptInput("foreground"));
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);

      agent().notify("vendor/turn", { turnId: "peer-3", state: "started" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      agent().respond(promptRequest!, { stopReason: "end_turn" });

      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:foreground" &&
          event.state === "completed",
      );
      expect(
        events.filter(
          (event) => event.type === "session.turn" && event.turnId.startsWith("acp-vendor:"),
        ),
      ).toEqual([]);
    } finally {
      await connection.close();
    }
  });

  it("admits a prompt after an open vendor turn completes without cancelling it", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-4", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-4" &&
          event.state === "started",
      );

      await connection.send(promptInput("queued"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);

      agent().notify("vendor/turn", { turnId: "peer-4", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:queued" &&
          event.state === "completed",
      );

      expect(countRequests(agent(), "session/cancel")).toBe(0);
      expect(countRequests(agent(), "session/prompt")).toBe(1);
      const vendorTerminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-4" &&
          event.state === "completed",
      );
      const admission = events.findIndex(
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "queued",
      );
      expect(vendorTerminal).toBeGreaterThan(-1);
      expect(vendorTerminal).toBeLessThan(admission);
    } finally {
      await connection.close();
    }
  });

  it("consumes the real jcode reverse-steer wire corpus during its own prompt", async () => {
    const { connection, events } = await connectVendorTurns({
      acpOptions: { vendorTurnsAreNeverForeground: true },
      harness: { promptUpdates: () => jcodeCorpusUpdates("10-reverse-steer-v1") },
    });
    try {
      await connection.send(promptInput("own-question"));
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "completed",
      );
      expect(timelineProjection(events).map((item) => item.text)).toEqual([
        "own-question",
        "before-steer",
        "reverse-steer-marker",
        "after-steer",
      ]);
    } finally {
      await connection.close();
    }
  });

  it("keeps anonymous assistant messages separate across a suppressed foreground steer echo", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer"],
      transformers: [
        { initialize: () => ({ steering: true }), attach: () => ({ steering: true }) },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      await connection.send(promptInput("origin"));
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("before"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "before",
      );
      await connection.send({
        ...promptInput("steer"),
        prompt: { ...promptInput("steer").prompt, delivery: "steer" },
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(2);
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("steer"),
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("after"),
      });
      for (const promptRequest of agent().requests.filter(
        (request) => request.method === "session/prompt",
      )) {
        agent().respond(promptRequest, { stopReason: "end_turn" });
      }
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:origin" &&
          event.state === "completed",
      );
      expect(timelineProjection(events)).toEqual([
        { type: "user_message", id: "origin", text: "origin" },
        { type: "assistant_message", id: "agent_message_chunk:1", text: "before" },
        { type: "user_message", id: "steer", text: "steer" },
        { type: "assistant_message", id: "agent_message_chunk:2", text: "after" },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("preserves equal-text peer input while a no-own-echo profile has a pending own steer", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [
        {
          initialize: () => ({ steering: true, echoesUserMessages: false }),
          attach: () => ({ steering: true }),
        },
      ],
      harness: { handleRequest: (_instance, request) => request.method === "session/prompt" },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer", state: "started" });
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      await connection.send({
        ...promptInput("steer"),
        prompt: { ...promptInput("steer").prompt, delivery: "steer" },
      });
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("steer", "peer-native"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "user_message" &&
          event.item.messageId === "peer-native",
      );
      expect(timelineProjection(events).filter((item) => item.type === "user_message")).toEqual([
        { type: "user_message", id: "steer", text: "steer" },
        { type: "user_message", id: '["user_message_chunk","peer-native"]', text: "steer" },
      ]);
      agent().notify("vendor/turn", { turnId: "peer", state: "completed" });
      agent().respond(agent().requests.find((request) => request.method === "session/prompt")!, {
        stopReason: "end_turn",
      });
    } finally {
      await connection.close();
    }
  });

  it("preserves equal-text peer steering during a foreground prompt for a no-own-echo profile", async () => {
    const { connection, events } = await connectVendorTurns({
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [{ initialize: () => ({ echoesUserMessages: false }) }],
      harness: {
        promptUpdates: (promptText) => [
          userChunk(promptText, "peer-same-text"),
          userChunk("reply REVERSE", "peer-steer"),
          userChunk("reply REVERSE", "peer-repeat"),
          textChunk("REVERSE"),
        ],
      },
    });
    try {
      await connection.send(promptInput("foreground"));
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:foreground" &&
          event.state === "completed",
      );
      expect(timelineProjection(events).filter((item) => item.type === "user_message")).toEqual([
        { type: "user_message", id: "foreground", text: "foreground" },
        { type: "user_message", id: '["user_message_chunk","peer-same-text"]', text: "foreground" },
        { type: "user_message", id: '["user_message_chunk","peer-steer"]', text: "reply REVERSE" },
        { type: "user_message", id: '["user_message_chunk","peer-repeat"]', text: "reply REVERSE" },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("shows a live user message that arrives outside a prompt and drops the prompt echo", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      harness: {
        promptUpdates: (promptText) => [
          { sessionUpdate: "user_message_chunk", content: { type: "text", text: promptText } },
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
        ],
      },
    });
    try {
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "from peer" },
        },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "user_message" &&
          event.item.text === "from peer",
      );

      await connection.send(promptInput("hello"));
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:hello" &&
          event.state === "completed",
      );
      const userMessages = events.flatMap((event) =>
        event.type === "timeline.item" && event.item.type === "user_message"
          ? [event.item.text]
          : [],
      );
      expect(userMessages).toEqual(["from peer", "hello"]);
    } finally {
      await connection.close();
    }
  });

  it("fails an open vendor turn when the transport closes and unblocks a waiting prompt", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-5", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-5" &&
          event.state === "started",
      );

      await connection.send(promptInput("after-peer"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      agent().closeFromAgent();

      const failed = await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-5" &&
          event.state === "failed",
      );
      expect(failed).toMatchObject({ error: { message: "ACP transport closed" } });
      // The waiting prompt proceeds and fails with the closed transport.
      await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "after-peer",
      );
    } finally {
      await connection.close();
    }
  });

  it("keeps the vendor lane moving when the SDK drops a schema-invalid update", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-6", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-6" &&
          event.state === "started",
      );

      // The SDK rejects this before it reaches the client, so its slot is never delivered.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: { sessionUpdate: "not_a_real_update" },
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("after the skip", "agent_message_chunk", "m-after-skip"),
      });
      agent().notify("vendor/turn", { turnId: "peer-6", state: "completed" });

      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-6" &&
          event.state === "completed",
      );
      const item = events.findIndex(
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "after the skip",
      );
      const terminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-6" &&
          event.state === "completed",
      );
      expect(item).toBeGreaterThan(-1);
      expect(item).toBeLessThan(terminal);
    } finally {
      await connection.close();
    }
  });

  it("waits for a vendor turn that opens while the previous one closes", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-7", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-7" &&
          event.state === "started",
      );

      await connection.send(promptInput("after-chain"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);

      // Ending the open turn admits the next one in the same step, so a single await would
      // release the prompt while the second turn is still running.
      agent().notify("vendor/turn", { turnId: "peer-8", state: "started" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);

      agent().notify("vendor/turn", { turnId: "peer-8", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:after-chain" &&
          event.state === "completed",
      );
      expect(countRequests(agent(), "session/prompt")).toBe(1);
    } finally {
      await connection.close();
    }
  });

  it("applies a vendor update between the updates that surround it on the wire", async () => {
    const vendorNote = {
      notification(notification: { method: string; params: unknown }) {
        if (notification.method !== "vendor/note") return null;
        const params = notification.params as { id: string; text: string };
        return {
          type: "timeline" as const,
          item: { type: "assistant_message" as const, id: params.id, text: params.text },
        };
      },
    };
    const { connection, events, agent } = await connectVendorTurns({
      transformers: [vendorNote],
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-9", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-9" &&
          event.state === "started",
      );

      // One write: an update, a vendor note, then another update.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("before the note", "agent_message_chunk", "m-before"),
      });
      agent().notify("vendor/note", { id: "vendor-note", text: "peer note" });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("after the note", "agent_message_chunk", "m-after"),
      });

      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "after the note",
      );
      const order = events.flatMap((event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text !== undefined
          ? [event.item.text]
          : [],
      );
      expect(order).toEqual(["before the note", "peer note", "after the note"]);
    } finally {
      await connection.close();
    }
  });

  it("ends an open vendor turn as completed when a second one starts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-10", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-10" &&
          event.state === "started",
      );
      agent().notify("vendor/turn", { turnId: "peer-11", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-11" &&
          event.state === "started",
      );

      const turns = events.flatMap((event) =>
        event.type === "session.turn" && event.turnId.startsWith("acp-vendor:")
          ? [`${event.state}:${event.turnId}`]
          : [],
      );
      expect(turns).toEqual([
        "started:acp-vendor:peer-10",
        "completed:acp-vendor:peer-10",
        "started:acp-vendor:peer-11",
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("acp-vendor:peer-11 started while acp-vendor:peer-10 was open"),
      );
    } finally {
      warn.mockRestore();
      await connection.close();
    }
  });

  it("closes running vendor tool rows and clears fallback chunks when a vendor turn ends", async () => {
    const vendorPhase = {
      notification(notification: { method: string; params: unknown }) {
        if (notification.method !== "vendor/phase") return null;
        const params = notification.params as { id: string; label: string };
        return {
          type: "timeline" as const,
          item: {
            type: "tool_call" as const,
            id: params.id,
            callId: params.id,
            name: "Vendor phase",
            detail: { type: "plain_text" as const, label: params.label },
            status: "running" as const,
            error: null,
          },
        };
      },
    };
    const { connection, events, agent } = await connectVendorTurns({
      transformers: [vendorPhase],
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-12", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-12" &&
          event.state === "started",
      );
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("streamed"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "streamed",
      );
      agent().notify("vendor/phase", { id: "phase-1", label: "Preparing" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "tool_call" &&
          event.item.id === "phase-1",
      );
      agent().notify("vendor/turn", { turnId: "peer-12", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-12" &&
          event.state === "completed",
      );

      const rowStatuses = events.flatMap((event) =>
        event.type === "timeline.item" &&
        event.item.type === "tool_call" &&
        event.item.id === "phase-1"
          ? [event.item.status]
          : [],
      );
      expect(rowStatuses).toEqual(["running", "completed"]);
      const closed = events.findIndex(
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "tool_call" &&
          event.item.id === "phase-1" &&
          event.item.status === "completed",
      );
      const terminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-12" &&
          event.state === "completed",
      );
      expect(closed).toBeGreaterThan(-1);
      expect(closed).toBeLessThan(terminal);

      // The turn cleared the anonymous chunk, so the next chunk starts a new timeline item.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("after the turn"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "after the turn",
      );
      const chunkIds = events.flatMap((event) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text !== undefined
          ? [{ id: event.item.id, text: event.item.text }]
          : [],
      );
      expect(chunkIds).toEqual([
        { id: "agent_message_chunk:1", text: "streamed" },
        { id: "agent_message_chunk:2", text: "after the turn" },
      ]);
    } finally {
      await connection.close();
    }
  });

  const vendorNoteTransformer = {
    notification(notification: { method: string; params: unknown }) {
      if (notification.method !== "vendor/note") return null;
      const params = notification.params as { id: string; text: string };
      return {
        type: "timeline" as const,
        item: { type: "assistant_message" as const, id: params.id, text: params.text },
      };
    },
  };

  function assistantTexts(events: ProviderEvent[]): string[] {
    return events.flatMap((event) =>
      event.type === "timeline.item" &&
      event.item.type === "assistant_message" &&
      event.item.text !== undefined
        ? [event.item.text]
        : [],
    );
  }

  it("holds later wire messages back while a vendor update waits on a dropped update", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      transformers: [vendorNoteTransformer],
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-15", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-15" &&
          event.state === "started",
      );

      // One write: a dropped update, a vendor note waiting on its slot, then a valid update. The
      // valid update must not reach the client while the note is still waiting.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: { sessionUpdate: "not_a_real_update" },
      });
      agent().notify("vendor/note", { id: "vendor-note-15", text: "peer note" });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("after the note", "agent_message_chunk", "m-after-15"),
      });

      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "after the note",
      );
      expect(assistantTexts(events)).toEqual(["peer note", "after the note"]);
    } finally {
      await connection.close();
    }
  });

  it("does not make later vendor updates wait on a dropped update that already timed out", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      transformers: [vendorNoteTransformer],
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-16", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-16" &&
          event.state === "started",
      );

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: { sessionUpdate: "not_a_real_update" },
      });
      agent().notify("vendor/note", { id: "vendor-note-16a", text: "first note" });
      await vi.advanceTimersByTimeAsync(250);
      expect(assistantTexts(events)).toEqual(["first note"]);

      // Nothing claimed the dropped slot, but its wait already expired: the next note goes
      // straight to the lane instead of waiting out the bound again.
      agent().notify("vendor/note", { id: "vendor-note-16b", text: "second note" });
      await vi.advanceTimersByTimeAsync(1);
      expect(assistantTexts(events)).toEqual(["first note", "second note"]);
    } finally {
      vi.useRealTimers();
      await connection.close();
    }
  });

  it("releases a vendor terminal whose last update the SDK dropped and admits the next prompt", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-13", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-13" &&
          event.state === "started",
      );

      // The SDK drops this before it reaches the client: toolCallId must be a string.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: 7,
          title: "Dropped row",
          status: "completed",
        },
      });
      agent().notify("vendor/turn", { turnId: "peer-13", state: "completed" });

      // The prompt is admitted behind the open vendor turn, which is behind the dropped slot.
      await connection.send(promptInput("after-drop"));

      const terminal = await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-13" &&
          event.state === "completed",
      );
      const admission = await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "after-drop",
      );
      expect(events.indexOf(terminal)).toBeLessThan(events.indexOf(admission));
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:after-drop" &&
          event.state === "completed",
      );
      expect(countRequests(agent(), "session/prompt")).toBe(1);
    } finally {
      await connection.close();
    }
  });

  it("bounds a dropped update that a later valid one cannot be told apart from", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-14", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-14" &&
          event.state === "started",
      );

      // Same ids and status as the update below, but `title` must be a string, so the SDK drops
      // this one and its slot is never claimed by a delivery.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "row-14",
          title: 42,
          status: "completed",
        },
      });
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "row-14",
          title: "Row 14",
          status: "completed",
        },
      });
      agent().notify("vendor/turn", { turnId: "peer-14", state: "completed" });
      await connection.send(promptInput("after-pair"));

      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-14" &&
          event.state === "completed",
      );
      const item = events.findIndex(
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "tool_call" &&
          event.item.id === "row-14",
      );
      const terminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-14" &&
          event.state === "completed",
      );
      expect(item).toBeGreaterThan(-1);
      expect(item).toBeLessThan(terminal);
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:after-pair" &&
          event.state === "completed",
      );
    } finally {
      await connection.close();
    }
  });

  it("starts a new chunk item after session/load instead of continuing the replay", async () => {
    const { connection, events, harness } = await openReplaySession(
      [textChunk("replayed")],
      "replay",
    );
    try {
      const live = harness.instances.at(-1);
      if (!live) throw new Error("ACP connector did not start");
      live.notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("live"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "live",
      );
      const chunks = timelineProjection(events).filter((item) => item.type === "assistant_message");
      expect(chunks).toEqual([
        { type: "assistant_message", id: "agent_message_chunk:1", text: "replayed" },
        { type: "assistant_message", id: "agent_message_chunk:2", text: "live" },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("clears the fallback chunk ids when a vendor turn starts", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("replayed"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "replayed",
      );
      agent().notify("vendor/turn", { turnId: "peer-15", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-15" &&
          event.state === "started",
      );
      // A peer turn without user content: its first chunk must not continue the previous item.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("peer output"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "peer output",
      );
      const chunks = timelineProjection(events).filter((item) => item.type === "assistant_message");
      expect(chunks).toEqual([
        { type: "assistant_message", id: "agent_message_chunk:1", text: "replayed" },
        { type: "assistant_message", id: "agent_message_chunk:2", text: "peer output" },
      ]);
    } finally {
      await connection.close();
    }
  });

  it("keeps a peer turn that starts during a prompt when the provider opts in", async () => {
    let promptRequest: AcpRequestMessage | null = null;
    const harness = connectorHarness({
      handleRequest(instance, request) {
        if (request.method !== "session/prompt") return false;
        promptRequest = request;
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "peer-turn-acp",
      label: "Peer turn ACP",
      connector: harness.connector,
      acpOptions: { vendorTurnsAreNeverForeground: true },
      transformers: [vendorTurnTransformer],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await connection.send(openInput());
    await waitForEvent(events, (event) => event.type === "session.ready");
    const agent = () => {
      const instance = harness.instances.at(-1);
      if (!instance) throw new Error("ACP connector did not start");
      return instance;
    };
    try {
      // Paseo's prompt B is active and its request has been sent.
      await connection.send(promptInput("B"));
      await expect.poll(() => countRequests(agent(), "session/prompt")).toBe(1);

      // The peer turn starts while B is active: the agent queues B behind it.
      agent().notify("vendor/turn", { turnId: "turn-7", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:turn-7" &&
          event.state === "started",
      );
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: userChunk("A"),
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "user_message" &&
          event.item.text === "A",
      );
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("A output"),
      });
      agent().notify("vendor/turn", { turnId: "turn-7", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:turn-7" &&
          event.state === "completed",
      );

      // B's own output follows the peer turn.
      agent().notify("session/update", {
        sessionId: "connector-session",
        update: textChunk("B output"),
      });
      agent().respond(promptRequest!, { stopReason: "end_turn" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" && event.turnId === "acp:B" && event.state === "completed",
      );

      // The peer user message is shown rather than dropped as B's echo.
      const userMessages = events.flatMap((event) =>
        event.type === "timeline.item" && event.item.type === "user_message"
          ? [event.item.text]
          : [],
      );
      expect(userMessages).toEqual(["B", "A"]);

      // Peer output and B's output stay separate items, and the peer's lands inside its turn.
      const assistant = events.flatMap((event, index) =>
        event.type === "timeline.item" &&
        event.item.type === "assistant_message" &&
        event.item.text !== undefined
          ? [{ id: event.item.id, text: event.item.text, index }]
          : [],
      );
      expect(assistant.map((item) => item.text)).toEqual(["A output", "B output"]);
      expect(new Set(assistant.map((item) => item.id)).size).toBe(2);
      const vendorTerminal = events.findIndex(
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:turn-7" &&
          event.state === "completed",
      );
      expect(assistant[0]!.index).toBeLessThan(vendorTerminal);
      expect(assistant[1]!.index).toBeGreaterThan(vendorTerminal);
    } finally {
      await connection.close();
    }
  });

  it("cancels a prompt parked behind a vendor turn when the user stops", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-17", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-17" &&
          event.state === "started",
      );

      await connection.send(promptInput("stopped"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);

      await connection.send({
        type: "session.interrupt",
        requestId: "stop-1",
        sessionId: "session-1",
      });
      const result = await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "stopped",
      );
      // The same shape an interrupted prompt uses, not a failure.
      expect(result.type === "session.prompt_result" ? result.result : null).toEqual({
        type: "turn",
        turnId: "acp:stopped",
      });
      expect(
        events.filter((event) => event.type === "session.turn" && event.turnId === "acp:stopped"),
      ).toEqual([
        expect.objectContaining({ state: "started" }),
        expect.objectContaining({ state: "canceled" }),
      ]);

      // Even after the peer turn ends, the stopped prompt is never sent.
      agent().notify("vendor/turn", { turnId: "peer-17", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-17" &&
          event.state === "completed",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);
      expect(
        events.filter((event) => event.type === "session.turn" && event.turnId === "acp:stopped"),
      ).toHaveLength(2);
    } finally {
      await connection.close();
    }
  });

  it("ends a cancelled vendor turn locally when the agent reports no terminal", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      acpOptions: { vendorTurnsAreNeverForeground: true },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-18", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-18" &&
          event.state === "started",
      );
      await connection.send({
        type: "session.interrupt",
        requestId: "stop-2",
        sessionId: "session-1",
      });

      // The agent acknowledges nothing and sends no terminal: the grace period ends the turn.
      const ended = await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-18" &&
          event.state === "canceled",
      );
      expect(ended).toMatchObject({ error: { message: "Canceled by Paseo" } });

      // Prompts are admitted again instead of waiting on the abandoned turn.
      await connection.send(promptInput("after-cancel"));
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:after-cancel" &&
          event.state === "completed",
      );
      expect(countRequests(agent(), "session/prompt")).toBe(1);
    } finally {
      await connection.close();
    }
  });

  it("keeps the agent's own terminal when it arrives before the cancel grace period", async () => {
    const { connection, events, agent } = await connectVendorTurns({
      acpOptions: { vendorTurnsAreNeverForeground: true },
    });
    try {
      agent().notify("vendor/turn", { turnId: "peer-19", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-19" &&
          event.state === "started",
      );
      await connection.send({
        type: "session.interrupt",
        requestId: "stop-3",
        sessionId: "session-1",
      });
      agent().notify("vendor/turn", { turnId: "peer-19", state: "canceled" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-19" &&
          event.state === "canceled",
      );
      // Give the grace period time to fire; the timer must not emit a second terminal.
      await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
      const terminals = events.filter(
        (event) => event.type === "session.turn" && event.turnId === "acp-vendor:peer-19",
      );
      expect(terminals.map((event) => event.type === "session.turn" && event.state)).toEqual([
        "started",
        "canceled",
      ]);
    } finally {
      await connection.close();
    }
  });

  it.each(["skip", "replay"] as const)(
    "surfaces a turn that is running when the session attaches with history %s",
    async (history) => {
      const harness = connectorHarness({
        capabilities: { loadSession: true },
        handleRequest(instance, request) {
          if (request.method !== "session/load") return false;
          // jcode replays history, then flushes the held peer turn, then answers session/load.
          instance.notify("session/update", {
            sessionId: "connector-session",
            update: textChunk("history"),
          });
          instance.notify("vendor/turn", { turnId: "turn-9", state: "started" });
          instance.notify("session/update", {
            sessionId: "connector-session",
            update: userChunk("peer message"),
          });
          instance.notify("session/update", {
            sessionId: "connector-session",
            update: textChunk("peer reply"),
          });
          instance.respond(request, {
            sessionId: "connector-session",
            modes: null,
            configOptions: [],
          });
          return true;
        },
      });
      const registration = runAcpProvider({
        id: "attach-acp",
        label: "Attach ACP",
        connector: harness.connector,
        transformers: [vendorTurnTransformer],
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message", "session.persistence"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      const input = openInput();
      input.persistence = { version: 1, data: { sessionId: "connector-session" } };
      input.history = history;
      try {
        await connection.send(input);
        await waitForEvent(events, (event) => event.type === "session.ready");

        // The running turn is surfaced before the session opens, so the server sees it as running.
        const turnStarted = events.findIndex(
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp-vendor:turn-9" &&
            event.state === "started",
        );
        const opened = events.findIndex((event) => event.type === "session.opened");
        expect(turnStarted).toBeGreaterThan(-1);
        expect(turnStarted).toBeLessThan(opened);

        // The peer's user message is kept once, and its output is not lost.
        const userMessages = events.flatMap((event) =>
          event.type === "timeline.item" && event.item.type === "user_message"
            ? [event.item.text]
            : [],
        );
        expect(userMessages).toEqual(["peer message"]);
        const assistant = events.flatMap((event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text !== undefined
            ? [event.item.text]
            : [],
        );
        expect(assistant).toEqual(
          history === "replay" ? ["history", "peer reply"] : ["peer reply"],
        );
      } finally {
        await connection.close();
      }
    },
  );

  it("ends an open vendor turn as canceled when the session is closed", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    agent().notify("vendor/turn", { turnId: "peer-20", state: "started" });
    await waitForEvent(
      events,
      (event) =>
        event.type === "session.turn" &&
        event.turnId === "acp-vendor:peer-20" &&
        event.state === "started",
    );
    await connection.close();
    const terminal = events.find(
      (event) =>
        event.type === "session.turn" &&
        event.turnId === "acp-vendor:peer-20" &&
        event.state !== "started",
    );
    // The peer turn keeps running on the agent's side: Paseo stopped watching, it did not fail.
    expect(terminal).toMatchObject({
      state: "canceled",
      error: { message: "Session closed by Paseo" },
    });
  });

  it("follows session/list cursors up to the requested limit", async () => {
    const pages: Record<string, unknown> = {
      "": {
        sessions: [
          { sessionId: "s1", cwd: "/repo", title: "One" },
          { sessionId: "s2", cwd: "/repo", title: "Two" },
        ],
        nextCursor: "page-2",
      },
      "page-2": {
        sessions: [
          { sessionId: "s3", cwd: "/repo", title: "Three" },
          { sessionId: "s4", cwd: "/repo", title: "Four" },
        ],
        nextCursor: "page-3",
      },
      "page-3": { sessions: [{ sessionId: "s5", cwd: "/repo", title: "Five" }] },
    };
    const cursors: Array<string | null | undefined> = [];
    const harness = connectorHarness({
      capabilities: { sessionCapabilities: { list: true } },
      handleRequest(instance, request) {
        if (request.method !== "session/list") return false;
        const cursor = (request.params as { cursor?: string | null } | undefined)?.cursor;
        cursors.push(cursor);
        instance.respond(request, pages[cursor ?? ""] ?? { sessions: [] });
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "list-acp",
      label: "List ACP",
      connector: harness.connector,
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["session.list"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send({ type: "sessions", requestId: "list-1", cwd: "/repo", limit: 3 });
      const listed = await waitForEvent(events, (event) => event.type === "sessions");
      expect(
        listed.type === "sessions" ? listed.sessions.map((session) => session.title) : [],
      ).toEqual(["One", "Two", "Three"]);
      // The requested limit was reached on the second page, so the third is never fetched.
      expect(cursors).toEqual([undefined, "page-2"]);
    } finally {
      await connection.close();
    }
  });

  it("does not end a cancelled vendor turn locally unless the provider reports peer turns", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-21", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-21" &&
          event.state === "started",
      );
      await connection.send({
        type: "session.interrupt",
        requestId: "stop-4",
        sessionId: "session-1",
      });

      // Past the grace period the turn is still open: for this agent a cancel may not stop the
      // peer turn, so Paseo must not pretend it did.
      await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
      expect(
        events.filter(
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp-vendor:peer-21" &&
            event.state !== "started",
        ),
      ).toEqual([]);

      agent().notify("vendor/turn", { turnId: "peer-21", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-21" &&
          event.state === "completed",
      );
    } finally {
      await connection.close();
    }
  });

  it("cancels every prompt waiting behind a vendor turn when the user stops", async () => {
    const { connection, events, agent } = await connectVendorTurns();
    try {
      agent().notify("vendor/turn", { turnId: "peer-22", state: "started" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-22" &&
          event.state === "started",
      );

      await connection.send(promptInput("queued-1"));
      await connection.send(promptInput("queued-2"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);

      await connection.send({
        type: "session.interrupt",
        requestId: "stop-5",
        sessionId: "session-1",
      });
      // Both prompts were admitted before the stop, so both are dropped, not only the parked one,
      // and each reports the cancelled shape an interrupted prompt uses.
      for (const clientMessageId of ["queued-1", "queued-2"]) {
        const result = await waitForEvent(
          events,
          (event) =>
            event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
        );
        expect(result.type === "session.prompt_result" ? result.result : null).toEqual({
          type: "turn",
          turnId: `acp:${clientMessageId}`,
        });
        expect(
          events.filter(
            (event) => event.type === "session.turn" && event.turnId === `acp:${clientMessageId}`,
          ),
        ).toEqual([
          expect.objectContaining({ state: "started" }),
          expect.objectContaining({ state: "canceled" }),
        ]);
      }

      agent().notify("vendor/turn", { turnId: "peer-22", state: "completed" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp-vendor:peer-22" &&
          event.state === "completed",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(countRequests(agent(), "session/prompt")).toBe(0);
    } finally {
      await connection.close();
    }
  });

  it.each(["steer first", "origin first"])(
    "settles one shared execution when the %s response arrives",
    async (order) => {
      const held: Array<Extract<AcpRequestMessage, { method: "session/prompt" }>> = [];
      let agent: ConnectorInstance | undefined;
      const { connector } = connectorHarness({
        handleRequest(instance, request) {
          if (request.method !== "session/prompt") return false;
          agent = instance;
          held.push(request as Extract<AcpRequestMessage, { method: "session/prompt" }>);
          return true;
        },
      });
      const registration = runAcpProvider({
        id: "correlated-acp",
        label: "Correlated ACP",
        connector,
        acpOptions: { vendorTurnsAreNeverForeground: true },
        transformers: [
          {
            initialize: () => ({ turnCorrelation: true, steering: true }),
            attach: () => ({ steering: true }),
            notification({ method, params }) {
              if (method !== "_jcode/turn") return null;
              const turn = params as { turnId: string; state: string };
              return { type: "turn", turnId: turn.turnId, state: turn.state };
            },
          },
        ],
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message", "prompt.steer", "session.shared_turns"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      try {
        await connection.send(openInput());
        await waitForEvent(events, (event) => event.type === "session.ready");
        await connection.send(promptInput("origin"));
        await expect.poll(() => held.length).toBe(1);
        const origin = held[0]!;
        if (!agent) throw new Error("prompt connector was not captured");
        agent.notify("_jcode/turn", {
          sessionId: "connector-session",
          turnId: "shared-1",
          state: "started",
        });

        await connection.send({
          ...promptInput("steer"),
          prompt: { ...promptInput("steer").prompt, delivery: "steer" },
        });
        await expect.poll(() => held.length).toBe(2);
        const steer = held[1]!;
        const respond = (
          request: Extract<AcpRequestMessage, { method: "session/prompt" }>,
          role: "origin" | "steer",
        ) =>
          agent!.respond(request, {
            stopReason: "end_turn",
            ...(role === "origin"
              ? { usage: { inputTokens: 10, outputTokens: 4, cachedReadTokens: 3 } }
              : {}),
            _meta: { jcode: { turnId: "shared-1", role } },
          });

        if (order === "steer first") {
          respond(steer, "steer");
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          expect(
            events.filter(
              (event) =>
                event.type === "session.turn" &&
                event.state !== "started" &&
                event.turnId === "acp:origin",
            ),
          ).toEqual([]);
          respond(origin, "origin");
        } else {
          respond(origin, "origin");
          respond(steer, "steer");
        }

        for (const clientMessageId of ["origin", "steer"]) {
          await waitForEvent(
            events,
            (event) =>
              event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
          );
        }
        await expect.poll(() => countTerminatedTurns(events, "acp:origin")).toBe(1);
        expect(
          events.filter(
            (event) =>
              event.type === "session.turn" &&
              event.state !== "started" &&
              event.turnId === "acp:steer",
          ),
        ).toEqual([]);
        expect(events.filter((event) => event.type === "session.usage")).toEqual([
          expect.objectContaining({
            turnId: "acp:origin",
            usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 3 },
          }),
        ]);
        // Every published start has exactly one terminal, including no abandoned vendor alias.
        expect(turnLifecycle(events)).toEqual({
          started: ["acp:origin"],
          ended: ["acp:origin"],
        });

        // A late duplicate terminal for the settled shared id must not reopen or re-end it.
        agent.notify("_jcode/turn", {
          sessionId: "connector-session",
          turnId: "shared-1",
          state: "completed",
        });
        // No stranded foreground ownership: the next prompt reaches the connector.
        await connection.send(promptInput("after"));
        await expect.poll(() => held.length).toBe(3);
        agent.respond(held[2]!, { stopReason: "end_turn" });
        await waitForEvent(
          events,
          (event) =>
            event.type === "session.turn" &&
            event.turnId === "acp:after" &&
            event.state === "completed",
        );
        expect(turnLifecycle(events)).toEqual({
          started: ["acp:after", "acp:origin"],
          ended: ["acp:after", "acp:origin"],
        });
      } finally {
        await connection.close();
      }
    },
  );

  it.each(["terminal first", "response first"])(
    "keeps one shared lifecycle when a foreground prompt is steered into a peer turn (%s)",
    async (order) => {
      const held: Array<Extract<AcpRequestMessage, { method: "session/prompt" }>> = [];
      let agent: ConnectorInstance | undefined;
      const { connector } = connectorHarness({
        handleRequest(instance, request) {
          if (request.method !== "session/prompt") return false;
          agent = instance;
          held.push(request as Extract<AcpRequestMessage, { method: "session/prompt" }>);
          return true;
        },
      });
      const registration = runAcpProvider({
        id: "steered-acp",
        label: "Steered ACP",
        connector,
        acpOptions: { vendorTurnsAreNeverForeground: true },
        transformers: [
          {
            initialize: () => ({ turnCorrelation: true }),
            notification({ method, params }) {
              if (method !== "_jcode/turn") return null;
              const turn = params as { turnId: string; state: string };
              return { type: "turn", turnId: turn.turnId, state: turn.state };
            },
          },
        ],
      });
      const connection = await registration.connect({
        versions: [1],
        capabilities: ["prompt.message", "session.shared_turns"],
      });
      const events: ProviderEvent[] = [];
      connection.onEvent((event) => events.push(event));
      try {
        await connection.send(openInput());
        await waitForEvent(events, (event) => event.type === "session.ready");
        await connection.send(promptInput("overlap"));
        await expect.poll(() => held.length).toBe(1);
        if (!agent) throw new Error("prompt connector was not captured");

        // The agent reports the turn bracket after the foreground prompt already started.
        agent.notify("_jcode/turn", {
          sessionId: "connector-session",
          turnId: "shared-overlap",
          state: "started",
        });
        const respond = () =>
          agent!.respond(held[0]!, {
            stopReason: "end_turn",
            usage: { inputTokens: 9, outputTokens: 3 },
            _meta: { jcode: { turnId: "shared-overlap", role: "steer" } },
          });

        if (order === "terminal first") {
          agent.notify("_jcode/turn", {
            sessionId: "connector-session",
            turnId: "shared-overlap",
            state: "completed",
          });
          await waitForEvent(
            events,
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:overlap" &&
              event.state === "completed",
          );
          respond();
        } else {
          respond();
          await waitForEvent(
            events,
            (event) =>
              event.type === "session.turn" &&
              event.turnId === "acp:overlap" &&
              event.state === "completed",
          );
          // A terminal after the response must not publish another completion.
          agent.notify("_jcode/turn", {
            sessionId: "connector-session",
            turnId: "shared-overlap",
            state: "completed",
          });
        }
        await waitForEvent(
          events,
          (event) => event.type === "session.prompt_result" && event.clientMessageId === "overlap",
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(turnLifecycle(events)).toEqual({
          started: ["acp:overlap"],
          ended: ["acp:overlap"],
        });
        expect(events.filter((event) => event.type === "session.usage")).toEqual([]);
        await connection.send(promptInput("next"));
        await expect.poll(() => held.length).toBe(2);
      } finally {
        await connection.close();
      }
    },
  );

  it("settles the rollover turn when a pending steer becomes its origin", async () => {
    const held: Array<Extract<AcpRequestMessage, { method: "session/prompt" }>> = [];
    let agent: ConnectorInstance | undefined;
    const { connector } = connectorHarness({
      handleRequest(instance, request) {
        if (request.method !== "session/prompt") return false;
        agent = instance;
        held.push(request as Extract<AcpRequestMessage, { method: "session/prompt" }>);
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "rollover-acp",
      label: "Rollover ACP",
      connector,
      transformers: [
        {
          initialize: () => ({ turnCorrelation: true, steering: true }),
          attach: () => ({ steering: true }),
        },
      ],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "prompt.steer"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send(openInput());
      await waitForEvent(events, (event) => event.type === "session.ready");
      await connection.send(promptInput("origin"));
      await expect.poll(() => held.length).toBe(1);
      await connection.send({
        ...promptInput("rollover"),
        prompt: { ...promptInput("rollover").prompt, delivery: "steer" },
      });
      await expect.poll(() => held.length).toBe(2);
      if (!agent) throw new Error("prompt connector was not captured");

      agent.respond(held[0]!, {
        stopReason: "end_turn",
        _meta: { jcode: { turnId: "origin-execution", role: "origin" } },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:origin" &&
          event.state === "completed",
      );
      // Output after the origin ends promotes the pending steer to a visible rollover turn.
      agent.notify("session/update", {
        sessionId: "connector-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "rollover output" },
        },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:rollover" &&
          event.state === "started",
      );

      agent.respond(held[1]!, {
        stopReason: "end_turn",
        usage: { inputTokens: 7, outputTokens: 2 },
        _meta: { jcode: { turnId: "rollover-execution", role: "origin" } },
      });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:rollover" &&
          event.state === "completed",
      );
      expect(events.filter((event) => event.type === "session.usage")).toEqual([
        expect.objectContaining({
          turnId: "acp:rollover",
          usage: { inputTokens: 7, outputTokens: 2 },
        }),
      ]);
      expect(turnLifecycle(events)).toEqual({
        started: ["acp:origin", "acp:rollover"],
        ended: ["acp:origin", "acp:rollover"],
      });
      await connection.send(promptInput("after"));
      await expect.poll(() => held.length).toBe(3);
      agent.respond(held[2]!, { stopReason: "end_turn" });
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:after" &&
          event.state === "completed",
      );
    } finally {
      await connection.close();
    }
  });

  it("sends skill metadata, a bare skill prompt, and an empty clear prompt", async () => {
    const promptBodies: Array<{ skill?: string | null; prompt: unknown }> = [];
    const { connector } = connectorHarness({
      handleRequest(instance, request) {
        if (request.method !== "session/prompt") return false;
        const params = request.params as {
          _meta?: { jcode?: { skill?: string | null } };
          prompt: unknown;
        };
        promptBodies.push({
          ...(params._meta?.jcode?.skill === undefined ? {} : { skill: params._meta.jcode.skill }),
          prompt: params.prompt,
        });
        instance.respond(request, {
          stopReason: "end_turn",
          _meta: { jcode: { turnId: null, role: "none" } },
        });
        return true;
      },
    });
    const registration = runAcpProvider({
      id: "skill-acp",
      label: "Skill ACP",
      connector,
      transformers: [
        {
          initialize: () => ({ turnCorrelation: true, skillSelection: true }),
          prompt: ({ skill }) => (skill === undefined ? null : { _meta: { jcode: { skill } } }),
        },
      ],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.command", "prompt.message"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send(openInput());
      await waitForEvent(events, (event) => event.type === "session.ready");
      const command = {
        type: "session.prompt" as const,
        sessionId: "session-1",
        prompt: {
          clientMessageId: "skill",
          delivery: "auto" as const,
          input: { type: "command" as const, name: "interrogate", arguments: "" },
          skill: "interrogate",
        },
      };
      await connection.send(command);
      await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "skill",
      );
      await connection.send({
        ...command,
        prompt: {
          ...command.prompt,
          clientMessageId: "clear",
          input: { type: "command" as const, name: "interrogate", arguments: "" },
          skill: null,
        },
      });
      await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "clear",
      );
      await connection.send({
        ...command,
        prompt: {
          clientMessageId: "plain",
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "hello" }] },
        },
      });
      await waitForEvent(
        events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "plain",
      );
    } finally {
      await connection.close();
    }
    expect(promptBodies).toEqual([
      { skill: "interrogate", prompt: [{ type: "text", text: "" }] },
      { skill: null, prompt: [] },
      { prompt: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("detaches explicitly without closing the agent session", async () => {
    const { connector, instances } = connectorHarness({});
    const registration = runAcpProvider({
      id: "detach-acp",
      label: "Detach ACP",
      connector,
      transformers: [{ attach: () => ({ detach: true }) }],
    });
    const connection = await registration.connect({
      versions: [1],
      capabilities: ["prompt.message", "session.detach"],
    });
    const events: ProviderEvent[] = [];
    connection.onEvent((event) => events.push(event));
    try {
      await connection.send(openInput());
      await waitForEvent(events, (event) => event.type === "session.ready");
      const opened = events.find((event) => event.type === "session.opened");
      expect(opened?.type === "session.opened" && opened.capabilities).toContain("session.detach");
      await connection.send({
        type: "session.detach",
        requestId: "detach-1",
        sessionId: "session-1",
      });
      await waitForEvent(
        events,
        (event) => event.type === "request.completed" && event.requestId === "detach-1",
      );
      expect(countRequestedMethod(instances, "_jcode/detach")).toBe(1);
      expect(countRequestedMethod(instances, "session/close")).toBe(0);
      // Repeated detach is idempotent and does not touch the provider again.
      await connection.send({
        type: "session.detach",
        requestId: "detach-2",
        sessionId: "session-1",
      });
      await waitForEvent(
        events,
        (event) => event.type === "request.completed" && event.requestId === "detach-2",
      );
    } finally {
      await connection.close();
    }
  });
});
