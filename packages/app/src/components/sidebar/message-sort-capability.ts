import type { SidebarSortMode } from "./sidebar-filter-sort";

export function messageSortAvailability(
  hosts: readonly (boolean | undefined)[],
): "ready" | "loading" | "unsupported" {
  if (hosts.some((support) => support === false)) return "unsupported";
  if (!hosts.length || hosts.some((support) => support === undefined)) return "loading";
  return "ready";
}

export function effectiveSidebarSortMode(
  mode: SidebarSortMode,
  availability: ReturnType<typeof messageSortAvailability>,
): SidebarSortMode {
  if ((mode === "recent" || mode === "user") && availability !== "ready") return "manual";
  return mode;
}
