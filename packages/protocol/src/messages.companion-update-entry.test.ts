import { describe, expect, it } from "vitest";
import {
  AgentCompanionUpdateEntryRequestMessageSchema,
  AgentCompanionUpdateEntryResponseMessageSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const baseRequest = {
  type: "agent.companion.update_entry.request" as const,
  agentId: "agent-1",
  action: "add_pin" as const,
  text: "note",
  requestId: "req-1",
};

describe("agent.companion.update_entry wire contract", () => {
  it("parses the renamed request through the session inbound union", () => {
    const parsed = SessionInboundMessageSchema.parse(baseRequest);
    expect(parsed.type).toBe("agent.companion.update_entry.request");
  });

  it("parses status, remove_pin, and add_q_and_a variants", () => {
    expect(
      AgentCompanionUpdateEntryRequestMessageSchema.parse({
        type: "agent.companion.update_entry.request",
        agentId: "agent-1",
        entryId: "question:1",
        action: "update_status",
        status: "reviewed",
        requestId: "req-2",
      }).action,
    ).toBe("update_status");
    expect(
      AgentCompanionUpdateEntryRequestMessageSchema.parse({
        type: "agent.companion.update_entry.request",
        agentId: "agent-1",
        entryId: "pin:1",
        action: "remove_pin",
        requestId: "req-3",
      }).entryId,
    ).toBe("pin:1");
    expect(
      AgentCompanionUpdateEntryRequestMessageSchema.parse({
        type: "agent.companion.update_entry.request",
        agentId: "agent-1",
        action: "add_q_and_a",
        text: "q",
        answerText: "a",
        requestId: "req-4",
      }).answerText,
    ).toBe("a");
  });

  it("rejects the source fork's flat update_companion_entry_request", () => {
    // The source fork's operation name must stay distinct: a source-built client
    // that sees the fork's `companionStream` capability would send this shape.
    const result = SessionInboundMessageSchema.safeParse({
      type: "update_companion_entry_request",
      agentId: "agent-1",
      action: "add_pin",
      text: "note",
      requestId: "req-5",
    });
    expect(result.success).toBe(false);
  });

  it("parses the correlated success and failure responses", () => {
    const success = AgentCompanionUpdateEntryResponseMessageSchema.parse({
      type: "agent.companion.update_entry.response",
      payload: { requestId: "req-1", agentId: "agent-1", accepted: true, error: null },
    });
    expect(success.payload.accepted).toBe(true);
    const failure = SessionOutboundMessageSchema.parse({
      type: "agent.companion.update_entry.response",
      payload: { requestId: "req-1", agentId: "agent-1", accepted: false, error: "not found" },
    });
    expect(failure.type).toBe("agent.companion.update_entry.response");
  });

  it("advertises companionStreamPortV1 and not the source fork's feature names", () => {
    const info = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "server-1",
      version: "0.11.0-beta.3-fork",
      features: { companionStreamPortV1: true },
    });
    expect(info.features?.companionStreamPortV1).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.safeParse({ features: { companionStream: true } }).success,
    ).toBe(false);
    expect(
      ServerInfoStatusPayloadSchema.safeParse({ features: { artifactFeed: true } }).success,
    ).toBe(false);
  });
});
