import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useSettledKeyboardShift } from "@/keyboard/shift";
import { dismissSoftwareKeyboard } from "@/keyboard/software-keyboard-dismiss";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { shouldShowKeyboardDismissButton } from "./keyboard-dismiss-model";

const ThemedChevronDown = withUnistyles(ChevronDown);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A visible way to put the software keyboard away while composing. Renders in
 * the composer's button row only while the keyboard occupies screen space;
 * the flick-down gesture on the chat history remains the other dismissal path.
 */
export function ComposerKeyboardDismissButton() {
  const { t } = useTranslation();
  const settledKeyboardShift = useSettledKeyboardShift();
  if (!shouldShowKeyboardDismissButton(settledKeyboardShift)) {
    return null;
  }
  return (
    <ToolbarButton
      onPress={dismissSoftwareKeyboard}
      label={t("composer.input.dismissKeyboard")}
      testID="message-input-keyboard-dismiss-button"
      style={styles.button}
    >
      <ThemedChevronDown size={ICON_SIZE.lg} uniProps={iconForegroundMutedMapping} />
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  button: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
}));
