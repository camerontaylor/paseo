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
  requireExisting?: boolean;
  client: QueueOutboxFlushClient;
  isHostEligible: () => boolean;
  outbox: {
    getEntry: (itemId: string) => Promise<PendingQueueEnqueue | undefined>;
    markRoutingDispatched: (itemId: string) => Promise<void>;
    add: (entry: Omit<PendingQueueEnqueue, "createdAt" | "attempts">) => Promise<void>;
    removeDurably: (itemId: string, preserveRemovalIntent?: boolean) => Promise<void>;
    acknowledge: (itemId: string, snapshot: AgentQueueSnapshot) => Promise<boolean>;
  };
  applySnapshot: (snapshot: AgentQueueSnapshot) => void;
}

export async function deliverRoutedPrompt(input: RouteDeliveryInput): Promise<{ queued: boolean }> {
  const { recipient, text, itemId } = input;
  return serializeQueueOperation(
    JSON.stringify(["dispatch", recipient.serverId, recipient.agentId]),
    async () => {
      const existing = await input.outbox.getEntry(itemId);
      if (existing?.removalRequested || (input.requireExisting && !existing))
        throw new Error("Delivery canceled or no longer pending.");
      const enqueue = existing ?? {
        serverId: recipient.serverId,
        agentId: recipient.agentId,
        itemId,
        text,
        expectedWorkspaceId: recipient.workspaceId,
        expectedProjectId: recipient.projectId,
        routingOrigin: true,
        routingDispatchHeld: true,
        routingDraftVersion: input.draftVersion,
        routingDraftUpdatedAt: input.draftUpdatedAt,
        images: [],
        attachments: [],
        composerAttachments: [],
      };
      if (!existing) await input.outbox.add(enqueue);
      const current = await input.outbox.getEntry(itemId);
      if (!current || current.removalRequested)
        throw new Error("Delivery cancellation is pending.");
      if (!input.isHostEligible()) {
        if (!existing) await input.outbox.removeDurably(itemId);
        throw new Error("The selected host was excluded. Choose a destination again.");
      }
      let snapshot: AgentQueueSnapshot;
      try {
        const request = input.client.enqueueAgentMessage(enqueue);
        const marker = input.outbox.markRoutingDispatched(itemId).catch(() => {});
        const outcome = await Promise.allSettled([request, marker]);
        if (outcome[0].status === "rejected") throw outcome[0].reason;
        snapshot = outcome[0].value;
      } catch (error) {
        if (error instanceof AgentQueueDestinationChangedError)
          await input.outbox.removeDurably(itemId);
        throw error;
      }
      const acknowledged = await input.outbox.acknowledge(itemId, snapshot);
      if (!acknowledged || (await input.outbox.getEntry(itemId))?.removalRequested)
        throw new Error("Delivery cancellation is pending.");
      input.applySnapshot(snapshot);
      await input.outbox.removeDurably(itemId, true);
      if ((await input.outbox.getEntry(itemId))?.removalRequested)
        throw new Error("Delivery cancellation is pending.");
      return { queued: snapshot.items.some((item) => item.id === itemId) };
    },
  );
}
