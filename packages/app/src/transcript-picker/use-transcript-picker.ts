import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import {
  useWorkspaceAttachmentsStore,
  buildDraftWorkspaceAttachmentScopeKey,
} from "@/attachments/workspace-attachments-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useStableEvent } from "@/hooks/use-stable-event";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { toErrorMessage } from "@/utils/error-messages";
import { openTranscriptPicker, type TranscriptSource } from "./model";

export function useTranscriptPicker(input: {
  serverId: string;
  workspaceId: string;
  draftId: string;
}) {
  const { serverId, workspaceId, draftId } = input;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "agentForkContext");
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const agentIds = useMemo(
    () =>
      layout
        ? Array.from(
            new Set(
              collectAllTabs(layout.root).flatMap((tab) =>
                tab.target.kind === "agent" ? [tab.target.agentId] : [],
              ),
            ),
          )
        : [],
    [layout],
  );
  const agents = useSessionStore(
    useShallow((state) =>
      agentIds.map(
        (id) =>
          state.sessions[serverId]?.agents.get(id) ??
          state.sessions[serverId]?.agentDetails.get(id),
      ),
    ),
  );
  const sources = useMemo<TranscriptSource[]>(
    () =>
      agents.flatMap((agent) =>
        agent?.workspaceId === workspaceId
          ? [
              {
                agentId: agent.id,
                title: agent.title?.trim() || t("panels.draft.untitledChat"),
                provider: agent.provider,
              },
            ]
          : [],
      ),
    [agents, t, workspaceId],
  );
  const scopeKey = buildDraftWorkspaceAttachmentScopeKey(draftId);
  const loadTranscript = useStableEvent(async (source: TranscriptSource) => {
    if (!supported) throw new Error(t("message.actions.forkUnavailable"));
    if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
    const payload = await client.buildAgentForkContext(source.agentId);
    if (!payload.attachment) throw new Error(t("panels.draft.transcriptFailed"));
    return {
      kind: "chat_history" as const,
      id: `chat_history:${draftId}:${serverId}:${source.agentId}`,
      attachment: {
        ...payload.attachment,
        title: t("panels.draft.transcriptTitle", { title: source.title }),
      },
      source: {
        serverId,
        agentId: source.agentId,
        itemCount: payload.itemCount,
        boundaryCursor: payload.boundaryCursor,
        boundaryMessageId: payload.boundaryMessageId,
      },
    };
  });
  const describeError = useStableEvent(
    (error: unknown) => toErrorMessage(error) || t("panels.draft.transcriptFailed"),
  );
  const [model] = useState(() =>
    openTranscriptPicker({
      serverId,
      getAttachments: () =>
        useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey] ?? [],
      setAttachments: (attachments) =>
        useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({ scopeKey, attachments }),
      loadTranscript,
      describeError,
    }),
  );
  useEffect(() => {
    const unsubscribe = useWorkspaceAttachmentsStore.subscribe((state, previous) => {
      if (state.attachmentsByScope[scopeKey] !== previous.attachmentsByScope[scopeKey])
        model.refresh();
    });
    model.refresh();
    return () => {
      unsubscribe();
      model.close();
    };
  }, [model, scopeKey]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  return {
    sources,
    state,
    toggle: model.toggle,
    supported,
    isLoading: state.pendingAgentIds.length > 0,
  };
}
