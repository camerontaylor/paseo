import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { SteerResult } from "../agent/agent-sdk-types.js";
import { MessageReceipts } from "../message-receipts/index.js";
import type { AgentManagerEvent, ManagedAgent } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import {
  AgentQueueService,
  DELIVERY_ATTEMPT_LIMIT,
  QueueImagePayloadTooLargeError,
  QueueItemDispatchingError,
  QueueItemUncertainError,
  type AgentQueueAgentController,
  type SendQueuedPromptInput,
} from "./service.js";
import { AgentQueueStore } from "./store.js";
import { wrapSpokenInput } from "../voice-config.js";

const AGENT_ID = "agent-1";

/**
 * Stands in for the shared AgentManager: the queue service needs the state
 * subscription, the lifecycle of the agent it is draining for, the strict-steer
 * admission, and the run-start wait.
 */
class FakeAgentController implements AgentQueueAgentController {
  lifecycle: AgentLifecycleStatus = "idle";
  pendingPermissions = 0;
  steerResult: SteerResult = { status: "unavailable" };
  steerPrompts: unknown[] = [];
  private readonly subscribers = new Set<(event: AgentManagerEvent) => void>();

  subscribe = ((callback: (event: AgentManagerEvent) => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }) as AgentQueueAgentController["subscribe"];

  getAgent = ((agentId: string) =>
    ({
      id: agentId,
      lifecycle: this.lifecycle,
    }) as ManagedAgent) as AgentQueueAgentController["getAgent"];

  getPendingPermissions = (() =>
    Array.from({ length: this.pendingPermissions }, (_, index) => ({
      id: `permission-${index}`,
    }))) as NonNullable<AgentQueueAgentController["getPendingPermissions"]>;

  steerAgentRun = (async (_agentId: string, prompt: unknown) => {
    this.steerPrompts.push(prompt);
    return this.steerResult;
  }) as AgentQueueAgentController["steerAgentRun"];

  waitForAgentRunStart = (async () => {}) as AgentQueueAgentController["waitForAgentRunStart"];

  emitLifecycle(lifecycle: AgentLifecycleStatus, agentId = AGENT_ID): void {
    this.lifecycle = lifecycle;
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent: { id: agentId, lifecycle } as ManagedAgent });
    }
  }

  resolvePermission(agentId = AGENT_ID): void {
    this.pendingPermissions = 0;
    for (const subscriber of this.subscribers) {
      subscriber({
        type: "agent_stream",
        agentId,
        event: {
          type: "permission_resolved",
          requestId: "permission-0",
          resolution: { behavior: "allow" },
          provider: "codex",
        },
      } as unknown as AgentManagerEvent);
    }
  }
}

interface Harness {
  service: AgentQueueService;
  store: AgentQueueStore;
  agents: FakeAgentController;
  /** Every send the service attempted, including the ones that threw. */
  attempts: SendQueuedPromptInput[];
  sent: SendQueuedPromptInput[];
  broadcasts: AgentQueueSnapshot[];
  failSends: (error: Error | null) => void;
}

describe("AgentQueueService", () => {
  let dir: string;
  let harness: Harness;

  function createHarness(): Harness {
    const agents = new FakeAgentController();
    const attempts: SendQueuedPromptInput[] = [];
    const sent: SendQueuedPromptInput[] = [];
    const broadcasts: AgentQueueSnapshot[] = [];
    let sendError: Error | null = null;

    const store = new AgentQueueStore(join(dir, "queues"));
    const service = new AgentQueueService({
      store,
      agentManager: agents,
      agentStorage: { get: async () => undefined } as unknown as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async (input) => {
        attempts.push(input);
        if (sendError) {
          throw sendError;
        }
        sent.push(input);
        // A real send starts a turn, so the agent is no longer free to drain.
        agents.lifecycle = "running";
      },
    });
    service.subscribeToMutations((snapshot) => broadcasts.push(snapshot));

    return {
      service,
      store,
      agents,
      attempts,
      sent,
      broadcasts,
      failSends: (error) => {
        sendError = error;
      },
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-agent-queue-"));
    harness = createHarness();
    harness.service.start();
  });

  afterEach(async () => {
    await harness.service.flushDrains();
    harness.service.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("broadcasts the queue to subscribers when an item is enqueued while the agent is busy", async () => {
    harness.agents.lifecycle = "running";

    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });

    expect(harness.sent).toEqual([]);
    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.items.map((item) => item.text)).toEqual(["first"]);
    // Delivery bookkeeping rides on every snapshot an enqueuing client sees.
    expect(harness.broadcasts[0]?.items[0]).toMatchObject({
      intent: "queue",
      deliveryState: "pending",
      attempts: 0,
    });
  });

  test("a second client reads the same queue the first client wrote", async () => {
    harness.agents.lifecycle = "running";

    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "from the phone",
      intent: "queue",
    });

    const asSeenElsewhere = await harness.service.list(AGENT_ID);
    expect(asSeenElsewhere.items.map((item) => item.text)).toEqual(["from the phone"]);
  });

  test("queue survives a service restart", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "persisted",
      intent: "queue",
    });

    harness.service.stop();
    const restarted = createHarness();
    restarted.agents.lifecycle = "running";
    try {
      const snapshot = await restarted.service.list(AGENT_ID);
      expect(snapshot.items.map((item) => item.text)).toEqual(["persisted"]);
    } finally {
      restarted.service.stop();
    }
  });

  test("drains the head when the agent stops running, with no client involved", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["item-2"]);
  });

  test("sends immediately when the agent is already idle", async () => {
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "now",
      intent: "queue",
    });
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("receipt-backed voice and typed messages preserve FIFO and equal spoken utterances", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:a",
      text: "same",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:b",
      text: "same",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "typed-1",
      text: "typed",
      intent: "queue",
    });
    for (let index = 0; index < 3; index++) {
      harness.agents.emitLifecycle("running");
      harness.agents.emitLifecycle("idle");
      await harness.service.flushDrains();
    }
    expect(harness.sent.map((item) => item.messageId)).toEqual([
      "attachment:a",
      "attachment:b",
      "typed-1",
    ]);
    expect(harness.sent.map((item) => item.prompt)).toEqual([
      wrapSpokenInput("same"),
      wrapSpokenInput("same"),
      "typed",
    ]);
    expect(await receipts.outcome(AGENT_ID, "attachment:a#1")).toBe("completed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("a permission wait holds the head until the keyed resolution", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.agents.pendingPermissions = 1;
    harness.agents.emitLifecycle("idle");
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:a",
      text: "yes",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);
    await expect(
      harness.service.waitForPendingDispatch(AGENT_ID, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(harness.agents.pendingPermissions).toBe(1);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "attachment:a",
    ]);
    harness.agents.resolvePermission();
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["attachment:a"]);
  });

  test("permission state resolution without a stream event wakes an idle queue", async () => {
    harness.agents.pendingPermissions = 1;
    harness.agents.emitLifecycle("idle");
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "yes",
      text: "yes",
      intent: "queue",
    });
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);
    harness.agents.pendingPermissions = 0;
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["yes"]);
  });

  test("removing admitted speech records an outcome that survives a later retry", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:removed",
      text: "cancel this",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    const snapshot = await harness.service.list(AGENT_ID);
    await harness.service.remove(AGENT_ID, "attachment:removed", snapshot.revision);
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    expect(await receipts.outcome(AGENT_ID, "attachment:removed")).toBe("removed");
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    // A reconnect retry of the same utterance id must not resurrect deleted speech.
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:removed",
      text: "cancel this",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    expect(harness.sent).toEqual([]);
  });

  test("refused speech deletions never write a removed receipt", async () => {
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    harness.service.setMessageReceipts(receipts);
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "attachment:protected",
      text: "keep this",
      intent: "queue",
      origin: "voice",
      voiceOwner: "owner-1",
    });
    const snapshot = await harness.service.list(AGENT_ID);
    await expect(
      harness.service.remove(AGENT_ID, "attachment:protected", snapshot.revision - 1),
    ).rejects.toMatchObject({ code: "queue_revision_conflict" });
    expect(await receipts.outcome(AGENT_ID, "attachment:protected")).toBeNull();
    const [item] = (await harness.store.get(AGENT_ID)).items;
    if (!item) throw new Error("Expected queued speech");
    const dispatchingItems = [{ ...item, deliveryState: "dispatching" as const }];
    await harness.store.mutate(AGENT_ID, (current) => ({
      ...current,
      items: dispatchingItems,
    }));
    const claimed = await harness.service.list(AGENT_ID);
    await expect(
      harness.service.remove(AGENT_ID, "attachment:protected", claimed.revision),
    ).rejects.toBeInstanceOf(QueueItemDispatchingError);
    expect(await receipts.outcome(AGENT_ID, "attachment:protected")).toBeNull();
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(1);
  });

  test("a dispatch observer reports an unknown outcome without retrying it", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.failSends(new Error("provider accepted, connection lost"));
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "uncertain",
      text: "once",
      intent: "queue",
    });
    await harness.service.flushDrains();
    await expect(
      harness.service.waitForPendingDispatch(AGENT_ID, new AbortController().signal),
    ).rejects.toThrow("not been confirmed submitted");
    expect(harness.attempts).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "uncertain",
    ]);
  });

  test("a competing run retains the head and clears only its pre-provider receipt", async () => {
    harness.service.setMessageReceipts(new MessageReceipts(join(dir, "agent-requests")));
    harness.failSends(Object.assign(new Error("Agent busy"), { code: "AGENT_RUN_BUSY" }));
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "race",
      text: "follow up",
      intent: "queue",
    });
    await harness.service.flushDrains();
    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual(["race"]);
    expect(
      await new MessageReceipts(join(dir, "agent-requests")).outcome(AGENT_ID, "race#1"),
    ).toBeNull();
    harness.failSends(null);
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((item) => item.messageId)).toEqual(["race"]);
  });

  test("a send that fails leaves the message pending at the front of the queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });

    harness.failSends(new Error("provider exploded"));
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent).toEqual([]);
    expect(harness.attempts.length).toBeGreaterThan(0);
    const items = (await harness.service.list(AGENT_ID)).items;
    expect(items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
    expect(items[0]).toMatchObject({ deliveryState: "pending", lastError: "provider exploded" });
  });

  test("removing an item broadcasts the shorter queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    const second = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });
    harness.broadcasts.length = 0;

    await harness.service.remove(AGENT_ID, "item-1", second.revision);

    expect(harness.broadcasts).toHaveLength(1);
    expect(harness.broadcasts[0]?.items.map((item) => item.id)).toEqual(["item-2"]);
  });

  test("removing an unknown item changes nothing and broadcasts nothing", async () => {
    harness.agents.lifecycle = "running";
    const first = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    harness.broadcasts.length = 0;

    const snapshot = await harness.service.remove(AGENT_ID, "does-not-exist", first.revision);

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(harness.broadcasts).toEqual([]);
  });

  test("a mutation carrying a stale revision is rejected, not applied", async () => {
    harness.agents.lifecycle = "running";
    const first = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });

    // Another device adds its own item; the first device's view is now stale.
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "from the other device",
      intent: "queue",
    });
    harness.broadcasts.length = 0;

    await expect(harness.service.remove(AGENT_ID, "item-1", first.revision)).rejects.toMatchObject({
      code: "queue_revision_conflict",
    });

    expect((await harness.service.list(AGENT_ID)).items.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    expect(harness.broadcasts).toEqual([]);
  });

  test("revision increases monotonically across mutations", async () => {
    harness.agents.lifecycle = "running";
    const first = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    const second = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });
    const afterRemovingBoth = await harness.service.remove(AGENT_ID, "item-1", second.revision);
    const emptied = await harness.service.remove(AGENT_ID, "item-2", afterRemovingBoth.revision);
    const refilled = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-3",
      text: "third",
      intent: "queue",
    });

    expect(emptied.items).toEqual([]);
    expect([
      first.revision,
      second.revision,
      afterRemovingBoth.revision,
      emptied.revision,
      refilled.revision,
    ]).toEqual([1, 2, 3, 4, 5]);
  });

  test("reorder moves an item to the front and leaves unmentioned ids at the end", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    const second = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "second",
      intent: "queue",
    });
    const third = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-3",
      text: "third",
      intent: "queue",
    });

    const snapshot = await harness.service.reorder(AGENT_ID, ["item-3", "item-1"], third.revision);

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-3", "item-1", "item-2"]);
    expect(second.revision).toBe(2);
  });

  test("image bytes are stored but never broadcast", async () => {
    harness.agents.lifecycle = "running";

    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "look at this",
      intent: "queue",
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });

    const image = snapshot.items[0]?.images?.[0];
    expect(image).toMatchObject({ mimeType: "image/png", byteSize: 3 });
    expect(JSON.stringify(snapshot)).not.toContain("AAAA");
  });

  test("queued images reach the agent as prompt image blocks on drain and round-trip on demand", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "look at this",
      intent: "queue",
      images: [{ data: "AAAA", mimeType: "image/png" }],
    });

    // A different device can pull the exact bytes back for its composer.
    const images = await harness.service.getItemImages(AGENT_ID, "item-1");
    expect(images.map((image) => image.data)).toEqual(["AAAA"]);

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent[0]?.prompt).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
    await expect(harness.service.getItemImages(AGENT_ID, "item-1")).rejects.toThrow(
      /no longer queued/,
    );
  });

  test("rejects an empty message", async () => {
    await expect(
      harness.service.enqueue({
        agentId: AGENT_ID,
        itemId: "item-1",
        text: "   ",
        intent: "queue",
      }),
    ).rejects.toThrow(/empty/i);
  });

  test("rejects an enqueue past the queue length bound", async () => {
    harness.agents.lifecycle = "running";
    let revision = 0;
    for (let index = 0; index < 50; index += 1) {
      const snapshot = await harness.service.enqueue({
        agentId: AGENT_ID,
        itemId: `item-${index}`,
        text: `message ${index}`,
        intent: "queue",
      });
      revision = snapshot.revision;
    }
    expect(revision).toBe(50);

    await expect(
      harness.service.enqueue({
        agentId: AGENT_ID,
        itemId: "item-over",
        text: "one too many",
        intent: "queue",
      }),
    ).rejects.toMatchObject({ code: "queue_full", limit: 50 });
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(50);
  });

  test("rejects an item whose images exceed the payload bound", async () => {
    harness.agents.lifecycle = "running";
    const oversized = "A".repeat(16 * 1024 * 1024 + 1);

    await expect(
      harness.service.enqueue({
        agentId: AGENT_ID,
        itemId: "item-1",
        text: "with a huge image",
        intent: "queue",
        images: [{ data: oversized, mimeType: "image/png" }],
      }),
    ).rejects.toBeInstanceOf(QueueImagePayloadTooLargeError);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("re-enqueueing the same id is a retry, not a duplicate", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
  });

  test("an enqueue retry that lands after the item drained does not resend it", async () => {
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "once",
      intent: "queue",
    });
    await harness.service.flushDrains();
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);

    // The client never saw the ack (e.g. relay dropped mid-request) and retries
    // after reconnect. The daemon already delivered the item.
    harness.agents.lifecycle = "idle";
    const snapshot = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "once",
      intent: "queue",
    });
    await harness.service.flushDrains();

    expect(snapshot.items).toEqual([]);
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
  });

  test("a failed delivery retries on the next wakeup and delivers once", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "flaky",
      intent: "queue",
    });

    harness.failSends(new Error("provider exploded"));
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent).toEqual([]);

    harness.failSends(null);
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("repeated known failures end in a visible failed state at the attempt limit", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "doomed",
      intent: "queue",
    });

    harness.failSends(new Error("provider exploded"));
    for (let attempt = 0; attempt < DELIVERY_ATTEMPT_LIMIT; attempt += 1) {
      harness.agents.emitLifecycle("running");
      harness.agents.emitLifecycle("idle");
      await harness.service.flushDrains();
    }

    const items = (await harness.service.list(AGENT_ID)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      deliveryState: "failed",
      attempts: DELIVERY_ATTEMPT_LIMIT,
      lastError: "provider exploded",
    });
    expect(harness.attempts).toHaveLength(DELIVERY_ATTEMPT_LIMIT);

    // An explicit retry is the only way back to deliverable.
    harness.failSends(null);
    const revision = (await harness.service.list(AGENT_ID)).revision;
    const snapshot = await harness.service.retry(AGENT_ID, "item-1", revision);
    expect(snapshot.items[0]).toMatchObject({ deliveryState: "pending", attempts: 0 });
    await harness.service.flushDrains();
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
  });

  test("editing an item replaces its content and resets its delivery state", async () => {
    harness.agents.lifecycle = "running";
    const enqueued = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "before the edit",
      intent: "queue",
    });

    const snapshot = await harness.service.update(AGENT_ID, "item-1", enqueued.revision, {
      text: "after the edit",
      images: [{ data: "BBBB", mimeType: "image/jpeg" }],
    });

    expect(snapshot.items[0]).toMatchObject({
      text: "after the edit",
      deliveryState: "pending",
      attempts: 0,
    });
    expect(snapshot.items[0]?.images?.[0]?.byteSize).toBe(3);

    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent[0]?.prompt).toEqual([
      { type: "text", text: "after the edit" },
      { type: "image", data: "BBBB", mimeType: "image/jpeg" },
    ]);
  });

  test("editing refuses a dispatching item and demands a decision on an uncertain item", async () => {
    harness.agents.lifecycle = "running";
    const now = new Date().toISOString();
    await harness.store.mutate(AGENT_ID, (current) => ({
      ...current,
      items: [
        {
          id: "item-1",
          text: "in flight",
          intent: "queue",
          deliveryState: "dispatching",
          attempts: 1,
          attemptSeq: 1,
          createdAt: now,
        },
        {
          id: "item-2",
          text: "ambiguous",
          intent: "queue",
          deliveryState: "uncertain",
          attempts: 1,
          attemptSeq: 1,
          lastError: "agent_request_outcome_unknown",
          createdAt: now,
        },
      ],
    }));
    const revision = (await harness.service.list(AGENT_ID)).revision;

    await expect(
      harness.service.update(AGENT_ID, "item-1", revision, { text: "edited mid-flight" }),
    ).rejects.toBeInstanceOf(QueueItemDispatchingError);
    await expect(
      harness.service.update(AGENT_ID, "item-2", revision, { text: "edited while uncertain" }),
    ).rejects.toBeInstanceOf(QueueItemUncertainError);
    // Deletion of an in-flight item is refused too; the ambiguous one is
    // deletable — that is the explicit discard.
    await expect(harness.service.remove(AGENT_ID, "item-1", revision)).rejects.toBeInstanceOf(
      QueueItemDispatchingError,
    );
    const discarded = await harness.service.remove(AGENT_ID, "item-2", revision);
    expect(discarded.items.map((item) => item.id)).toEqual(["item-1"]);
  });

  test("deleting an agent drops its queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });

    await harness.service.deleteForAgent(AGENT_ID);

    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("send_now delivers a pending item from a free agent and reports the post-attempt queue", async () => {
    harness.agents.lifecycle = "running";
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "first",
      intent: "queue",
    });
    const second = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-2",
      text: "urgent second",
      intent: "queue",
    });

    // An explicit send-now may deliver a later item to a free agent: the
    // response shows it gone while the head remains queued. The enqueues armed
    // drain attempts that were refused while busy, so settle them first.
    await harness.service.flushDrains();
    harness.agents.lifecycle = "idle";
    const snapshot = await harness.service.sendNow(AGENT_ID, "item-2", second.revision);
    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-2"]);
  });

  test("send_now on a busy agent refuses without touching the queue", async () => {
    harness.agents.lifecycle = "running";
    const enqueued = await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "wait your turn",
      intent: "queue",
    });
    harness.broadcasts.length = 0;

    const snapshot = await harness.service.sendNow(AGENT_ID, "item-1", enqueued.revision);

    expect(snapshot.items.map((item) => item.id)).toEqual(["item-1"]);
    expect(snapshot.items[0]).toMatchObject({ deliveryState: "pending" });
    expect(harness.sent).toEqual([]);
    expect(harness.broadcasts).toEqual([]);
  });

  test("a refused strict steer leaves the turn running, the item pending, and burns no attempt", async () => {
    harness.agents.lifecycle = "running";
    harness.agents.steerResult = { status: "unavailable" };

    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "steer this",
      intent: "steer_strict",
    });
    await harness.service.flushDrains();

    // The admission was asked once, refused, and nothing was interrupted.
    expect(harness.agents.steerPrompts).toHaveLength(1);
    expect(harness.agents.lifecycle).toBe("running");
    expect(harness.sent).toEqual([]);
    const items = (await harness.service.list(AGENT_ID)).items;
    expect(items[0]).toMatchObject({ deliveryState: "pending", attempts: 0 });

    // When the turn later ends, the item is delivered as a normal run — the
    // fallback that never interrupts anything.
    harness.agents.emitLifecycle("running");
    harness.agents.emitLifecycle("idle");
    await harness.service.flushDrains();
    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });

  test("an accepted strict steer delivers into the running turn", async () => {
    harness.agents.lifecycle = "running";
    harness.agents.steerResult = { status: "accepted" };

    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "steer this",
      intent: "steer_strict",
    });
    await harness.service.flushDrains();

    expect(harness.agents.steerPrompts).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
    expect(harness.sent).toEqual([]);
  });

  test("a steer_strict item on an idle agent is delivered as a normal run", async () => {
    await harness.service.enqueue({
      agentId: AGENT_ID,
      itemId: "item-1",
      text: "arrived after the turn ended",
      intent: "steer_strict",
    });
    await harness.service.flushDrains();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["item-1"]);
    expect((await harness.service.list(AGENT_ID)).items).toEqual([]);
  });
});

describe("AgentQueueService startup recovery", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-agent-queue-recovery-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  interface RecoveryHarness {
    service: AgentQueueService;
    agents: FakeAgentController;
    store: AgentQueueStore;
    receipts: MessageReceipts;
    sent: SendQueuedPromptInput[];
  }

  async function createRecoveryHarness(): Promise<RecoveryHarness> {
    const agents = new FakeAgentController();
    const receipts = new MessageReceipts(join(dir, "agent-requests"));
    const store = new AgentQueueStore(join(dir, "queues"));
    const sent: SendQueuedPromptInput[] = [];
    const service = new AgentQueueService({
      store,
      agentManager: agents,
      agentStorage: { get: async () => undefined } as unknown as AgentStorage,
      logger: createTestLogger(),
      receipts,
      sendPrompt: async (input) => {
        sent.push(input);
        agents.lifecycle = "running";
      },
    });
    return { service, agents, store, receipts, sent };
  }

  test("activates without dispatching, then resumes only never-dispatched items", async () => {
    const first = await createRecoveryHarness();
    first.agents.lifecycle = "running";
    await first.service.start();
    await first.service.enqueue({
      agentId: "agent-a",
      itemId: "kept",
      text: "queued before the restart",
      intent: "queue",
    });
    await first.service.enqueue({
      agentId: "agent-a",
      itemId: "removed",
      text: "deleted before the restart",
      intent: "queue",
    });
    const before = await first.service.list("agent-a");
    await first.service.remove("agent-a", "removed", before.revision);
    await first.service.stop();

    // A restarted daemon loads the queue without dispatching: construction and
    // activation are separate, and agents that are not loaded stay untouched.
    const second = await createRecoveryHarness();
    expect((await second.service.list("agent-a")).items.map((item) => item.id)).toEqual(["kept"]);
    expect(second.sent).toEqual([]);

    // The agent is loaded and idle at activation time, so the never-dispatched
    // item resumes exactly once.
    second.agents.lifecycle = "idle";
    await second.service.activate();
    expect(second.sent.map((input) => input.messageId)).toEqual(["kept"]);
    expect((await second.service.list("agent-a")).items).toEqual([]);
    await second.service.stop();
  });

  test("a claim whose receipt completed is delivered, not resent", async () => {
    const harness = await createRecoveryHarness();
    const prompt = [{ type: "text", text: "crashed mid-dispatch" }];
    // Simulate a crash after the provider took the prompt: the attempt's
    // receipt reached `completed` but the queue still holds the claim.
    await harness.receipts.send({
      agentId: "agent-a",
      messageId: "claimed#1",
      request: { prompt, intent: "queue" },
      send: async () => {},
    });
    await harness.store.mutate("agent-a", (current) => ({
      ...current,
      items: [
        {
          id: "claimed",
          text: "crashed mid-dispatch",
          intent: "queue",
          deliveryState: "dispatching",
          attempts: 1,
          attemptSeq: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    await harness.service.activate();

    expect((await harness.service.list("agent-a")).items).toEqual([]);
    expect(harness.sent).toEqual([]);
    await harness.service.stop();
  });

  test("a claim whose receipt is pending holds as uncertain and is never auto-resent", async () => {
    const harness = await createRecoveryHarness();
    const prompt = [{ type: "text", text: "crashed before the receipt" }];
    // The receipt was committed but the send never completed: the provider may
    // or may not have the prompt. The simulated crash rejects the send.
    await harness.receipts
      .send({
        agentId: "agent-a",
        messageId: "claimed#1",
        request: { prompt, intent: "queue" },
        send: async () => {
          throw new Error("daemon restarted mid-send");
        },
      })
      .catch(() => undefined);
    await harness.store.mutate("agent-a", (current) => ({
      ...current,
      items: [
        {
          id: "claimed",
          text: "crashed before the receipt",
          intent: "queue",
          deliveryState: "dispatching",
          attempts: 1,
          attemptSeq: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    await harness.service.activate();
    await harness.service.flushDrains();

    const items = (await harness.service.list("agent-a")).items;
    expect(items[0]).toMatchObject({
      deliveryState: "uncertain",
      lastError: "agent_request_outcome_unknown",
    });
    expect(harness.sent).toEqual([]);

    // The explicit user decision is the only path that resends it.
    const snapshot = await harness.service.retry(
      "agent-a",
      "claimed",
      (await harness.service.list("agent-a")).revision,
    );
    expect(snapshot.items[0]).toMatchObject({ deliveryState: "pending", attempts: 0 });
    await harness.service.flushDrains();
    expect(harness.sent.map((input) => input.messageId)).toEqual(["claimed"]);
    await harness.service.stop();
  });

  test("a queue-intent claim with no receipt resumes as never dispatched", async () => {
    const harness = await createRecoveryHarness();
    // Crash between claim and dispatch: the receipt layer saw nothing, so the
    // prompt never reached the provider.
    await harness.store.mutate("agent-a", (current) => ({
      ...current,
      items: [
        {
          id: "claimed",
          text: "claimed but never sent",
          intent: "queue",
          deliveryState: "dispatching",
          attempts: 1,
          attemptSeq: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    // Recovery returns the claim to `pending` instead of holding it, and the
    // activation then delivers it exactly once to the loaded, idle agent.
    await harness.service.activate();

    expect(harness.sent.map((input) => input.messageId)).toEqual(["claimed"]);
    expect((await harness.service.list("agent-a")).items).toEqual([]);
    await harness.service.stop();
  });

  test("a steer_strict claim with no receipt holds as uncertain", async () => {
    const harness = await createRecoveryHarness();
    await harness.store.mutate("agent-a", (current) => ({
      ...current,
      items: [
        {
          id: "steered-maybe",
          text: "steer interrupted by a crash",
          intent: "steer_strict",
          deliveryState: "dispatching",
          attempts: 1,
          attemptSeq: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    await harness.service.activate();
    await harness.service.flushDrains();

    expect((await harness.service.list("agent-a")).items[0]).toMatchObject({
      deliveryState: "uncertain",
      lastError: "queue_claim_interrupted",
    });
    expect(harness.sent).toEqual([]);
    await harness.service.stop();
  });

  test("an archived agent keeps its queue and never auto-runs it", async () => {
    const records = new Map<string, { archivedAt?: string }>([
      ["agent-archived", { archivedAt: "2026-01-01T00:00:00.000Z" }],
    ]);
    const agents = new FakeAgentController();
    const sent: SendQueuedPromptInput[] = [];
    const service = new AgentQueueService({
      store: new AgentQueueStore(join(dir, "queues")),
      agentManager: agents,
      agentStorage: {
        get: async (agentId: string) => records.get(agentId),
      } as unknown as AgentStorage,
      logger: createTestLogger(),
      sendPrompt: async (input) => {
        sent.push(input);
        agents.lifecycle = "running";
      },
    });

    await service.enqueue({
      agentId: "agent-archived",
      itemId: "item-1",
      text: "waiting for a restored agent",
      intent: "queue",
    });
    await service.flushDrains();

    agents.lifecycle = "idle";
    agents.emitLifecycle("running");
    agents.emitLifecycle("idle");
    await service.activate();
    await service.flushDrains();

    expect(sent).toEqual([]);
    expect((await service.list("agent-archived")).items.map((item) => item.id)).toEqual(["item-1"]);
    await service.stop();
  });
});
