import { useCallback, useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { sendOsNotification } from "@/utils/os-notifications";
import { useToast } from "@/contexts/toast-context";
import { Button } from "@/components/ui/button";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

export function useWorkspaceSnoozeNotifications(serverId: string, client: DaemonClient) {
  // COMPAT(workspaceSnoozing): added in v0.11, remove gate after 2027-04-06.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.workspaceSnoozing === true,
  );
  const toast = useToast();
  useEffect(() => {
    if (!supported) return;
    const feed = client.observeEvents(["workspace.snooze.woke"], { notifications: true });
    const unsubscribe = feed.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== "workspace.snooze.woke" || !message.payload.shouldNotify) return;
        const { title, body, workspaceId } = message.payload;
        void sendOsNotification({ title, body, data: { serverId, workspaceId } })
          .then((sent) => {
            if (!sent)
              toast.show(<WakeToast serverId={serverId} workspaceId={workspaceId} title={title} />);
            return;
          })
          .catch(() => toast.show(title));
      },
    });
    return () => {
      unsubscribe();
      void feed.release().catch(() => {});
    };
  }, [client, serverId, supported, toast]);
}

function WakeToast({
  serverId,
  workspaceId,
  title,
}: {
  serverId: string;
  workspaceId: string;
  title: string;
}) {
  const open = useCallback(
    () => navigateToWorkspace({ serverId, workspaceId }),
    [serverId, workspaceId],
  );
  return (
    <Button variant="ghost" onPress={open}>
      {title}
    </Button>
  );
}
