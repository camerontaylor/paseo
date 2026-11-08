import { describe, expect, it } from "vitest";
import { runAcpProvider, type AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
import { jcodeCapabilities } from "./capabilities.js";
import { jcodePeerTurns } from "./peer-turns.js";

const context = { sessionId: "session-1" };

function peerTurn(params: Record<string, unknown>) {
  return {
    method: "_jcode/turn",
    params: { sessionId: "jcode-native-session", turnId: "peer-1", ...params },
  };
}

describe("jcodePeerTurns", () => {
  it.each([
    ["started", { type: "turn", turnId: "peer-1", state: "started" }],
    ["completed", { type: "turn", turnId: "peer-1", state: "completed" }],
    ["failed", { type: "turn", turnId: "peer-1", state: "failed" }],
    ["canceled", { type: "turn", turnId: "peer-1", state: "canceled" }],
  ] as const)("maps %s to a turn update", (state, expected) => {
    expect(jcodePeerTurns.notification?.(peerTurn({ state }), context)).toEqual(expected);
  });

  it("ignores every other notification method", () => {
    expect(
      jcodePeerTurns.notification?.(
        { method: "session/update", params: { sessionId: "jcode-native-session" } },
        context,
      ),
    ).toBeNull();
    expect(
      jcodePeerTurns.notification?.(
        { method: "_jcode/server_event", params: { state: "started", turnId: "peer-1" } },
        context,
      ),
    ).toBeNull();
  });

  it("returns null when a field that identifies the transition is malformed", () => {
    // Each case starts from a valid payload and breaks one field, so it is rejected for that field.
    const valid = peerTurn({ state: "started" }).params;
    const { sessionId: _sessionId, ...withoutSessionId } = valid;
    const { turnId: _turnId, ...withoutTurnId } = valid;
    const { state: _state, ...withoutState } = valid;
    const malformed: unknown[] = [
      null,
      "started",
      withoutSessionId,
      { ...valid, sessionId: 7 },
      withoutTurnId,
      { ...valid, turnId: "" },
      withoutState,
      { ...valid, state: "finished" },
    ];
    expect(jcodePeerTurns.notification?.(peerTurn({ state: "started" }), context)).not.toBeNull();
    for (const params of malformed) {
      expect(
        jcodePeerTurns.notification?.({ method: "_jcode/turn", params }, context),
        JSON.stringify(params),
      ).toBeNull();
    }
  });

  it.each([
    ["a string", "boom"],
    ["null", null],
    ["an object without a message", { code: 3 }],
  ])("keeps a terminal whose error is %s and leaves the error off", (_label, error) => {
    expect(jcodePeerTurns.notification?.(peerTurn({ state: "failed", error }), context)).toEqual({
      type: "turn",
      turnId: "peer-1",
      state: "failed",
    });
  });

  it.each([
    ["a string", "tui"],
    ["a number", 42],
    ["null", null],
    ["an array", ["tui"]],
    ["an object without a kind", { clientInstanceId: "client-2" }],
    ["an object with a non-string kind", { kind: 1 }],
  ])("keeps a turn whose origin is %s", (_label, origin) => {
    // `origin` is not parsed, so no shape of it can reject the notification. A dropped terminal
    // would leave the vendor turn open and park every later Paseo prompt behind it.
    expect(jcodePeerTurns.notification?.(peerTurn({ state: "started", origin }), context)).toEqual({
      type: "turn",
      turnId: "peer-1",
      state: "started",
    });
    expect(
      jcodePeerTurns.notification?.(peerTurn({ state: "completed", origin }), context),
    ).toEqual({ type: "turn", turnId: "peer-1", state: "completed" });
  });

  it("passes the agent's error through on a terminal state", () => {
    expect(
      jcodePeerTurns.notification?.(
        peerTurn({ state: "failed", error: { message: "tool crashed" } }),
        context,
      ),
    ).toEqual({
      type: "turn",
      turnId: "peer-1",
      state: "failed",
      error: { message: "tool crashed" },
    });
  });
});

// A scripted ACP agent: it answers the client's requests and lets the test push notifications in
// the order a real `jcode acp` would send them. Like jcode, it sends no `messageId` on its chunks.
interface ScriptedAgent {
  readonly requests: string[];
  readonly configurations: Array<{ configId: string; value: string }>;
  notify(method: string, params: unknown): void;
}

const jcodeConfigOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "model-a",
    options: [
      { value: "model-a", name: "Model A" },
      { value: "model-b", name: "Model B" },
    ],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning effort",
    category: "thought_level",
    type: "select",
    currentValue: "medium",
    options: [
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

function scriptedConnector(configOptions = [] as typeof jcodeConfigOptions) {
  const agents: ScriptedAgent[] = [];
  const connector = () => {
    let sink!: ReadableStreamDefaultController<AcpStreamMessage>;
    const agent: ScriptedAgent = {
      requests: [],
      configurations: [],
      notify: (method, params) => sink.enqueue({ jsonrpc: "2.0", method, params }),
    };
    agents.push(agent);
    const readable = new ReadableStream<AcpStreamMessage>({
      start(controller) {
        sink = controller;
      },
    });
    const notify = (method: string, params: unknown) =>
      sink.enqueue({ jsonrpc: "2.0", method, params });
    const writable = new WritableStream<AcpStreamMessage>({
      write(message) {
        if (!("method" in message)) return;
        agent.requests.push(message.method);
        if (!("id" in message)) return;
        const reply = (result: unknown) => sink.enqueue({ jsonrpc: "2.0", id: message.id, result });
        if (message.method === "initialize") {
          const params = message.params as { protocolVersion: number };
          reply({ protocolVersion: params.protocolVersion, agentCapabilities: {} });
        } else if (message.method === "session/new") {
          reply({ sessionId: "jcode-native-session", modes: null, configOptions });
        } else if (message.method === "session/set_config_option") {
          const params = message.params as { configId: string; value: string };
          agent.configurations.push({ configId: params.configId, value: params.value });
          reply({
            configOptions: configOptions.map((option) => ({
              ...option,
              currentValue: option.id === params.configId ? params.value : option.currentValue,
            })),
          });
        } else if (message.method === "session/prompt") {
          notify("session/update", sessionUpdate("agent_message_chunk", "paseo output"));
          reply({ stopReason: "end_turn" });
        } else if (message.method === "session/close") {
          reply({});
        }
      },
    });
    return { readable, writable };
  };
  return { connector, agents };
}

function sessionUpdate(kind: string, text: string) {
  return {
    sessionId: "jcode-native-session",
    update: { sessionUpdate: kind, content: { type: "text", text } },
  };
}

function openInput(): Extract<ProviderInput, { type: "session.open" }> {
  return {
    type: "session.open",
    requestId: "open-1",
    sessionId: "session-1",
    config: { cwd: "/repo", env: {}, mcpServers: {}, settings: {}, persist: true },
    history: "skip",
  };
}

function promptInput(clientMessageId: string): Extract<ProviderInput, { type: "session.prompt" }> {
  return {
    type: "session.prompt",
    sessionId: "session-1",
    prompt: {
      clientMessageId,
      delivery: "auto",
      input: { type: "message", content: [{ type: "text", text: "paseo ask" }] },
    },
  };
}

async function waitForEvent(
  events: ProviderEvent[],
  predicate: (event: ProviderEvent) => boolean,
): Promise<ProviderEvent> {
  await expect.poll(() => events.find(predicate), { timeout: 5_000 }).toBeTruthy();
  return events.find(predicate)!;
}

// The timeline as text, in publish order. Turn events are left out except for the peer turn, so a
// test can state where a turn starts and ends relative to the items.
function timeline(events: readonly ProviderEvent[], peerTurnId = "acp-vendor:peer-1"): string[] {
  return events.flatMap((event) => {
    if (event.type === "session.turn" && event.turnId === peerTurnId) {
      return [`turn:${event.state}`];
    }
    if (event.type !== "timeline.item") return [];
    if (event.item.type === "user_message") return [`user:${event.item.text}`];
    if (event.item.type === "assistant_message") return [`item:${event.item.text}`];
    return [];
  });
}

async function connect(
  acpOptions?: { vendorTurnsAreNeverForeground?: boolean },
  configOptions?: typeof jcodeConfigOptions,
) {
  const scripted = scriptedConnector(configOptions);
  const registration = runAcpProvider({
    id: "jcode",
    label: "Jcode",
    connector: scripted.connector,
    acpOptions,
    transformers: [jcodePeerTurns, jcodeCapabilities],
  });
  const connection = await registration.connect({
    versions: [1],
    capabilities: ["prompt.message", "session.configure", "session.shared_turns"],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  await connection.send(openInput());
  await waitForEvent(events, (event) => event.type === "session.ready");
  // The capability probe opens the first connection; the session lives on the last one.
  const agent = scripted.agents.at(-1);
  if (!agent) throw new Error("ACP connector did not start");
  return { connection, events, agent };
}

type TerminalState = "completed" | "failed" | "canceled";

// One peer turn in jcode's wire order: `started`, the peer's user message chunk with no
// `messageId`, the peer's agent chunks, then the terminal.
async function runPeerTurn(terminal: {
  state: TerminalState;
  error?: unknown;
}): Promise<{ sequence: string[]; ended: ProviderEvent }> {
  const { connection, events, agent } = await connect();
  try {
    agent.notify("_jcode/turn", peerTurn({ state: "started" }).params);
    agent.notify("session/update", sessionUpdate("user_message_chunk", "ask from the TUI"));
    agent.notify("session/update", sessionUpdate("agent_message_chunk", "peer output"));
    agent.notify("_jcode/turn", peerTurn(terminal).params);

    const ended = await waitForEvent(
      events,
      (event) =>
        event.type === "session.turn" &&
        event.turnId === "acp-vendor:peer-1" &&
        event.state === terminal.state,
    );

    const items = events.flatMap((event) => (event.type === "timeline.item" ? [event.item] : []));
    // The peer's message arrives once, as a live user chunk, and is not duplicated.
    expect(items.filter((item) => item.type === "user_message")).toHaveLength(1);
    expect(items.findIndex((item) => item.type === "user_message")).toBeLessThan(
      items.findIndex((item) => item.type === "assistant_message"),
    );
    return { sequence: timeline(events), ended };
  } finally {
    await connection.close();
  }
}

describe("jcodePeerTurns through an ACP connection", () => {
  it("maps jcode model and effort categories without interface metadata", async () => {
    const { connection, events, agent } = await connect(undefined, jcodeConfigOptions);
    try {
      expect(await waitForEvent(events, (event) => event.type === "session.config")).toMatchObject({
        config: {
          model: "model-a",
          thinkingOption: "medium",
          models: [
            { id: "model-a", label: "Model A" },
            { id: "model-b", label: "Model B" },
          ],
          thinkingOptions: [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
          settings: [],
        },
      });

      await connection.send({
        type: "session.configure",
        requestId: "configure-model",
        sessionId: "session-1",
        changes: { model: "model-b" },
      });
      await connection.send({
        type: "session.configure",
        requestId: "configure-effort",
        sessionId: "session-1",
        changes: { thinkingOption: "high" },
      });
      await expect
        .poll(() => agent.configurations)
        .toEqual([
          { configId: "model", value: "model-b" },
          { configId: "reasoning_effort", value: "high" },
        ]);
    } finally {
      await connection.close();
    }
  });

  it("keeps shared peer-turn behavior enabled without interface metadata", async () => {
    const { connection, events, agent } = await connect({ vendorTurnsAreNeverForeground: true });
    try {
      expect(connection.capabilities).toContain("session.shared_turns");
      expect(connection.capabilities).not.toContain("prompt.steer");
      agent.notify("_jcode/turn", peerTurn({ state: "started" }).params);
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "started",
      );
      agent.notify("_jcode/turn", peerTurn({ state: "completed" }).params);
      await waitForEvent(
        events,
        (event) => event.type === "session.turn" && event.state === "completed",
      );
      expect(agent.requests).not.toContain("session/cancel");
    } finally {
      await connection.close();
    }
  });

  it("completes a peer turn after its timeline items", async () => {
    const { sequence, ended } = await runPeerTurn({ state: "completed" });

    expect(sequence).toEqual([
      "turn:started",
      "user:ask from the TUI",
      "item:peer output",
      "turn:completed",
    ]);
    expect(ended).toMatchObject({
      type: "session.turn",
      turnId: "acp-vendor:peer-1",
      state: "completed",
    });
    expect(ended).not.toHaveProperty("error");
  });

  it("fails a peer turn with the agent's error", async () => {
    const { sequence, ended } = await runPeerTurn({
      state: "failed",
      error: { message: "tool crashed" },
    });

    expect(sequence).toEqual([
      "turn:started",
      "user:ask from the TUI",
      "item:peer output",
      "turn:failed",
    ]);
    expect(ended).toMatchObject({
      type: "session.turn",
      turnId: "acp-vendor:peer-1",
      state: "failed",
      error: { message: "tool crashed" },
    });
  });

  it("closes a failed peer turn whose error is malformed", async () => {
    const { sequence, ended } = await runPeerTurn({ state: "failed", error: "tool crashed" });

    expect(sequence).toEqual([
      "turn:started",
      "user:ask from the TUI",
      "item:peer output",
      "turn:failed",
    ]);
    expect(ended).not.toHaveProperty("error");
  });

  it("cancels a peer turn", async () => {
    const { sequence, ended } = await runPeerTurn({ state: "canceled" });

    expect(sequence).toEqual([
      "turn:started",
      "user:ask from the TUI",
      "item:peer output",
      "turn:canceled",
    ]);
    expect(ended).toMatchObject({
      type: "session.turn",
      turnId: "acp-vendor:peer-1",
      state: "canceled",
    });
    expect(ended).not.toHaveProperty("error");
  });

  it("keeps a peer turn's output out of a Paseo prompt sent while it runs", async () => {
    const { connection, events, agent } = await connect({ vendorTurnsAreNeverForeground: true });
    try {
      agent.notify("_jcode/turn", peerTurn({ state: "started" }).params);
      agent.notify("session/update", sessionUpdate("user_message_chunk", "ask from the TUI"));
      agent.notify("session/update", sessionUpdate("agent_message_chunk", "peer output"));
      await waitForEvent(
        events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "peer output",
      );

      const promptSent = connection.send(promptInput("paseo-1"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The prompt waits behind the peer turn instead of reaching jcode now.
      expect(agent.requests).not.toContain("session/prompt");

      agent.notify("_jcode/turn", peerTurn({ state: "completed" }).params);
      await promptSent;
      await waitForEvent(
        events,
        (event) =>
          event.type === "session.turn" &&
          event.turnId === "acp:paseo-1" &&
          event.state === "completed",
      );

      const items = timeline(events).filter((entry) => !entry.startsWith("turn:"));
      expect(items).toEqual([
        "user:ask from the TUI",
        "item:peer output",
        "user:paseo ask",
        "item:paseo output",
      ]);
    } finally {
      await connection.close();
    }
  });
});
