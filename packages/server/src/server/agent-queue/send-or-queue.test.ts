import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { AgentQueueService } from "./service.js";
import { AgentQueueStore } from "./store.js";
import { sendOrQueuePromptToAgent, type SendOrQueuePromptParams } from "./send-or-queue.js";

const AGENT_ID = "agent-1";

interface FakeManagerState {
  inFlight: boolean;
  outOfBandAccepts: boolean;
  modeChanges: string[];
}

function createFakeManager(state: FakeManagerState): AgentManager {
  return {
    hasInFlightRun: () => state.inFlight,
    tryRunOutOfBand: () => state.outOfBandAccepts,
    setAgentMode: async (_agentId: string, mode: string) => {
      state.modeChanges.push(mode);
    },
    subscribe: () => () => {},
    // The queue's own drain must see the same busy state the policy saw, or it
    // would deliver the queued item immediately and the tests would race it.
    getAgent: (agentId: string) => ({
      id: agentId,
      lifecycle: state.inFlight ? "running" : "idle",
    }),
  } as unknown as AgentManager;
}

describe("sendOrQueuePromptToAgent", () => {
  let dir: string;
  let services: AgentQueueService[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "send-or-queue-"));
    services = [];
  });

  afterEach(async () => {
    for (const service of services) {
      await service.flushDrains();
      service.stop();
    }
    await rm(dir, { recursive: true, force: true });
  });

  function createHarness(state: FakeManagerState) {
    const manager = createFakeManager(state);
    const service = new AgentQueueService({
      store: new AgentQueueStore(join(dir, "queues")),
      agentManager: manager,
      agentStorage: { get: async () => undefined } as unknown as AgentStorage,
      logger: createTestLogger(),
      // Drains never fire in these tests (no lifecycle events), but the send
      // is stubbed anyway so a drain could not reach a real agent.
      sendPrompt: async () => {},
    });
    services.push(service);
    const sends: SendOrQueuePromptParams[] = [];
    const send = (async (params: unknown) => {
      sends.push(params as SendOrQueuePromptParams);
      return { outOfBand: false };
    }) as NonNullable<SendOrQueuePromptParams["send"]>;
    return { manager, service, sends, send };
  }

  test("queues the message when an explicit intent targets a busy agent", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "follow-up while busy",
      intent: "queue",
      messageId: "msg-1",
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result).toEqual({ queued: true, outOfBand: false });
    expect(harness.sends).toHaveLength(0);
    const snapshot = await harness.service.list(AGENT_ID);
    expect(snapshot.items.map((item) => item.id)).toEqual(["msg-1"]);
    expect(snapshot.items[0]?.text).toBe("follow-up while busy");
  });

  test("a busy agent without queue intent keeps the legacy direct send", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "legacy busy send",
      messageId: "msg-1",
      logger: createTestLogger(),
      send: harness.send,
    });

    // Admission is explicit: no intent, no queue. This is the seam that keeps
    // the legacy send path on its released behavior.
    expect(result).toEqual({ queued: false, outOfBand: false });
    expect(harness.sends).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(0);
  });

  test("interrupt: true bypasses the queue and sends immediately", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "explicit interruption",
      intent: "queue",
      interrupt: true,
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result).toEqual({ queued: false, outOfBand: false });
    expect(harness.sends).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(0);
  });

  test("sends immediately when the agent is idle", async () => {
    const state: FakeManagerState = { inFlight: false, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "normal send",
      intent: "queue",
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result).toEqual({ queued: false, outOfBand: false });
    expect(harness.sends).toHaveLength(1);
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(0);
  });

  test("out-of-band commands run mid-turn instead of queueing", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: true, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "/goal pause",
      intent: "queue",
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result).toEqual({ queued: false, outOfBand: true });
    expect(harness.sends).toHaveLength(0);
    expect((await harness.service.list(AGENT_ID)).items).toHaveLength(0);
  });

  test("applies a requested mode change even while the prompt queues", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: harness.service,
      agentId: AGENT_ID,
      text: "queued with mode",
      intent: "steer_strict",
      sessionMode: "plan",
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result.queued).toBe(true);
    expect(state.modeChanges).toEqual(["plan"]);
  });

  test("falls back to a direct send when no queue service is available", async () => {
    const state: FakeManagerState = { inFlight: true, outOfBandAccepts: false, modeChanges: [] };
    const harness = createHarness(state);

    const result = await sendOrQueuePromptToAgent({
      agentManager: harness.manager,
      agentStorage: {} as AgentStorage,
      queueService: null,
      agentId: AGENT_ID,
      text: "no queue configured",
      intent: "queue",
      logger: createTestLogger(),
      send: harness.send,
    });

    expect(result).toEqual({ queued: false, outOfBand: false });
    expect(harness.sends).toHaveLength(1);
  });
});
