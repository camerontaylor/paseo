import { describe, expect, test } from "vitest";
import { buildOutboxReportAgents } from "./outbox-report";
import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import type { PendingDirectSend } from "@/stores/queue-outbox-store/direct-model";

const queued = (overrides: Partial<PendingQueueEnqueue> = {}): PendingQueueEnqueue => ({
  serverId: "host",
  agentId: "agent",
  itemId: "q",
  text: "secret",
  intent: "queue",
  images: [],
  attachments: [],
  composerAttachments: [],
  createdAt: 1000,
  attempts: 0,
  ...overrides,
});
const direct = (overrides: Partial<PendingDirectSend> = {}): PendingDirectSend => ({
  serverId: "host",
  agentId: "agent",
  clientMessageId: "d",
  text: "secret",
  images: [],
  attachments: [],
  createdAt: 2000,
  attempts: 0,
  ...overrides,
});

describe("device outbox report", () => {
  test("counts pending, failed, and uncertain without exposing prompt text", () => {
    const report = buildOutboxReportAgents({
      serverId: "host",
      agentIds: ["agent", "empty"],
      queued: [
        queued(),
        queued({ itemId: "f", failedAt: 3000 }),
        queued({ itemId: "removed", removalRequested: true }),
      ],
      direct: [
        direct({ rejectedError: "agent_request_outcome_unknown" }),
        direct({ clientMessageId: "refused", rejectedError: "agent archived" }),
      ],
    });
    expect(report).toEqual([
      {
        agentId: "agent",
        pending: 1,
        failed: 2,
        uncertain: 1,
        oldestCreatedAt: new Date(1000).toISOString(),
      },
      { agentId: "empty", pending: 0, failed: 0, uncertain: 0, oldestCreatedAt: null },
    ]);
    expect(JSON.stringify(report)).not.toContain("secret");
  });
  test("never mixes hosts", () => {
    expect(
      buildOutboxReportAgents({
        serverId: "other",
        agentIds: [],
        queued: [queued()],
        direct: [direct()],
      }),
    ).toEqual([]);
  });
});
