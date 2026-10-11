import type { Page, WebSocketRoute } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

type WebSocketMessage = string | Buffer;

interface SendAgentMessageRequest {
  type: "send_agent_message_request";
  requestId: string;
  agentId: string;
  /** Absent when the client sends into an idle agent. */
  activeTurnBehavior?: string;
}

/** A durable queue enqueue the reconnecting client re-sends verbatim. */
export interface QueueEnqueueRequest {
  type: "agent.queue.enqueue.request";
  requestId: string;
  agentId: string;
  itemId: string;
  text: string;
  intent: string;
}

/** The daemon's acknowledgement of one queue enqueue, snapshot included. */
export interface QueueEnqueueResponse {
  type: "agent.queue.enqueue.response";
  payload: {
    requestId: string;
    agentId: string;
    queue: {
      agentId: string;
      revision: number;
      items: Array<{ id: string; text: string; deliveryState: string }>;
    } | null;
    error: string | null;
  };
}

function readSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  if (typeof message !== "string") return null;
  try {
    const envelope = JSON.parse(message) as { type?: unknown; message?: unknown };
    if (envelope.type !== "session") return null;
    if (!envelope.message || typeof envelope.message !== "object") return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readSendRequest(message: WebSocketMessage): SendAgentMessageRequest | null {
  const request = readSessionMessage(message);
  if (
    request?.type !== "send_agent_message_request" ||
    typeof request.requestId !== "string" ||
    typeof request.agentId !== "string"
  ) {
    return null;
  }
  return {
    type: "send_agent_message_request",
    requestId: request.requestId,
    agentId: request.agentId,
    activeTurnBehavior:
      typeof request.activeTurnBehavior === "string" ? request.activeTurnBehavior : undefined,
  };
}

function readQueueEnqueueRequest(message: WebSocketMessage): QueueEnqueueRequest | null {
  const request = readSessionMessage(message);
  if (
    request?.type !== "agent.queue.enqueue.request" ||
    typeof request.requestId !== "string" ||
    typeof request.agentId !== "string" ||
    typeof request.itemId !== "string" ||
    typeof request.text !== "string" ||
    typeof request.intent !== "string"
  ) {
    return null;
  }
  return {
    type: "agent.queue.enqueue.request",
    requestId: request.requestId,
    agentId: request.agentId,
    itemId: request.itemId,
    text: request.text,
    intent: request.intent,
  };
}

function readQueueEnqueueResponse(message: WebSocketMessage): QueueEnqueueResponse | null {
  const response = readSessionMessage(message);
  if (response?.type !== "agent.queue.enqueue.response") return null;
  const payload = response.payload;
  if (!payload || typeof payload !== "object") return null;
  return response as unknown as QueueEnqueueResponse;
}

export async function gateNextAgentMessage(page: Page) {
  let serverSocket: WebSocketRoute | null = null;
  let browserSocket: WebSocketRoute | null = null;
  const heldMessages: Array<WebSocketMessage | null> = [];
  const requests: SendAgentMessageRequest[] = [];
  const requestWaiters = new Set<() => void>();

  /** Browser sockets the gate accepted since installation. */
  let acceptedConnections = 0;
  let connectionsAtDisconnect = 0;
  /** When false, a new browser socket is refused so no reconnect can slip in. */
  let acceptingConnections = true;
  const reconnectWaiters = new Set<() => void>();

  let forwardedSendRequests = 0;
  let discardedHeldSendRequests = 0;

  const queueEnqueueRequests: QueueEnqueueRequest[] = [];
  let holdingEnqueueResponses = false;
  const heldEnqueueResponses: Array<{
    message: WebSocketMessage;
    response: QueueEnqueueResponse;
    browser: WebSocketRoute;
  }> = [];
  const heldEnqueueResponseWaiters = new Set<() => void>();

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    if (!acceptingConnections) {
      void ws.close({ code: 1008, reason: "Reconnect held by submission test." });
      return;
    }

    browserSocket = ws;
    acceptedConnections += 1;
    for (const resolve of reconnectWaiters) resolve();
    reconnectWaiters.clear();

    const server = ws.connectToServer();
    serverSocket = server;

    ws.onMessage((message) => {
      const enqueueRequest = readQueueEnqueueRequest(message);
      if (enqueueRequest) {
        queueEnqueueRequests.push(enqueueRequest);
        server.send(message);
        return;
      }
      const request = readSendRequest(message);
      if (request) {
        heldMessages.push(message);
        requests.push(request);
        for (const resolve of requestWaiters) resolve();
        requestWaiters.clear();
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => {
      const response = readQueueEnqueueResponse(message);
      if (response && holdingEnqueueResponses) {
        heldEnqueueResponses.push({ message, response, browser: ws });
        for (const resolve of heldEnqueueResponseWaiters) resolve();
        heldEnqueueResponseWaiters.clear();
        return;
      }
      ws.send(message);
    });
  });

  const waitForRequest = async (count = 1): Promise<SendAgentMessageRequest> => {
    while (requests.length < count) {
      await new Promise<void>((resolve) => requestWaiters.add(resolve));
    }
    return requests[count - 1]!;
  };

  return {
    waitForRequest,
    accept(index = 0) {
      const heldMessage = heldMessages[index];
      if (!serverSocket || !heldMessage) {
        throw new Error("No held send-agent-message request to accept");
      }
      serverSocket.send(heldMessage);
      forwardedSendRequests += 1;
      heldMessages[index] = null;
    },
    /** Refuses every new browser socket until `allowReconnect` is called. */
    blockReconnect(): void {
      acceptingConnections = false;
    },
    allowReconnect(): void {
      acceptingConnections = true;
    },
    /**
     * Resolves once a browser socket has been accepted after the last
     * disconnect. The check and the waiter registration share one synchronous
     * block, so an acceptance can never slip between them.
     */
    async waitForReconnect(): Promise<void> {
      if (acceptedConnections > connectionsAtDisconnect) return;
      await new Promise<void>((resolve) => {
        if (acceptedConnections > connectionsAtDisconnect) {
          resolve();
          return;
        }
        reconnectWaiters.add(resolve);
      });
    },
    /** Holds the daemon's queue acks so the pre-ack state can be asserted. */
    holdQueueEnqueueResponses(): void {
      holdingEnqueueResponses = true;
    },
    async waitForQueueEnqueueResponse(count: number): Promise<QueueEnqueueResponse> {
      while (heldEnqueueResponses.length < count) {
        await new Promise<void>((resolve) => heldEnqueueResponseWaiters.add(resolve));
      }
      return heldEnqueueResponses[count - 1]!.response;
    },
    /** Delivers the oldest held ack to the client it belongs to. */
    releaseQueueEnqueueResponse(): void {
      const held = heldEnqueueResponses.shift();
      if (!held) throw new Error("No held queue enqueue response to release");
      held.browser.send(held.message);
    },
    getQueueEnqueueRequests(): QueueEnqueueRequest[] {
      return [...queueEnqueueRequests];
    },
    getForwardedSendRequestCount(): number {
      return forwardedSendRequests;
    },
    getDiscardedHeldSendRequestCount(): number {
      return discardedHeldSendRequests;
    },
    /**
     * Drops the connection. The held send requests die with it: they are never
     * forwarded and never replayed by the client, so the two prompts stay
     * unsubmitted.
     */
    async disconnect(): Promise<void> {
      if (!browserSocket) throw new Error("No browser daemon socket to disconnect");
      for (let index = 0; index < heldMessages.length; index += 1) {
        if (heldMessages[index] !== null) {
          heldMessages[index] = null;
          discardedHeldSendRequests += 1;
        }
      }
      connectionsAtDisconnect = acceptedConnections;
      await browserSocket.close({ code: 1008, reason: "Dropped by submission test." });
    },
  };
}
