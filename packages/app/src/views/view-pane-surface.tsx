import { memo, useCallback, useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { WorkspacePaneContent } from "@/screens/workspace/workspace-pane-content";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import {
  WorkspaceTabPresentationResolver,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { collectAllPanes, findPaneById } from "@/stores/workspace-layout-actions";
import type { Theme } from "@/styles/theme";
import type { ViewPaneSurfaceProps } from "@/views/view-pane-surface.types";
import { useViewPaneActions } from "@/views/view-pane-actions";

const ThemedX = withUnistyles(X);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Native View surface: the focused pane only (the header pages between panes), with a tab
 * strip for that pane's sessions. Native has no split container, same as workspaces.
 */
export function ViewPaneSurface({
  layout,
  uiTabs,
  renderMainHeader,
  buildPaneContentModel,
  onNavigateTab,
  onCloseTab,
  renderEmptyPane,
  isWorkspaceFocused,
}: ViewPaneSurfaceProps) {
  const viewPaneActions = useViewPaneActions();
  const pane =
    findPaneById(layout.root, layout.focusedPaneId) ?? collectAllPanes(layout.root)[0] ?? null;
  const paneState = useMemo(
    () => (pane ? deriveWorkspacePaneState({ pane, tabs: uiTabs }) : null),
    [pane, uiTabs],
  );
  const tabs = useMemo(() => paneState?.tabs.map((tab) => tab.descriptor) ?? [], [paneState]);
  const activeTab = paneState?.activeTab?.descriptor ?? null;
  const paneId = pane?.id ?? null;
  const content = useMemo(
    () => (activeTab && paneId ? buildPaneContentModel({ paneId, tab: activeTab }) : null),
    [activeTab, buildPaneContentModel, paneId],
  );
  const handleAdd = useCallback(() => {
    if (paneId) viewPaneActions?.onAddTab(paneId);
  }, [paneId, viewPaneActions]);

  let body: ReactNode = null;
  if (content) {
    body = (
      <WorkspacePaneContent
        key={content.key}
        content={content}
        isWorkspaceFocused={isWorkspaceFocused}
        isPaneFocused
      />
    );
  } else if (paneId) {
    body = renderEmptyPane(paneId);
  }

  return (
    <View style={styles.container}>
      {renderMainHeader?.()}
      {tabs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabStrip}
          contentContainerStyle={styles.tabStripContent}
        >
          {tabs.map((tab) => (
            <ViewNativeTabChip
              key={tab.key}
              tab={tab}
              active={tab.tabId === activeTab?.tabId}
              onSelect={onNavigateTab}
              onClose={onCloseTab}
            />
          ))}
          {viewPaneActions ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={viewPaneActions.addTabLabel}
              onPress={handleAdd}
              style={styles.addChip}
              testID="view-native-add-tab"
            >
              <Text style={styles.addChipText}>+</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
      <View style={styles.content}>{body}</View>
    </View>
  );
}

const ViewNativeTabChip = memo(function ViewNativeTabChip({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: WorkspaceTabDescriptor;
  active: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => Promise<void> | void;
}) {
  const select = useCallback(() => onSelect(tab.tabId), [onSelect, tab.tabId]);
  const close = useCallback(() => {
    void onClose(tab.tabId);
  }, [onClose, tab.tabId]);
  const renderLabel = useCallback(
    (presentation: WorkspaceTabPresentation) => (
      <Text numberOfLines={1} style={active ? styles.chipLabelActive : styles.chipLabel}>
        {presentation.label}
      </Text>
    ),
    [active],
  );
  return (
    <View style={active ? [styles.chip, styles.chipActive] : styles.chip}>
      <Pressable
        accessibilityRole="button"
        onPress={select}
        style={styles.chipLabelButton}
        testID={`view-native-tab-${tab.tabId}`}
      >
        <WorkspaceTabPresentationResolver
          tab={tab}
          serverId={tab.scope?.serverId ?? ""}
          workspaceId={tab.scope?.workspaceId ?? ""}
        >
          {renderLabel}
        </WorkspaceTabPresentationResolver>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={close} hitSlop={8} style={styles.chipClose}>
        <ThemedX size={12} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  tabStrip: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabStripContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 220,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  chipActive: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  chipLabelButton: {
    flexShrink: 1,
    paddingLeft: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chipLabelActive: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  chipClose: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
  },
  addChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  addChipText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  content: {
    flex: 1,
  },
}));
