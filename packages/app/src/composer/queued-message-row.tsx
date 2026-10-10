import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react-native";
import { resolveQueuedEditFinalization } from "@/composer/actions";
import type { QueuedComposerMessage } from "@/composer/actions";
import { runQueuedRowEditSave, type QueuedRowSaveResult } from "@/composer/queued-row-save";
import { flushDraftPersistStorage, useDraftStore } from "@/stores/draft-store";

/**
 * Owner generation per draft key: bumped whenever a fresh row instance takes
 * the keys (mount). An in-flight save captures its generation at start; a
 * completion after a replacement editor mounted must abandon instead of
 * overwriting the replacement's baseline.
 */
const editorGenerations = new Map<string, number>();
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedRotateCcw = withUnistyles(RotateCcw);
const ThemedX = withUnistyles(X);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedMoreVertical = withUnistyles(MoreVertical);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});

type QueuedRowState = "queued" | "sending" | "unconfirmed" | "failed";

function resolveQueueRowState(item: QueuedComposerMessage): QueuedRowState {
  if (item.syncState === "failed" || item.deliveryState === "failed") return "failed";
  if (item.deliveryState === "uncertain") return "unconfirmed";
  if (item.deliveryState === "dispatching") return "sending";
  return "queued";
}

function resolveQueueStateBadge(
  state: QueuedRowState,
  labels: { sendingLabel: string; unconfirmedLabel: string; failedLabel: string },
): { variant: "muted" | "warning" | "error"; label: string } | null {
  if (state === "failed") return { variant: "error", label: labels.failedLabel };
  if (state === "unconfirmed") return { variant: "warning", label: labels.unconfirmedLabel };
  if (state === "sending") return { variant: "muted", label: labels.sendingLabel };
  return null;
}

export interface QueuedRowDurableControls {
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
  labels: {
    menu: string;
    moveUp: string;
    moveDown: string;
    remove: string;
    retry: string;
    discard: string;
  };
  sendingLabel: string;
  unconfirmedLabel: string;
  failedLabel: string;
}

interface QueuedMessageEditorProps {
  testID: string;
  editInputRef: MutableRefObject<EditingTextInputHandle | null>;
  draft: string;
  onEditorChange: (text: string) => void;
  isSaving: boolean;
  conflicted: boolean;
  editLabel: string;
  doneLabel: string;
  saveAnywayLabel: string;
  discardEditLabel: string;
  onDone: () => void;
  onSaveAnyway: () => void;
  onDiscard: () => void;
}

function QueuedMessageEditor({
  testID,
  editInputRef,
  draft,
  onEditorChange,
  isSaving,
  conflicted,
  editLabel,
  doneLabel,
  saveAnywayLabel,
  discardEditLabel,
  onDone,
  onSaveAnyway,
  onDiscard,
}: QueuedMessageEditorProps) {
  return (
    <View style={[styles.queueItem, styles.queueEditItem]} testID={testID}>
      <EditingTextInput
        ref={editInputRef}
        initialValue={draft}
        onChangeText={onEditorChange}
        multiline
        editable={!isSaving}
        placeholder={editLabel}
        style={styles.queueEditInput}
      />
      <View style={styles.queueActions}>
        {conflicted ? (
          <Pressable
            onPress={onDiscard}
            disabled={isSaving}
            style={styles.queueEditTextButton}
            accessibilityRole="button"
          >
            <Text style={styles.queueEditTextButtonLabel}>{discardEditLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDone}
          disabled={isSaving}
          style={styles.queueEditTextButton}
          accessibilityRole="button"
        >
          <Text style={styles.queueEditTextButtonLabel}>{doneLabel}</Text>
        </Pressable>
        {conflicted ? (
          <Pressable
            onPress={onSaveAnyway}
            disabled={isSaving}
            style={[styles.queueEditTextButton, styles.queueEditSaveButton]}
            accessibilityRole="button"
          >
            <Text style={styles.queueEditTextButtonLabel}>{saveAnywayLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

interface QueuedRowActionsProps {
  item: QueuedComposerMessage;
  durable: QueuedRowDurableControls | undefined;
  isPending: boolean;
  needsAttention: boolean;
  isFirst: boolean;
  isLast: boolean;
  isRemoving: boolean;
  removalBlocked: boolean;
  editLabel: string;
  sendNowLabel: string;
  moveToComposerLabel: string;
  removeLabel: string;
  onEdit: () => void;
  onSendNow: () => void;
  onRemove: () => void;
  onMoveToComposer: () => void;
}

function QueuedRowActions({
  item,
  durable,
  isPending,
  needsAttention,
  isFirst,
  isLast,
  isRemoving,
  removalBlocked,
  editLabel,
  sendNowLabel,
  moveToComposerLabel,
  removeLabel,
  onEdit,
  onSendNow,
  onRemove,
  onMoveToComposer,
}: QueuedRowActionsProps) {
  const menuIcons = useMemo(
    () => ({
      moveUp: <ThemedChevronUp size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />,
      moveDown: <ThemedChevronDown size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />,
      remove: <ThemedTrash2 size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />,
    }),
    [],
  );
  const handleRetry = useCallback(() => {
    durable?.onRetry(item.id);
  }, [durable, item.id]);
  const handleDiscard = useCallback(() => {
    durable?.onDiscard(item.id);
  }, [durable, item.id]);
  const handleMoveUp = useCallback(() => {
    durable?.onMove(item.id, -1);
  }, [durable, item.id]);
  const handleMoveDown = useCallback(() => {
    durable?.onMove(item.id, 1);
  }, [durable, item.id]);
  const handleDelete = useCallback(() => {
    durable?.onDelete(item.id);
  }, [durable, item.id]);

  if (durable && needsAttention) {
    return (
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleRetry}
          style={styles.queueActionButton}
          accessibilityLabel={durable.labels.retry}
          accessibilityRole="button"
        >
          <ThemedRotateCcw size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        {!item.removalRequested ? (
          <Pressable
            onPress={handleDiscard}
            style={styles.queueActionButton}
            accessibilityLabel={durable.labels.discard}
            accessibilityRole="button"
          >
            <ThemedX size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  const canEditOrSend =
    !isPending && !removalBlocked && (!item.deliveryState || item.deliveryState === "pending");
  return (
    <View style={styles.queueActions}>
      {canEditOrSend ? (
        <>
          <Pressable
            onPress={onEdit}
            style={styles.queueActionButton}
            accessibilityLabel={editLabel}
            accessibilityRole="button"
          >
            <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
          </Pressable>
          <Pressable
            onPress={onSendNow}
            style={[styles.queueActionButton, styles.queueSendButton]}
            accessibilityLabel={sendNowLabel}
            accessibilityRole="button"
          >
            <ThemedArrowUp size={ICON_SIZE.sm} uniProps={iconAccentForegroundMapping} />
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={onRemove}
        disabled={isRemoving}
        style={styles.queueActionButton}
        accessibilityLabel={removeLabel}
        accessibilityRole="button"
      >
        <ThemedTrash2 size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
      </Pressable>
      {!isPending && durable ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            accessibilityLabel={durable.labels.menu}
            accessibilityRole="button"
            style={styles.queueActionButton}
          >
            {({ hovered, open }) => (
              <ThemedMoreVertical
                size={ICON_SIZE.sm}
                uniProps={hovered || open ? iconForegroundMapping : iconForegroundMutedMapping}
              />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" minWidth={200}>
            <DropdownMenuItem disabled={isFirst} leading={menuIcons.moveUp} onSelect={handleMoveUp}>
              {durable.labels.moveUp}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isLast}
              leading={menuIcons.moveDown}
              onSelect={handleMoveDown}
            >
              {durable.labels.moveDown}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem leading={menuIcons.remove} onSelect={onMoveToComposer}>
              {moveToComposerLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive leading={menuIcons.remove} onSelect={handleDelete}>
              {durable.labels.remove}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

export interface QueuedMessageRowProps {
  item: QueuedComposerMessage;
  /** Legacy take-to-composer edit for old hosts; durable rows edit in place. */
  onEdit: (id: string) => void;
  onMoveToComposer: (id: string) => void;
  onSendNow: (id: string) => void;
  editLabel: string;
  sendNowLabel: string;
  moveToComposerLabel: string;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
  pendingLabel: string;
  draftKey: string;
  baselineKey: string;
  onSave: (id: string, text: string, baselineRevision: number) => Promise<QueuedRowSaveResult>;
  onRemove: (id: string) => Promise<boolean>;
  onError: (message: string) => void;
  readLabel: string;
  removeLabel: string;
  removeFailedLabel: string;
  doneLabel: string;
  saveAnywayLabel: string;
  discardEditLabel: string;
  removalPendingLabel: string;
  removalFailedLabel: string;
  conflictLabel: string;
  persistFailedLabel: string;
  isRemovalPending: boolean;
  isRemovalFailed: boolean;
  appliedRevision: number;
  durable?: QueuedRowDurableControls;
}

export interface QueuedMessageRowProps {
  item: QueuedComposerMessage;
  /** Legacy take-to-composer edit for old hosts; durable rows edit in place. */
  onEdit: (id: string) => void;
  onMoveToComposer: (id: string) => void;
  onSendNow: (id: string) => void;
  editLabel: string;
  sendNowLabel: string;
  moveToComposerLabel: string;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
  pendingLabel: string;
  draftKey: string;
  baselineKey: string;
  onSave: (id: string, text: string, baselineRevision: number) => Promise<QueuedRowSaveResult>;
  onRemove: (id: string) => Promise<boolean>;
  onError: (message: string) => void;
  readLabel: string;
  removeLabel: string;
  removeFailedLabel: string;
  doneLabel: string;
  saveAnywayLabel: string;
  discardEditLabel: string;
  removalPendingLabel: string;
  removalFailedLabel: string;
  conflictLabel: string;
  persistFailedLabel: string;
  isRemovalPending: boolean;
  isRemovalFailed: boolean;
  appliedRevision: number;
  durable?: QueuedRowDurableControls;
}

export function QueuedMessageRow({
  item,
  onEdit,
  onMoveToComposer,
  onSendNow,
  editLabel,
  sendNowLabel,
  moveToComposerLabel,
  isFirst,
  isLast,
  isPending,
  pendingLabel,
  draftKey,
  baselineKey,
  onSave,
  onRemove,
  onError,
  readLabel,
  removeLabel,
  removeFailedLabel,
  doneLabel,
  saveAnywayLabel,
  discardEditLabel,
  removalPendingLabel,
  removalFailedLabel,
  conflictLabel,
  persistFailedLabel,
  isRemovalPending,
  isRemovalFailed,
  appliedRevision,
  durable,
}: QueuedMessageRowProps) {
  // Inline queued-edit state, persisted through the draft store: the working
  // draft and the edit-start baseline (row text + revision) survive a restart.
  const [hasDraftHydrated, setHasDraftHydrated] = useState(() =>
    useDraftStore.persist.hasHydrated(),
  );
  const [isEditing, setIsEditing] = useState(() => {
    if (!hasDraftHydrated) return false;
    return useDraftStore.getState().getDraftInput(draftKey) !== undefined;
  });
  const [draft, setDraft] = useState(() => {
    if (!hasDraftHydrated) return item.text;
    return useDraftStore.getState().getDraftInput(draftKey)?.text ?? item.text;
  });
  const draftRef = useRef(draft);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const editingRef = useRef(isEditing);
  editingRef.current = isEditing;
  const savingRef = useRef(false);
  const editInputRef = useRef<EditingTextInputHandle | null>(null);
  const ownerGenerationRef = useRef<number>(-1);
  if (ownerGenerationRef.current === -1) {
    ownerGenerationRef.current = (editorGenerations.get(draftKey) ?? 0) + 1;
    editorGenerations.set(draftKey, ownerGenerationRef.current);
  }
  const conflicted =
    useDraftStore.getState().getDraftInput(draftKey)?.queueEdit?.conflicted === true;

  // The draft store rehydrates asynchronously (native storage): restore an
  // in-progress edit once its persisted checkpoint (text + edit-start
  // baseline) has landed — this is what survives a kill between the edit and
  // the host confirmation.
  useEffect(() => {
    if (hasDraftHydrated) return;
    if (useDraftStore.persist.hasHydrated()) {
      setHasDraftHydrated(true);
      return;
    }
    return useDraftStore.persist.onFinishHydration(() => setHasDraftHydrated(true));
  }, [hasDraftHydrated]);

  useEffect(() => {
    if (!hasDraftHydrated || editingRef.current) return;
    const restored = useDraftStore.getState().getDraftInput(draftKey);
    if (!restored) return;
    draftRef.current = restored.text;
    setDraft(restored.text);
    editingRef.current = true;
    setIsEditing(true);
  }, [hasDraftHydrated, draftKey]);

  const preserveDraft = useCallback(
    (text: string): number | undefined => {
      draftRef.current = text;
      setDraft(text);
      const store = useDraftStore.getState();
      const metadata = { itemId: item.id, baselineRevision: appliedRevision };
      if (!store.getDraftInput(baselineKey)) {
        store.saveDraftInput({
          draftKey: baselineKey,
          draft: { text: item.text, attachments: [], queueEdit: metadata },
        });
      }
      store.editDraftText({ draftKey, text, keepActive: true });
      return useDraftStore.getState().drafts[draftKey]?.version;
    },
    [appliedRevision, baselineKey, draftKey, item.id, item.text],
  );

  const clearSavedDraft = useCallback(() => {
    const store = useDraftStore.getState();
    store.clearDraftInput({ draftKey, lifecycle: "sent" });
    store.clearDraftInput({ draftKey: baselineKey, lifecycle: "sent" });
  }, [baselineKey, draftKey]);

  const handleEditorChange = useCallback(
    (text: string) => {
      preserveDraft(text);
    },
    [preserveDraft],
  );

  // Persist the conflict fence: implicit saves stay blocked (across restarts)
  // until the user explicitly overwrites or discards. The checkpoint flush is
  // awaited so a fence that cannot land surfaces instead of silently vanishing
  // on the next restart.
  const persistEditFence = useCallback(
    async (attemptedRevision: number) => {
      const current = useDraftStore.getState().getDraftInput(draftKey);
      if (!current) return;
      useDraftStore.getState().saveDraftInput({
        draftKey,
        draft: {
          ...current,
          queueEdit: {
            itemId: item.id,
            baselineRevision: attemptedRevision,
            conflicted: true,
          },
        },
      });
      await flushDraftPersistStorage();
    },
    [draftKey, item.id],
  );

  const finalizeSave = useCallback(
    (
      confirmedText: string,
      confirmedRevision: number,
      submittedVersion: number | undefined,
      ownerGeneration: number,
    ) => {
      const store = useDraftStore.getState();
      const finalization = resolveQueuedEditFinalization({
        savedVersion: submittedVersion,
        currentVersion: store.drafts[draftKey]?.version,
        recordExists: store.drafts[draftKey] !== undefined,
        ownerGenerationChanged: editorGenerations.get(draftKey) !== ownerGeneration,
        latestText: draftRef.current,
        confirmedText,
        confirmedRevision,
        itemId: item.id,
      });
      if (finalization.kind === "abandon") {
        // A stale completion: the edit was discarded, finalized, or its keys
        // now belong to a replacement editor. Never recreate or overwrite.
        return;
      }
      if (finalization.kind === "clear") {
        clearSavedDraft();
        editingRef.current = false;
        setIsEditing(false);
        return;
      }
      // Version-safe finalization: newer input typed during the save is kept
      // and re-based — the conflict fence clears and the baseline advances to
      // the confirmed generation, so the next save sends against it.
      store.saveDraftInput({
        draftKey,
        draft: {
          text: draftRef.current,
          attachments: [],
          queueEdit: {
            itemId: finalization.baseline.itemId,
            baselineRevision: finalization.baseline.baselineRevision,
          },
        },
      });
      store.saveDraftInput({
        draftKey: baselineKey,
        draft: {
          text: finalization.baseline.text,
          attachments: [],
          queueEdit: {
            itemId: finalization.baseline.itemId,
            baselineRevision: finalization.baseline.baselineRevision,
          },
        },
      });
    },
    [baselineKey, clearSavedDraft, draftKey, item.id],
  );

  const runSave = useCallback(
    async (force: boolean) => {
      await runQueuedRowEditSave({
        itemId: item.id,
        force,
        conflictMessage: conflictLabel,
        persistMessage: persistFailedLabel,
        isReady: () => hasDraftHydrated,
        isEditing: () => editingRef.current,
        isSaving: () => savingRef.current,
        getWorking: () => useDraftStore.getState().getDraftInput(draftKey),
        getBaseline: () => useDraftStore.getState().getDraftInput(baselineKey),
        getAppliedRevision: () => appliedRevision,
        getText: () => editInputRef.current?.getText() ?? draftRef.current,
        checkpoint: preserveDraft,
        flushCheckpoint: flushDraftPersistStorage,
        persistFence: persistEditFence,
        getOwnerGeneration: () => ownerGenerationRef.current,
        finalize: finalizeSave,
        discardSavedDraft: clearSavedDraft,
        onSave,
        onError,
        setSaving: (saving) => {
          savingRef.current = saving;
          setIsSaving(saving);
        },
      });
    },
    [
      appliedRevision,
      baselineKey,
      clearSavedDraft,
      conflictLabel,
      draftKey,
      finalizeSave,
      hasDraftHydrated,
      item.id,
      onError,
      onSave,
      persistEditFence,
      persistFailedLabel,
      preserveDraft,
    ],
  );

  const startEditing = useCallback(() => {
    if (!durable) {
      // Legacy (non-durable) rows keep the take-to-composer edit.
      onEdit(item.id);
      return;
    }
    if (!hasDraftHydrated) {
      // The store's persisted state is unknown until hydration: no editor,
      // no checkpoint write, no implicit save can run against it.
      return;
    }
    preserveDraft(item.text);
    editingRef.current = true;
    setIsEditing(true);
  }, [durable, hasDraftHydrated, item.id, item.text, onEdit, preserveDraft]);

  const handleMoveToComposer = useCallback(() => {
    // Leaving the editor without saving: the retained draft is dropped in
    // favor of the explicit take (its content moves into the composer).
    clearSavedDraft();
    editingRef.current = false;
    setIsEditing(false);
    onMoveToComposer(item.id);
  }, [clearSavedDraft, item.id, onMoveToComposer]);

  // Leaving the workspace (unmount) attempts the implicit save; a conflicted
  // draft blocks it and stays recoverable.
  const saveOnLeaveRef = useRef(runSave);
  saveOnLeaveRef.current = runSave;
  useEffect(
    () => () => {
      void saveOnLeaveRef.current(false).catch(() => {});
    },
    [],
  );

  const handleRemove = useCallback(async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      await onRemove(item.id);
    } catch (error) {
      // A failed removal retains the tombstone; the failure is actionable.
      onError(error instanceof Error && error.message ? error.message : removeFailedLabel);
    } finally {
      setIsRemoving(false);
    }
  }, [isRemoving, item.id, onError, onRemove, removeFailedLabel]);

  const removeFromUI = useCallback(() => {
    void handleRemove().catch(() => {});
  }, [handleRemove]);
  const saveFromUI = useCallback(() => {
    void runSave(false).catch(() => {});
  }, [runSave]);
  const saveAnywayFromUI = useCallback(() => {
    void runSave(true).catch(() => {});
  }, [runSave]);
  const discardEditFromUI = useCallback(() => {
    clearSavedDraft();
    editingRef.current = false;
    setIsEditing(false);
  }, [clearSavedDraft]);
  const toggleReading = useCallback(() => setIsReading((value) => !value), []);
  const readingAccessibilityState = useMemo(() => ({ expanded: isReading }), [isReading]);
  const handleSendNow = useCallback(() => {
    onSendNow(item.id);
  }, [onSendNow, item.id]);
  const state = resolveQueueRowState(item);
  const needsAttention = state === "failed" || state === "unconfirmed";
  const badge = durable ? resolveQueueStateBadge(state, durable) : null;

  const stateBadge: ReactElement | null = badge ? (
    <StatusBadge size="xs" variant={badge.variant} label={badge.label} />
  ) : null;

  if (isEditing) {
    return (
      <QueuedMessageEditor
        testID={`queued-message-${item.id}`}
        editInputRef={editInputRef}
        draft={draft}
        onEditorChange={handleEditorChange}
        isSaving={isSaving}
        conflicted={conflicted}
        editLabel={editLabel}
        doneLabel={doneLabel}
        saveAnywayLabel={saveAnywayLabel}
        discardEditLabel={discardEditLabel}
        onDone={saveFromUI}
        onSaveAnyway={saveAnywayFromUI}
        onDiscard={discardEditFromUI}
      />
    );
  }

  const removalBlocked = isRemovalPending || isRemovalFailed;
  return (
    <View style={styles.queueItem}>
      <Pressable
        onPress={toggleReading}
        accessibilityRole="button"
        accessibilityLabel={readLabel}
        accessibilityState={readingAccessibilityState}
        style={styles.queueItemContent}
      >
        <Text
          style={styles.queueText}
          numberOfLines={isReading ? undefined : 2}
          ellipsizeMode="tail"
          selectable={isReading}
        >
          {item.text}
        </Text>
        {isRemovalPending ? (
          <Text style={styles.queuePendingText}>{removalPendingLabel}</Text>
        ) : null}
        {isRemovalFailed ? <Text style={styles.queueErrorText}>{removalFailedLabel}</Text> : null}
        {isPending && !needsAttention && !isRemovalPending ? (
          <Text style={styles.queuePendingText}>{pendingLabel}</Text>
        ) : null}
        {stateBadge !== null || item.lastError ? (
          <View style={styles.queueItemState}>
            {stateBadge}
            {item.lastError && needsAttention ? (
              <Text style={styles.queueErrorText} numberOfLines={1} ellipsizeMode="tail">
                {item.lastError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      <QueuedRowActions
        item={item}
        durable={durable}
        isPending={isPending}
        needsAttention={needsAttention}
        isFirst={isFirst}
        isLast={isLast}
        isRemoving={isRemoving}
        removalBlocked={removalBlocked}
        editLabel={editLabel}
        sendNowLabel={sendNowLabel}
        moveToComposerLabel={moveToComposerLabel}
        removeLabel={removeLabel}
        onEdit={startEditing}
        onSendNow={handleSendNow}
        onRemove={removeFromUI}
        onMoveToComposer={handleMoveToComposer}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  queueText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  queueItemContent: {
    flex: 1,
    flexDirection: "column",
    gap: theme.spacing[1],
  },
  queueItemState: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueErrorText: {
    flexShrink: 1,
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  queuePendingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  queueEditItem: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  queueEditInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    minHeight: 64,
    maxHeight: 160,
    width: "100%",
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  queueEditTextButton: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  queueEditSaveButton: {
    backgroundColor: theme.colors.foreground,
  },
  queueEditTextButtonLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
}));
