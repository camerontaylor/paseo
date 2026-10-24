import { Search, X } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { PressHighlight } from "@/components/ui/press-highlight";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useSidebarModel } from "./sidebar-model";
import { useUniqueSessionForQuery } from "./sidebar-filter-context";
import { SidebarFilterScopeMenu } from "./sidebar-filter-scope-menu";
import { useSidebarFilterRequestFocus } from "./sidebar-filter-request";
import { useStartChatFromFilterQuery } from "./use-start-chat-from-filter-query";
import { useRoutingBridge } from "./find-or-start";

/** The same Find field is shown on compact and desktop sidebars. Typing never sends a prompt. */
const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function SidebarFindControls() {
  const { t } = useTranslation();
  const { searchQuery, setSearchQuery } = useSidebarModel();
  const uniqueSession = useUniqueSessionForQuery();
  const startChat = useStartChatFromFilterQuery();
  const inputRef = useRef<EditingTextInputHandle>(null);
  useSidebarFilterRequestFocus(inputRef);
  useEffect(() => {
    if (!searchQuery && inputRef.current?.getText()) inputRef.current.reset();
  }, [searchQuery]);

  const openOrStart = useCallback(() => {
    if (uniqueSession) {
      navigateToAgent(uniqueSession);
      return;
    }
    if (searchQuery.trim()) startChat(false);
  }, [uniqueSession, searchQuery, startChat]);
  const onKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = event.nativeEvent as TextInputKeyPressEventData & {
        metaKey?: boolean;
        ctrlKey?: boolean;
        shiftKey?: boolean;
        repeat?: boolean;
        isComposing?: boolean;
      };
      if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey) || key.isComposing || key.repeat)
        return;
      event.preventDefault();
      if (key.shiftKey) startChat(true);
      else useRoutingBridge.getState().entry?.findWithAi();
    },
    [startChat],
  );
  const clear = useCallback(() => {
    inputRef.current?.reset();
    setSearchQuery("");
  }, [setSearchQuery]);

  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <ThemedSearch size={15} uniProps={mutedColor} />
        <EditingTextInput
          ref={inputRef}
          initialValue={searchQuery}
          onChangeText={setSearchQuery}
          onKeyPress={onKeyPress}
          onSubmitEditing={openOrStart}
          returnKeyType="go"
          placeholder={t("sidebar.filterSidebar.placeholder")}
          accessibilityLabel={t("sidebar.filterSidebar.placeholder")}
          autoCorrect={false}
          autoCapitalize="none"
          testID="sidebar-title-project-filter"
          style={styles.input}
        />
        {searchQuery ? (
          <PressHighlight
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.filterSidebar.clear")}
            testID="sidebar-title-project-filter-clear"
          >
            <ThemedX size={14} uniProps={mutedColor} />
          </PressHighlight>
        ) : null}
      </View>
      <SidebarFilterScopeMenu />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  field: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 9,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: theme.colors.foreground,
    fontSize: 13,
  },
}));
