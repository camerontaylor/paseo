import {
  parseServerInfoStatusPayload,
  type ServerInfoStatusPayload,
} from "@getpaseo/protocol/messages";

export type ServerInfoFeatures = ServerInfoStatusPayload["features"];

export interface OutboxReconnectClient {
  readonly isConnected: boolean;
  getLastServerInfoMessage: () => ServerInfoStatusPayload | null;
}

/** Raw server_info precedes owned feed registration on connect. */
export function startOutboxReconnectFlush(input: {
  client: OutboxReconnectClient;
  subscribeStatus: (handler: (payload: unknown) => void) => () => void;
  flush: (features: ServerInfoStatusPayload["features"]) => void;
}): () => void {
  const unsubscribe = input.subscribeStatus((payload) => {
    const info = parseServerInfoStatusPayload(payload);
    if (info) input.flush(info.features);
  });
  if (input.client.isConnected) {
    const info = input.client.getLastServerInfoMessage();
    if (info) input.flush(info.features);
  }
  return unsubscribe;
}
