import { useMemo } from "react";
import { ListFilter, MessageSquare } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";

export function AgentViewSwitcher({
  value,
  onValueChange,
  disabled = false,
}: {
  value: "chat" | "artifacts";
  onValueChange: (value: "chat" | "artifacts") => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const options = useMemo(
    () => [
      {
        value: "chat" as const,
        label: t("agentPanel.artifacts.chatTab"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <MessageSquare color={color} size={size} />
        ),
        testID: "agent-view-chat",
        disabled,
      },
      {
        value: "artifacts" as const,
        label: t("agentPanel.stream.tab"),
        icon: ({ color, size }: { color: string; size: number }) => (
          <ListFilter color={color} size={size} />
        ),
        testID: "agent-view-artifacts",
        disabled,
      },
    ],
    [t, disabled],
  );
  return (
    <SegmentedControl
      options={options}
      value={value}
      onValueChange={onValueChange}
      size={isCompact ? "md" : "sm"}
      textWrap={isCompact}
      testID="agent-view-switcher"
      style={styles.rail}
      segmentStyle={isCompact ? styles.compactSegment : undefined}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  rail: {
    minHeight: 40,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  compactSegment: { minHeight: 44 },
}));
