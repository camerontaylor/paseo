import { createQueueOutboxFlushClient, type ComposerQueueClient } from "@/composer/actions";
import { useSessionStore } from "@/stores/session-store";
import type { QueueOutboxFlushClient } from "@/stores/queue-outbox-store/model";

/**
 * The one flush-client construction point for server-scoped dispatches — the
 * reconnect flush, the composer's flush, and explicit retries all use it.
 * Revisions resolve and conflicts refresh BY THE DISPATCHED AGENT, so an
 * outbox holding entries for several agents never judges one agent's queue
 * with another agent's revision (a stale mismatch would burn conflict
 * reservations on dispatches that were never stale).
 */
export function createServerQueueFlushClient(input: {
  client: ComposerQueueClient;
  serverId: string;
}): QueueOutboxFlushClient {
  return createQueueOutboxFlushClient({
    client: input.client,
    getAppliedRevision: (agentId) =>
      useSessionStore.getState().sessions[input.serverId]?.queuedMessageRevisions.get(agentId) ?? 0,
    onRevisionConflict: async (agentId) => {
      const snapshot = await input.client.listQueuedAgentMessages(agentId);
      await useSessionStore.getState().applyAgentQueueSnapshot(input.serverId, snapshot);
    },
  });
}
