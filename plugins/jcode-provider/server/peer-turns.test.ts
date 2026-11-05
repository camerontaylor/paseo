import { describe, expect, it } from "vitest";
import { runAcpProvider, type AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import type { ProviderEvent, ProviderInput } from "@getpaseo/plugin/server/provider";
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

  it("returns null for malformed params", () => {
    const malformed = [
      null,
      "started",
      { state: "started" },
      { turnId: "", state: "started" },
      { turnId: "peer-1" },
      { turnId: "peer-1", state: "finished" },
      { turnId: "peer-1", state: "started", error: "boom" },
    ];
    for (const params of malformed) {
      expect(
        jcodePeerTurns.notification?.({ method: "_jcode/turn", params }, context),
        JSON.stringify(params),
      ).toBeNull();
    }
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
// the order a real `jcode acp` would send them.
interface ScriptedAgent {
  notify(method: string, params: unknown): void;
}

function scriptedConnector() {
  const agents: ScriptedAgent[] = [];
  const connector = () => {
    let sink!: ReadableStreamDefaultController<AcpStreamMessage>;
    const agent: ScriptedAgent = {
      notify: (method, params) => sink.enqueue({ jsonrpc: "2.0", method, params }),
    };
    agents.push(agent);
    const readable = new ReadableStream<AcpStreamMessage>({
      start(controller) {
        sink = controller;
      },
    });
    const writable = new WritableStream<AcpStreamMessage>({
      write(message) {
        if (!("method" in message) || !("id" in message)) return;
        const reply = (result: unknown) => sink.enqueue({ jsonrpc: "2.0", id: message.id, result });
        if (message.method === "initialize") {
          const params = message.params as { protocolVersion: number };
          reply({ protocolVersion: params.protocolVersion, agentCapabilities: {} });
        } else if (message.method === "session/new") {
          reply({ sessionId: "jcode-native-session", modes: null, configOptions: [] });
        } else if (message.method === "session/close") {
          reply({});
        }
      },
    });
    return { readable, writable };
  };
  return { connector, agents };
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

async function waitForEvent(
  events: ProviderEvent[],
  predicate: (event: ProviderEvent) => boolean,
): Promise<ProviderEvent> {
  await expect.poll(() => events.find(predicate), { timeout: 5_000 }).toBeTruthy();
  return events.find(predicate)!;
}

type TerminalState = "completed" | "failed" | "canceled";

// Runs one peer turn through the real ACP connection: the transformer sees the lifecycle, and the
// shim publishes the turn events around the timeline items the peer's chunks produced.
async function runPeerTurn(terminal: {
  state: TerminalState;
  error?: { message: string };
}): Promise<{ sequence: string[]; ended: ProviderEvent }> {
  const scripted = scriptedConnector();
  const registration = runAcpProvider({
    id: "jcode",
    label: "Jcode",
    connector: scripted.connector,
    transformers: [jcodePeerTurns],
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
    // The catalog probe opens the first connection; the session lives on the last one.
    const agent = scripted.agents.at(-1);
    if (!agent) throw new Error("ACP connector did not start");

    agent.notify("_jcode/turn", peerTurn({ state: "started" }).params);
    agent.notify("session/update", {
      sessionId: "jcode-native-session",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "started in the TUI" },
      },
    });
    agent.notify("session/update", {
      sessionId: "jcode-native-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "peer output" },
        messageId: "m-peer",
      },
    });
    const terminalParams = peerTurn(terminal).params;
    agent.notify("_jcode/turn", terminalParams);

    const ended = await waitForEvent(
      events,
      (event) =>
        event.type === "session.turn" &&
        event.turnId === "acp-vendor:peer-1" &&
        event.state === terminal.state,
    );
    const sequence = events.flatMap((event) => {
      if (event.type === "session.turn" && event.turnId === "acp-vendor:peer-1") {
        return [`turn:${event.state}`];
      }
      if (event.type !== "timeline.item") return [];
      if (event.item.type === "user_message") return [`user:${event.item.text}`];
      if (event.item.type === "assistant_message") return [`item:${event.item.text}`];
      return [];
    });
    return { sequence, ended };
  } finally {
    await connection.close();
  }
}

describe("jcodePeerTurns through an ACP connection", () => {
  it("completes a peer turn after its timeline items", async () => {
    const { sequence, ended } = await runPeerTurn({ state: "completed" });

    expect(sequence).toEqual([
      "turn:started",
      "user:started in the TUI",
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
      "user:started in the TUI",
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

  it("cancels a peer turn", async () => {
    const { sequence, ended } = await runPeerTurn({ state: "canceled" });

    expect(sequence).toEqual([
      "turn:started",
      "user:started in the TUI",
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
});
