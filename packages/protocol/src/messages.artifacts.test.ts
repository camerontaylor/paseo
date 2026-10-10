import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CompanionEntrySchema } from "./companion-stream.js";
import {
  AgentSnapshotPayloadSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("agent artifact snapshots", () => {
  it("accepts additive per-agent artifacts", () => {
    const snapshot = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      model: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:01:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: "Artifacts",
      labels: {},
      artifacts: [
        {
          path: "report.html",
          name: "report.html",
          kind: "html",
          mimeType: "text/html",
          size: 42,
          createdAt: "2026-07-22T00:00:30.000Z",
          updatedAt: "2026-07-22T00:00:30.000Z",
        },
      ],
    });

    expect(snapshot.artifacts?.[0]?.path).toBe("report.html");
    expect(snapshot.companionEntries).toBeUndefined();
    const upgraded = {
      ...snapshot,
      companionEntries: [
        {
          id: "turn:one",
          kind: "outcome",
          status: "completed",
          text: "Report is ready",
          timestamp: "2026-09-21T12:00:00.000Z",
          truncated: false,
        },
      ],
    };
    expect(AgentSnapshotPayloadSchema.parse(upgraded).companionEntries).toEqual(
      upgraded.companionEntries,
    );
    // The previous wire shape ignores the additive field and still parses the snapshot.
    expect(AgentSnapshotPayloadSchema.omit({ companionEntries: true }).parse(upgraded)).toEqual(
      snapshot,
    );
  });
});

// COMPAT(globalStream): added in v0.11.1-fork (C2), remove after 2027-04-06.
// Old-client compatibility proof for the enriched existing push path: a frozen
// released question schema parses an ask-bearing entry and strips `ask`. The
// new stream.* response types have no frozen-union proof by design (an old
// outbound union cannot recognize them); the daemon proves instead that
// capability-absent sessions never receive them.
it("keeps tracked asks readable by the previous question schema", () => {
  const oldQuestion = z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    truncated: z.boolean(),
    kind: z.literal("question"),
    status: z.enum(["open", "reviewed", "done", "reply_sent"]),
  });
  const entry = {
    id: "ask:deploy",
    timestamp: "2026-10-07T12:00:00Z",
    text: "Deploy",
    truncated: false,
    kind: "question",
    status: "open",
    ask: {
      state: "blocked",
      evidence: "Tests passed",
      remaining: "Approval",
      revision: 1,
      provenance: "explicit",
    },
  };
  expect(oldQuestion.parse(entry)).toEqual({
    id: entry.id,
    timestamp: entry.timestamp,
    text: "Deploy",
    truncated: false,
    kind: "question",
    status: "open",
  });
  expect(CompanionEntrySchema.parse(oldQuestion.parse(entry)).ask).toBeUndefined();
  expect(CompanionEntrySchema.parse(entry).ask).toMatchObject({ state: "blocked", revision: 1 });
});

it("parses the stream RPCs and keeps the question status enum closed", () => {
  expect(
    SessionInboundMessageSchema.parse({
      type: "stream.list.request",
      requestId: "page",
      agentId: "parent",
      asksOnly: true,
      limit: 50,
    }),
  ).toMatchObject({ agentId: "parent", asksOnly: true });
  expect(
    SessionInboundMessageSchema.parse({
      type: "stream.entry.update.request",
      requestId: "write",
      agentId: "parent",
      entryId: "deploy",
      action: "set_ask",
      text: "Deploy",
      expectedRevision: 0,
      ask: { state: "blocked", evidence: "Tests passed", remaining: "Approval" },
    }),
  ).toMatchObject({ action: "set_ask", ask: { state: "blocked" } });
  expect(
    SessionOutboundMessageSchema.parse({
      type: "stream.list.response",
      payload: { requestId: "page", rows: [], nextCursor: null, error: null },
    }).payload.nextCursor,
  ).toBeNull();
  // The richer ask state never widens the mirrored question status.
  expect(() =>
    CompanionEntrySchema.parse({
      id: "ask:x",
      timestamp: "2026-10-07T12:00:00Z",
      text: "Deploy",
      truncated: false,
      kind: "question",
      status: "in_progress",
      ask: {
        state: "in_progress",
        remaining: "",
        evidence: "",
        revision: 1,
        provenance: "explicit",
      },
    }),
  ).toThrow();
});

it("gates the stream features on optional flags an old daemon never sets", () => {
  const oldDaemon = ServerInfoStatusPayloadSchema.parse({
    status: "server_info",
    protocolVersion: 1,
    serverId: "server-1",
  });
  expect(oldDaemon.features?.globalStream).toBeUndefined();
  expect(oldDaemon.features?.trackedAsks).toBeUndefined();
  expect(oldDaemon.features?.companionStreamPortV1).toBeUndefined();
});
