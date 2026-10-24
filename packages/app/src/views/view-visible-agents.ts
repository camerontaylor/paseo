import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { collectAllPanes, type WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";

/** Agent ids on screen in a View (each pane's active tab), grouped by host. */
export function selectViewVisibleAgentIds(
  layout: WorkspaceLayout,
  tabs: WorkspaceTab[],
): Map<string, string[]> {
  const byServer = new Map<string, Set<string>>();
  for (const pane of collectAllPanes(layout.root)) {
    if (pane.hidden) continue;
    const active = deriveWorkspacePaneState({ pane, tabs }).activeTab?.descriptor;
    if (active?.target.kind !== "agent" || !active.scope) continue;
    const ids = byServer.get(active.scope.serverId) ?? new Set<string>();
    ids.add(active.target.agentId);
    byServer.set(active.scope.serverId, ids);
  }
  return new Map([...byServer].map(([serverId, ids]) => [serverId, [...ids].sort()]));
}
