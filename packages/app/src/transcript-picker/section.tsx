import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useProviderIcon } from "@/components/provider-icons";
import type { TranscriptPickerState, TranscriptSource } from "./model";

interface TranscriptPickerSectionProps {
  sources: readonly TranscriptSource[];
  state: TranscriptPickerState;
  toggle: (source: TranscriptSource) => Promise<void>;
  serverId: string;
  supported: boolean;
  disabled: boolean;
  isCompact: boolean;
}

export function TranscriptPickerSection(props: TranscriptPickerSectionProps) {
  const { t } = useTranslation();
  if (props.sources.length === 0) return null;
  return (
    <View style={styles.section} testID="draft-transcript-picker">
      <View style={styles.content}>
        <Text style={styles.label}>{t("panels.draft.addTranscripts")}</Text>
        <View style={styles.buttons}>
          {props.sources.map((source) => (
            <TranscriptToggle key={source.agentId} source={source} picker={props} />
          ))}
        </View>
        {!props.supported ? (
          <Text style={styles.label}>{t("message.actions.forkUnavailable")}</Text>
        ) : null}
        {props.state.error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {props.state.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function TranscriptToggle({
  source,
  picker,
}: {
  source: TranscriptSource;
  picker: TranscriptPickerSectionProps;
}) {
  const Icon = useProviderIcon(source.provider, picker.serverId);
  const selected = picker.state.selectedAgentIds.includes(source.agentId);
  const pending = picker.state.pendingAgentIds.includes(source.agentId);
  const accessibilityState = useMemo(() => ({ checked: selected || pending }), [pending, selected]);
  const toggle = picker.toggle;
  const handlePress = useCallback(() => void toggle(source), [toggle, source]);
  return (
    <Button
      testID={`draft-transcript-toggle-${source.agentId}`}
      variant={selected || pending ? "secondary" : "outline"}
      size={picker.isCompact ? "md" : "sm"}
      leftIcon={Icon}
      style={styles.toggle}
      textStyle={styles.toggleText}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      aria-checked={selected || pending}
      disabled={picker.disabled || !picker.supported}
      loading={pending}
      onPress={handlePress}
    >
      {source.title}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    alignItems: "center",
  },
  content: { width: "100%", maxWidth: theme.contentMaxWidth, gap: theme.spacing[2] },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  toggle: { maxWidth: "100%" },
  toggleText: { flexShrink: 1 },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
