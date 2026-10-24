import { useMemo, useSyncExternalStore } from "react";
import { joinSubtitleParts } from "@/command-center/results";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import { navigationHistoryStore } from "./store";
import { buildRecentSessionRows, type RecentSessionRow } from "./recent-sessions";
import { recentSessionsFromVisits } from "./recent-workspaces";

export function useRecentVisits() {
  return useSyncExternalStore(
    navigationHistoryStore.subscribe,
    navigationHistoryStore.getRecentVisits,
    navigationHistoryStore.getRecentVisits,
  );
}

export function useFocusedAgent(): { serverId: string; agentId: string } | null {
  const state = useSyncExternalStore(
    navigationHistoryStore.subscribe,
    navigationHistoryStore.getState,
    navigationHistoryStore.getState,
  );
  const current = state.entries[state.index];
  return useMemo(
    () =>
      current?.kind === "workspace" && current.target?.kind === "agent"
        ? { serverId: current.serverId, agentId: current.target.agentId }
        : null,
    [current],
  );
}

/** Mount only while the menu is open; the session map is a live subscription. */
export function useRecentSessionRows(limit?: number): RecentSessionRow[] {
  const visits = useRecentVisits();
  const sessions = useSessionStore((state) => state.sessions);
  const current = useFocusedAgent();
  return useMemo(
    () =>
      buildRecentSessionRows({
        sessions: recentSessionsFromVisits(visits),
        current,
        limit,
        agentInfo: (serverId, agentId) => {
          const agent = sessions[serverId]?.agents.get(agentId);
          if (!agent) return null;
          const liveWorkspace = selectWorkspace({ sessions }, serverId, agent.workspaceId ?? null);
          if (!liveWorkspace || liveWorkspace.archivingAt) return null;
          return {
            title: agent.title,
            workspaceId: liveWorkspace.id,
            provider: agent.provider,
            status: agent.status,
            requiresAttention: Boolean(agent.requiresAttention),
            attentionReason: agent.attentionReason ?? null,
            pendingPermissionCount: agent.pendingPermissions.length,
            archived: Boolean(agent.archivedAt),
          };
        },
        breadcrumb: (serverId, workspaceId) => {
          const workspace = selectWorkspace({ sessions }, serverId, workspaceId);
          return workspace
            ? joinSubtitleParts([
                workspace.projectCustomName ?? workspace.projectDisplayName,
                workspace.title ?? workspace.name,
              ])
            : "";
        },
      }),
    [current, limit, sessions, visits],
  );
}
