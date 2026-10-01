import { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { CircleDashed } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { LinearIssue } from "@getpaseo/protocol/linear";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  DropdownMenuHint,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import {
  iconButtonChromeStyle,
  extraMutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { openExternalUrl } from "@/utils/open-external-url";
import { useToast } from "@/contexts/toast-context";
import { LinearStatusIcon } from "./status-icon";
import { LinkLinearIssuePage } from "./link-issue-page";
import { useLinearIssues, type LinearWorkspaceTarget } from "./query";

const EmptyIcon = withUnistyles(CircleDashed);

function issueLabel(issue: LinearIssue) {
  return `${issue.identifier}: ${issue.title} · ${issue.state.name}`;
}

function triggerStyle(state: { hovered: boolean; pressed: boolean; open: boolean }) {
  return iconButtonChromeStyle({ size: "large", state, style: styles.button });
}

export function WorkspaceLinearButton(target: LinearWorkspaceTarget) {
  const { t } = useTranslation();
  const toast = useToast();
  const { query, supported, connected } = useLinearIssues(target);
  const issues = query.data ?? [];
  const single = issues.length === 1 ? issues[0] : null;
  const pages = useMemo<readonly MenuPageDefinition[]>(
    () => [
      {
        id: "link",
        title: t("workspace.linear.link"),
        hoverIntent: false,
        content: <LinkLinearIssuePage target={target} />,
      },
    ],
    [t, target],
  );
  const open = useCallback(
    (url: string) => {
      void openExternalUrl(url).catch(() => toast.show(t("workspace.linear.openFailed")));
    },
    [t, toast],
  );
  const openSingle = useCallback(() => {
    if (single) open(single.url);
  }, [single, open]);
  const createIssue = useCallback(() => {
    const url = new URL("https://linear.new");
    if (target.prUrl) url.searchParams.set("description", target.prUrl);
    open(url.toString());
  }, [target.prUrl, open]);
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  if (single && !query.isError) {
    const label = issueLabel(single);
    return (
      <HeaderToggleButton
        testID="workspace-linear-button"
        accessibilityRole="button"
        accessibilityLabel={label}
        tooltipLabel={label}
        tooltipSide="bottom"
        tooltipKeys={[]}
        style={styles.button}
        onPress={openSingle}
      >
        <LinearStatusIcon state={single.state} />
        <Text style={[styles.label, inlineUnistylesStyle({ color: single.state.color })]}>
          {single.identifier}
        </Text>
      </HeaderToggleButton>
    );
  }

  const canLink = supported && connected && Boolean(target.prUrl);

  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID="workspace-linear-button"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.linear.title")}
        style={triggerStyle}
      >
        <EmptyIcon size={16} uniProps={extraMutedIconColorMapping} />
        {issues.length > 1 ? <Text style={styles.label}>{issues.length}</Text> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        minWidth={260}
        maxWidth={380}
        pages={pages}
        sheetTitle={t("workspace.linear.title")}
        testID="workspace-linear-menu"
      >
        {issues.map((issue) => (
          <LinearIssueMenuItem key={issue.id} issue={issue} onOpen={open} />
        ))}
        {issues.length > 0 ? <DropdownMenuSeparator /> : null}
        {!supported ? (
          <DropdownMenuHint>{t("workspace.linear.updateHost")}</DropdownMenuHint>
        ) : null}
        {!target.prUrl ? <DropdownMenuHint>{t("workspace.linear.noPr")}</DropdownMenuHint> : null}
        {query.isLoading ? (
          <DropdownMenuHint>{t("workspace.linear.loading")}</DropdownMenuHint>
        ) : null}
        {query.error ? (
          <Text style={styles.error} accessibilityRole="alert" testID="linear-lookup-error">
            {query.error.message}
          </Text>
        ) : null}
        {canLink ? (
          <DropdownMenuSubTrigger id="link">{t("workspace.linear.link")}</DropdownMenuSubTrigger>
        ) : null}
        <DropdownMenuItem onSelect={createIssue}>{t("workspace.linear.create")}</DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canLink || query.isFetching}
          closeOnSelect={false}
          status={query.isFetching ? "pending" : "idle"}
          pendingLabel={t("workspace.linear.loading")}
          onSelect={refresh}
          testID="linear-retry"
        >
          {t("workspace.linear.refresh")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinearIssueMenuItem({
  issue,
  onOpen,
}: {
  issue: LinearIssue;
  onOpen: (url: string) => void;
}) {
  const select = useCallback(() => onOpen(issue.url), [onOpen, issue.url]);
  const icon = useMemo(() => <LinearStatusIcon state={issue.state} />, [issue.state]);
  return (
    <DropdownMenuItem leading={icon} onSelect={select}>
      {issueLabel(issue)}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: "auto",
    flexDirection: "row",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  label: { fontSize: theme.fontSize.base, color: theme.colors.foregroundMuted },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
    padding: theme.spacing[3],
  },
}));
