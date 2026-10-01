import { WorkspaceLinearButton } from "@/linear/workspace-button";
import { useMemo, type ReactNode } from "react";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActions } from "@/git/use-actions";
import { WorkspacePullRequestButton } from "@/git/workspace-pull-request-button";

interface WorkspaceActionsProps {
  serverId: string;
  cwd: string;
  children?: ReactNode;
}

export function WorkspaceActions({ serverId, cwd, children }: WorkspaceActionsProps) {
  const { gitActions, pullRequestAction, pullRequest, hasPullRequest } = useGitActions({
    serverId,
    cwd,
    icons: GIT_ACTION_ICONS,
  });

  // FORK(pr-toolbar): the dedicated PR button owns viewing and creating pull requests.
  const toolbarActions = useMemo(
    () => ({
      primary: gitActions.primary?.id === "pr" ? null : gitActions.primary,
      secondary: gitActions.secondary.filter((action) => action.id !== "pr"),
      menu: gitActions.menu.filter((action) => action.id !== "pr"),
    }),
    [gitActions],
  );

  return (
    <>
      {pullRequestAction ? (
        <WorkspacePullRequestButton
          action={pullRequestAction}
          hasPullRequest={hasPullRequest}
          pullRequest={pullRequest}
        />
      ) : null}
      {/* FORK(linear-toolbar): Linear follows the checkout's current PR. */}
      <WorkspaceLinearButton serverId={serverId} cwd={cwd} prUrl={pullRequest?.url ?? null} />
      {children}
      <GitActionsSplitButton gitActions={toolbarActions} menuOnly={!toolbarActions.primary} />
    </>
  );
}
