import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { selectWorkspace } from "@/stores/session-store-hooks/selectors";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatTimeAgo } from "@/utils/time";
import { goHistory } from "@/navigation/history/replay";
import { navigationHistoryStore } from "@/navigation/history/store";
import {
  useRecentSessionRows,
  useRecentVisits,
} from "@/navigation/history/use-recent-session-rows";
import { recentWorkspacesFromVisits } from "@/navigation/history/recent-workspaces";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedClock = withUnistyles(Clock);

export function WorkspaceHistoryButtons() {
  const { t } = useTranslation();
  const history = useSyncExternalStore(
    navigationHistoryStore.subscribe,
    navigationHistoryStore.getState,
    navigationHistoryStore.getState,
  );
  const backLabel = t("settings.shortcuts.help.historyBack");
  const forwardLabel = t("settings.shortcuts.help.historyForward");
  const goBack = useCallback(() => {
    goHistory(-1);
  }, []);
  const goForward = useCallback(() => {
    goHistory(1);
  }, []);
  return (
    <>
      <HeaderToggleButton
        onPress={goBack}
        disabled={history.index <= 0}
        tooltipLabel={backLabel}
        tooltipKeys={[]}
        tooltipSide="bottom"
        testID="workspace-history-back"
        accessibilityLabel={backLabel}
      >
        <ThemedArrowLeft
          size={iconButtonChromeGlyphSize("large")}
          uniProps={mutedIconColorMapping}
        />
      </HeaderToggleButton>
      <HeaderToggleButton
        onPress={goForward}
        disabled={history.index >= history.entries.length - 1}
        tooltipLabel={forwardLabel}
        tooltipKeys={[]}
        tooltipSide="bottom"
        testID="workspace-history-forward"
        accessibilityLabel={forwardLabel}
      >
        <ThemedArrowRight
          size={iconButtonChromeGlyphSize("large")}
          uniProps={mutedIconColorMapping}
        />
      </HeaderToggleButton>
    </>
  );
}

interface WorkspaceRow {
  serverId: string;
  workspaceId: string;
  title: string;
  subtitle: string;
}
function RecentWorkspaceItem({ workspace }: { workspace: WorkspaceRow }) {
  const onSelect = useCallback(() => {
    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
  }, [workspace.serverId, workspace.workspaceId]);
  return (
    <DropdownMenuItem
      testID={`recent-workspace-${workspace.serverId}-${workspace.workspaceId}`}
      description={workspace.subtitle}
      onSelect={onSelect}
    >
      {workspace.title}
    </DropdownMenuItem>
  );
}

function RecentSessionItem({
  session,
}: {
  session: ReturnType<typeof useRecentSessionRows>[number];
}) {
  const { t } = useTranslation();
  const onSelect = useCallback(() => {
    navigateToAgent({
      serverId: session.serverId,
      agentId: session.agentId,
    });
  }, [session.serverId, session.agentId]);
  const description = [session.breadcrumb, formatTimeAgo(new Date(session.visitedAt))]
    .filter(Boolean)
    .join(" · ");
  return (
    <DropdownMenuItem
      testID={`recent-session-${session.key}`}
      description={description}
      onSelect={onSelect}
    >
      {session.title || t("agentList.fallbackTitle")}
    </DropdownMenuItem>
  );
}

function recentTriggerStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
}

export function RecentNavigationItems() {
  const { t } = useTranslation();
  const visits = useRecentVisits();
  const sessions = useSessionStore((state) => state.sessions);
  const recentSessions = useRecentSessionRows(8);
  const workspaces = useMemo(
    () =>
      recentWorkspacesFromVisits(visits)
        .flatMap((recent) => {
          const workspace = selectWorkspace({ sessions }, recent.serverId, recent.workspaceId);
          if (!workspace || workspace.archivingAt) return [];
          return [
            {
              ...recent,
              title: workspace.title || workspace.name,
              subtitle: workspace.projectCustomName ?? workspace.projectDisplayName,
            },
          ];
        })
        .slice(0, 8),
    [sessions, visits],
  );
  return (
    <>
      <DropdownMenuLabel>{t("shell.commandCenter.workspaces")}</DropdownMenuLabel>
      {workspaces.length === 0 ? (
        <DropdownMenuHint>{t("shell.commandCenter.noMatches")}</DropdownMenuHint>
      ) : (
        workspaces.map((workspace) => (
          <RecentWorkspaceItem
            key={workspace.serverId + ":" + workspace.workspaceId}
            workspace={workspace}
          />
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("shell.commandCenter.agents")}</DropdownMenuLabel>
      {recentSessions.length === 0 ? (
        <DropdownMenuHint>{t("shell.commandCenter.noMatches")}</DropdownMenuHint>
      ) : (
        recentSessions.map((session) => <RecentSessionItem key={session.key} session={session} />)
      )}
    </>
  );
}

/** Recent workspaces and sessions share the navigation history store's one persisted visit list. */
export function RecentNavigationButton() {
  const { t } = useTranslation();
  const visits = useRecentVisits();
  const label = t("agentList.dateSections.recent");
  if (visits.length === 0) return null;
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID="recent-navigation-button"
        accessibilityRole="button"
        accessibilityLabel={label}
        style={recentTriggerStyle}
      >
        <ThemedClock size={iconButtonChromeGlyphSize("large")} uniProps={mutedIconColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        minWidth={300}
        maxWidth={420}
        sheetTitle={label}
        testID="recent-navigation-menu"
      >
        <RecentNavigationItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
