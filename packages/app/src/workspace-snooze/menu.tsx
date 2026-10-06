import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { openWorkspaceSnooze } from "./store";

export function WorkspaceSnoozeMenuItems({
  surface,
  serverId,
  workspaceId,
  workspaceKey,
}: {
  surface: "context" | "dropdown";
  serverId?: string;
  workspaceId?: string;
  workspaceKey: string;
}) {
  const { t } = useTranslation();
  // COMPAT(workspaceSnoozing): added in v0.11, remove gate after 2027-04-06.
  const supported = useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.serverInfo?.features?.workspaceSnoozing === true : false,
  );
  const fields = useWorkspaceFields(serverId ?? null, workspaceId ?? null, (workspace) => ({
    snoozed: Boolean(workspace.snooze),
  }));
  const toast = useToast();
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!serverId || !workspaceId) return;
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      await client.setWorkspaceSnooze(workspaceId, null);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const unsnooze = useCallback(() => mutate(), [mutate]);
  const open = useCallback(() => {
    if (serverId && workspaceId) openWorkspaceSnooze(serverId, workspaceId);
  }, [serverId, workspaceId]);
  if (!supported) return null;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      <Item testID={`sidebar-workspace-snooze-${workspaceKey}`} onSelect={open}>
        {t(fields?.snoozed ? "workspaceSnooze.edit" : "workspaceSnooze.action")}
      </Item>
      {fields?.snoozed ? (
        <Item
          status={isPending ? "pending" : "idle"}
          onSelect={unsnooze}
          testID={`sidebar-workspace-unsnooze-${workspaceKey}`}
        >
          {t("workspaceSnooze.unsnooze")}
        </Item>
      ) : null}
    </>
  );
}
