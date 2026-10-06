import { useCallback, useMemo, useState } from "react";
import { selectSnoozableGroup } from "@/workspace-snooze/sidebar";
import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";

// FORK(workspace-snooze): hidden rows remain reachable even below the ordinary limit.
export function useLimitedSidebarGroup<T extends SidebarWorkspacePlacement>(
  items: readonly T[],
  entries?: ReadonlyMap<string, SidebarWorkspacePlacement>,
) {
  const [expanded, setExpanded] = useState(false);
  const { visibleItems, canToggle } = useMemo(
    () => selectSnoozableGroup(items, expanded, entries),
    [expanded, items, entries],
  );
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  return { visibleItems, expanded, canToggle, toggleExpanded };
}
