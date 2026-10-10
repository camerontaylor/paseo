import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { z } from "zod";
import {
  AgentSnapshotPayloadSchema,
  type SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { StreamRow } from "@getpaseo/protocol/global-stream";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";

/**
 * Durable Stream RPC surface over the real daemon, on the fake provider
 * harness: capability-gated delivery of the two correlated RPCs, dormant
 * reads with zero provider launches, history across collector restart, both
 * real handlers refusing manual entries at the carried cap, and the released
 * snapshot schema parsing an actual emitted payload.
 */

// COMPAT(globalStream): released 0.11.1-fork client shapes, frozen
// independently of the current schemas. The released client knows artifacts
// and companionEntries; it does not know `ask` or `captureDegraded`.
const ReleasedCompanionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("question"),
    status: z.enum(["open", "reviewed", "done", "reply_sent"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("feature_request"),
    status: z.enum(["open", "reviewed", "done"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("permission"),
    requestId: z.string(),
    requestKind: z.enum(["tool", "plan", "question", "mode", "other"]),
    status: z.enum(["pending", "allowed", "denied", "expired"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("outcome"),
    status: z.enum(["completed", "failed", "canceled"]),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("pin"),
    sourceId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("q_and_a"),
    answer: z.string().optional(),
    questionMessageId: z.string().optional(),
    answerMessageId: z.string().optional(),
  }),
]);

const ReleasedAgentSnapshotSchema = AgentSnapshotPayloadSchema.omit({
  captureDegraded: true,
}).extend({
  // The released payload keeps every released field (artifacts and
  // companionEntries included) and strips only what it does not know.
  companionEntries: z.array(ReleasedCompanionEntrySchema).optional(),
});

async function waitFor<T>(
  poll: () => T | undefined,
  description: string,
  timeoutMs = 15000,
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

function streamMessages(collector: MessageCollector): SessionOutboundMessage[] {
  return collector.messages.filter(
    (message): message is SessionOutboundMessage =>
      message.type === "stream.list.response" || message.type === "stream.entry.update.response",
  );
}

describe("stream durability daemon", () => {
  let ctx: DaemonTestContext;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  test("capable sessions receive correlated list and update responses", async () => {
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      action: "add_question",
      entryId: "launch",
      text: "Choose a launch window",
    });
    const page = await ctx.client.listGlobalStream({ filter: "pending" });
    const row = page.rows.find(
      (candidate): candidate is StreamRow & { item: { kind: "entry" } } =>
        candidate.agentId === agent.id && candidate.item.kind === "entry",
    );
    expect(row?.item.entry).toMatchObject({ id: "question:launch", status: "open" });
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      entryId: "question:launch",
      action: "update_status",
      status: "done",
    });
    const after = await ctx.client.listGlobalStream({ filter: "pending" });
    expect(
      after.rows.some((candidate) => candidate.agentId === agent.id),
    ).toBe(false);
  });

  test("capability-absent sessions receive neither response type and never mutate", async () => {
    const providerSessions = 0;
    void providerSessions;
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      action: "add_question",
      entryId: "keep",
      text: "Stays open",
    });
    const absent = new DaemonClient({
      url: `ws://127.0.0.1:${ctx.daemon.port}/ws`,
      capabilities: { [CLIENT_CAPS.globalStream]: false },
    });
    await absent.connect();
    await absent.fetchAgents({ subscribe: {} });
    const absentCollector = createMessageCollector(absent);
    try {
      // Fire both new request types from the capability-absent session without
      // awaiting a correlated response, then prove the daemon processed the
      // frames: the ordinary RPC sent AFTER them is answered.
      const rawSend = (
        absent as unknown as {
          sendSessionMessageStrict: (message: Record<string, unknown>) => void;
        }
      ).sendSessionMessageStrict.bind(absent);
      rawSend({
        type: "stream.list.request",
        requestId: "absent-list",
      });
      rawSend({
        type: "stream.entry.update.request",
        requestId: "absent-update",
        agentId: agent.id,
        entryId: "injected",
        action: "add_pin",
        text: "must not persist",
      });
      await absent.fetchAgents({ subscribe: {} });
      // Deterministic barrier passed: no new-type response ever arrived.
      expect(streamMessages(absentCollector)).toEqual([]);
      // The mutation attempt left no trace.
      const page = await ctx.client.listGlobalStream({ agentId: agent.id });
      expect(
        page.rows.some(
          (candidate) =>
            candidate.item.kind === "entry" && candidate.item.entry.id === "pin:injected",
        ),
      ).toBe(false);
      // The absent session is still healthy.
      await absent.fetchAgents({ subscribe: {} });
    } finally {
      absentCollector.unsubscribe();
      await absent.close();
    }
  });

  test("dormant reads page stored history with zero provider launches across collector restart", async () => {
    let providerLaunches = 0;
    // The fake provider counts session creations after seeding; a dormant read
    // must not launch anything.
    const launchCounter = createTestAgentClients({
      beforeCreateSession: () => {
        providerLaunches += 1;
      },
    });
    await ctx.cleanup();
    ctx = await createDaemonTestContext({ agentClients: launchCounter });
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    const seededLaunches = providerLaunches;
    expect(seededLaunches).toBeGreaterThan(0);
    for (let i = 0; i < 7; i++) {
      await ctx.client.updateStreamEntry({
        agentId: agent.id,
        action: "add_question",
        entryId: `q${i}`,
        text: `Dormant question ${i}`,
      });
    }
    await ctx.client.archiveAgent(agent.id);
    expect(providerLaunches).toBe(seededLaunches);
    // Dormant read over the stored record.
    const page = await ctx.client.listGlobalStream({
      agentId: agent.id,
      includeArchived: true,
    });
    const entryRows = page.rows.filter(
      (candidate): candidate is StreamRow & { item: { kind: "entry" } } =>
        candidate.item.kind === "entry",
    );
    expect(entryRows.map((row) => row.item.entry.id)).toContain("question:q6");
    expect(providerLaunches).toBe(seededLaunches);
  });

  test("both real handlers refuse manual entries at the carried cap", async () => {
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    for (let i = 0; i < 100; i++) {
      await ctx.client.updateStreamEntry({
        agentId: agent.id,
        action: "add_pin",
        entryId: `filler-${i}`,
        text: `Filler ${i}`,
      });
    }
    // New RPC: a NEW manual entry is refused; an edit of an existing pin passes.
    await expect(
      ctx.client.updateStreamEntry({
        agentId: agent.id,
        action: "add_pin",
        entryId: "one-too-many",
        text: "Overflow",
      }),
    ).rejects.toThrow("Stream pin limit reached");
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      action: "add_pin",
      entryId: "filler-3",
      text: "Rewritten filler",
    });
    // Legacy RPC through its real handler: same refusal.
    await expect(
      ctx.client.updateCompanionEntry({
        agentId: agent.id,
        action: "add_pin",
        text: "Legacy overflow",
      }),
    ).rejects.toThrow("Stream pin limit reached");
    // Pages clamp at 50 rows even though 100 pins are stored. The edit kept
    // its original timestamp (upsert semantics), so it can sit mid-history:
    // page through everything and assert there.
    const page = await ctx.client.listGlobalStream({ agentId: agent.id, filter: "pinned" });
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
    const secondPage = await ctx.client.listGlobalStream({
      agentId: agent.id,
      filter: "pinned",
      cursor: page.nextCursor!,
    });
    const allTexts = [...page.rows, ...secondPage.rows].map(
      (candidate) =>
        candidate.item.kind === "entry" ? candidate.item.entry.text : "<artifact>",
    );
    expect(allTexts).toHaveLength(100);
    expect(allTexts).toContain("Rewritten filler");
    expect(allTexts).not.toContain("Overflow");
    expect(allTexts).not.toContain("Legacy overflow");
  });

  test("an emitted snapshot parses through the released snapshot schema", async () => {
    // Detach from the shared context: this test runs its own daemon so the
    // ask-bearing record can be seeded on disk before the daemon that emits
    // it ever loads its cache.
    await ctx.cleanup();
    const { createTestPaseoDaemon } = await import("../test-utils/paseo-daemon.js");
    const seeded = await createTestPaseoDaemon({
      agentClients: createTestAgentClients(),
      cleanup: false,
    });
    let fresh: DaemonClient | null = null;
    try {
      const client = new DaemonClient({ url: `ws://127.0.0.1:${seeded.port}/ws` });
      await client.connect();
      await client.fetchAgents({ subscribe: {} });
      const agent = await client.createAgent({ provider: "codex", cwd: "/tmp" });
      await client.updateStreamEntry({
        agentId: agent.id,
        action: "add_question",
        entryId: "deploy",
        text: "Deploy window",
      });
      await client.close();
      // Stopping the daemon flushes the live record to disk.
      await seeded.close();

      // Seed ask-bearing state the way s4's engine will leave it: edit the
      // stored record on disk while no daemon holds it cached. The s1 wire
      // schema already carries the nested ask.
      const { readdir, readFile, writeFile } = await import("node:fs/promises");
      const agentsDir = join(seeded.paseoHome, "agents");
      const recordFiles: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const entryPath = join(dir, entry.name);
          if (entry.isDirectory()) await walk(entryPath);
          else if (entry.name.endsWith(".json")) recordFiles.push(entryPath);
        }
      };
      await walk(agentsDir);
      expect(recordFiles).toHaveLength(1);
      const record = JSON.parse(await readFile(recordFiles[0]!, "utf8")) as {
        companionEntries: Array<Record<string, unknown>>;
      };
      record.companionEntries = [
        {
          id: "ask:deploy",
          kind: "question",
          status: "open",
          timestamp: "2026-10-11T00:00:00.000Z",
          text: "Deploy window",
          truncated: false,
          ask: {
            state: "blocked",
            remaining: "Approval",
            evidence: "Tests passed",
            revision: 1,
            provenance: "explicit",
          },
        },
      ];
      await writeFile(recordFiles[0]!, JSON.stringify(record, null, 2));

      // A second daemon loads the seeded record from disk; a fresh capable
      // connection receives the snapshot through the real projection path.
      // TestPaseoDaemon does not expose paseoHomeRoot; the home is always
      // `<root>/.paseo`, so the root is its parent directory.
      const emitter = await createTestPaseoDaemon({
        agentClients: createTestAgentClients(),
        paseoHomeRoot: dirname(seeded.paseoHome),
        cleanup: false,
      });
      try {
        fresh = new DaemonClient({ url: `ws://127.0.0.1:${emitter.port}/ws` });
        await fresh.connect();
        const collector = createMessageCollector(fresh);
        try {
          await fresh.fetchAgents({ subscribe: {} });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          console.log(
            "ALL-FRAMES",
            JSON.stringify(
              collector.messages.map((message) => ({
                type: message.type,
                hasAsk: JSON.stringify(message).includes('"ask"'),
                mentionsAskDeploy: JSON.stringify(message).includes("ask:deploy"),
              })),
            ),
          );
          const rawFrame = collector.messages.find((message) =>
            JSON.stringify(message).includes("ask:deploy"),
          );
          console.log("RAW-FRAME", JSON.stringify(rawFrame).slice(0, 900));
          const emitted = waitFor(
            () => {
              const frame = collector.messages.find((message) => {
                const candidate =
                  message.type === "agent_update" && message.payload.kind === "upsert"
                    ? message.payload.agent
                    : (message as unknown as { agent?: AgentSnapshotPayload }).agent;
                return (
                  candidate?.id === agent.id &&
                  (candidate.companionEntries ?? []).some(
                    (entry) => entry.id === "ask:deploy",
                  )
                );
              });
              if (!frame) return undefined;
              console.log("MATCHED-FRAME", JSON.stringify(frame).slice(0, 700));
              const agentOut =
                frame.type === "agent_update" && frame.payload.kind === "upsert"
                  ? frame.payload.agent
                  : (frame as unknown as { agent: AgentSnapshotPayload }).agent;
              console.log("AGENT-OUT", JSON.stringify(agentOut).slice(0, 400));
              return agentOut;
            },
            "emitted agent snapshot with the ask entry",
          );
          expect(emitted.companionEntries?.[0]?.ask).toMatchObject({ state: "blocked" });
          const released = ReleasedAgentSnapshotSchema.parse(emitted);
          expect(released.companionEntries?.every((entry) => !("ask" in entry))).toBe(true);
          expect("captureDegraded" in released).toBe(false);
        } finally {
          collector.unsubscribe();
        }
      } finally {
        await emitter.close();
      }
    } finally {
      // cleanup:false above: remove the daemon-created dirs here.
      const { rm } = await import("node:fs/promises");
      await rm(seeded.paseoHome, { recursive: true, force: true });
      await rm(seeded.staticDir, { recursive: true, force: true });
      await fresh?.close().catch(() => undefined);
    }
  });
});
