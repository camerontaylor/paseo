import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { selectViewVisibleAgentIds } from "@/views/view-visible-agents";
import type { ViewedTimelineOwner } from "@/timeline/viewed-timeline-sync";

function serializeVisible(visible: Map<string, string[]>): string {
  return [...visible]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serverId, ids]) => `${serverId}=${ids.join(",")}`)
    .join(";");
}

/**
 * Mirrors what the workspace screen does for its own panes: prepares the timeline of every
 * agent a View shows and reports them to each host's viewed-timeline sync, so chats load and
 * stay live even when their home workspace is not mounted.
 */
export function useViewTimelineSync(input: {
  ownerKey: string;
  layout: WorkspaceLayout | null;
  tabs: WorkspaceTab[];
}): void {
  const { ownerKey, layout, tabs } = input;
  const computed = useMemo(
    () => (layout ? selectViewVisibleAgentIds(layout, tabs) : new Map<string, string[]>()),
    [layout, tabs],
  );
  const stableRef = useRef<{ key: string; visible: Map<string, string[]> }>({
    key: "",
    visible: new Map(),
  });
  const key = serializeVisible(computed);
  if (stableRef.current.key !== key) {
    stableRef.current = { key, visible: computed };
  }
  const visible = stableRef.current.visible;
  // The owner object can be replaced on reconnect while the host id stays the same.
  // Compare identities so reporting follows the new owner without subscribing to every
  // unrelated session update.
  const syncOwners = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      [...visible.keys()].map(
        (serverId) => [serverId, state.sessions[serverId]?.viewedTimelineSync ?? null] as const,
      ),
    (left, right) =>
      left.length === right.length &&
      left.every(
        ([serverId, owner], index) => serverId === right[index]?.[0] && owner === right[index]?.[1],
      ),
  );

  useEffect(() => {
    for (const [serverId, agentIds] of visible) {
      for (const agentId of agentIds) {
        void getHostRuntimeStore()
          .prepareAgentTimeline(serverId, agentId)
          .catch(() => undefined);
      }
    }
  }, [visible]);

  useLayoutEffect(() => {
    const reported: ViewedTimelineOwner[] = [];
    for (const [serverId, sync] of syncOwners) {
      if (!sync) continue;
      const agentIds = visible.get(serverId) ?? [];
      if (agentIds.length === 0) continue;
      sync.replaceVisibleAgentIds(ownerKey, agentIds);
      reported.push(sync);
    }
    // Clean the exact object that received the registration. Session context can swap
    // owners before this hook renders again, leaving the previous owner otherwise live.
    return () => {
      for (const sync of reported) sync.replaceVisibleAgentIds(ownerKey, []);
    };
  }, [ownerKey, syncOwners, visible]);
}
