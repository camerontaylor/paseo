import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageCircle } from "lucide-react-native";
import invariant from "tiny-invariant";
import type { TFunction } from "i18next";
import type { SideAnswerPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import {
  queueComposerMessageOnServer,
  type QueueWriter,
  type QueueOutboxWriter,
} from "@/composer/actions";
import { useQueueOutboxStore } from "@/stores/queue-outbox-store";
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
import { buildSendBackText, latestAssistantReply } from "@/threads/model";
import { generateMessageId } from "@/types/stream";
import { useThreadOriginNavigationStore } from "@/threads/origin-navigation-store";
import {
  resolveSideConversationPlaceholder,
  SIDE_CONVERSATION_PLACEHOLDER_KEYS,
  type SideConversationLoadState,
  type SideConversationPlaceholder,
} from "@/panels/side-conversation-panel-state";

const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

function answerNotice(answer: SideAnswerPayload | null | undefined, t: TFunction): string | null {
  if (!answer) return null;
  // An unavailable answer means one of two things: the provider has no side questions at
  // all, or the agent closed while this question was in flight. The reason field tells
  // them apart; absent is treated as the provider case (pre-fork daemons never answer).
  if (answer.status === "unavailable") {
    return answer.reason === "session_closed"
      ? t("sideConversations.errors.sessionClosed")
      : t("sideConversations.errors.unavailable");
  }
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

function ThreadActionBar({
  hasOrigin,
  openSourceReply,
  originNavigationStatus,
  sendBackError,
  sendBackText,
  canSendBack,
  alreadySentBack,
  isSendingBack,
  sendBack,
  t,
}: {
  hasOrigin: boolean;
  openSourceReply: () => void;
  originNavigationStatus: string | null;
  sendBackError: string | null;
  sendBackText: string | null;
  canSendBack: boolean;
  alreadySentBack: boolean;
  isSendingBack: boolean;
  sendBack: () => void;
  t: TFunction;
}) {
  return (
    <View style={styles.threadActions}>
      {hasOrigin ? (
        <Button variant="secondary" size="sm" onPress={openSourceReply} testID="thread-open-source">
          {t("sideConversations.actions.openSourceReply")}
        </Button>
      ) : (
        <Text style={styles.muted} testID="thread-origin-unavailable">
          {t("sideConversations.errors.originUnavailable")}
        </Text>
      )}
      {originNavigationStatus === "unavailable" ? (
        <Text style={styles.error} testID="thread-source-unavailable">
          {t("sideConversations.errors.originUnavailable")}
        </Text>
      ) : null}
      {originNavigationStatus === "failed" ? (
        <Text style={styles.error} testID="thread-source-failed">
          {t("sideConversations.errors.sourceOpenFailed")}
        </Text>
      ) : null}
      {sendBackError ? <Text style={styles.error}>{sendBackError}</Text> : null}
      {sendBackText ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={sendBack}
          disabled={!canSendBack}
          loading={isSendingBack}
          testID="thread-send-back"
        >
          {alreadySentBack
            ? t("sideConversations.actions.sentBackToMain")
            : t("sideConversations.actions.sendBackToMain")}
        </Button>
      ) : null}
    </View>
  );
}

function ThreadTimeline({
  messages,
  placeholder,
  isPending,
  notice,
  submitError,
  t,
}: {
  messages: readonly {
    item: { type: "user_message" | "assistant_message"; text: string };
    key: string;
  }[];
  placeholder: SideConversationPlaceholder | null;
  isPending: boolean;
  notice: string | null;
  submitError: string | null;
  t: TFunction;
}) {
  return (
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
      {isPending ? <Text style={styles.muted}>{t("sideConversations.states.pending")}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
    </ScrollView>
  );
}

function ThreadComposer({
  inputRef,
  question,
  isPending,
  canSubmit,
  onChangeQuestion,
  onSubmit,
  t,
}: {
  inputRef: React.RefObject<EditingTextInputHandle | null>;
  question: string;
  isPending: boolean;
  canSubmit: boolean;
  onChangeQuestion: (question: string) => void;
  onSubmit: () => void;
  t: TFunction;
}) {
  return (
    <View style={styles.composer}>
      <ThemedTextInput
        ref={inputRef}
        style={styles.input}
        initialValue={question}
        onChangeText={onChangeQuestion}
        onSubmitEditing={onSubmit}
        editable={!isPending}
        placeholder={t("sideConversations.composer.placeholder")}
        accessibilityLabel={t("sideConversations.composer.placeholder")}
        testID="side-conversation-input"
      />
      <Button
        variant="default"
        size="sm"
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={isPending}
        testID="side-conversation-send"
      >
        {isPending ? t("sideConversations.composer.pending") : t("sideConversations.composer.send")}
      </Button>
    </View>
  );
}

function useRefreshSideConversation(input: {
  client: ReturnType<typeof useSessionStore.getState>["sessions"][string]["client"] | null;
  serverId: string;
  target: { parentAgentId: string; threadId: string };
  supported: boolean;
  setLoadState: (state: SideConversationLoadState) => void;
}) {
  const { client, serverId, target, supported, setLoadState } = input;
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
  }, [client, serverId, supported, target.parentAgentId, target.threadId, setLoadState]);
}

function useSubmitSideConversation(input: {
  client: DaemonClient | null;
  supported: boolean;
  question: string;
  isPending: boolean;
  serverId: string;
  parentAgentId: string;
  threadId: string;
  inputRef: React.RefObject<EditingTextInputHandle | null>;
  setQuestion: (question: string) => void;
  setSubmitError: (error: string | null) => void;
  setIsSubmitting: (submitting: boolean) => void;
  t: TFunction;
}) {
  const {
    client,
    supported,
    question,
    isPending,
    serverId,
    parentAgentId,
    threadId,
    inputRef,
    setQuestion,
    setSubmitError,
    setIsSubmitting,
    t,
  } = input;
  return useCallback(() => {
    const nextQuestion = question.trim();
    if (!client || !supported || !nextQuestion || isPending) return;
    setSubmitError(null);
    setIsSubmitting(true);
    setQuestion("");
    inputRef.current?.replaceText("");
    void client
      .askSideConversation(parentAgentId, threadId, nextQuestion)
      .then(() => refreshSideConversation(client, serverId, parentAgentId, threadId))
      .catch((error: unknown) => {
        setQuestion(nextQuestion);
        inputRef.current?.replaceText(nextQuestion);
        const detail = error instanceof Error ? error.message : "";
        setSubmitError(t("sideConversations.errors.failed", { error: detail }));
      })
      .finally(() => setIsSubmitting(false));
  }, [
    client,
    inputRef,
    isPending,
    parentAgentId,
    question,
    serverId,
    setIsSubmitting,
    setQuestion,
    setSubmitError,
    supported,
    t,
    threadId,
  ]);
}

async function runSendBack(input: {
  client: DaemonClient | null;
  serverId: string;
  parentAgentId: string;
  threadId: string;
  supportsDurableQueue: boolean;
  hasDestinationAgent: boolean;
  destinationAgentArchived: boolean;
  sendBackText: string | null;
  queueWriter: QueueWriter;
  queueOutbox: QueueOutboxWriter;
  applyAgentQueueSnapshot: (
    serverId: string,
    snapshot: Parameters<ReturnType<typeof useSessionStore.getState>["applyAgentQueueSnapshot"]>[1],
  ) => void;
  prepareSendBack: ReturnType<typeof useSideConversationStore.getState>["prepareSendBack"];
  updateSendBackStatus: ReturnType<
    typeof useSideConversationStore.getState
  >["updateSendBackStatus"];
  setSendBackError: (error: string | null) => void;
  setIsSendingBack: (loading: boolean) => void;
  t: TFunction;
}): Promise<void> {
  if (
    !input.client ||
    !input.supportsDurableQueue ||
    !input.sendBackText ||
    !input.hasDestinationAgent ||
    input.destinationAgentArchived
  ) {
    input.setSendBackError(
      input.destinationAgentArchived
        ? input.t("sideConversations.errors.mainAgentArchived")
        : input.t("sideConversations.errors.mainQueueUnavailable"),
    );
    return;
  }
  input.setSendBackError(null);
  input.setIsSendingBack(true);
  const itemId = input.prepareSendBack(
    input.serverId,
    input.parentAgentId,
    input.threadId,
    input.sendBackText,
    generateMessageId(),
  );
  try {
    const result = await queueComposerMessageOnServer({
      client: input.client,
      agentId: input.parentAgentId,
      text: input.sendBackText,
      itemId,
      attachments: [],
      encodeImages: async () => [],
      queue: input.queueWriter,
      applySnapshot: (snapshot) => input.applyAgentQueueSnapshot(input.serverId, snapshot),
      outbox: input.queueOutbox,
    });
    if (result.error && !result.queued) {
      input.updateSendBackStatus(
        input.serverId,
        input.parentAgentId,
        input.threadId,
        itemId,
        "failed",
      );
      input.setSendBackError(
        input.t("sideConversations.errors.sendBackFailed", { error: result.error }),
      );
    } else if (result.queued) {
      input.updateSendBackStatus(
        input.serverId,
        input.parentAgentId,
        input.threadId,
        itemId,
        "queued",
      );
      if (result.error) {
        input.setSendBackError(
          input.t("sideConversations.errors.sendBackFailed", { error: result.error }),
        );
      }
    }
  } catch (error) {
    input.updateSendBackStatus(
      input.serverId,
      input.parentAgentId,
      input.threadId,
      itemId,
      "failed",
    );
    input.setSendBackError(
      input.t("sideConversations.errors.sendBackFailed", {
        error: error instanceof Error ? error.message : "",
      }),
    );
  } finally {
    input.setIsSendingBack(false);
  }
}

function isSideConversationUnsupported(serverInfo: unknown, supported: boolean): boolean {
  return Boolean(serverInfo) && !supported;
}

function canSendBackToMain(input: {
  supportsDurableQueue: boolean;
  hasDestinationAgent: boolean;
  destinationAgentArchived: boolean;
  alreadySentBack: boolean;
  isSendingBack: boolean;
}): boolean {
  return (
    input.supportsDurableQueue &&
    input.hasDestinationAgent &&
    !input.destinationAgentArchived &&
    !input.alreadySentBack &&
    !input.isSendingBack
  );
}

function SideConversationPanel() {
  const { t } = useTranslation();
  const pane = usePaneContext();
  const { serverId, target } = pane;
  invariant(target.kind === "side_conversation", "SideConversationPanel requires side target");
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  const destinationAgent = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      session?.agents?.get(target.parentAgentId) ??
      session?.agentDetails?.get(target.parentAgentId) ??
      null
    );
  });
  const supportsDurableQueue = serverInfo?.features?.durableAgentQueueV1 === true;
  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const applyAgentQueueSnapshot = useSessionStore((state) => state.applyAgentQueueSnapshot);
  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (agentId) =>
        useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(agentId) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );
  const queueOutbox = useMemo<QueueOutboxWriter>(
    () => ({
      add: (entry) => useQueueOutboxStore.getState().add({ ...entry, serverId }),
      remove: (itemId) => useQueueOutboxStore.getState().remove(itemId),
    }),
    [serverId],
  );
  // COMPAT(sideConversations): added in 0.7.0-beta.2.fork.1, fork-only — stock peers never gain it, so the gate lasts as long as stock peers are supported.
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
  const [isSendingBack, setIsSendingBack] = useState(false);
  const [sendBackError, setSendBackError] = useState<string | null>(null);
  const threadKey = sideConversationKey(serverId, target.parentAgentId, target.threadId);
  const origin = useSideConversationStore((state) => state.origins[threadKey]);
  const sendBackReceipt = useSideConversationStore((state) => state.sendBacks[threadKey]);
  const prepareSendBack = useSideConversationStore((state) => state.prepareSendBack);
  const updateSendBackStatus = useSideConversationStore((state) => state.updateSendBackStatus);
  const originNavigationStatus = useThreadOriginNavigationStore(
    (state) => state.statusByThread[threadKey]?.status ?? null,
  );
  const requestOriginNavigation = useThreadOriginNavigationStore((state) => state.request);

  // The fetch below is gated on a connected, capable host, so it cannot own this reset: a pane
  // retargeted while disconnected would otherwise keep reporting the previous thread's state.
  useEffect(() => {
    setLoadState("loading");
    setHadRecord(false);
  }, [serverId, target.parentAgentId, target.threadId]);

  useRefreshSideConversation({ client, serverId, target, supported, setLoadState });

  // A thread the daemon dropped disappears from the store under an open tab. Remembering that it
  // was here is what separates "gone" from "not fetched yet".
  useEffect(() => {
    setHadRecord((current) => current || Boolean(record));
  }, [record]);

  const isPending = isSubmitting || Boolean(record?.pendingQuestion);
  const canSubmit = canSubmitQuestion(Boolean(client), supported, question, isPending);
  const submit = useSubmitSideConversation({
    client,
    supported,
    question,
    isPending,
    serverId,
    parentAgentId: target.parentAgentId,
    threadId: target.threadId,
    inputRef,
    setQuestion,
    setSubmitError,
    setIsSubmitting,
    t,
  });

  const latestReply = latestAssistantReply(record);
  const sendBackText = latestReply
    ? buildSendBackText({
        threadTitle: (record ? sideConversationTitle(record) : "") || t("sideConversations.title"),
        threadId: target.threadId,
        reply: latestReply,
      })
    : null;
  const alreadySentBack = Boolean(
    sendBackText && sendBackReceipt?.answer === sendBackText && sendBackReceipt.status === "queued",
  );
  const sendBack = useCallback(() => {
    void runSendBack({
      client,
      serverId,
      parentAgentId: target.parentAgentId,
      threadId: target.threadId,
      supportsDurableQueue,
      hasDestinationAgent: Boolean(destinationAgent),
      destinationAgentArchived: Boolean(destinationAgent?.archivedAt),
      sendBackText,
      queueWriter,
      queueOutbox,
      applyAgentQueueSnapshot,
      prepareSendBack,
      updateSendBackStatus,
      setSendBackError,
      setIsSendingBack,
      t,
    });
  }, [
    applyAgentQueueSnapshot,
    client,
    destinationAgent,
    prepareSendBack,
    queueOutbox,
    queueWriter,
    sendBackText,
    serverId,
    supportsDurableQueue,
    t,
    target.parentAgentId,
    target.threadId,
    updateSendBackStatus,
  ]);
  const openSourceReply = useCallback(() => {
    invariant(origin, "Thread origin is required for source navigation");
    requestOriginNavigation({
      serverId,
      parentAgentId: target.parentAgentId,
      threadId: target.threadId,
      anchor: origin.anchor,
    });
    pane.openTab({ kind: "agent", agentId: target.parentAgentId });
  }, [origin, pane, requestOriginNavigation, serverId, target.parentAgentId, target.threadId]);

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

  if (isSideConversationUnsupported(serverInfo, supported)) {
    return (
      <View style={styles.centered} testID="side-conversation-panel-unsupported">
        <Text style={styles.muted}>{t("sideConversations.errors.unavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="side-conversation-panel">
      <ThreadActionBar
        hasOrigin={Boolean(origin)}
        openSourceReply={openSourceReply}
        originNavigationStatus={originNavigationStatus}
        sendBackError={sendBackError}
        sendBackText={sendBackText}
        canSendBack={canSendBackToMain({
          supportsDurableQueue,
          hasDestinationAgent: Boolean(destinationAgent),
          destinationAgentArchived: Boolean(destinationAgent?.archivedAt),
          alreadySentBack,
          isSendingBack,
        })}
        alreadySentBack={alreadySentBack}
        isSendingBack={isSendingBack}
        sendBack={sendBack}
        t={t}
      />
      <ThreadTimeline
        messages={messages}
        placeholder={placeholder}
        isPending={isPending}
        notice={notice}
        submitError={submitError}
        t={t}
      />
      <ThreadComposer
        inputRef={inputRef}
        question={question}
        isPending={isPending}
        canSubmit={canSubmit}
        onChangeQuestion={setQuestion}
        onSubmit={submit}
        t={t}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  threadActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
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
