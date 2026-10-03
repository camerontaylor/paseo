import type { WorkspaceTab } from "@/workspace-tabs/model";

export interface BroadcastTarget {
  serverId: string;
  agentId: string;
}

export type BroadcastDelivery = "send" | "queue" | "skip";

export interface BroadcastPlanEntry extends BroadcastTarget {
  delivery: BroadcastDelivery;
}

/** Every distinct agent shown in a View, in tab order. */
export function collectBroadcastTargets(tabs: WorkspaceTab[]): BroadcastTarget[] {
  const seen = new Set<string>();
  const targets: BroadcastTarget[] = [];
  for (const tab of tabs) {
    if (tab.target.kind !== "agent" || !tab.scope) continue;
    const key = `${tab.scope.serverId}:${tab.target.agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ serverId: tab.scope.serverId, agentId: tab.target.agentId });
  }
  return targets;
}

/**
 * Idle agents get the prompt now. Busy agents get it through the host's durable queue so a
 * broadcast never interrupts or steers a running turn; hosts without a queue, or offline
 * hosts, are skipped.
 */
export function planBroadcast(
  targets: BroadcastTarget[],
  host: {
    isConnected: (serverId: string) => boolean;
    isBusy: (target: BroadcastTarget) => boolean;
    supportsQueue: (serverId: string) => boolean;
  },
): BroadcastPlanEntry[] {
  return targets.map((target) => {
    if (!host.isConnected(target.serverId)) return { ...target, delivery: "skip" };
    if (!host.isBusy(target)) return { ...target, delivery: "send" };
    return { ...target, delivery: host.supportsQueue(target.serverId) ? "queue" : "skip" };
  });
}
