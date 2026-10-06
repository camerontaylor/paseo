import type { WorkspaceSnooze } from "@getpaseo/protocol/workspace-snooze";

interface Snoozable {
  workspaceKey: string;
  snooze?: WorkspaceSnooze | null;
}
export function selectSnoozableGroup<T extends Snoozable>(
  items: readonly T[],
  expanded: boolean,
  entries?: ReadonlyMap<string, Snoozable>,
) {
  const awake: T[] = [];
  const snoozed: T[] = [];
  for (const item of items) {
    const snooze = entries ? entries.get(item.workspaceKey)?.snooze : item.snooze;
    (snooze ? snoozed : awake).push(item);
  }
  return {
    visibleItems: expanded ? [...awake, ...snoozed] : awake.slice(0, 20),
    canToggle: snoozed.length > 0 || awake.length > 20,
  };
}
