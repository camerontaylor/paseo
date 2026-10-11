import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArtifactCard, ArtifactFeed } from "@/artifacts/feed";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ToastApi } from "@/components/toast-host";
import { useHostRuntimeConnectionStatus, useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatMessageTimestamp } from "@/utils/time";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { useSessionStore } from "@/stores/session-store";
import { buildCompanionFeed, type CompanionFeedItem } from "./model";
import { ArtifactPinOperations } from "./artifact-pin-operations";
import { useGlobalStream } from "./use-global-stream";

interface CompanionFeedProps {
  serverId: string;
  agentId: string;
  cwd: string;
  captureDegraded?: boolean;
  artifacts: readonly AgentArtifact[];
  isSupported: boolean;
  artifactsSupported: boolean;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  toast?: ToastApi | null;
}

const keyExtractor = (item: CompanionFeedItem) => item.id;
const NoteInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

type ViewTab = "checklist" | "stream" | "pinned";
type StreamFilter = "all" | "question" | "feature_request" | "permission" | "outcome" | "q_and_a";

export function CompanionFeed({
  serverId,
  agentId,
  cwd,
  captureDegraded,
  artifacts,
  isSupported,
  artifactsSupported,
  onOpenWorkspaceFile,
  onReturnToChat,
  onReplyInChat,
  toast,
}: CompanionFeedProps) {
  const { t } = useTranslation();
  const connection = useHostRuntimeConnectionStatus(serverId);
  const client = useHostRuntimeClient(serverId);
  const supportsWrites = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.globalStream === true,
  );
  // COMPAT(durableStream): added in v0.11.1-fork (C2), remove after 2027-04-07.
  // The plan mandates trackedAsks as this gate's name (not the source's durableStream).
  const supportsDurableStream = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.trackedAsks === true,
  );
  const [saving, setSaving] = useState(false);
  // Ownership of the pending state: several writes can overlap (two artifact
  // long-presses), and `saving` clears only when the LAST one settles, so the
  // first completion cannot re-enable controls while another is pending.
  const pendingSaves = useRef(0);
  // Retry identity is scoped per host+agent+action: switching tabs after a
  // lost acknowledgement starts a fresh identity instead of replaying the
  // old id under a different action prefix.
  const draftEntryIds = useRef(new Map<string, string>());
  const artifactPins = useRef(new ArtifactPinOperations());
  const [saveError, setSaveError] = useState<string | null>(null);

  const [viewTab, setViewTab] = useState<ViewTab>("checklist");
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [pinText, setPinText] = useState("");
  const noteInput = useRef<EditingTextInputHandle>(null);

  const pendingFilter = onlyOpen ? "pending" : "all";
  const query = useGlobalStream({
    serverId,
    agentId,
    asksOnly: viewTab === "checklist",
    filter: viewTab === "pinned" ? "pinned" : pendingFilter,
    includeArchived: true,
    enabled: isSupported && supportsDurableStream,
  });
  const { refetch, fetchNextPage } = query;
  const items = useMemo(
    () =>
      buildCompanionFeed(
        query.rows.flatMap((row) => (row.item.kind === "entry" ? [row.item.entry] : [])),
        query.rows.flatMap((row) => (row.item.kind === "artifact" ? [row.item.artifact] : [])),
      ),
    [query.rows],
  );
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const loadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (viewTab === "checklist") {
        // The server already scopes asksOnly reads; keep cached rows consistent.
        return item.kind === "entry" && item.entry.ask !== undefined;
      }
      if (viewTab === "pinned") {
        return item.kind === "entry" && item.entry.kind === "pin";
      } else {
        // Stream / Queue
        if (item.kind === "entry" && item.entry.kind === "pin") return false;

        if (item.kind === "artifact") {
          return filter === "all" && !onlyOpen;
        }

        if (filter !== "all" && item.entry.kind !== filter) return false;

        if (onlyOpen) {
          if (item.entry.kind === "question" || item.entry.kind === "feature_request") {
            return isCompanionEntryPending(item.entry);
          }
          if (item.entry.kind === "permission") {
            return item.entry.status === "pending";
          }
          return false;
        }

        return true;
      }
    });
  }, [items, viewTab, filter, onlyOpen]);

  const openArtifact = useCallback(
    (artifact: AgentArtifact) => {
      onOpenWorkspaceFile?.({ location: { path: artifact.path }, disposition: "side" });
      onReturnToChat();
    },
    [onOpenWorkspaceFile, onReturnToChat],
  );

  const reportFailure = useCallback(() => {
    toast?.error(t("agentPanel.stream.mutationFailed"));
  }, [toast, t]);

  const save = useCallback(
    async (input: Parameters<NonNullable<typeof client>["updateStreamEntry"]>[0]) => {
      pendingSaves.current += 1;
      setSaving(true);
      setSaveError(null);
      try {
        if (!client || !supportsWrites || connection !== "online") {
          throw new Error(t("globalStream.writeUnavailable"));
        }
        // Ask-bearing entries mutate only through the tracked-asks contract:
        // without the host's trackedAsks flag the write is refused before any
        // frame is sent (never a revision-less compatibility fallback).
        // A brand-new ask has no cached target to inspect, so `set_ask` is
        // guarded directly rather than through the entry lookup below.
        if (input.action === "set_ask" && !supportsDurableStream) {
          throw new Error(t("globalStream.writeUnavailable"));
        }
        const target = items.find(
          (item) => item.kind === "entry" && item.entry.id === input.entryId,
        );
        if (target?.kind === "entry" && target.entry.ask && !supportsDurableStream) {
          throw new Error(t("globalStream.writeUnavailable"));
        }
        await client.updateStreamEntry(input);
        await refetch();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : t("globalStream.saveFailed"));
        reportFailure();
        throw error;
      } finally {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) {
          setSaving(false);
        }
      }
    },
    [client, connection, supportsWrites, supportsDurableStream, items, t, reportFailure, refetch],
  );
  const handleUpdateStatus = useCallback(
    (entryId: string, status: "open" | "reviewed" | "done") => {
      const entry = items.find((item) => item.kind === "entry" && item.entry.id === entryId);
      const expectedRevision = entry?.kind === "entry" ? entry.entry.ask?.revision : undefined;
      void save({ agentId, entryId, action: "update_status", status, expectedRevision }).catch(
        () => undefined,
      );
    },
    [save, agentId, items],
  );

  const handleRemovePin = useCallback(
    (entryId: string) => {
      void save({ agentId, entryId, action: "remove_pin" }).catch(() => undefined);
    },
    [save, agentId],
  );

  const handlePinArtifact = useCallback(
    (artifact: { path: string }) => {
      void artifactPins.current.save(serverId, agentId, artifact.path, save).catch(() => undefined);
    },
    [save, serverId, agentId],
  );

  const renderItem = useCallback(
    ({ item }: { item: CompanionFeedItem }) =>
      item.kind === "artifact" ? (
        <ArtifactCard
          artifact={item.artifact}
          serverId={serverId}
          cwd={cwd}
          onOpen={openArtifact}
          pinDisabled={saving || !supportsWrites || connection !== "online"}
          // eslint-disable-next-line react-perf/jsx-no-new-function-as-prop
          onPin={() => handlePinArtifact(item.artifact)}
        />
      ) : (
        <EntryCard
          entry={item.entry}
          serverId={serverId}
          onReturnToChat={onReturnToChat}
          onReplyInChat={onReplyInChat}
          onUpdateStatus={handleUpdateStatus}
          onRemovePin={handleRemovePin}
          disabled={
            saving ||
            !supportsWrites ||
            connection !== "online" ||
            Boolean(item.entry.ask && !supportsDurableStream)
          }
        />
      ),
    [
      serverId,
      cwd,
      openArtifact,
      handlePinArtifact,
      onReturnToChat,
      onReplyInChat,
      handleUpdateStatus,
      handleRemovePin,
      saving,
      supportsWrites,
      supportsDurableStream,
      connection,
    ],
  );

  const handleToggleOnlyOpen = useCallback(() => setOnlyOpen((v) => !v), []);
  // The checklist submits through `set_ask`, which needs the host's
  // trackedAsks capability. Fence it when the flag is absent or was lost: the
  // typed draft stays put and no frame is sent (never fall back to another
  // action that would mutate the stream under the user's feet).
  const checklistFenced = viewTab === "checklist" && !supportsDurableStream;
  const handleSubmitPin = useCallback(() => {
    if (!pinText.trim() || saving) return;
    const action = ({ pinned: "add_pin", checklist: "set_ask", stream: "add_question" } as const)[
      viewTab
    ];
    if (action === "set_ask" && !supportsDurableStream) return;
    const identityKey = JSON.stringify([serverId, agentId, action]);
    const entryId = draftEntryIds.current.get(identityKey) ?? globalThis.crypto.randomUUID();
    draftEntryIds.current.set(identityKey, entryId);
    void save({
      agentId,
      action,
      entryId,
      text: pinText.trim(),
      ...(action === "set_ask"
        ? { expectedRevision: 0, ask: { state: "open" as const, remaining: "", evidence: "" } }
        : {}),
    })
      .then(() => {
        draftEntryIds.current.delete(identityKey);
        setPinText("");
        noteInput.current?.replaceText("");
        return;
      })
      .catch(() => undefined);
  }, [save, agentId, serverId, pinText, viewTab, saving, supportsDurableStream]);

  const inputPlaceholderKey = {
    checklist: "globalStream.askPlaceholder",
    pinned: "agentPanel.stream.notePlaceholder",
    stream: "globalStream.questionPlaceholder",
  }[viewTab];
  const submitLabelKey = {
    checklist: "globalStream.addAsk",
    pinned: "agentPanel.stream.addNote",
    stream: "globalStream.addQuestion",
  }[viewTab];

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.title}>{t("agentPanel.stream.title")}</Text>
        <Text style={styles.description}>{t("agentPanel.stream.description")}</Text>

        {connection !== "online" ? (
          <View style={styles.notice} testID="companion-stream-connection">
            {connection === "connecting" ? <ActivityIndicator size="small" /> : null}
            <Text style={styles.description}>{t("agentPanel.stream.offline")}</Text>
          </View>
        ) : null}

        {captureDegraded ? (
          <View style={styles.notice} testID="companion-stream-degraded">
            <Text accessibilityRole="alert" style={styles.description}>
              {t("globalStream.captureDegraded")}
            </Text>
          </View>
        ) : null}

        <SegmentedControl
          value={viewTab}
          onValueChange={setViewTab}
          options={[
            ...(supportsDurableStream
              ? [{ value: "checklist" as const, label: t("globalStream.checklistTab") }]
              : []),
            { value: "stream", label: t("agentPanel.stream.queueTab") },
            { value: "pinned", label: t("agentPanel.stream.pinnedTab") },
          ]}
        />

        <Button
          variant="ghost"
          onPress={refresh}
          disabled={query.isFetching || connection !== "online"}
          testID="companion-stream-refresh"
        >
          {t("globalStream.refresh")}
        </Button>
        {query.notices.map((notice) => (
          <Text key={notice} accessibilityRole="alert" style={styles.description}>
            {notice}
          </Text>
        ))}
        {viewTab === "checklist" ? (
          <Text style={styles.description}>{t("globalStream.checklistHint")}</Text>
        ) : null}

        {viewTab !== "pinned" && (
          <View style={styles.segmentContainer}>
            <SegmentedControl
              value={filter}
              onValueChange={setFilter}
              size="sm"
              options={[
                { value: "all", label: t("agentPanel.stream.filterAll") },
                { value: "question", label: t("agentPanel.stream.filterQuestions") },
                { value: "q_and_a", label: t("agentPanel.stream.filterQAndA") },
                { value: "feature_request", label: t("agentPanel.stream.filterFeatures") },
                { value: "permission", label: t("agentPanel.stream.filterDecisions") },
                { value: "outcome", label: t("agentPanel.stream.filterOutcomes") },
              ]}
            />
            <Button
              variant={onlyOpen ? "secondary" : "outline"}
              style={styles.touchTarget}
              onPress={handleToggleOnlyOpen}
              testID="companion-stream-pending"
            >
              {onlyOpen ? t("globalStream.showCompletedToo") : t("globalStream.showUnresolvedOnly")}
            </Button>
          </View>
        )}

        {saveError ? (
          <Text accessibilityRole="alert" style={styles.description}>
            {saveError}
          </Text>
        ) : null}
        {saving ? <Text style={styles.description}>{t("globalStream.saving")}</Text> : null}
        {!supportsWrites ? (
          <Text style={styles.description}>{t("globalStream.writeUnavailable")}</Text>
        ) : null}
        {supportsWrites && (
          <View style={styles.pinInputContainer}>
            <NoteInput
              ref={noteInput}
              style={styles.pinInput}
              placeholder={t(inputPlaceholderKey)}
              maxLength={4000}
              editable={!saving}
              initialValue=""
              onChangeText={setPinText}
              onSubmitEditing={handleSubmitPin}
            />
            <Button
              onPress={handleSubmitPin}
              disabled={saving || connection !== "online" || !pinText.trim() || checklistFenced}
              testID="note-submit"
            >
              {t(submitLabelKey)}
            </Button>
          </View>
        )}
      </View>
    ),
    [
      connection,
      captureDegraded,
      refresh,
      query.isFetching,
      query.notices,
      viewTab,
      inputPlaceholderKey,
      submitLabelKey,
      filter,
      onlyOpen,
      t,
      handleToggleOnlyOpen,
      handleSubmitPin,
      supportsWrites,
      supportsDurableStream,
      checklistFenced,
      saveError,
      saving,
      pinText,
    ],
  );

  const empty = useMemo(
    () => (
      <View style={styles.empty} testID="companion-stream-empty">
        <Text style={styles.title}>
          {viewTab === "pinned"
            ? t("agentPanel.stream.noPinnedItems")
            : t("agentPanel.stream.noItemsFound")}
        </Text>
        <Button variant="outline" style={styles.touchTarget} onPress={onReturnToChat}>
          {t("agentPanel.stream.backToChat")}
        </Button>
      </View>
    ),
    [viewTab, onReturnToChat, t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        {query.hasNextPage ? (
          <Button onPress={loadMore} disabled={query.isFetching || connection !== "online"}>
            {t("globalStream.more")}
          </Button>
        ) : null}
        {query.isLoading ? <ActivityIndicator /> : null}
        <Text style={styles.description}>{t("globalStream.retentionDurable")}</Text>
      </View>
    ),
    [query.hasNextPage, query.isFetching, query.isLoading, loadMore, connection, t],
  );

  if (!isSupported) {
    return (
      <View style={styles.root}>
        <View style={styles.notice} testID="companion-stream-unsupported">
          <Text style={styles.title}>{t("agentPanel.stream.updateHost")}</Text>
          <Text style={styles.description}>{t("agentPanel.stream.updateHostDescription")}</Text>
        </View>
        <ArtifactFeed
          serverId={serverId}
          cwd={cwd}
          artifacts={artifacts}
          isSupported={artifactsSupported}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          onReturnToChat={onReturnToChat}
        />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.feed}
      testID="companion-stream"
      data={visible}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ItemSeparatorComponent={CardSeparator}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
    />
  );
}

function CardSeparator() {
  return <View style={styles.separator} />;
}

// eslint-disable-next-line complexity
export function EntryCard({
  entry,
  serverId,
  onReturnToChat,
  onReplyInChat,
  onUpdateStatus,
  onRemovePin,
  disabled = false,
}: {
  entry: CompanionEntry;
  serverId?: string;
  disabled?: boolean;
  onReturnToChat: () => void;
  onReplyInChat: () => void;
  onUpdateStatus: (id: string, status: "open" | "reviewed" | "done") => void;
  onRemovePin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const handleSetOpen = useCallback(
    () => onUpdateStatus(entry.id, "open"),
    [onUpdateStatus, entry.id],
  );
  const handleSetReviewed = useCallback(
    () => onUpdateStatus(entry.id, "reviewed"),
    [onUpdateStatus, entry.id],
  );
  const handleSetDone = useCallback(
    () => onUpdateStatus(entry.id, "done"),
    [onUpdateStatus, entry.id],
  );
  const handleRemovePinLocal = useCallback(() => onRemovePin(entry.id), [onRemovePin, entry.id]);
  const openDelegated = useCallback(() => {
    if (serverId && entry.ask?.delegatedAgentId)
      navigateToAgent({ serverId, agentId: entry.ask.delegatedAgentId });
  }, [serverId, entry.ask?.delegatedAgentId]);
  const pending = isCompanionEntryPending(entry);
  const expandedAccessibilityState = useMemo(() => ({ expanded }), [expanded]);

  let title: string;
  let status: string = "";
  if (entry.kind === "question") {
    title = t("agentPanel.stream.question");
    if (entry.id.startsWith("turn:")) title = t("globalStream.inferredQuestion");
    if (entry.ask) title = t("globalStream.trackedAsk");
    status = entry.ask
      ? {
          open: t("globalStream.askStateOpen"),
          in_progress: t("globalStream.askStateInProgress"),
          blocked: t("globalStream.askStateBlocked"),
          done: t("globalStream.askStateDone"),
        }[entry.ask.state]
      : entry.status;
  } else if (entry.kind === "feature_request") {
    title = t("agentPanel.stream.featureRequest");
    status = entry.status;
  } else if (entry.kind === "permission") {
    const titles = {
      question: "question",
      plan: "decision",
      tool: "permission",
      mode: "permission",
      other: "permission",
    } as const;
    title = t(`agentPanel.stream.${titles[entry.requestKind]}`);
    status = t(
      entry.status === "pending"
        ? "agentPanel.stream.pendingStatus"
        : `agentPanel.stream.${entry.status}`,
    );
  } else if (entry.kind === "pin") {
    title = t("agentPanel.stream.streamPin");
  } else if (entry.kind === "q_and_a") {
    title = t("agentPanel.stream.qAndA");
  } else {
    title = t(`agentPanel.stream.${entry.status}`);
  }

  let body = null;
  if (entry.text) {
    body = expanded ? (
      <View>
        <MarkdownRenderer text={entry.text} compact enableHtmlish={false} />
        {entry.kind === "q_and_a" && entry.answer && (
          <View style={styles.qaAnswerContainer}>
            <Text style={styles.qaAnswerLabel}>{t("agentPanel.stream.answerLabel")}</Text>
            <MarkdownRenderer text={entry.answer} compact enableHtmlish={false} />
          </View>
        )}
      </View>
    ) : (
      <View>
        <Text selectable style={styles.body} numberOfLines={6}>
          {entry.text}
        </Text>
        {entry.kind === "q_and_a" && entry.answer && (
          <View style={styles.qaAnswerContainer}>
            <Text style={styles.qaAnswerLabel}>{t("agentPanel.stream.answerLabel")}</Text>
            <Text selectable style={styles.body} numberOfLines={6}>
              {entry.answer}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View
      style={[styles.card, pending && styles.pendingCard]}
      testID={`companion-entry-${entry.id}`}
    >
      <View style={styles.entryHeaderRow}>
        <Text style={styles.eyebrow}>{formatMessageTimestamp(new Date(entry.timestamp))}</Text>
        {entry.kind === "pin" ? (
          <Button variant="ghost" size="sm" onPress={handleRemovePinLocal} disabled={disabled}>
            <Text style={styles.description}>{t("agentPanel.stream.unpin")}</Text>
          </Button>
        ) : null}
      </View>

      <Text style={styles.title}>{title}</Text>
      {status ? (
        <Text style={[styles.description, pending && styles.pendingText]}>{status}</Text>
      ) : null}

      {body}

      {entry.ask ? (
        <View style={styles.notice}>
          {entry.ask.subtasks?.length ? (
            <Text style={styles.description}>
              {entry.ask.subtasks.filter((task) => task.done).length} / {entry.ask.subtasks.length}{" "}
              {t("globalStream.subtasksDone")}
            </Text>
          ) : null}
          {entry.ask.subtasks?.map((task) => (
            <Text key={task.id} style={styles.body}>
              {task.done ? "✓" : "○"} {task.text}
            </Text>
          ))}
          <Text selectable style={styles.description}>
            {entry.ask.state === "done"
              ? t("globalStream.completionEvidence")
              : t("globalStream.evidenceSoFar")}
            : {entry.ask.evidence || t("globalStream.noneRecorded")}
          </Text>
          {entry.ask.state !== "done" ? (
            <Text selectable style={styles.body}>
              {t("globalStream.remaining")}: {entry.ask.remaining || t("globalStream.notSpecified")}
            </Text>
          ) : null}
          {entry.ask.sourceMessageId ? (
            <Text selectable style={styles.description}>
              {t("globalStream.sourceMessage")}: {entry.ask.sourceMessageId}
            </Text>
          ) : null}
          {entry.ask.delegatedAgentId && serverId ? (
            <Button variant="outline" onPress={openDelegated}>
              {t("globalStream.openDelegated")}
            </Button>
          ) : null}
        </View>
      ) : null}

      {entry.truncated ? (
        <Text style={styles.description}>{t("agentPanel.stream.excerpt")}</Text>
      ) : null}

      <View style={styles.actions}>
        {entry.text ? (
          <Button
            variant="ghost"
            style={styles.touchTarget}
            onPress={toggleExpanded}
            accessibilityState={expandedAccessibilityState}
          >
            {t(expanded ? "agentPanel.stream.showLess" : "agentPanel.stream.read")}
          </Button>
        ) : null}
        <Button
          variant={pending ? "secondary" : "outline"}
          style={styles.touchTarget}
          onPress={pending ? onReplyInChat : onReturnToChat}
        >
          {t(pending ? "agentPanel.stream.replyInChat" : "agentPanel.stream.backToChat")}
        </Button>

        {(entry.kind === "question" || entry.kind === "feature_request") && (
          <View style={styles.statusActionsRow}>
            <Button variant="outline" onPress={handleSetOpen} disabled={disabled}>
              {t("agentPanel.stream.statusOpen")}
            </Button>
            <Button variant="outline" onPress={handleSetReviewed} disabled={disabled}>
              {entry.ask
                ? t("globalStream.askStateInProgress")
                : t("agentPanel.stream.statusReviewed")}
            </Button>
            <Button
              variant="outline"
              onPress={handleSetDone}
              disabled={disabled || Boolean(entry.ask)}
            >
              {t("agentPanel.stream.statusDone")}
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.surface0 },
  feed: { width: "100%", maxWidth: 760, alignSelf: "center", padding: theme.spacing[4] },
  header: { gap: theme.spacing[2], paddingBottom: theme.spacing[6] },
  notice: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  eyebrow: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.sm },
  card: {
    padding: theme.spacing[4],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  pendingCard: { borderLeftWidth: 3, borderLeftColor: theme.colors.accent },
  pendingText: { color: theme.colors.accent },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    marginTop: theme.spacing[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  touchTarget: { minHeight: 44 },
  empty: { gap: theme.spacing[3], paddingVertical: theme.spacing[6] },
  separator: { height: theme.spacing[3] },
  footer: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[6],
  },
  segmentContainer: { gap: theme.spacing[2], marginTop: theme.spacing[2] },
  pinInputContainer: { flexDirection: "row", gap: theme.spacing[2], marginTop: theme.spacing[2] },
  pinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
  },
  qaAnswerContainer: {
    marginTop: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },
  qaAnswerLabel: {
    fontWeight: "bold",
    marginBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  entryHeaderRow: { flexDirection: "row", justifyContent: "space-between" },
  statusActionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    width: "100%",
  },
}));
