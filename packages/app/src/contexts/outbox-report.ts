import type { PendingQueueEnqueue } from "@/stores/queue-outbox-store/model";
import {
  isUncertainSendOutcome,
  SEND_OUTBOX_MAX_ATTEMPTS,
  type PendingDirectSend,
} from "@/stores/queue-outbox-store/direct-model";

export interface OutboxReportAgent {
  agentId: string;
  pending: number;
  failed: number;
  uncertain: number;
  oldestCreatedAt: string | null;
}

/** Reports counts only. Agent ids include prior reports so clearing an outbox sends zero. */
export function buildOutboxReportAgents(input: {
  serverId: string;
  agentIds: readonly string[];
  queued: readonly PendingQueueEnqueue[];
  direct: readonly PendingDirectSend[];
}): OutboxReportAgent[] {
  const agents = new Map<
    string,
    { pending: number; failed: number; uncertain: number; oldest: number | null }
  >();
  const ensure = (id: string) => {
    let counts = agents.get(id);
    if (!counts) {
      counts = { pending: 0, failed: 0, uncertain: 0, oldest: null };
      agents.set(id, counts);
    }
    return counts;
  };
  for (const id of input.agentIds) ensure(id);
  const add = (id: string, state: "pending" | "failed" | "uncertain", at: number) => {
    const counts = ensure(id);
    counts[state] += 1;
    counts.oldest = Math.min(counts.oldest ?? at, at);
  };
  for (const entry of input.queued) {
    if (entry.serverId !== input.serverId || entry.removalRequested) continue;
    add(entry.agentId, entry.failedAt !== undefined ? "failed" : "pending", entry.createdAt);
  }
  for (const entry of input.direct) {
    if (entry.serverId !== input.serverId) continue;
    let state: "pending" | "failed" | "uncertain" = "pending";
    if (isUncertainSendOutcome(entry.rejectedError)) state = "uncertain";
    else if (entry.rejectedError !== undefined || entry.attempts >= SEND_OUTBOX_MAX_ATTEMPTS)
      state = "failed";
    add(entry.agentId, state, entry.createdAt);
  }
  return [...agents].map(([agentId, counts]) => ({
    agentId,
    pending: counts.pending,
    failed: counts.failed,
    uncertain: counts.uncertain,
    oldestCreatedAt: counts.oldest === null ? null : new Date(counts.oldest).toISOString(),
  }));
}
