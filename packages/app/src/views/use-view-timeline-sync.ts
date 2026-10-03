import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { selectViewVisibleAgentIds } from "@/views/view-visible-agents";

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
  // Re-run reporting when a host's sync owner appears, without re-rendering on every
  // session update.
  const readySyncKey = useSessionStore((state) =>
    [...visible.keys()]
      .filter((serverId) => state.sessions[serverId]?.viewedTimelineSync)
      .sort()
      .join(","),
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

  const reportedServersRef = useRef(new Set<string>());
  useLayoutEffect(() => {
    const reported = reportedServersRef.current;
    const sessions = useSessionStore.getState().sessions;
    for (const serverId of new Set([...reported, ...visible.keys()])) {
      const sync = sessions[serverId]?.viewedTimelineSync;
      if (!sync) continue;
      const agentIds = visible.get(serverId) ?? [];
      sync.replaceVisibleAgentIds(ownerKey, agentIds);
      if (agentIds.length === 0) reported.delete(serverId);
      else reported.add(serverId);
    }
  }, [ownerKey, readySyncKey, visible]);

  useEffect(
    () => () => {
      const latestSessions = useSessionStore.getState().sessions;
      for (const serverId of reportedServersRef.current) {
        latestSessions[serverId]?.viewedTimelineSync?.replaceVisibleAgentIds(ownerKey, []);
      }
      reportedServersRef.current.clear();
    },
    [ownerKey],
  );
}
