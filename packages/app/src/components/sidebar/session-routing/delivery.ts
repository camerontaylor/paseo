import type { AgentQueueSnapshot } from "@getpaseo/protocol/messages";
import type {
  PendingQueueEnqueue,
  QueueOutboxFlushClient,
} from "@/stores/queue-outbox-store/model";
import { serializeQueueOperation } from "@/stores/queue-outbox-store/model";
import type { Recipient } from "./model";
import { AgentQueueDestinationChangedError } from "@getpaseo/client/internal/daemon-client";

export interface RouteDeliveryInput {
  recipient: Recipient;
  text: string;
  itemId: string;
  draftVersion: number;
  draftUpdatedAt?: number;
  client: QueueOutboxFlushClient;
  outbox: {
    add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
    removeDurably: (itemId: string, preserveRemovalIntent?: boolean) => Promise<void>;
    acknowledge: (itemId: string, snapshot: AgentQueueSnapshot) => Promise<void>;
  };
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

export async function deliverRoutedPrompt(input: RouteDeliveryInput): Promise<{ queued: boolean }> {
  const { recipient, text, itemId } = input;
  return serializeQueueOperation(
    JSON.stringify(["dispatch", recipient.serverId, recipient.agentId]),
    async () => {
      const enqueue = {
        serverId: recipient.serverId,
        agentId: recipient.agentId,
        itemId,
        text,
        expectedWorkspaceId: recipient.workspaceId,
        expectedProjectId: recipient.projectId,
        routingOrigin: true,
        routingDraftVersion: input.draftVersion,
        routingDraftUpdatedAt: input.draftUpdatedAt,
        images: [],
        attachments: [],
        composerAttachments: [],
      };
      await input.outbox.add(enqueue);
      let snapshot: AgentQueueSnapshot;
      try {
        snapshot = await input.client.enqueueAgentMessage(enqueue);
      } catch (error) {
        if (error instanceof AgentQueueDestinationChangedError)
          await input.outbox.removeDurably(itemId);
        throw error;
      }
      await input.outbox.acknowledge(itemId, snapshot);
      input.applySnapshot(snapshot);
      await input.outbox.removeDurably(itemId, true);
      return { queued: snapshot.items.some((item) => item.id === itemId) };
    },
  );
}
