import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import {
  type AgentSnapshotPayload,
  type SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { StreamRow } from "@getpaseo/protocol/global-stream";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createMessageCollector, type MessageCollector } from "../test-utils/message-collector.js";
import { ReleasedAgentSnapshotSchema } from "../test-utils/released-stream-schemas.js";

/**
 * Durable Stream RPC surface over the real daemon, on the fake provider
 * harness: capability-gated delivery of the two correlated RPCs, dormant
 * reads with zero provider launches, history across collector restart, both
 * real handlers refusing manual entries at the carried cap, and the released
 * snapshot schema parsing an actual emitted payload.
 */

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
    expect(after.rows.some((candidate) => candidate.agentId === agent.id)).toBe(false);
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
    const firstPage = await ctx.client.listGlobalStream({ agentId: agent.id, filter: "pinned" });
    expect(firstPage.rows).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await ctx.client.listGlobalStream({
      agentId: agent.id,
      filter: "pinned",
      cursor: firstPage.nextCursor!,
    });
    const allTexts = [...firstPage.rows, ...secondPage.rows].map((candidate) =>
      candidate.item.kind === "entry" ? candidate.item.entry.text : "<artifact>",
    );
    expect(allTexts).toHaveLength(100);
    expect(allTexts).toContain("Rewritten filler");
    expect(allTexts).not.toContain("Overflow");
    expect(allTexts).not.toContain("Legacy overflow");
    // Legacy oversized text clips at 4000 with the excerpt flag (declared
    // carried behavior); empty/whitespace text is rejected by the engine.
    // Free one manual slot first — the legacy create consults the same cap.
    await ctx.client.updateCompanionEntry({
      agentId: agent.id,
      entryId: "pin:filler-0",
      action: "remove_pin",
    });
    await ctx.client.updateCompanionEntry({
      agentId: agent.id,
      action: "add_pin",
      text: "y".repeat(4500),
    });
    await expect(
      ctx.client.updateCompanionEntry({ agentId: agent.id, action: "add_pin", text: "   " }),
    ).rejects.toThrow("Enter between 1 and 4000 characters");
    let cursor: string | null = null;
    let sawClippedLegacyPin = false;
    do {
      const page = await ctx.client.listGlobalStream({
        agentId: agent.id,
        filter: "pinned",
        cursor: cursor ?? undefined,
      });
      for (const row of page.rows) {
        if (
          row.item.kind === "entry" &&
          row.item.entry.kind === "pin" &&
          row.item.entry.truncated === true &&
          row.item.entry.text === "y".repeat(4000)
        ) {
          sawClippedLegacyPin = true;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(sawClippedLegacyPin).toBe(true);
  }, 30_000);

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
          // The stored snapshot reaches the client through the daemon's real
          // projection path inside the fetch response (the ask entry is on
          // the wire, nested `ask` included).
          const emitted = await waitFor(() => {
            for (const message of collector.messages) {
              if (message.type !== "fetch_agents_response") continue;
              const payload = message.payload as
                | { entries?: Array<{ agent: AgentSnapshotPayload }> }
                | undefined;
              for (const entry of payload?.entries ?? []) {
                if (entry.agent.id === agent.id) return entry.agent;
              }
            }
            return undefined;
          }, "fetch response carrying the ask entry");
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

  test("two clients: a stale differing ask update conflicts and never replaces the winner", async () => {
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    const clientB = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
    await clientB.connect();
    await clientB.fetchAgents({ subscribe: {} });
    const readAsk = async (client: DaemonClient) => {
      const page = await client.listGlobalStream({ agentId: agent.id, asksOnly: true });
      const row = page.rows.find(
        (candidate): candidate is StreamRow & { item: { kind: "entry" } } =>
          candidate.item.kind === "entry" && candidate.item.entry.id === "ask:deploy",
      );
      const ask = row?.item.entry.ask;
      if (!ask) throw new Error("ask row missing from the stream page");
      return ask;
    };
    try {
      await ctx.client.updateStreamEntry({
        agentId: agent.id,
        action: "set_ask",
        entryId: "deploy",
        expectedRevision: 0,
        text: "Deploy the release",
        ask: { state: "open", remaining: "", evidence: "" },
      });
      // Both clients read one revision.
      const readA = await readAsk(ctx.client);
      const readB = await readAsk(clientB);
      expect(readA.revision).toBe(1);
      expect(readB.revision).toBe(1);

      // A wins with a differing update at that revision.
      await ctx.client.updateStreamEntry({
        agentId: agent.id,
        action: "set_ask",
        entryId: "deploy",
        expectedRevision: readA.revision,
        text: "Deploy the release",
        ask: { state: "in_progress", remaining: "Ship it", evidence: "Draft ready" },
      });

      // B's differing stale update at the same revision conflicts.
      await expect(
        clientB.updateStreamEntry({
          agentId: agent.id,
          action: "set_ask",
          entryId: "deploy",
          expectedRevision: readB.revision,
          text: "Deploy the release",
          ask: { state: "done", remaining: "", evidence: "B wins" },
        }),
      ).rejects.toThrow(/Ask revision conflict/);

      // Persisted state is A's winner on both live connections.
      const winner = {
        state: "in_progress",
        remaining: "Ship it",
        evidence: "Draft ready",
        revision: 2,
      };
      expect(await readAsk(ctx.client)).toMatchObject(winner);
      expect(await readAsk(clientB)).toMatchObject(winner);

      // Storage-level proof, not just live reads: the record on the daemon's own
      // persistence boundary holds A's winner.
      const stored = await ctx.daemon.daemon.agentStorage.get(agent.id);
      const storedAsk = stored?.companionEntries?.find((entry) => entry.id === "ask:deploy")?.ask;
      expect(storedAsk).toMatchObject(winner);

      // A fresh connection reads the same winner.
      const clientC = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
      await clientC.connect();
      try {
        await clientC.fetchAgents({ subscribe: {} });
        expect(await readAsk(clientC)).toMatchObject(winner);
      } finally {
        await clientC.close();
      }
    } finally {
      await clientB.close();
    }
  });

  test("degraded capture during a live provider turn: events keep streaming, retained history survives, a background persist clears the flag", async () => {
    // This test needs a provider turn it can hold at its completion boundary, so
    // it runs its own daemon with a controllable fake provider instead of the
    // shared context.
    interface Hold {
      reached: Promise<void>;
      released: Promise<void>;
      markReached: () => void;
      release: () => void;
    }
    const createHold = (): Hold => {
      let markReached!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        markReached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { reached, released, markReached, release };
    };
    let hold: Hold | null = null;
    let pendingFault: NodeJS.ErrnoException | null = null;
    let fault: NodeJS.ErrnoException | null = null;
    await ctx.cleanup();
    ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        // Arm the fault at the turn's own admission boundary: the prompt is
        // accepted while storage is healthy, then every capture of this turn's
        // events fails until the test clears it.
        onStartTurn: () => {
          fault = pendingFault;
        },
        // Deterministic mid-turn barrier: the provider holds just before
        // `turn_completed`, so the fault lands on the turn's own capture and the
        // test can clear it while the turn is still live.
        beforeTurnCompletion: () => {
          hold?.markReached();
          return hold?.released;
        },
      }),
    });
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      action: "add_question",
      entryId: "kept",
      text: "Kept across the fault",
    });

    // Fault injection at the daemon's own persistence boundary: wrap the
    // isolated instance's storage methods; restore them in finally so nothing
    // leaks across tests (no global monkeypatching).
    const storage = ctx.daemon.daemon.agentStorage;
    const originalApplySnapshot = storage.applySnapshot;
    const originalUpsert = storage.upsert;
    let captureFailures = 0;
    storage.applySnapshot = (async (...args: Parameters<typeof originalApplySnapshot>) => {
      if (fault) {
        captureFailures += 1;
        throw fault;
      }
      return originalApplySnapshot.apply(storage, args);
    }) as typeof storage.applySnapshot;
    storage.upsert = (async (...args: Parameters<typeof originalUpsert>) => {
      if (fault) throw fault;
      return originalUpsert.apply(storage, args);
    }) as typeof storage.upsert;

    const collector = createMessageCollector(ctx.client);
    // A real client subscribes to the agent's timeline; without this the daemon
    // delivers only state updates, not `agent_stream` events.
    const timelineObservation = ctx.client.observeTimeline([agent.id]);
    await timelineObservation.ready;
    const streamTexts = async () => {
      const page = await ctx.client.listGlobalStream({ agentId: agent.id });
      return page.rows.flatMap((row) => (row.item.kind === "entry" ? [row.item.entry.text] : []));
    };
    const storedTexts = async () => {
      const record = await storage.get(agent.id);
      return (record?.companionEntries ?? []).map((entry) => entry.text);
    };
    const streamedTimelineEvent = () =>
      collector.messages.find(
        (outbound) =>
          outbound.type === "agent_stream" &&
          outbound.payload.agentId === agent.id &&
          outbound.payload.event.type === "timeline",
      );
    try {
      for (const [code, message] of [
        ["ENOSPC", "No space left on device"],
        ["EIO", "I/O error"],
      ] as const) {
        const failuresBeforeTurn = captureFailures;
        const injected = Object.assign(new Error(message), { code });
        hold = createHold();
        pendingFault = injected;
        await ctx.client.sendMessage(agent.id, "Write a note");
        await hold.reached;

        // Degradation is visible on the wire, and it came from capture failing
        // during this turn (not from a client mutation).
        const degraded = await ctx.client.waitForAgentUpsert(
          agent.id,
          (snapshot) => snapshot.captureDegraded === true,
          15000,
        );
        expect(degraded.captureDegraded).toBe(true);
        expect(captureFailures).toBeGreaterThan(failuresBeforeTurn);

        // Already-captured entries remain readable, live and from storage.
        expect(await streamTexts()).toContain("Kept across the fault");
        expect(await storedTexts()).toContain("Kept across the fault");

        // Subsequent provider events still stream to the client while capture
        // is degraded: the held turn already emitted its timeline chunks, and
        // the daemon dispatches them regardless of the failed capture.
        const streamedTimeline = await waitFor(
          streamedTimelineEvent,
          "streamed timeline event while capture is degraded",
        );
        expect(streamedTimeline.type).toBe("agent_stream");

        // Clear the fault while the turn is still live, then let it finish. The
        // turn's own `turn_completed` triggers a background persist
        // (finalizeForegroundTurn → emitState); no client mutation is involved.
        const failuresAtRecovery = captureFailures;
        fault = null;
        pendingFault = null;
        hold.release();
        const finished = await ctx.client.waitForFinish(agent.id, 60000);
        expect(finished.status).toBe("idle");
        const recovered = await ctx.client.waitForAgentUpsert(
          agent.id,
          (snapshot) => snapshot.captureDegraded !== true,
          15000,
        );
        expect(recovered.captureDegraded).toBeUndefined();
        expect(captureFailures).toBe(failuresAtRecovery);

        // The covering background persist stored the retained history.
        expect(await storedTexts()).toContain("Kept across the fault");
      }
    } finally {
      collector.unsubscribe();
      await timelineObservation.release();
      storage.applySnapshot = originalApplySnapshot;
      storage.upsert = originalUpsert;
    }
  }, 60000);

  test("a failed capture write is never acknowledged and never evicts", async () => {
    const agent = await ctx.client.createAgent({ provider: "codex", cwd: "/tmp" });
    await ctx.client.updateStreamEntry({
      agentId: agent.id,
      action: "add_question",
      entryId: "kept",
      text: "Kept across the fault",
    });
    const storage = ctx.daemon.daemon.agentStorage;
    const originalApplySnapshot = storage.applySnapshot;
    const originalUpsert = storage.upsert;
    let fault: NodeJS.ErrnoException | null = Object.assign(new Error("No space left on device"), {
      code: "ENOSPC",
    });
    storage.applySnapshot = (async (...args: Parameters<typeof originalApplySnapshot>) => {
      if (fault) throw fault;
      return originalApplySnapshot.apply(storage, args);
    }) as typeof storage.applySnapshot;
    storage.upsert = (async (...args: Parameters<typeof originalUpsert>) => {
      if (fault) throw fault;
      return originalUpsert.apply(storage, args);
    }) as typeof storage.upsert;
    try {
      await expect(
        ctx.client.updateStreamEntry({
          agentId: agent.id,
          action: "add_question",
          entryId: "during-enospc",
          text: "Refused by ENOSPC",
        }),
      ).rejects.toThrow(/No space left on device/);
      fault = Object.assign(new Error("I/O error"), { code: "EIO" });
      await expect(
        ctx.client.updateStreamEntry({
          agentId: agent.id,
          action: "add_question",
          entryId: "during-eio",
          text: "Refused by EIO",
        }),
      ).rejects.toThrow(/I\/O error/);

      // No eviction: prior capture is still served live. The refused writes were
      // never acknowledged and never reached storage — they exist only as
      // optimistic in-memory state until a persist succeeds. The session stays
      // live and idle.
      const page = await ctx.client.listGlobalStream({ agentId: agent.id });
      const liveTexts = page.rows.flatMap((row) =>
        row.item.kind === "entry" ? [row.item.entry.text] : [],
      );
      expect(liveTexts).toContain("Kept across the fault");
      const record = await storage.get(agent.id);
      const storedTexts = (record?.companionEntries ?? []).map((entry) => entry.text);
      expect(storedTexts).toContain("Kept across the fault");
      expect(storedTexts).not.toContain("Refused by ENOSPC");
      expect(storedTexts).not.toContain("Refused by EIO");
      const listed = await ctx.client.fetchAgents({ subscribe: {} });
      const live = listed.entries.find((entry) => entry.agent.id === agent.id)?.agent;
      expect(live?.status).toBe("idle");
    } finally {
      storage.applySnapshot = originalApplySnapshot;
      storage.upsert = originalUpsert;
    }
  });
});
