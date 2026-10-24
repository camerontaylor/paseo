import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Mic, MicOff, PhoneOff, Square } from "lucide-react-native";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useVoiceTelemetry } from "@/contexts/voice-context";
import type { VoiceFailureKind } from "@/voice/voice-failure";
import { isVoiceFailureBlocking } from "@/voice/voice-failure";
import type { VoiceInputStatus } from "@/voice/voice-runtime";
import type { RealtimeVoiceState } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";
import { VolumeMeter } from "./volume-meter";

const VoiceMic = withUnistyles(Mic);
const VoiceMicOff = withUnistyles(MicOff);
const VoicePhoneOff = withUnistyles(PhoneOff);
const VoiceSquare = withUnistyles(Square);
const VoiceSpinner = withUnistyles(LoadingSpinner);
const whiteIcon = (theme: Theme) => ({
  size: theme.iconSize.lg,
  color: theme.colors.palette.white,
});
const filledWhiteIcon = (theme: Theme) => ({
  ...whiteIcon(theme),
  fill: theme.colors.palette.white,
});
const muteIcon = (theme: Theme) => ({ size: theme.iconSize.lg, color: theme.colors.foreground });
const whiteSpinner = (theme: Theme) => ({ color: theme.colors.palette.white });

interface RealtimeVoiceOverlayProps {
  isMuted: boolean;
  voiceCommandsEnabled?: boolean;
  realtime?: RealtimeVoiceState;
  onRealtimeControl?: (
    action: "listen" | "end_listening" | "clear" | "retry" | "focus_agent" | "back_to_assistant",
  ) => Promise<void>;
  isCaptureInterrupted?: boolean;
  isSwitching: boolean;
  failure: VoiceFailureKind | null;
  lastInputStatus?: VoiceInputStatus | null;
  isAgentRunning?: boolean;
  isCancellingAgent?: boolean;
  onToggleMute: () => void;
  onStop: () => void;
  onCancelAgent?: () => void;
}

const OVERLAY_BUTTON_SIZE = 44;
const OVERLAY_VERTICAL_PADDING = (FOOTER_HEIGHT - OVERLAY_BUTTON_SIZE) / 2;
const inputStatusLabels = {
  queued: { key: "realtimeVoice.inputQueued", defaultValue: "Speech queued for agent" },
  sent: { key: "realtimeVoice.inputSent", defaultValue: "Speech sent to agent" },
  removed: { key: "realtimeVoice.inputRemoved", defaultValue: "Speech removed from queue" },
  unknown: { key: "realtimeVoice.inputUnknown", defaultValue: "Speech delivery uncertain" },
} as const;

function voiceStatusLabel(input: {
  isCaptureInterrupted: boolean;
  listeningForUnmute: boolean;
  notListening: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}): string {
  if (input.isCaptureInterrupted)
    return input.t("realtimeVoice.interrupted", { defaultValue: "Microphone interrupted" });
  if (input.listeningForUnmute)
    return input.t("realtimeVoice.listeningForUnmute", {
      defaultValue: "Listening for “unmute microphone”",
    });
  return input.t(input.notListening ? "realtimeVoice.notListening" : "realtimeVoice.listening");
}

// Status, controls and native interruption each contribute a branch to this compact overlay.
// oxlint-disable-next-line complexity
export function RealtimeVoiceOverlay({
  isMuted,
  voiceCommandsEnabled = false,
  realtime,
  onRealtimeControl,
  isCaptureInterrupted = false,
  isSwitching,
  failure,
  lastInputStatus,
  isAgentRunning,
  isCancellingAgent,
  onToggleMute,
  onStop,
  onCancelAgent,
}: RealtimeVoiceOverlayProps) {
  const { t } = useTranslation();
  const { volume, isSpeaking } = useVoiceTelemetry();
  const [controlError, setControlError] = useState<string | null>(null);
  const runControl = useCallback(
    async (action: "listen" | "end_listening" | "clear" | "retry") => {
      if (!onRealtimeControl) return;
      setControlError(null);
      try {
        await onRealtimeControl(action);
      } catch (error) {
        setControlError(error instanceof Error ? error.message : "Voice control failed");
      }
    },
    [onRealtimeControl],
  );
  const handleRetry = useCallback(() => void runControl("retry"), [runControl]);
  const handleListen = useCallback(() => void runControl("listen"), [runControl]);
  const handleEndListening = useCallback(() => void runControl("end_listening"), [runControl]);
  const handleClear = useCallback(() => void runControl("clear"), [runControl]);
  const muteButtonStyle = useMemo(
    () => [
      styles.actionButton,
      styles.muteButton,
      isMuted ? styles.muteButtonMuted : undefined,
      isSwitching ? styles.buttonDisabled : undefined,
    ],
    [isMuted, isSwitching],
  );
  const stopButtonStyle = useMemo(
    () => [styles.actionButton, styles.stopButton, isSwitching ? styles.buttonDisabled : undefined],
    [isSwitching],
  );
  const listeningForUnmute = isMuted && voiceCommandsEnabled && !isCaptureInterrupted;
  const notListening =
    isCaptureInterrupted ||
    (isMuted && !listeningForUnmute) ||
    (failure !== null && isVoiceFailureBlocking(failure));
  return (
    <View style={styles.container}>
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text style={notListening ? styles.mutedLabel : styles.label}>
          {voiceStatusLabel({ isCaptureInterrupted, listeningForUnmute, notListening, t })}
        </Text>
        {failure && (
          <Text accessibilityRole="alert" style={styles.error}>
            {t(`realtimeVoice.failure.${failure}`)}
          </Text>
        )}
        {realtime?.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {realtime.error}
          </Text>
        )}
        {controlError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {controlError}
          </Text>
        )}
        {realtime && onRealtimeControl && (
          <View style={styles.realtimeActions}>
            {realtime.connection === "unavailable" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry GPT Realtime"
                onPress={handleRetry}
              >
                <Text style={styles.realtimeActionText}>Retry</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={realtime.mode === "listen" ? "End listening" : "Listen only"}
                onPress={realtime.mode === "listen" ? handleEndListening : handleListen}
              >
                <Text style={styles.realtimeActionText}>
                  {realtime.mode === "listen" ? "End listening" : "Listen only"}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear voice context"
              onPress={handleClear}
            >
              <Text style={styles.realtimeActionText}>Clear</Text>
            </Pressable>
          </View>
        )}
        {lastInputStatus && (
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            {t(inputStatusLabels[lastInputStatus].key, {
              defaultValue: inputStatusLabels[lastInputStatus].defaultValue,
            })}
          </Text>
        )}
      </View>
      <View style={styles.meterContainer}>
        <VolumeMeter
          volume={volume}
          isMuted={isMuted}
          isSpeaking={isSpeaking}
          orientation="horizontal"
        />
      </View>

      <View style={styles.actionsContainer}>
        {isAgentRunning && onCancelAgent && (
          <Pressable
            onPress={onCancelAgent}
            disabled={isCancellingAgent}
            accessibilityRole="button"
            accessibilityLabel={t("realtimeVoice.actions.interruptAgent", {
              defaultValue: "Interrupt agent",
            })}
            style={stopButtonStyle}
          >
            {isCancellingAgent ? (
              <VoiceSpinner size="small" uniProps={whiteSpinner} />
            ) : (
              <VoiceSquare uniProps={filledWhiteIcon} strokeWidth={2.5} />
            )}
          </Pressable>
        )}

        <Pressable
          onPress={onToggleMute}
          disabled={isSwitching}
          accessibilityRole="button"
          accessibilityLabel={
            isMuted ? t("realtimeVoice.actions.unmute") : t("realtimeVoice.actions.mute")
          }
          style={muteButtonStyle}
        >
          {isMuted ? (
            <VoiceMicOff uniProps={whiteIcon} strokeWidth={2.5} />
          ) : (
            <VoiceMic uniProps={muteIcon} strokeWidth={2.5} />
          )}
        </Pressable>

        <Pressable
          onPress={onStop}
          disabled={isSwitching}
          accessibilityRole="button"
          accessibilityLabel={t("realtimeVoice.actions.stop")}
          style={stopButtonStyle}
        >
          {isSwitching ? (
            <VoiceSpinner size="small" uniProps={whiteSpinner} />
          ) : (
            <VoicePhoneOff uniProps={whiteIcon} strokeWidth={2.5} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: FOOTER_HEIGHT,
    borderRadius: theme.borderRadius["2xl"],
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: OVERLAY_VERTICAL_PADDING,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  status: {
    flex: 1,
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  mutedLabel: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  meterContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  realtimeActionText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  muteButton: {
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  muteButtonMuted: {
    backgroundColor: theme.colors.palette.red[600],
    borderColor: theme.colors.palette.red[800],
  },
  stopButton: {
    backgroundColor: theme.colors.palette.red[600],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.red[800],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
