import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceSnooze } from "@getpaseo/protocol/workspace-snooze";

export function WorkspaceSnoozeIndicator({ snooze }: { snooze: WorkspaceSnooze }) {
  const { t } = useTranslation();
  const detail =
    snooze.config.mode === "time"
      ? new Date(snooze.config.wakeAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : t(`workspaceSnooze.result.${snooze.lastCheck?.status ?? "pending"}`);
  return (
    <Text style={styles.label} numberOfLines={1} testID="workspace-snooze-indicator">
      {t("workspaceSnooze.snoozed")} · {detail}
    </Text>
  );
}
const styles = StyleSheet.create((theme) => ({
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
