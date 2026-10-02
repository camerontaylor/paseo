import { create } from "zustand";

interface AgentViewStoreState {
  /**
   * Find is an overlay on Chat, not a sibling view, so it is tracked separately.
   * Keyed by `${serverId}:${agentId}` because the tab menu opens it for an agent
   * the panel may not be mounted for yet.
   */
  findOpen: Record<string, boolean>;
  setFindOpen: (serverId: string, agentId: string, open: boolean) => void;
}

export const useAgentViewStore = create<AgentViewStoreState>()((set) => ({
  findOpen: {},
  setFindOpen: (serverId, agentId, open) => {
    set((state) => ({
      findOpen: {
        ...state.findOpen,
        [`${serverId}:${agentId}`]: open,
      },
    }));
  },
}));
