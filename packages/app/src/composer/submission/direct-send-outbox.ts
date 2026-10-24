import type { DirectSendOutbox } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useSessionStore } from "@/stores/session-store";
import {
  awaitOutboxHydration,
  flushDirectOutboxForServer,
  supportsDurableDirectSend,
  useQueueOutboxStore,
  type PendingDirectSend,
} from "@/stores/queue-outbox-store";
import type { SendOutboxFlushClient } from "@/stores/queue-outbox-store/direct-model";

export function createDirectSendAcceptanceHandler(serverId: string) {
  return (entry: PendingDirectSend, result: { queued: boolean }) => {
    const writer = createMessageSubmissionWriter(serverId);
    if (result.queued) writer.reject(entry.agentId, entry.clientMessageId);
    else writer.accept(entry.agentId, entry.clientMessageId);
  };
}

export function createDirectSendOutbox(
  serverId: string,
  client: SendOutboxFlushClient,
): DirectSendOutbox | undefined {
  const serverInfo = useSessionStore.getState().sessions[serverId]?.serverInfo;
  const supported = serverInfo
    ? supportsDurableDirectSend(serverInfo.features)
    : useQueueOutboxStore.getState().durableHosts[serverId] === true;
  if (!supported) return undefined;
  return {
    serverId,
    add: (entry) => useQueueOutboxStore.getState().addDirect(entry),
    flush: (agentId) =>
      flushDirectOutboxForServer({
        serverId,
        agentId,
        client,
        onAccepted: createDirectSendAcceptanceHandler(serverId),
      }),
    get: (clientMessageId) => useQueueOutboxStore.getState().directEntries[clientMessageId],
    remove: (clientMessageId) =>
      useQueueOutboxStore.getState().removeDirectDurably(clientMessageId),
  };
}

/** Read remembered host capability only after the durable outbox has hydrated. */
export async function prepareDirectSendOutbox(
  serverId: string,
  client: SendOutboxFlushClient,
): Promise<DirectSendOutbox | undefined> {
  await awaitOutboxHydration();
  return createDirectSendOutbox(serverId, client);
}
