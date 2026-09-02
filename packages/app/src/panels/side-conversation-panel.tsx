import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageCircle } from "lucide-react-native";
import invariant from "tiny-invariant";
import type { TFunction } from "i18next";
import type { SideAnswerPayload } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";
import {
  refreshSideConversation,
  sideConversationKey,
  sideConversationTitle,
  useSideConversationStore,
} from "@/side-conversations/store";
import {
  resolveSideConversationPlaceholder,
  SIDE_CONVERSATION_PLACEHOLDER_KEYS,
  type SideConversationLoadState,
} from "@/panels/side-conversation-panel-state";

const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function answerNotice(answer: SideAnswerPayload | null | undefined, t: TFunction): string | null {
  if (!answer) return null;
  if (answer.status === "unavailable") return t("sideConversations.errors.unavailable");
  if (answer.status === "timed_out") return t("sideConversations.errors.timeout");
  if (answer.status === "failed") {
    return t("sideConversations.errors.failed", { error: answer.error });
  }
  if (answer.synthetic && answer.threading === "single_shot") {
    return `${t("sideConversations.notices.degraded")} ${t("sideConversations.notices.singleShot")}`;
  }
  if (answer.synthetic) return t("sideConversations.notices.degraded");
  if (answer.threading === "single_shot") return t("sideConversations.notices.singleShot");
  return null;
}

function canSubmitQuestion(
  hasClient: boolean,
  supported: boolean,
  question: string,
  isPending: boolean,
): boolean {
  return hasClient && supported && Boolean(question.trim()) && !isPending;
}

function useSideConversationDescriptor(
  target: { kind: "side_conversation"; parentAgentId: string; threadId: string },
  context: { serverId: string },
): PanelDescriptor {
  const record = useSideConversationStore((state) =>
    state.records.get(sideConversationKey(context.serverId, target.parentAgentId, target.threadId)),
  );
  const { t } = useTranslation();
  const title = record ? sideConversationTitle(record) : "";
  return {
    label: title || t("sideConversations.title"),
    subtitle: t("sideConversations.title"),
    tooltip: title || t("sideConversations.title"),
    // The thread is named by its first question, so a thread that has none — a freshly started
    // one, or one the daemon dropped — has a real name already: the surface's own. Waiting on a
    // record for the title leaves the tab reading "Loading" for as long as it stays open.
    titleState: "ready",
    icon: MessageCircle,
    statusBucket: record?.pendingQuestion ? "running" : null,
  };
}

function SideConversationPanel() {
  const { t } = useTranslation();
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "side_conversation", "SideConversationPanel requires side target");
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  // COMPAT(sideConversations): added in v0.5.x, remove gate after 2027-02-24.
  const supported = serverInfo?.features?.sideConversations === true;
  const record = useSideConversationStore((state) =>
    state.records.get(sideConversationKey(serverId, target.parentAgentId, target.threadId)),
  );
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [question, setQuestion] = useState("");
  const [loadState, setLoadState] = useState<SideConversationLoadState>("loading");
  const [hadRecord, setHadRecord] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The fetch below is gated on a connected, capable host, so it cannot own this reset: a pane
  // retargeted while disconnected would otherwise keep reporting the previous thread's state.
  useEffect(() => {
    setLoadState("loading");
    setHadRecord(false);
  }, [serverId, target.parentAgentId, target.threadId]);

  useEffect(() => {
    if (!client || !supported) return;
    let canceled = false;
    void refreshSideConversation(client, serverId, target.parentAgentId, target.threadId)
      .then(() => {
        if (!canceled) setLoadState("loaded");
        return undefined;
      })
      .catch(() => {
        if (!canceled) setLoadState("failed");
      });
    return () => {
      canceled = true;
    };
  }, [client, serverId, supported, target.parentAgentId, target.threadId]);

  // A thread the daemon dropped disappears from the store under an open tab. Remembering that it
  // was here is what separates "gone" from "not fetched yet".
  useEffect(() => {
    if (record) setHadRecord(true);
  }, [record]);

  const isPending = isSubmitting || Boolean(record?.pendingQuestion);
  const canSubmit = canSubmitQuestion(Boolean(client), supported, question, isPending);
  const submit = useCallback(() => {
    const nextQuestion = question.trim();
    if (!client || !supported || !nextQuestion) return;
    if (isPending) {
      setSubmitError(t("sideConversations.errors.duplicate"));
      return;
    }
    setSubmitError(null);
    setIsSubmitting(true);
    setQuestion("");
    inputRef.current?.replaceText("");
    void client
      .askSideConversation(target.parentAgentId, target.threadId, nextQuestion)
      .then(() => refreshSideConversation(client, serverId, target.parentAgentId, target.threadId))
      .catch((error: unknown) => {
        setQuestion(nextQuestion);
        inputRef.current?.replaceText(nextQuestion);
        const detail = error instanceof Error ? error.message : "";
        setSubmitError(t("sideConversations.errors.failed", { error: detail }));
      })
      .finally(() => setIsSubmitting(false));
  }, [client, isPending, question, serverId, supported, t, target.parentAgentId, target.threadId]);

  const notice = answerNotice(record?.lastAnswer, t);
  const placeholder = resolveSideConversationPlaceholder({
    loadState,
    hasRecord: Boolean(record),
    hadRecord,
    isEmpty: record?.items.length === 0,
  });
  const messages = useMemo(() => {
    const occurrences = new Map<string, number>();
    return (
      record?.items
        .filter((item) => item.type === "user_message" || item.type === "assistant_message")
        .map((item) => {
          const valueKey = `${item.type}:${item.text}`;
          const occurrence = occurrences.get(valueKey) ?? 0;
          occurrences.set(valueKey, occurrence + 1);
          return { item, key: `${valueKey}:${occurrence}` };
        }) ?? []
    );
  }, [record?.items]);

  if (serverInfo && !supported) {
    return (
      <View style={styles.centered} testID="side-conversation-panel-unsupported">
        <Text style={styles.muted}>{t("sideConversations.errors.unavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="side-conversation-panel">
      <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
        {placeholder ? (
          <Text
            style={placeholder === "failed" ? styles.error : styles.muted}
            testID={`side-conversation-panel-${placeholder}`}
          >
            {t(SIDE_CONVERSATION_PLACEHOLDER_KEYS[placeholder])}
          </Text>
        ) : null}
        {messages.map(({ item, key }) => (
          <View
            key={key}
            style={item.type === "user_message" ? styles.userMessage : styles.assistantMessage}
          >
            <Text style={styles.messageText}>{item.text}</Text>
          </View>
        ))}
        {isPending ? (
          <Text style={styles.muted}>{t("sideConversations.states.pending")}</Text>
        ) : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
      </ScrollView>
      <View style={styles.composer}>
        <ThemedTextInput
          ref={inputRef}
          style={styles.input}
          initialValue=""
          onChangeText={setQuestion}
          onSubmitEditing={submit}
          editable={!isPending}
          placeholder={t("sideConversations.composer.placeholder")}
          accessibilityLabel={t("sideConversations.composer.placeholder")}
          testID="side-conversation-input"
        />
        <Button
          variant="default"
          size="sm"
          onPress={submit}
          disabled={!canSubmit}
          loading={isPending}
          testID="side-conversation-send"
        >
          {isPending
            ? t("sideConversations.composer.pending")
            : t("sideConversations.composer.send")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  timeline: { flex: 1 },
  timelineContent: { padding: theme.spacing[4], gap: theme.spacing[3] },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[6] },
  muted: { color: theme.colors.foregroundMuted, textAlign: "center" },
  error: { color: theme.colors.destructive, textAlign: "center" },
  notice: { color: theme.colors.foregroundMuted, textAlign: "center", fontSize: theme.fontSize.sm },
  userMessage: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface3,
  },
  assistantMessage: { alignSelf: "stretch", paddingVertical: theme.spacing[1] },
  messageText: { color: theme.colors.foreground, fontSize: theme.fontSize.content },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 144,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.content,
  },
}));

export const sideConversationPanelRegistration = definePanel("side_conversation", {
  component: SideConversationPanel,
  useDescriptor: useSideConversationDescriptor,
});
