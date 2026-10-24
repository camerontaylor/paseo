import { dispatchComposerAgentMessage, type DirectSendOutbox } from "@/composer/actions";
import { prepareDirectSendOutbox } from "@/composer/submission/direct-send-outbox";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { flushQueueOutboxForServer, useQueueOutboxStore } from "@/stores/queue-outbox-store";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { generateMessageId } from "@/types/stream";
import {
  planBroadcast,
  type BroadcastPlanEntry,
  type BroadcastTarget,
} from "@/views/broadcast-plan";

export interface BroadcastResult {
  sent: number;
  queued: number;
  skipped: number;
  failed: number;
  /** Recipients with no admitted message. Only these are safe to retry. */
  retryTargets: BroadcastTarget[];
}

export function planBroadcastForCurrentState(targets: BroadcastTarget[]): BroadcastPlanEntry[] {
  const runtime = getHostRuntimeStore();
  const sessions = useSessionStore.getState().sessions;
  return planBroadcast(targets, {
    isConnected: (serverId) =>
      Boolean(runtime.getClient(serverId)) && isHostRuntimeConnected(runtime.getSnapshot(serverId)),
    isBusy: (target) =>
      selectAgentTurnPresentation(sessions[target.serverId], target.agentId).isActive,
    supportsQueue: (serverId) =>
      sessions[serverId]?.serverInfo?.features?.durableAgentQueueV1 === true,
  });
}

export async function runBroadcast(
  text: string,
  plan: BroadcastPlanEntry[],
): Promise<BroadcastResult> {
  const result: BroadcastResult = { sent: 0, queued: 0, skipped: 0, failed: 0, retryTargets: [] };
  const trimmed = text.trim();
  if (!trimmed) return result;
  const runtime = getHostRuntimeStore();
  const queuedServers = new Set<string>();

  await Promise.all(
    plan.map(async (entry) => {
      const client = runtime.getClient(entry.serverId);
      if (entry.delivery === "skip" || !client) {
        result.skipped += 1;
        result.retryTargets.push({ serverId: entry.serverId, agentId: entry.agentId });
        return;
      }
      let directOutbox: DirectSendOutbox | undefined;
      let clientMessageId: string | null = null;
      try {
        if (entry.delivery === "send") {
          const preparedOutbox = await prepareDirectSendOutbox(entry.serverId, client);
          directOutbox = preparedOutbox;
          const observedOutbox: DirectSendOutbox | undefined = preparedOutbox
            ? {
                ...preparedOutbox,
                add: async (pending) => {
                  clientMessageId = pending.clientMessageId;
                  await preparedOutbox.add(pending);
                },
              }
            : undefined;
          await dispatchComposerAgentMessage({
            client,
            agentId: entry.agentId,
            text: trimmed,
            attachments: [],
            encodeImages: async () => undefined,
            submission: createMessageSubmissionWriter(entry.serverId),
            outbox: observedOutbox,
          });
          // An uncertain delivery remains in the durable outbox for retry. Report it as
          // queued, never as sent, until the host confirms admission.
          if (clientMessageId && directOutbox?.get(clientMessageId)) {
            result.queued += 1;
          } else {
            result.sent += 1;
          }
          return;
        }
        await useQueueOutboxStore.getState().add({
          serverId: entry.serverId,
          agentId: entry.agentId,
          itemId: generateMessageId(),
          text: trimmed,
          intent: "queue",
          images: [],
          attachments: [],
          composerAttachments: [],
        });
        queuedServers.add(entry.serverId);
        result.queued += 1;
      } catch {
        // A flush can fail after the durable add. Its retained intent will retry with the
        // same id; sending it again from this modal would create a second prompt.
        if (clientMessageId && directOutbox?.get(clientMessageId)) {
          result.queued += 1;
        } else {
          result.failed += 1;
          result.retryTargets.push({ serverId: entry.serverId, agentId: entry.agentId });
        }
      }
    }),
  );

  await Promise.all(
    [...queuedServers].map(async (serverId) => {
      const client = runtime.getClient(serverId);
      if (!client) return;
      await flushQueueOutboxForServer({
        serverId,
        client,
        applySnapshot: (snapshot) =>
          useSessionStore.getState().applyAgentQueueSnapshot(serverId, snapshot),
      }).catch(() => undefined);
    }),
  );
  return result;
}
