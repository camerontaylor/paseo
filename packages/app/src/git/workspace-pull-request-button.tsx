import { useCallback } from "react";
import { Text } from "react-native";
import { GitPullRequest } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import type { GitAction } from "@/git/policy";
import type { PrHint } from "@/git/pr-hint";
import { useGitActionRunner } from "@/git/use-actions";
import type { Theme } from "@/styles/theme";

const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const checkColorMapping = {
  success: (theme: Theme) => ({ color: theme.colors.statusSuccess }),
  failure: (theme: Theme) => ({ color: theme.colors.statusDanger }),
  pending: (theme: Theme) => ({ color: theme.colors.statusWarning }),
  none: extraMutedIconColorMapping,
};

interface WorkspacePullRequestButtonProps {
  action: GitAction;
  hasPullRequest: boolean;
  pullRequest: PrHint | null;
}

function triggerStyle(state: { hovered: boolean; pressed: boolean; open: boolean }) {
  return iconButtonChromeStyle({ size: "large", state });
}

export function WorkspacePullRequestButton({
  action,
  hasPullRequest,
  pullRequest,
}: WorkspacePullRequestButtonProps) {
  const runGitAction = useGitActionRunner();
  const handleSelect = useCallback(() => runGitAction(action), [action, runGitAction]);
  const checksStatus = pullRequest?.checksStatus ?? "none";
  const label = pullRequest ? `${action.label} #${pullRequest.number}` : action.label;
  styles.useVariants({ checksStatus });

  if (hasPullRequest) {
    return (
      <HeaderToggleButton
        testID="workspace-pull-request-button"
        accessibilityRole="button"
        accessibilityLabel={label}
        tooltipLabel={label}
        tooltipKeys={[]}
        tooltipSide="bottom"
        disabled={action.disabled}
        onPress={handleSelect}
        style={styles.button}
      >
        <ThemedGitPullRequest
          size={iconButtonChromeGlyphSize("large")}
          uniProps={checkColorMapping[checksStatus]}
        />
        {pullRequest ? <Text style={styles.number}>{pullRequest.number}</Text> : null}
      </HeaderToggleButton>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="workspace-pull-request-button"
        accessibilityRole="button"
        accessibilityLabel={action.label}
        style={triggerStyle}
      >
        <ThemedGitPullRequest
          size={iconButtonChromeGlyphSize("large")}
          uniProps={extraMutedIconColorMapping}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" testID="workspace-pull-request-menu">
        <DropdownMenuItem
          testID="workspace-create-pull-request"
          leading={action.icon}
          disabled={action.disabled}
          muted={Boolean(action.unavailableMessage)}
          status={action.status}
          pendingLabel={action.pendingLabel}
          successLabel={action.successLabel}
          closeOnSelect={false}
          onSelect={handleSelect}
        >
          {action.label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: "auto",
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  number: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundExtraMuted,
    variants: {
      checksStatus: {
        success: { color: theme.colors.statusSuccess },
        failure: { color: theme.colors.statusDanger },
        pending: { color: theme.colors.statusWarning },
        none: {},
      },
    },
  },
}));
