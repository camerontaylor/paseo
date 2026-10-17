import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable, Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Play,
  RotateCw,
  Square,
  SquareTerminal,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenuClose,
} from "@/components/ui/dropdown-menu";
import { MenuTextField } from "@/components/ui/menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MENU_ITEM_HEIGHT } from "@/components/ui/menu/menu-geometry";
import { openServiceUrl } from "@/utils/open-service-url";
import type {
  WorkspaceScriptLinkKind,
  WorkspaceScriptLinkTarget,
} from "@/utils/workspace-script-links";
import type { Theme } from "@/styles/theme";
import { buttonControlHeight, HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { extraMutedIconColorMapping } from "@/components/ui/icon-color";
import { ExitCodeBadge, routeLabelKey, ScriptIcon } from "./script-marks";
import { scriptToneColorMapping } from "./script-status";
import {
  useWorkspaceScriptActions,
  type WorkspaceScriptActions,
} from "./use-workspace-script-actions";

type RowActionIcon = "copy" | "open" | "restart" | "start" | "stop" | "terminal";

interface WorkspaceScriptsButtonProps {
  serverId: string;
  workspaceId: string;
  scripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds?: readonly string[];
  onScriptTerminalStarted?: (terminalId: string) => void;
  onViewTerminal?: (terminalId: string) => void;
  onOpenUrlInBrowserTab?: (url: string) => void;
  hideLabels?: boolean;
}

const ThemedPlay = withUnistyles(Play);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedEye = withUnistyles(Eye);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedSquare = withUnistyles(Square);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const playFillTransparent = { fill: "transparent" };

interface ScriptRowActionButtonProps {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: RowActionIcon;
  onPress: () => void;
  testID: string;
  tooltipLabel: string;
}

function RowActionIconElement({
  hovered,
  icon,
}: {
  hovered?: boolean;
  icon: RowActionIcon;
}): ReactElement {
  const colorMapping = hovered ? foregroundColorMapping : mutedColorMapping;
  switch (icon) {
    case "copy":
      return <ThemedCopy size={11} uniProps={colorMapping} />;
    case "open":
      return <ThemedEye size={12} uniProps={colorMapping} />;
    case "restart":
      return <ThemedRotateCw size={11} uniProps={colorMapping} />;
    case "start":
      return <ThemedPlay size={11} uniProps={colorMapping} {...playFillTransparent} />;
    case "stop":
      return <ThemedSquare size={11} uniProps={colorMapping} />;
    case "terminal":
      return <ThemedSquareTerminal size={12} uniProps={colorMapping} />;
  }
}

function ScriptRowActionButton({
  accessibilityLabel,
  disabled,
  icon,
  onPress,
  testID,
  tooltipLabel,
}: ScriptRowActionButtonProps): ReactElement {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  const renderChildren = useCallback(
    ({ hovered }: { hovered?: boolean }) => <RowActionIconElement hovered={hovered} icon={icon} />,
    [icon],
  );

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          hitSlop={6}
          disabled={disabled}
          onPress={handlePress}
          style={styles.iconActionButton}
        >
          {renderChildren}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent testID={`${testID}-tooltip`} side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltipLabel}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

interface ServiceLinkRowProps {
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  scriptName: string;
  onSelectKind: (kind: WorkspaceScriptLinkKind) => void;
  onCopy: (target: WorkspaceScriptLinkTarget) => void;
}

function ServiceRouteOption({
  scriptName,
  selectedKind,
  target,
  onSelect,
}: {
  scriptName: string;
  selectedKind: WorkspaceScriptLinkKind;
  target: WorkspaceScriptLinkTarget;
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(target.kind), [onSelect, target.kind]);
  return (
    <DropdownMenuItem
      testID={`workspace-scripts-route-${scriptName}-${target.kind}`}
      selected={target.kind === selectedKind}
      showSelectedCheck
      description={target.label}
      onSelect={handleSelect}
    >
      {t(routeLabelKey(target.kind))}
    </DropdownMenuItem>
  );
}

function ServiceRouteTriggerContent({
  hovered,
  label,
}: {
  hovered: boolean;
  label: string;
}): ReactElement {
  return (
    <>
      <View style={styles.routeSelectorButton}>
        <ThemedChevronDown
          size={14}
          uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
        />
      </View>
      <Text
        style={hovered ? [styles.hostLabel, styles.hostLabelActive] : styles.hostLabel}
        numberOfLines={1}
      >
        {label}
      </Text>
    </>
  );
}

function ServiceRouteSelector({
  scriptName,
  selectedTarget,
  targets,
  onSelect,
}: {
  scriptName: string;
  selectedTarget: WorkspaceScriptLinkTarget;
  targets: WorkspaceScriptLinkTarget[];
  onSelect: (kind: WorkspaceScriptLinkKind) => void;
}): ReactElement {
  const { t } = useTranslation();
  const accessibilityLabel = t("workspace.scripts.accessibility.chooseUrl", { scriptName });

  return (
    <DropdownMenu>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <View collapsable={false} style={styles.routeSelectorFrame}>
            <DropdownMenuTrigger
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              testID={`workspace-scripts-route-${scriptName}`}
              hitSlop={6}
              style={styles.routeSelectorTrigger}
            >
              {({ hovered }) => (
                <ServiceRouteTriggerContent hovered={hovered} label={selectedTarget.label} />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        <TooltipContent
          testID={`workspace-scripts-route-${scriptName}-tooltip`}
          side="top"
          align="center"
          offset={8}
        >
          <Text style={styles.tooltipText}>{t("workspace.scripts.actions.chooseUrl")}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" minWidth={220} maxWidth={280}>
        {targets.map((target) => (
          <ServiceRouteOption
            key={target.kind}
            scriptName={scriptName}
            selectedKind={selectedTarget.kind}
            target={target}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServiceLinkRow({
  selectedTarget,
  targets,
  scriptName,
  onSelectKind,
  onCopy,
}: ServiceLinkRowProps): ReactElement {
  const { t } = useTranslation();
  const closeMenu = useDropdownMenuClose();
  const { label } = selectedTarget;

  const handleCopy = useCallback(() => {
    closeMenu();
    onCopy(selectedTarget);
  }, [selectedTarget, onCopy, closeMenu]);

  return (
    <View style={styles.hostRow}>
      {targets.length > 1 ? (
        <ServiceRouteSelector
          scriptName={scriptName}
          selectedTarget={selectedTarget}
          targets={targets}
          onSelect={onSelectKind}
        />
      ) : (
        <View style={styles.routeDisplay}>
          <View style={styles.routeSelectorButton} />
          <Text style={styles.hostLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
      <ScriptRowActionButton
        accessibilityLabel={t("workspace.scripts.accessibility.copyUrl", { scriptName })}
        testID={`workspace-scripts-copy-${scriptName}`}
        icon="copy"
        onPress={handleCopy}
        tooltipLabel={t("workspace.scripts.actions.copyUrl")}
      />
    </View>
  );
}

interface ScriptRowProps {
  script: WorkspaceDescriptor["scripts"][number];
  liveTerminalIdSet: Set<string>;
  actions: WorkspaceScriptActions;
  onViewTerminal?: (terminalId: string) => void;
  onOpenUrlInBrowserTab?: (url: string) => void;
}

function ScriptRow({
  script,
  liveTerminalIdSet,
  actions,
  onViewTerminal,
  onOpenUrlInBrowserTab,
}: ScriptRowProps): ReactElement {
  const { t } = useTranslation();
  const scriptLabel = script.packageJson?.script ?? script.scriptName;
  const isRunning = script.lifecycle === "running";
  const exitCode = script.exitCode ?? null;
  const { selected: selectedLink, targets: linkTargets } = actions.resolveLinks(script);
  const liveTerminalId =
    script.terminalId && liveTerminalIdSet.has(script.terminalId) ? script.terminalId : null;
  const showExitBadge = !isRunning && exitCode !== null;
  const { start, stop, restart } = actions;
  const closeMenu = useDropdownMenuClose();

  const handleOpenService = useCallback(() => {
    if (!selectedLink) return;
    closeMenu();
    void openServiceUrl(selectedLink.url, { openInApp: onOpenUrlInBrowserTab });
  }, [selectedLink, closeMenu, onOpenUrlInBrowserTab]);

  const handleView = useCallback(() => {
    if (liveTerminalId) onViewTerminal?.(liveTerminalId);
  }, [liveTerminalId, onViewTerminal]);

  const handleRun = useCallback(() => {
    start(script.scriptName);
  }, [start, script.scriptName]);

  const handleStop = useCallback(() => {
    stop(script.scriptName);
  }, [stop, script.scriptName]);

  const handleRestart = useCallback(() => {
    restart(script.scriptName);
  }, [restart, script.scriptName]);

  const scriptNameStyle = useMemo(
    () => (isRunning ? [styles.scriptName, styles.scriptNameActive] : styles.scriptName),
    [isRunning],
  );

  const viewAction =
    isRunning && liveTerminalId ? (
      <ScriptRowActionButton
        accessibilityLabel={t("workspace.scripts.accessibility.viewTerminal", {
          scriptName: scriptLabel,
        })}
        testID={`workspace-scripts-view-${script.scriptName}`}
        icon="terminal"
        onPress={handleView}
        tooltipLabel={t("workspace.scripts.actions.view")}
      />
    ) : null;

  const openServiceAction = selectedLink ? (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.openService", {
        scriptName: scriptLabel,
      })}
      testID={`workspace-scripts-open-${script.scriptName}`}
      icon="open"
      onPress={handleOpenService}
      tooltipLabel={t("workspace.scripts.actions.openService")}
    />
  ) : null;

  const lifecycleAction = isRunning ? (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.stopScript", {
        scriptName: scriptLabel,
      })}
      testID={`workspace-scripts-stop-${script.scriptName}`}
      disabled={actions.isStopPending}
      icon="stop"
      onPress={handleStop}
      tooltipLabel={t("workspace.scripts.actions.stop")}
    />
  ) : (
    <ScriptRowActionButton
      accessibilityLabel={t("workspace.scripts.accessibility.runScript", {
        scriptName: scriptLabel,
      })}
      testID={`workspace-scripts-start-${script.scriptName}`}
      disabled={actions.isStartPending}
      icon="start"
      onPress={handleRun}
      tooltipLabel={t("workspace.scripts.actions.run")}
    />
  );

  return (
    <View
      testID={`workspace-scripts-item-${script.scriptName}`}
      accessibilityLabel={t("workspace.scripts.accessibility.script", {
        scriptName: scriptLabel,
      })}
    >
      <View style={styles.scriptHeader}>
        <ScriptIcon script={script} size={14} />
        <Text style={scriptNameStyle} numberOfLines={1}>
          {scriptLabel}
        </Text>
        {showExitBadge ? <ExitCodeBadge code={exitCode} /> : null}
        <View style={styles.spacer} />
        {openServiceAction}
        {viewAction}
        {isRunning ? (
          <ScriptRowActionButton
            accessibilityLabel={t("workspace.scripts.accessibility.restartScript", {
              scriptName: scriptLabel,
            })}
            testID={`workspace-scripts-restart-${script.scriptName}`}
            disabled={actions.isStopPending}
            icon="restart"
            onPress={handleRestart}
            tooltipLabel={t("workspace.scripts.actions.restart")}
          />
        ) : null}
        {lifecycleAction}
      </View>
      {selectedLink ? (
        <View style={styles.hostList}>
          <ServiceLinkRow
            selectedTarget={selectedLink}
            targets={linkTargets}
            scriptName={script.scriptName}
            onSelectKind={actions.selectRoute}
            onCopy={actions.copyUrl}
          />
        </View>
      ) : null}
    </View>
  );
}

function ScriptGroup({
  path,
  collapsible,
  children,
}: {
  path: string;
  collapsible: boolean;
  children: ReactNode;
}): ReactNode {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(path === "package.json");
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const Icon = expanded ? ThemedChevronDown : ThemedChevronRight;
  const leading = useMemo(() => <Icon size={14} uniProps={mutedColorMapping} />, [Icon]);
  if (!path) return children;
  const directory =
    path === "package.json"
      ? t("workspace.scripts.rootPackage")
      : path.slice(0, -"/package.json".length);
  return (
    <>
      <DropdownMenuSeparator />
      {collapsible ? (
        <DropdownMenuItem
          closeOnSelect={false}
          onSelect={toggleExpanded}
          leading={leading}
          testID={`workspace-scripts-group-${path}`}
        >
          {directory}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuLabel>{path}</DropdownMenuLabel>
      )}
      {!collapsible || expanded ? children : null}
    </>
  );
}

export function WorkspaceScriptsButton({
  serverId,
  workspaceId,
  scripts: workspaceScripts,
  liveTerminalIds = [],
  onScriptTerminalStarted,
  onViewTerminal,
  onOpenUrlInBrowserTab,
  hideLabels,
}: WorkspaceScriptsButtonProps): ReactElement | null {
  const { t } = useTranslation();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(packageJsonScripts): added in fork v0.10.1, remove gate after 2027-04-01.
  const supportsPackages = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.packageJsonScripts === true,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    if (open) setSearch("");
  }, []);
  const packageQuery = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["workspace-package-scripts", serverId, workspaceId],
    enabled: menuOpen && supportsPackages && client !== null,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const result = await client.listWorkspaceScripts(workspaceId);
      if (result.error) throw new Error(result.error);
      return { scripts: result.scripts ?? [] };
    },
  });
  const retryDiscovery = useCallback(() => {
    void packageQuery.refetch();
  }, [packageQuery]);
  const scripts = useMemo(() => {
    if (!packageQuery.data) return workspaceScripts;
    const live = new Map(workspaceScripts.map((script) => [script.scriptName, script]));
    const discovered = packageQuery.data.scripts.filter((script) => script.packageJson);
    const packageIds = new Set(discovered.map((script) => script.scriptName));
    const configured = workspaceScripts.filter(
      (script) =>
        !script.packageJson ||
        (script.lifecycle === "running" && !packageIds.has(script.scriptName)),
    );
    return [...configured, ...discovered.map((script) => live.get(script.scriptName) ?? script)];
  }, [packageQuery.data, workspaceScripts]);
  const groups = useMemo(() => {
    const grouped = new Map<string, WorkspaceDescriptor["scripts"]>();
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    for (const script of scripts) {
      const path = script.packageJson?.path ?? "";
      const label = script.packageJson?.script ?? script.scriptName;
      const searchable = `${label} ${path}`.toLowerCase();
      if (!terms.every((term) => searchable.includes(term))) continue;
      const group = grouped.get(path) ?? [];
      group.push(script);
      grouped.set(path, group);
    }
    return [...grouped.entries()].sort(([left], [right]) => {
      if (left === "") return -1;
      if (right === "") return 1;
      if (left === "package.json") return -1;
      if (right === "package.json") return 1;
      return left.localeCompare(right);
    });
  }, [scripts, search]);
  const packageCount = groups.filter(([path]) => path !== "").length;
  const actions = useWorkspaceScriptActions({
    serverId,
    workspaceId,
    scripts,
    onScriptTerminalStarted,
  });
  const liveTerminalIdSet = useMemo(() => new Set(liveTerminalIds), [liveTerminalIds]);

  const triggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonPrimary,
      (hovered || pressed || open) && styles.splitButtonPrimaryHovered,
    ],
    [],
  );

  if (scripts.length === 0 && !supportsPackages) {
    return null;
  }

  // The trigger only says whether anything runs; health is for the rows inside.
  const hasAnyRunning = scripts.some((s) => s.lifecycle === "running");
  const triggerPlayMapping = scriptToneColorMapping(hasAnyRunning ? "running" : "idle");

  return (
    <View style={styles.row}>
      <View style={styles.splitButton}>
        <DropdownMenu onOpenChange={handleMenuOpenChange} compactMode="sheet">
          <DropdownMenuTrigger
            testID="workspace-scripts-button"
            style={triggerStyle}
            accessibilityRole="button"
            accessibilityLabel={t("workspace.scripts.accessibility.trigger")}
          >
            <View style={styles.splitButtonContent}>
              <ThemedPlay size={14} uniProps={triggerPlayMapping} {...playFillTransparent} />
              {!hideLabels && (
                <Text style={styles.splitButtonText}>{t("workspace.scripts.title")}</Text>
              )}
              <ThemedChevronDown size={16} uniProps={extraMutedIconColorMapping} />
            </View>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            minWidth={280}
            maxWidth={360}
            maxHeight={420}
            scrollable
            sheetTitle={t("workspace.scripts.title")}
            testID="workspace-scripts-menu"
          >
            <MenuTextField
              initialValue={search}
              onChangeText={setSearch}
              placeholder={t("workspace.scripts.searchPlaceholder")}
              testID="workspace-scripts-search"
            />
            {groups.map(([path, group]) => (
              <ScriptGroup
                key={path}
                path={path}
                collapsible={path !== "" && packageCount > 1 && !search.trim()}
              >
                {group.map((script) => (
                  <ScriptRow
                    key={script.scriptName}
                    script={script}
                    liveTerminalIdSet={liveTerminalIdSet}
                    actions={actions}
                    onViewTerminal={onViewTerminal}
                    onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
                  />
                ))}
              </ScriptGroup>
            ))}
            {packageQuery.isFetching ? (
              <DropdownMenuLabel>{t("common.loading")}</DropdownMenuLabel>
            ) : null}
            {packageQuery.isError ? (
              <DropdownMenuItem
                description={packageQuery.error.message}
                closeOnSelect={false}
                onSelect={retryDiscovery}
              >
                {t("common.actions.retry")}
              </DropdownMenuItem>
            ) : null}
            {groups.length === 0 && !packageQuery.isFetching ? (
              <DropdownMenuLabel>
                {t(
                  search.trim()
                    ? "workspace.scripts.states.noMatches"
                    : "workspace.scripts.states.empty",
                )}
              </DropdownMenuLabel>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  splitButton: {
    height: {
      xs: buttonControlHeight.xs,
      md: HEADER_CONTROL_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  splitButtonPrimary: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    justifyContent: "center",
  },
  splitButtonPrimaryHovered: {
    backgroundColor: theme.colors.surface2,
  },
  splitButtonText: {
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: {
      xs: theme.spacing[1.5],
      md: theme.spacing[1],
    },
    minHeight: theme.fontSize.base * 1.5,
  },
  scriptHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    minHeight: MENU_ITEM_HEIGHT,
  },
  scriptName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 18,
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
  },
  scriptNameActive: {
    color: theme.colors.foreground,
  },
  spacer: {
    flex: 1,
    minWidth: 0,
  },
  hostList: {
    marginTop: 2,
    paddingHorizontal: theme.spacing[3],
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
    minHeight: 18,
  },
  routeDisplay: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  hostLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  hostLabelActive: {
    color: theme.colors.foreground,
  },
  iconActionButton: {
    padding: 2,
  },
  routeSelectorButton: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  routeSelectorFrame: {
    flex: 1,
    minWidth: 0,
  },
  routeSelectorTrigger: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
