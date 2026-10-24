import { create } from "zustand";
import { sideConversationKey } from "@/side-conversations/store";

export type ThreadOriginNavigationStatus = "pending" | "opened" | "unavailable" | "failed";

export interface ThreadOriginNavigationRequest {
  requestId: number;
  serverId: string;
  parentAgentId: string;
  threadId: string;
  anchor: string;
}

interface ThreadOriginNavigationState {
  requestsByAgent: Readonly<Record<string, ThreadOriginNavigationRequest>>;
  statusByThread: Readonly<
    Record<string, { requestId: number; status: ThreadOriginNavigationStatus }>
  >;
  request(input: Omit<ThreadOriginNavigationRequest, "requestId">): number;
  resolve(input: {
    serverId: string;
    parentAgentId: string;
    threadId: string;
    requestId: number;
    status: Exclude<ThreadOriginNavigationStatus, "pending">;
  }): void;
}

let nextRequestId = 0;

export function threadOriginAgentKey(serverId: string, parentAgentId: string): string {
  return `${serverId}\0${parentAgentId}`;
}

export const useThreadOriginNavigationStore = create<ThreadOriginNavigationState>()((set) => ({
  requestsByAgent: {},
  statusByThread: {},
  request(input) {
    nextRequestId += 1;
    const request = { ...input, requestId: nextRequestId };
    const key = threadOriginAgentKey(input.serverId, input.parentAgentId);
    set((state) => ({
      requestsByAgent: { ...state.requestsByAgent, [key]: request },
      statusByThread: {
        ...state.statusByThread,
        [sideConversationKey(input.serverId, input.parentAgentId, input.threadId)]: {
          requestId: request.requestId,
          status: "pending",
        },
      },
    }));
    return request.requestId;
  },
  resolve(input) {
    const key = threadOriginAgentKey(input.serverId, input.parentAgentId);
    const threadKey = sideConversationKey(input.serverId, input.parentAgentId, input.threadId);
    set((state) => {
      if (state.statusByThread[threadKey]?.requestId !== input.requestId) return state;
      const requestsByAgent = { ...state.requestsByAgent };
      if (requestsByAgent[key]?.requestId === input.requestId) delete requestsByAgent[key];
      return {
        requestsByAgent,
        statusByThread: {
          ...state.statusByThread,
          [threadKey]: { requestId: input.requestId, status: input.status },
        },
      };
    });
  },
}));
