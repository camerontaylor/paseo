import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";

export interface TabActivityState {
  lastActivityAt: number;
  unread: boolean;
}

/** The optional tab clock keeps cross-host View tabs with equal agent IDs independent. */
export function reconcileTabActivity(
  previous: Map<string, TabActivityState>,
  tabs: WorkspaceTabDescriptor[],
  activityByAgentId: Map<string, number>,
  viewedTabIds: Set<string>,
  activityByTabId?: Map<string, number>,
): Map<string, TabActivityState> {
  const next = new Map<string, TabActivityState>();
  for (const tab of tabs) {
    if (tab.target.kind !== "agent") continue;
    const timestamp =
      activityByTabId?.get(tab.tabId) ?? activityByAgentId.get(tab.target.agentId) ?? 0;
    const before = previous.get(tab.tabId);
    const viewed = viewedTabIds.has(tab.tabId);
    next.set(tab.tabId, {
      lastActivityAt: Math.max(timestamp, before?.lastActivityAt ?? 0),
      unread: viewed
        ? false
        : Boolean(
            before &&
            (before.unread || (before.lastActivityAt > 0 && timestamp > before.lastActivityAt)),
          ),
    });
  }
  return next;
}

export function sortTabsByActivity<T extends { tab: WorkspaceTabDescriptor }>(
  items: T[],
  activityByAgentId: Map<string, number>,
  activityByTabId?: Map<string, number>,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestamp = (entry: T) =>
        entry.tab.target.kind === "agent"
          ? (activityByTabId?.get(entry.tab.tabId) ??
            activityByAgentId.get(entry.tab.target.agentId) ??
            0)
          : 0;
      return timestamp(right.item) - timestamp(left.item) || left.index - right.index;
    })
    .map(({ item }) => item);
}
