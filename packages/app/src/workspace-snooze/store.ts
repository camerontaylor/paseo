import { create } from "zustand";
import type { WorkspaceSnooze } from "@getpaseo/protocol/workspace-snooze";
import { useSessionStore } from "@/stores/session-store";

export interface SnoozeTarget {
  serverId: string;
  workspaceId: string;
  name: string;
  snooze: WorkspaceSnooze | null;
}
export const useSnoozeDialog = create<{ target: SnoozeTarget | null; close: () => void }>(
  (set) => ({
    target: null,
    close: () => set({ target: null }),
  }),
);
export function openWorkspaceSnooze(serverId: string, workspaceId: string): void {
  const workspace = useSessionStore.getState().sessions[serverId]?.workspaces.get(workspaceId);
  if (!workspace) return;
  useSnoozeDialog.setState({
    target: { serverId, workspaceId, name: workspace.name, snooze: workspace.snooze ?? null },
  });
}
