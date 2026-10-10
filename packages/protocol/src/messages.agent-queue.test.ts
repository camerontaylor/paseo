import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CLIENT_CAPS } from "./client-capabilities";
import {
  AgentQueueEnqueueRequestSchema,
  AgentQueueMutationRequestSchema,
  AgentQueueUpdateMessageSchema,
  SendAgentMessageRequestSchema,
  SendAgentMessageResponseMessageSchema,
  ServerInfoStatusPayloadSchema,
  SessionEventSubscriptionSchema,
  SessionEventsSetSubscriptionRequestSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

/**
 * A released daemon's view of the send request. It knows nothing about queue
 * intent, which is exactly the mixed-version case the legacy contract protects.
 */
const ReleasedSendRequestSchema = z.object({
  type: z.literal("send_agent_message_request"),
  requestId: z.string(),
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().optional(),
});

/**
 * A released client's view of the send response. It knows nothing about the
 * queued flag: a new daemon's response must still parse for it.
 */
const ReleasedSendResponseSchema = z.object({
  type: z.literal("send_agent_message_response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    accepted: z.boolean(),
    error: z.string().nullable(),
  }),
});

describe("durable agent queue wire contract", () => {
  it("requires an explicit delivery intent on admission", () => {
    const admitted = AgentQueueEnqueueRequestSchema.parse({
      type: "agent.queue.enqueue.request",
      requestId: "req-1",
      agentId: "agent-1",
      itemId: "item-1",
      text: "follow-up",
      intent: "steer_strict",
    });
    expect(admitted.intent).toBe("steer_strict");

    // Omitting the intent is a parse failure, not a silent "queue" default:
    // admission is never inferred from a message the daemon did not classify.
    expect(() =>
      AgentQueueEnqueueRequestSchema.parse({
        type: "agent.queue.enqueue.request",
        requestId: "req-2",
        agentId: "agent-1",
        itemId: "item-2",
        text: "follow-up",
      }),
    ).toThrow();
  });

  it("registers every queue RPC on the session unions", () => {
    for (const type of [
      "agent.queue.enqueue.request",
      "agent.queue.update.request",
      "agent.queue.reorder.request",
      "agent.queue.delete.request",
      "agent.queue.retry.request",
      "agent.queue.send_now.request",
      "agent.queue.list.request",
      "agent.queue.get_item_images.request",
    ]) {
      expect(
        SessionInboundMessageSchema.options.map((option) => option.shape.type.value),
      ).toContain(type);
    }
    for (const type of [
      "agent.queue.enqueue.response",
      "agent.queue.update.response",
      "agent.queue.reorder.response",
      "agent.queue.delete.response",
      "agent.queue.retry.response",
      "agent.queue.send_now.response",
      "agent.queue.list.response",
      "agent.queue.get_item_images.response",
      "agent.queue.update",
    ]) {
      expect(
        SessionOutboundMessageSchema.options.map((option) => option.shape.type.value),
      ).toContain(type);
    }
  });

  it("lets a queue-aware client subscribe to the queue broadcast", () => {
    // A client cannot mirror the queue without subscribing to it, and the
    // daemon only delivers the event to durableAgentQueue-capable clients.
    expect(SessionEventSubscriptionSchema.options).toContain("agent.queue.update");
    expect(() =>
      SessionEventsSetSubscriptionRequestSchema.parse({
        type: "session.events.set_subscription.request",
        requestId: "req-1",
        events: ["agent.queue.update"],
      }),
    ).not.toThrow();
  });

  it("never sends image bytes in a queue snapshot", () => {
    const broadcast = AgentQueueUpdateMessageSchema.parse({
      type: "agent.queue.update",
      payload: {
        agentId: "agent-1",
        revision: 3,
        items: [
          {
            id: "item-1",
            text: "look at this",
            intent: "queue",
            deliveryState: "uncertain",
            attempts: 1,
            lastError: "agent_request_outcome_unknown",
            images: [{ id: "image-1", mimeType: "image/png", byteSize: 3 }],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(broadcast.payload.items[0]?.deliveryState).toBe("uncertain");
    expect(JSON.stringify(broadcast)).not.toContain("data:");
  });

  it("carries the expected revision on queue mutations", () => {
    const base = {
      type: "agent.queue.delete.request",
      requestId: "req-1",
      agentId: "agent-1",
      expectedRevision: 7,
    };
    expect(() => AgentQueueMutationRequestSchema.parse(base)).not.toThrow();
    expect(() =>
      AgentQueueMutationRequestSchema.parse({ ...base, expectedRevision: -1 }),
    ).toThrow();
  });
});

describe("mixed-version send compatibility", () => {
  it("keeps a legacy send request on the legacy shape with no queue intent", () => {
    const legacyRequest = ReleasedSendRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-old-client",
      agentId: "agent-1",
      text: "keep working",
    });
    expect(legacyRequest).toEqual({
      type: "send_agent_message_request",
      requestId: "req-old-client",
      agentId: "agent-1",
      text: "keep working",
    });
  });

  it("never lets queue intent ride along on the legacy send request", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "req-new-client",
      agentId: "agent-1",
      text: "replace the turn",
      activeTurnBehavior: "steer",
    });
    const legacyView = ReleasedSendRequestSchema.parse(parsed);
    expect("activeTurnBehavior" in legacyView).toBe(false);
    expect(Object.keys(legacyView)).not.toContain("intent");
  });

  it("a queued response parses for a released client and the current schema carries the flag", () => {
    const newDaemonResponse = SendAgentMessageResponseMessageSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "req-1",
        agentId: "agent-1",
        accepted: true,
        error: null,
        queued: true,
      },
    });
    expect(newDaemonResponse.payload.queued).toBe(true);

    const legacyView = ReleasedSendResponseSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "req-1",
        agentId: "agent-1",
        accepted: true,
        error: null,
        queued: true,
      },
    });
    expect("queued" in legacyView.payload).toBe(false);
  });

  it("gates the queue on an optional feature flag an old daemon never sets", () => {
    const oldDaemon = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      protocolVersion: 1,
      serverId: "server-1",
    });
    expect(oldDaemon.features?.durableAgentQueueV1).toBeUndefined();

    const newDaemon = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      protocolVersion: 1,
      serverId: "server-1",
      features: { durableAgentQueueV1: true },
    });
    expect(newDaemon.features?.durableAgentQueueV1).toBe(true);
    // A daemon without the flag must never receive the new enum, so a client
    // that sees it absent must not send any agent.queue.* message at all.
    expect(oldDaemon.features?.durableAgentQueueV1 === true).toBe(false);
  });

  it("gates the queue broadcast on a client capability old clients do not send", () => {
    expect(CLIENT_CAPS.durableAgentQueue).toBe("durable_agent_queue");
  });
});
