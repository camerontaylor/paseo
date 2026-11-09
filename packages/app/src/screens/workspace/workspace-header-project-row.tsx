import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { WorkspaceHeaderBranches } from "@/screens/workspace/workspace-header-branches";

/**
 * What sits beside the workspace name: on wide, the branch pair for a git checkout; otherwise the
 * project and host.
 *
 * Wide git checkouts show `<current branch> → <base branch>` in place of the project name. The
 * sidebar already groups workspaces by project, so the name repeats what is on screen, while the
 * branch pair is the one fact about the checkout the header could not otherwise show.
 *
 * Compact gets both, on their own line under the workspace name: this header is the only thing on
 * screen that says where the workspace lives, because the sidebar that normally carries the host
 * badge is closed. It still follows the host's own badge setting, so a purely local setup stays
 * quiet. A project name that only repeats the workspace name is dropped on wide, where the two sit
 * side by side, and kept on compact, where the line exists for the host anyway.
 */

/** The branch pair the wide header shows for a git checkout. Null when there is no branch. */
export interface WorkspaceHeaderBranchesModel {
  workspaceId: string;
  workspaceDirectory: string | null;
  currentBranchName: string;
  baseRefName: string | null;
  onCopyBranchName: () => void;
}

export function WorkspaceHeaderProjectRow({
  subtitle,
  isSubtitleDistinct,
  serverId,
  branches,
}: {
  subtitle: string;
  isSubtitleDistinct: boolean;
  serverId: string;
  branches?: WorkspaceHeaderBranchesModel | null;
}) {
  const isCompact = useIsCompactFormFactor();
  const hostBadge = useHostBadges({ enabled: isCompact }).get(serverId) ?? null;
  if (!isCompact && branches) {
    return (
      <View style={styles.row}>
        <WorkspaceHeaderBranches
          serverId={serverId}
          workspaceId={branches.workspaceId}
          workspaceDirectory={branches.workspaceDirectory}
          currentBranchName={branches.currentBranchName}
          baseRefName={branches.baseRefName}
          onCopyBranchName={branches.onCopyBranchName}
        />
      </View>
    );
  }
  const showProject = isSubtitleDistinct || isCompact;
  if (!showProject && !hostBadge) {
    return null;
  }
  return (
    <View style={styles.row}>
      {showProject ? (
        <Text testID="workspace-header-subtitle" style={styles.project} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {showProject && hostBadge ? <Text style={styles.separator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The compact header stretches this row to its available title width. Within that width,
  // the project truncates and HostBadge yields its label while retaining its fixed icon.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  project: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
