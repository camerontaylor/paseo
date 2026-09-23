import { describe, expect, it } from "vitest";

import { CLIENT_CAPS } from "../src/client-capabilities.js";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "../src/messages.js";

describe("side conversation protocol", () => {
  it("round-trips the ask and timeline RPC pairs", () => {
    const askRequest = SessionInboundMessageSchema.parse({
      type: "agent.side_conversation.ask.request",
      parentAgentId: "agent-1",
      threadId: "thread-1",
      question: "What should I check?",
      requestId: "ask-1",
    });
    expect(askRequest.type).toBe("agent.side_conversation.ask.request");

    const askResponse = SessionOutboundMessageSchema.parse({
      type: "agent.side_conversation.ask.response",
      payload: {
        requestId: "ask-1",
        parentAgentId: "agent-1",
        threadId: "thread-1",
        answer: {
          status: "answered",
          content: "Check the protocol boundary.",
          synthetic: false,
          threading: "threaded",
        },
        error: null,
      },
    });
    expect(askResponse.type).toBe("agent.side_conversation.ask.response");

    const timelineRequest = SessionInboundMessageSchema.parse({
      type: "agent.side_conversation.timeline.get.request",
      parentAgentId: "agent-1",
      threadId: "thread-1",
      requestId: "timeline-1",
    });
    expect(timelineRequest.type).toBe("agent.side_conversation.timeline.get.request");

    const timelineResponse = SessionOutboundMessageSchema.parse({
      type: "agent.side_conversation.timeline.get.response",
      payload: {
        requestId: "timeline-1",
        parentAgentId: "agent-1",
        threadId: "thread-1",
        items: [{ type: "user_message", text: "What should I check?" }],
        pendingQuestion: null,
        lastAnswer: { status: "unavailable" },
        error: null,
      },
    });
    expect(timelineResponse.type).toBe("agent.side_conversation.timeline.get.response");
  });

  it("keeps capability negotiation optional on both sides", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "server-1" }).features,
    ).toBeUndefined();
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-1",
        features: { sideConversations: true },
      }).features?.sideConversations,
    ).toBe(true);
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "browser",
        protocolVersion: 1,
        capabilities: { [CLIENT_CAPS.sideConversations]: true },
      }).capabilities?.[CLIENT_CAPS.sideConversations],
    ).toBe(true);
  });
});
