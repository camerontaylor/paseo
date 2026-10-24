import {
  queueComposerMessageOnServer,
  type QueueComposerMessageOnServerInput,
} from "@/composer/actions";
import type { Recipient } from "./model";

export interface RoutedHostFeatures {
  sessionSearch?: boolean;
  routedQueueAdmission?: boolean;
  durableAgentQueueV1?: boolean;
}

const ROUTE_ERROR_MESSAGES = {
  host: "Update or reconnect the selected host before routing this prompt.",
  destination: "The selected chat moved or is no longer available. Choose a destination again.",
  persist: "The prompt could not be saved for delivery. It remains in your draft.",
} as const;

export class RoutedQueueUnavailableError extends Error {
  constructor(reason: keyof typeof ROUTE_ERROR_MESSAGES) {
    super(ROUTE_ERROR_MESSAGES[reason]);
    this.name = "RoutedQueueUnavailableError";
  }
}

/** A route is explicit queue-only delivery to an exact host, agent, workspace, and project. */
export async function queueRoutedPrompt(
  input: Omit<QueueComposerMessageOnServerInput, "agentId" | "text" | "attachments" | "itemId"> & {
    recipient: Recipient;
    text: string;
    itemId: string;
    features: RoutedHostFeatures | undefined;
    isHostEligible: () => boolean;
    isDestinationCurrent: () => boolean;
  },
): Promise<{ itemId: string }> {
  if (
    !input.isHostEligible() ||
    input.features?.sessionSearch !== true ||
    input.features?.routedQueueAdmission !== true ||
    input.features?.durableAgentQueueV1 !== true
  ) {
    throw new RoutedQueueUnavailableError("host");
  }
  if (!input.isDestinationCurrent() || !input.recipient.workspaceId || !input.recipient.projectId) {
    throw new RoutedQueueUnavailableError("destination");
  }
  const outcome = await queueComposerMessageOnServer({
    ...input,
    agentId: input.recipient.agentId,
    text: input.text,
    attachments: [],
    itemId: input.itemId,
    expectedWorkspaceId: input.recipient.workspaceId,
    expectedProjectId: input.recipient.projectId,
  });
  if (!outcome.queued || outcome.queued.id !== input.itemId) {
    const error = new RoutedQueueUnavailableError("persist");
    if (outcome.error) error.cause = new Error(outcome.error);
    throw error;
  }
  // This resolves after the durable local write, before host acknowledgement.
  // The UI retains the draft and pending receipt until the host ACK removes the outbox entry.
  return { itemId: input.itemId };
}
