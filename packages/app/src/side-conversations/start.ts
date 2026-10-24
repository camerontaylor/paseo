import { useCallback } from "react";
import { useSettings } from "@/hooks/use-settings";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  openPreferredWorkspaceTarget,
  openWorkspaceTargetAtLocation,
} from "@/workspace-tabs/open-beside";
import { sideConversationParentPrefix, useSideConversationStore } from "./store";

/**
 * Thread ids are minted by the client. The daemon has no create call — a thread comes into
 * existence with its first question and is addressed by whatever id the asker chose — so an id
 * that has never been asked anything is real to this client and unknown to the host.
 */
export function createSideConversationThreadId(): string {
  return globalThis.crypto.randomUUID();
}

export interface StartSideConversationOptions {
  /** The agent tab the question is about, so the thread opens beside it. */
  parentTabId?: string;
  /** Stable assistant-message id or epoch:sequence cursor for the presentation origin. */
  anchor?: string;
}

/**
 * Opens or revisits a side conversation on the parent agent. With an anchor, an existing
 * conversation for that reply is reopened. Null when the host lacks the feature or the
 * workspace cannot place the tab.
 */
export function useStartSideConversation(input: {
  serverId: string;
  workspaceId: string;
}): ((parentAgentId: string, options?: StartSideConversationOptions) => string | null) | null {
  // COMPAT(sideConversations): added in 0.7.0-beta.2.fork.1, fork-only — stock peers never gain it, so the gate lasts as long as stock peers are supported.
  const supported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.sideConversations === true,
  );
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const originsHydrated = useSideConversationStore((state) => state.originsHydrated);
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const start = useCallback(
    (parentAgentId: string, options?: StartSideConversationOptions) => {
      const store = useSideConversationStore.getState();
      const parentPrefix = sideConversationParentPrefix(input.serverId, parentAgentId);
      const existingOriginKey = options?.anchor
        ? Object.entries(store.origins).find(
            ([key, origin]) =>
              key.startsWith(parentPrefix) &&
              origin.parentAgentId === parentAgentId &&
              origin.anchor === options.anchor,
          )?.[0]
        : undefined;
      const threadId = existingOriginKey
        ? existingOriginKey.slice(parentPrefix.length)
        : createSideConversationThreadId();
      const layout = workspaceKey
        ? useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]
        : undefined;
      const parentTabId =
        options?.parentTabId ??
        (layout
          ? collectAllTabs(layout.root).find(
              (tab) => tab.target.kind === "agent" && tab.target.agentId === parentAgentId,
            )?.tabId
          : undefined);
      const target = {
        kind: "side_conversation" as const,
        parentAgentId,
        threadId,
      };
      const tabId = options?.anchor
        ? openWorkspaceTargetAtLocation({
            workspaceKey,
            target,
            location: "side",
            parentTabId,
          })
        : openPreferredWorkspaceTarget({
            workspaceKey,
            target,
            source: "subagents",
            preferences: openInSidePane,
            parentTabId: options?.parentTabId,
          });
      if (!tabId) return null;
      if (options?.anchor && !existingOriginKey) {
        useSideConversationStore.getState().setOrigin(input.serverId, parentAgentId, threadId, {
          parentAgentId,
          anchor: options.anchor,
        });
      }
      return threadId;
    },
    [input.serverId, openInSidePane, workspaceKey],
  );
  return supported && originsHydrated ? start : null;
}
