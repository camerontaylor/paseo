import { useCallback } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openPreferredWorkspaceTarget } from "@/workspace-tabs/open-beside";

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
  // Side conversations open from the subagents track and present as one, so they follow that
  // source's side-pane preference rather than introducing a preference of their own.
  const openInSidePane = useSettings((settings) => settings.openInSidePane);
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const start = useCallback(
    (parentAgentId: string, options?: StartSideConversationOptions) => {
      openPreferredWorkspaceTarget({
        isCompact,
        workspaceKey,
        target: {
          kind: "side_conversation",
          parentAgentId,
          threadId: createSideConversationThreadId(),
        },
        source: "subagents",
        preferences: openInSidePane,
        parentTabId: options?.parentTabId,
      });
    },
    [isCompact, openInSidePane, workspaceKey],
  );
  return supported ? start : null;
}
