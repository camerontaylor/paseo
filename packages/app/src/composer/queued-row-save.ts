import { resolveQueuedEditFailure, resolveQueuedEditSave } from "@/composer/actions";
import type { DraftInput } from "@/stores/draft-store/state";

type PreparedRowSave =
  | { kind: "skip" }
  | { kind: "conflict"; message: string }
  | {
      kind: "save";
      /** "noop" finalizes without an RPC; "rpc" sends the revision-checked update. */
      mode: "noop" | "rpc";
      text: string;
      rpcRevision: number;
      attemptedRevision: number;
      baselineRevision: number;
    };

/**
 * The save decision for one row-edit save trigger, read from the live draft
 * records: skip (no edit, or a save already in flight), the standing conflict
 * fence, or the resolved save (no-op finalize or revision-checked RPC).
 */
function prepareRowSave(input: {
  working: DraftInput | undefined;
  baseline: DraftInput | undefined;
  editing: boolean;
  saving: boolean;
  text: string;
  appliedRevision: number;
  force: boolean;
  conflictMessage: string;
}): PreparedRowSave {
  if (!input.editing || input.saving || !input.working) {
    return { kind: "skip" };
  }
  const decision = resolveQueuedEditSave({
    text: input.text,
    baselineText: input.baseline?.text,
    baselineRevision: input.baseline?.queueEdit?.baselineRevision ?? 0,
    appliedRevision: input.appliedRevision,
    conflicted: input.working.queueEdit?.conflicted === true,
    force: input.force,
    conflictMessage: input.conflictMessage,
  });
  if (decision.kind === "conflict") {
    return { kind: "conflict", message: decision.message };
  }
  const baselineRevision = input.baseline?.queueEdit?.baselineRevision ?? 0;
  return {
    kind: "save",
    mode: decision.kind === "rpc" ? "rpc" : "noop",
    text: input.text,
    rpcRevision: decision.kind === "rpc" ? decision.revision : baselineRevision,
    attemptedRevision: decision.kind === "rpc" ? decision.revision : baselineRevision,
    baselineRevision,
  };
}

/** The host's answer to one queued-row update. */
export type QueuedRowSaveResult =
  | {
      status: "saved";
      /** The revision the host confirmed, from the returned snapshot. */
      confirmedRevision: number;
      /** The confirmed row content, from the returned snapshot (the server
       * trims submitted text). */
      confirmedText: string;
    }
  | { status: "vanished" }
  | { status: "unsaved" };

export interface QueuedRowSavePorts {
  itemId: string;
  force: boolean;
  conflictMessage: string;
  persistMessage: string;
  // Reads
  isReady: () => boolean;
  isEditing: () => boolean;
  isSaving: () => boolean;
  getWorking: () => DraftInput | undefined;
  getBaseline: () => DraftInput | undefined;
  getAppliedRevision: () => number;
  getText: () => string;
  // Effects
  checkpoint: (text: string) => number | undefined;
  flushCheckpoint: () => Promise<void>;
  /** Persists the conflict fence; rejects when the write cannot land. */
  persistFence: (attemptedRevision: number) => Promise<void>;
  /**
   * The current owner generation of this edit's draft keys. A replacement
   * editor (remount) bumps it; an old completion must then abandon.
   */
  getOwnerGeneration: () => number;
  /**
   * Version- and ownership-safe finalization against the HOST-CONFIRMED
   * content and revision.
   */
  finalize: (
    confirmedText: string,
    confirmedRevision: number,
    submittedVersion: number | undefined,
    ownerGeneration: number,
  ) => void;
  /** The host no longer lists the row: drop the saved draft quietly. */
  discardSavedDraft: () => void;
  onSave: (itemId: string, text: string, revision: number) => Promise<QueuedRowSaveResult>;
  onError: (message: string) => void;
  setSaving: (saving: boolean) => void;
}

/**
 * One queued-row save trigger, end to end: the pre-check decision, the durable
 * checkpoint barrier, the revision-checked RPC, the persisted conflict fence
 * (installed for BOTH conflict paths — a fresh-snapshot conflict is a conflict),
 * and version-safe finalization against the revision the host confirmed. The
 * submitted draft version is captured at checkpoint time; finalization compares
 * against that immutable capture, never a ref later edits mutate.
 */
export async function runQueuedRowEditSave(ports: QueuedRowSavePorts): Promise<void> {
  if (!ports.isReady() || ports.isSaving()) return;
  const prepared = prepareRowSave({
    working: ports.getWorking(),
    baseline: ports.getBaseline(),
    editing: ports.isEditing(),
    saving: ports.isSaving(),
    text: ports.getText(),
    appliedRevision: ports.getAppliedRevision(),
    force: ports.force,
    conflictMessage: ports.conflictMessage,
  });
  if (prepared.kind === "skip") return;
  if (prepared.kind === "conflict") {
    // The row moved remotely before dispatch: the fence stands here too, so
    // implicit saves stay blocked until the user overwrites or discards.
    try {
      await ports.persistFence(ports.getBaseline()?.queueEdit?.baselineRevision ?? 0);
    } catch {
      ports.onError(ports.persistMessage);
      return;
    }
    ports.onError(prepared.message);
    return;
  }
  const submittedVersion = ports.checkpoint(prepared.text);
  const ownerGeneration = ports.getOwnerGeneration();
  ports.setSaving(true);
  try {
    // The draft checkpoint is the durability barrier: it must be on disk
    // before the host sees anything.
    await ports.flushCheckpoint();
    if (prepared.mode === "noop") {
      ports.finalize(prepared.text, prepared.baselineRevision, submittedVersion, ownerGeneration);
      return;
    }
    const result = await ports.onSave(ports.itemId, prepared.text, prepared.rpcRevision);
    if (result.status === "vanished") {
      // The host no longer lists the row (removed remotely mid-save): the
      // edit is moot — drop the saved draft, surface nothing.
      ports.discardSavedDraft();
      return;
    }
    if (result.status === "unsaved") {
      ports.onError(ports.persistMessage);
      return;
    }
    ports.finalize(
      result.confirmedText,
      result.confirmedRevision,
      submittedVersion,
      ownerGeneration,
    );
  } catch (error) {
    const failure = resolveQueuedEditFailure(error, {
      conflictMessage: ports.conflictMessage,
      persistMessage: ports.persistMessage,
    });
    if (failure.conflicted) {
      try {
        await ports.persistFence(prepared.attemptedRevision);
      } catch {
        ports.onError(ports.persistMessage);
        return;
      }
    }
    ports.onError(failure.message);
  } finally {
    ports.setSaving(false);
  }
}
