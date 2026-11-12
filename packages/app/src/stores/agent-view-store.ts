import { create } from "zustand";

type AgentView = "chat" | "artifacts";

interface AgentViewStoreState {
  selectedViews: Record<string, AgentView>;
  setSelectedView: (serverId: string, agentId: string, view: AgentView) => void;
  getSelectedView: (serverId: string, agentId: string) => AgentView;
  /**
   * Find is an overlay on Chat, not a sibling view, so it is tracked separately.
   * Keyed by `${serverId}:${agentId}` because the tab menu opens it for an agent
   * the panel may not be mounted for yet.
   */
  findOpen: Record<string, boolean>;
  setFindOpen: (serverId: string, agentId: string, open: boolean) => void;
}

// Find state and the Chat/Artifacts selection have separate lifetimes and keys.
export const useAgentViewStore = create<AgentViewStoreState>()((set, get) => ({
  selectedViews: {},
  setSelectedView: (serverId, agentId, view) => {
    set((state) => ({
      selectedViews: {
        ...state.selectedViews,
        [`${serverId}:${agentId}`]: view,
      },
    }));
  },
  getSelectedView: (serverId, agentId) => {
    return get().selectedViews[`${serverId}:${agentId}`] || "chat";
  },
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
