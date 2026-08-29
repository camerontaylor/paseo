import { useCallback } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openSupportingTab } from "@/workspace-tabs/side-panel";

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
}

/**
 * Opens a fresh side conversation on `parentAgentId`. Null when the host has no side
 * conversations, so callers hide the control instead of offering one that cannot work.
 */
export function useStartSideConversation(input: {
  serverId: string;
  workspaceId: string;
}): ((parentAgentId: string, options?: StartSideConversationOptions) => void) | null {
  // COMPAT(sideConversations): added in v0.5.x, remove gate after 2027-02-24.
  const supported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.sideConversations === true,
  );
  const isCompact = useIsCompactFormFactor();
  const openInSidePanelByDefault = useSettings(
    (settings) => settings.openSupportingTabsInSidePanel,
  );
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const start = useCallback(
    (parentAgentId: string, options?: StartSideConversationOptions) => {
      openSupportingTab({
        isCompact,
        workspaceKey,
        target: {
          kind: "side_conversation",
          parentAgentId,
          threadId: createSideConversationThreadId(),
        },
        openInSidePanelByDefault,
        parentTabId: options?.parentTabId,
      });
    },
    [isCompact, openInSidePanelByDefault, workspaceKey],
  );
  return supported ? start : null;
}
