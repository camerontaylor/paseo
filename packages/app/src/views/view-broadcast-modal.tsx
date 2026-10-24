import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { planBroadcastForCurrentState, runBroadcast } from "@/views/broadcast";
import type { BroadcastTarget } from "@/views/broadcast-plan";

/** Sends one prompt to every agent in a View (iTerm's "broadcast input"). */
export function ViewBroadcastModal({
  visible,
  targets,
  onClose,
}: {
  visible: boolean;
  targets: BroadcastTarget[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [retryTargets, setRetryTargets] = useState<BroadcastTarget[] | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const activeTargets = retryTargets ?? targets;
  const plan = useMemo(
    () => (visible ? planBroadcastForCurrentState(activeTargets) : []),
    [activeTargets, visible],
  );
  const counts = useMemo(
    () => ({
      send: plan.filter((entry) => entry.delivery === "send").length,
      queue: plan.filter((entry) => entry.delivery === "queue").length,
      skip: plan.filter((entry) => entry.delivery === "skip").length,
    }),
    [plan],
  );
  const header = useMemo(() => ({ title: t("views.broadcast.title") }), [t]);

  const close = useCallback(() => {
    if (isSending) return;
    setText("");
    setRetryTargets(null);
    setResetKey((key) => key + 1);
    onClose();
  }, [isSending, onClose]);

  const send = useCallback(async () => {
    if (isSending || !text.trim()) return;
    setIsSending(true);
    try {
      // Re-plan at send time: agents may have started or finished a turn meanwhile.
      const result = await runBroadcast(text, planBroadcastForCurrentState(activeTargets));
      let variant: "error" | "default" | "success" = "success";
      if (result.failed > 0) variant = "error";
      else if (result.queued > 0 || result.sent === 0) variant = "default";
      toast.show(
        t("views.broadcast.result", {
          sent: result.sent,
          queued: result.queued,
          skipped: result.skipped + result.failed,
        }),
        { variant },
      );
      if (result.retryTargets.length > 0) {
        // Keep the original draft, but never repeat an accepted or durably pending send.
        setRetryTargets(result.retryTargets);
      } else {
        setText("");
        setRetryTargets(null);
        setResetKey((key) => key + 1);
        onClose();
      }
    } finally {
      setIsSending(false);
    }
  }, [activeTargets, isSending, onClose, t, text, toast]);
  const sendVoid = useCallback(() => {
    void send();
  }, [send]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={close}
      header={header}
      testID="view-broadcast-modal"
    >
      <View style={styles.body}>
        <Text style={styles.summary}>
          {t("views.broadcast.summary", {
            send: counts.send,
            queue: counts.queue,
            skip: counts.skip,
          })}
        </Text>
        <AdaptiveTextInput
          initialValue=""
          resetKey={resetKey}
          onChangeText={setText}
          placeholder={t("views.broadcast.placeholder")}
          multiline
          autoFocus
          editable={!isSending}
          style={styles.input}
          testID="view-broadcast-input"
        />
        <View style={styles.actions}>
          <Button variant="secondary" size="sm" onPress={close} disabled={isSending}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={sendVoid}
            loading={isSending}
            disabled={!text.trim() || (counts.send + counts.queue === 0 && !retryTargets)}
            testID="view-broadcast-send"
          >
            {t(retryTargets ? "common.actions.retry" : "views.broadcast.send")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  input: {
    minHeight: 96,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.base,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
