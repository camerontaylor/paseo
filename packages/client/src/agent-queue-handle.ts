// FORK: the durable agent queue exists only in the camerontaylor/paseo fork, so upstream's
// `@getpaseo/client` has no equivalent. Keep this feature in this file and keep the wiring in
// `createAgentHandleFactory` to one line, so an upstream merge of `index.ts` stays a one-line seam.
import type { AgentQueueSnapshot, QueuedAgentDeliveryIntent } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "./daemon-client.js";

export type { AgentQueueSnapshot, QueuedAgentDeliveryIntent };

export class AgentQueueUnsupportedError extends Error {
  readonly code = "AGENT_QUEUE_UNSUPPORTED";
  readonly version: string | null;

  constructor(version: string | null) {
    super(
      `The host${version ? ` (v${version})` : ""} has no durable agent queue. Update the host to use agent.queue.`,
    );
    this.name = "AgentQueueUnsupportedError";
    this.version = version;
  }
}

export interface PaseoAgentQueueEnqueueOptions {
  /**
   * Caller-chosen id. Enqueueing an id that is still queued, is one of the agent's last 100
   * drained ids, or has a completed delivery receipt returns the current snapshot and queues
   * nothing. Outside those limits the id is forgotten and a repeat enqueue sends again; a deleted
   * non-voice item leaves no record, so re-enqueueing it after `remove` queues it anew.
   */
  itemId: string;
  text: string;
  intent: QueuedAgentDeliveryIntent;
}

/**
 * The user's composer queue for one agent. Items show in the user's UI, where the user can edit
 * or delete them, and delivery is FIFO: a failed item ahead of yours blocks yours.
 *
 * Every method rejects with `AgentQueueUnsupportedError` on a host without
 * `server_info.features.durableAgentQueueV1`. Daemon rejections surface as an `Error` whose
 * message is the machine-readable code, e.g. `queue_revision_conflict` for a stale
 * `expectedRevision`. An agent holds at most 50 queued items; enqueueing beyond that rejects.
 */
export interface PaseoAgentQueueHandle {
  enqueue(options: PaseoAgentQueueEnqueueOptions): Promise<AgentQueueSnapshot>;
  /** The queue with its `revision` and each item's `deliveryState`. */
  list(): Promise<AgentQueueSnapshot>;
  /** Removes an item. `expectedRevision` is the snapshot `revision` the caller last saw. */
  remove(itemId: string, expectedRevision: number): Promise<AgentQueueSnapshot>;
  /** Requeues an item whose delivery failed. `expectedRevision` is as for `remove`. */
  retry(itemId: string, expectedRevision: number): Promise<AgentQueueSnapshot>;
}

export function createAgentQueueHandle(
  daemonClient: DaemonClient,
  agentId: string,
): PaseoAgentQueueHandle {
  const gate = (): void => {
    daemonClient.ensureConnected();
    const serverInfo = daemonClient.getLastServerInfoMessage();
    if (serverInfo?.features?.durableAgentQueueV1 !== true) {
      throw new AgentQueueUnsupportedError(serverInfo?.version ?? null);
    }
  };
  // `async` turns a synchronous gate failure into a rejection, matching the other handle methods.
  return {
    enqueue: async ({ itemId, text, intent }) => {
      gate();
      return daemonClient.enqueueAgentMessage({ agentId, itemId, text, intent });
    },
    list: async () => {
      gate();
      return daemonClient.listQueuedAgentMessages(agentId);
    },
    remove: async (itemId, expectedRevision) => {
      gate();
      return daemonClient.deleteQueuedAgentMessage(agentId, itemId, expectedRevision);
    },
    retry: async (itemId, expectedRevision) => {
      gate();
      return daemonClient.retryQueuedAgentMessage(agentId, itemId, expectedRevision);
    },
  };
}
