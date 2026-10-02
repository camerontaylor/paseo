import { create } from "zustand";

type AgentView = "chat" | "artifacts";

interface AgentViewStoreState {
  selectedViews: Record<string, AgentView>;
  setSelectedView: (serverId: string, agentId: string, view: AgentView) => void;
  getSelectedView: (serverId: string, agentId: string) => AgentView;
}

// The source fork's reconciliation (#21) also tracks a per-agent `findOpen`
// overlay here for native chat Find. Find ships separately (TM-07); when it
// lands, restore its state alongside this store rather than widening the
// selected-view union.
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
}));
