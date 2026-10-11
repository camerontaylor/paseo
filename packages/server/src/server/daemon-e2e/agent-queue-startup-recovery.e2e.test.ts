import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type {
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentQueueSnapshot,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";

import { AgentQueueStore } from "../agent-queue/store.js";
import { MessageReceipts } from "../message-receipts/index.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";

/**
 * C1 package-gate integration evidence on the ad-hoc in-process daemon
 * harness (fake provider, no credentials): startup recovery must preserve
 * queued work across a daemon restart and send NOTHING before an explicit
 * resume boundary, then resume never-dispatched items FIFO, each exactly
 * once. A claim whose dispatch never confirmed recovers as `uncertain` and
 * is never auto-resent, even after the agent resumes.
 */

const CODEX_TEST_MODEL = "gpt-5.4-mini";
const CODEX_TEST_THINKING_OPTION_ID = "low";

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("");
}

async function waitFor<T>(
  poll: () => T | undefined,
  description: string,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = poll();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function queueEvents(collector: MessageCollector, agentId: string): AgentQueueSnapshot[] {
  return collector.messages
    .filter(
      (message): message is Extract<SessionOutboundMessage, { type: "agent.queue.update" }> =>
        message.type === "agent.queue.update" && message.payload.agentId === agentId,
    )
    .map((message) => message.payload);
}

function permissionRequestFrom(collector: MessageCollector, agentId: string) {
  const message = collector.messages.find(
    (candidate) =>
      candidate.type === "agent_permission_request" && candidate.payload.agentId === agentId,
  );
  return message?.type === "agent_permission_request" ? message.payload.request : undefined;
}

interface Home {
  root: string;
  paseoHome: string;
}

function createHome(): Home {
  const root = mkdtempSync(path.join(os.tmpdir(), "paseo-queue-recovery-"));
  return { root, paseoHome: path.join(root, ".paseo") };
}

function destroyHome(home: Home): void {
  rmSync(home.root, { recursive: true, force: true });
}

async function startDaemonOn(
  home: Home,
  turnPrompts: AgentPromptInput[],
): Promise<TestPaseoDaemon> {
  // cleanup: false keeps the home on close — the restart reuses it.
  return await createTestPaseoDaemon({
    paseoHomeRoot: home.root,
    cleanup: false,
    agentClients: createTestAgentClients({
      onStartTurn: (prompt) => {
        turnPrompts.push(prompt);
      },
    }),
  });
}

async function connect(daemon: TestPaseoDaemon): Promise<{
  client: DaemonClient;
  collector: MessageCollector;
  release: () => Promise<void>;
}> {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.70",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  // Permission requests and queue snapshots are pushed as notifications to
  // subscribed capable clients — the same two feeds the app's session
  // context subscribes to.
  const feeds = client.observeEvents(["agent_permission_request", "agent.queue.update"], {
    notifications: true,
  });
  await feeds.ready;
  const collector = createMessageCollector(client);
  return {
    client,
    collector,
    release: () => feeds.release(),
  };
}

describe("agent queue startup recovery e2e", () => {
  test("a restarted daemon recovers queued work without dispatching until the agent resumes, then drains FIFO exactly once", async () => {
    const home = createHome();
    const turnPrompts: AgentPromptInput[] = [];
    let daemon: TestPaseoDaemon | null = null;
    let client: DaemonClient | null = null;
    let collector: MessageCollector | null = null;
    let releaseFirst: (() => Promise<void>) | null = null;
    let releaseSecond: (() => Promise<void>) | null = null;
    let cwd: string | null = null;
    try {
      cwd = mkdtempSync(path.join(os.tmpdir(), "queue-recovery-cwd-"));
      daemon = await startDaemonOn(home, turnPrompts);
      const first = await connect(daemon);
      client = first.client;
      collector = first.collector;
      releaseFirst = first.release;

      const agent = await client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd,
        title: "Queue startup recovery",
      });

      // Turn 1 completes normally so a persistence handle survives the restart.
      await client.sendMessage(agent.id, "Warm up the session before the restart.");
      const finished = await client.waitForFinish(agent.id, 60000);
      const handle = finished.final?.persistence as AgentPersistenceHandle | undefined;
      expect(handle).toBeTruthy();
      expect(turnPrompts).toHaveLength(1);

      // Turn 2 parks on a permission request so the agent is busy while the
      // explicit-intent items are admitted — they must stay pending.
      await client.sendMessage(agent.id, 'printf "ok" > permission.txt');
      await waitFor(
        () => permissionRequestFrom(collector, agent.id),
        "the fake permission request",
      );

      await client.enqueueAgentMessage({
        agentId: agent.id,
        itemId: "item-1",
        text: "first queued payload",
        intent: "queue",
      });
      const enqueued = await client.enqueueAgentMessage({
        agentId: agent.id,
        itemId: "item-2",
        text: "second queued payload",
        intent: "queue",
      });
      expect(enqueued.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
      const lastRevision = enqueued.revision;

      // Stop the daemon with the items queued and the turn still parked.
      await releaseFirst?.().catch(() => undefined);
      releaseFirst = null;
      await client.close();
      await daemon.close();
      daemon = null;
      client = null;

      // A fresh daemon on the SAME home: the queue must come back intact and
      // startup must not dispatch anything — activation only recovers state.
      daemon = await startDaemonOn(home, turnPrompts);
      const second = await connect(daemon);
      client = second.client;
      collector = second.collector;
      releaseSecond = second.release;

      const recovered = await client.listQueuedAgentMessages(agent.id);
      expect(recovered.items.map((item) => item.id)).toEqual(["item-1", "item-2"]);
      expect(recovered.items.map((item) => item.text)).toEqual([
        "first queued payload",
        "second queued payload",
      ]);
      expect(recovered.items.every((item) => item.deliveryState === "pending")).toBe(true);
      expect(recovered.revision).toBeGreaterThanOrEqual(lastRevision);

      // Startup recovery without dispatch: the only recorded turns are the
      // two pre-restart ones (the warmup and the turn parked on the
      // permission). No fake-provider turn may start across the restart
      // before the explicit resume — nothing can dispatch: no agent session
      // is live yet, and neither queued payload may appear.
      expect(turnPrompts).toHaveLength(2);
      expect(turnPrompts.map(promptText).join("\n")).not.toContain("queued payload");

      // Explicit resume boundary: a fresh send re-materializes the persisted
      // agent under the SAME id (ensureAgentLoaded), and the queue drains on
      // that agent's lifecycle as the sent turn completes.
      await client.sendMessage(agent.id, "Resume the queue after the restart.");
      const triggerFinished = await client.waitForFinish(agent.id, 60000);
      expect(triggerFinished.status).toBe("idle");

      const emptyQueueAfterResume = (): AgentQueueSnapshot | undefined =>
        queueEvents(collector, agent.id).find(
          (s) => s.items.length === 0 && s.revision > lastRevision,
        );
      const drained = await waitFor(emptyQueueAfterResume, "the queue to drain after the resume");
      expect(drained.items).toEqual([]);

      // Warmup + parked turn + trigger + each queued item exactly once, FIFO.
      expect(turnPrompts).toHaveLength(5);
      const texts = turnPrompts.map(promptText);
      expect(texts[0]).toContain("Warm up the session");
      const firstRuns = texts.filter((text) => text.includes("first queued payload"));
      const secondRuns = texts.filter((text) => text.includes("second queued payload"));
      expect(firstRuns).toHaveLength(1);
      expect(secondRuns).toHaveLength(1);
      expect(texts.indexOf(texts.find((t) => t.includes("first queued payload"))!)).toBeLessThan(
        texts.indexOf(texts.find((t) => t.includes("second queued payload"))!),
      );

      // Delivery leaves exactly one canonical user row per payload.
      const timeline = await client.fetchAgentTimeline(agent.id, { projection: "canonical" });
      const firstRows = timeline.entries.filter(
        (entry) => entry.item.type === "user_message" && entry.item.text.includes("first queued"),
      );
      const secondRows = timeline.entries.filter(
        (entry) => entry.item.type === "user_message" && entry.item.text.includes("second queued"),
      );
      expect(firstRows).toHaveLength(1);
      expect(secondRows).toHaveLength(1);
    } finally {
      await releaseFirst?.().catch(() => undefined);
      await releaseSecond?.().catch(() => undefined);
      await client?.close().catch(() => undefined);
      await daemon?.close().catch(() => undefined);
      if (cwd) rmSync(cwd, { recursive: true, force: true });
      destroyHome(home);
    }
  }, 180000);

  test("a claim whose dispatch never confirmed recovers as uncertain and is never auto-resent, even after the agent resumes", async () => {
    const home = createHome();
    const turnPrompts: AgentPromptInput[] = [];
    let daemon: TestPaseoDaemon | null = null;
    let client: DaemonClient | null = null;
    let cwd: string | null = null;
    try {
      cwd = mkdtempSync(path.join(os.tmpdir(), "queue-recovery-uncertain-cwd-"));
      daemon = await startDaemonOn(home, turnPrompts);
      const first = await connect(daemon);

      const agent = await first.client.createAgent({
        provider: "codex",
        model: CODEX_TEST_MODEL,
        thinkingOptionId: CODEX_TEST_THINKING_OPTION_ID,
        cwd,
        title: "Queue uncertain recovery",
      });
      await first.client.sendMessage(agent.id, "Warm up before the crash.");
      const finished = await first.client.waitForFinish(agent.id, 60000);
      const handle = finished.final?.persistence as AgentPersistenceHandle | undefined;
      expect(handle).toBeTruthy();

      await first.client.close();
      await daemon.close();
      daemon = null;

      // Simulate the crash residue with the daemon's own persistence classes
      // at the daemon's paths: an item claimed (dispatching) whose attempt
      // receipt was committed but whose send never completed.
      const store = new AgentQueueStore(path.join(home.paseoHome, "queues"));
      await store.mutate(agent.id, (current) => ({
        ...current,
        items: [
          ...current.items,
          {
            id: "claimed",
            text: "crashed mid-dispatch",
            intent: "queue" as const,
            deliveryState: "dispatching" as const,
            attempts: 1,
            attemptSeq: 1,
            createdAt: new Date().toISOString(),
          },
          {
            id: "behind",
            text: "queued behind the claim",
            intent: "queue" as const,
            deliveryState: "pending" as const,
            attempts: 0,
            attemptSeq: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      const receipts = new MessageReceipts(path.join(home.paseoHome, "agent-requests"));
      await receipts
        .send({
          agentId: agent.id,
          messageId: "claimed#1",
          request: {
            prompt: [{ type: "text", text: "crashed mid-dispatch" }],
            intent: "queue",
          },
          send: async () => {
            throw new Error("daemon restarted mid-send");
          },
        })
        .catch(() => undefined);

      // The restarted daemon recovers the claim as uncertain: the provider may
      // or may not have the prompt, so it is never auto-resent.
      daemon = await startDaemonOn(home, turnPrompts);
      const second = await connect(daemon);
      client = second.client;

      const recovered = await client.listQueuedAgentMessages(agent.id);
      const claimed = recovered.items.find((item) => item.id === "claimed");
      expect(claimed?.deliveryState).toBe("uncertain");
      expect(claimed?.text).toBe("crashed mid-dispatch");
      const behind = recovered.items.find((item) => item.id === "behind");
      expect(behind?.deliveryState).toBe("pending");

      // No startup dispatch: the only recorded turn is the pre-restart warmup,
      // and neither the uncertain claim nor the item behind it was sent.
      expect(turnPrompts).toHaveLength(1);
      expect(turnPrompts.map(promptText).join("\n")).not.toContain("crashed mid-dispatch");
      expect(turnPrompts.map(promptText).join("\n")).not.toContain("queued behind the claim");

      // Explicit boundary: a fresh send re-materializes the persisted agent
      // under the SAME id; the drain runs on its lifecycle, but an uncertain
      // head is not a pending head, so nothing dispatches and the item behind
      // it holds the line.
      await client.sendMessage(agent.id, "Trigger the drain after the restart.");
      const triggerFinished = await client.waitForFinish(agent.id, 60000);
      expect(triggerFinished.status).toBe("idle");

      const after = await client.listQueuedAgentMessages(agent.id);
      expect(after.items.find((item) => item.id === "claimed")?.deliveryState).toBe("uncertain");
      expect(after.items.find((item) => item.id === "behind")?.deliveryState).toBe("pending");
      expect(turnPrompts).toHaveLength(2);
      expect(turnPrompts.map(promptText).join("\n")).not.toContain("crashed mid-dispatch");
      expect(turnPrompts.map(promptText).join("\n")).not.toContain("queued behind the claim");
    } finally {
      await client?.close().catch(() => undefined);
      await daemon?.close().catch(() => undefined);
      if (cwd) rmSync(cwd, { recursive: true, force: true });
      destroyHome(home);
    }
  }, 180000);
});
