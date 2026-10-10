import { describe, expect, it, vi } from "vitest";
import type { DraftInput } from "@/stores/draft-store/state";
import {
  runQueuedRowEditSave,
  type QueuedRowSavePorts,
  type QueuedRowSaveResult,
} from "./queued-row-save";

/**
 * A fake of the row's draft-store seam: the working draft, the edit-start
 * baseline, and version-safe finalization with the component's exact retain
 * semantics (newer input keeps editing and re-bases the baseline to the
 * confirmed generation).
 */
function createHarness() {
  const store = {
    working: {
      text: "draft",
      attachments: [],
      queueEdit: { itemId: "item-1", baselineRevision: 4 },
    } as DraftInput | undefined,
    baseline: {
      text: "row",
      attachments: [],
      queueEdit: { itemId: "item-1", baselineRevision: 4 },
    } as DraftInput | undefined,
    version: 5,
    appliedRevision: 4,
    hydrated: true,
    saving: false,
    /** The real store keeps a "sent" record behind a cleared edit. */
    clearedRecordRetained: false,
  };
  // The current owner generation (the row's per-key map); the orchestrator
  // captures whatever this is at save start.
  const generationRef = { current: 1 };
  const calls = {
    checkpoints: [] as Array<{ text: string; version: number }>,
    fence: [] as number[],
    fenceFailures: 0,
    finalized: [] as Array<{
      text: string;
      confirmedRevision: number;
      submittedVersion: number | undefined;
    }>,
    errors: [] as string[],
    saves: [] as number[],
    discardedSavedDrafts: 0,
  };
  let respond: ((result: QueuedRowSaveResult) => void) | null = null;
  const ports: QueuedRowSavePorts = {
    itemId: "item-1",
    force: false,
    conflictMessage: "changed on another device",
    persistMessage: "couldn't save",
    isReady: () => store.hydrated,
    isEditing: () => store.working !== undefined,
    isSaving: () => store.saving,
    getWorking: () => store.working,
    getBaseline: () => store.baseline,
    getAppliedRevision: () => store.appliedRevision,
    getText: () => store.working?.text ?? "",
    checkpoint: (text) => {
      store.version += 1;
      const current: DraftInput = store.working ?? {
        text: "",
        attachments: [],
        queueEdit: { itemId: "item-1", baselineRevision: 4 },
      };
      store.working = { ...current, text };
      calls.checkpoints.push({ text, version: store.version });
      return store.version;
    },
    flushCheckpoint: async () => {},
    persistFence: async (attemptedRevision) => {
      if (calls.fenceFailures > 0) {
        calls.fenceFailures -= 1;
        throw new Error("Simulated fence write failure");
      }
      calls.fence.push(attemptedRevision);
      if (store.working) {
        store.working = {
          ...store.working,
          queueEdit: { itemId: "item-1", baselineRevision: attemptedRevision, conflicted: true },
        };
      }
    },
    finalize: (confirmedText, confirmedRevision, submittedVersion, ownerGeneration) => {
      calls.finalized.push({
        text: confirmedText,
        confirmedRevision,
        submittedVersion,
      });
      const activeRecord = !store.clearedRecordRetained && store.working !== undefined;
      if (!activeRecord || generationRef.current !== ownerGeneration) {
        // Abandon: the edit was cleared (a "sent" record remains but is not
        // the edit) or a replacement editor owns the keys.
        return;
      }
      if (store.version !== submittedVersion) {
        // Retain: the baseline advances to the confirmed generation, editing
        // continues with the newer input.
        store.baseline = {
          text: confirmedText,
          attachments: [],
          queueEdit: { itemId: "item-1", baselineRevision: confirmedRevision },
        };
        return;
      }
      store.working = undefined;
      store.baseline = undefined;
    },
    getOwnerGeneration: () => generationRef.current,
    hasOwnership: (ownerGeneration: number) =>
      generationRef.current === ownerGeneration &&
      (store.clearedRecordRetained ? false : store.working !== undefined),
    discardSavedDraft: (ownerGeneration: number) => {
      if (generationRef.current !== ownerGeneration) return;
      calls.discardedSavedDrafts += 1;
      // The real clearDraftInput keeps a "sent" record behind.
      store.clearedRecordRetained = true;
      store.working = undefined;
      store.baseline = undefined;
    },
    onSave: async (_itemId, _text, revision) => {
      calls.saves.push(revision);
      return new Promise<QueuedRowSaveResult>((resolve) => {
        respond = resolve;
      });
    },
    onError: (message) => {
      calls.errors.push(message);
    },
    setSaving: (saving) => {
      store.saving = saving;
    },
  };
  return {
    store,
    calls,
    ports,
    generationRef,
    resolve: (result: QueuedRowSaveResult) => respond?.(result),
  };
}

describe("runQueuedRowEditSave", () => {
  it("a deferred update resolved after a newer broadcast finalizes with the confirmed generation", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));

    // A newer keystroke and a strictly newer broadcast (revision 12, past the
    // response's 9) land while the RPC and the deferred snapshot application
    // are in flight.
    h.store.working = { ...h.store.working!, text: "draft 2" };
    h.ports.checkpoint("draft 2");
    h.store.appliedRevision = 12;
    h.resolve({ status: "saved", confirmedRevision: 9, confirmedText: "saved text" });
    await run;

    // Finalization used the HOST-CONFIRMED generation and text — never the
    // request's (4), never the later broadcast's (12).
    expect(h.calls.finalized).toEqual([
      { text: "saved text", confirmedRevision: 9, submittedVersion: 6 },
    ]);
    // The retained draft was re-based to the confirmed generation: the next
    // implicit save now fences at revision 9 (the broadcast at 12 makes it a
    // fresh-snapshot conflict — re-base + explicit re-save by design).
    await runQueuedRowEditSave(h.ports);
    expect(h.calls.saves).toEqual([4]);
    expect(h.calls.fence).toEqual([9]);
    expect(h.calls.errors).toEqual(["changed on another device"]);
  });

  it("a deferred completion after the edit was discarded abandons", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));

    // The user discards the edit while the RPC is in flight: clearDraftInput
    // retains a "sent" record with a bumped version — the edit is still gone.
    h.store.clearedRecordRetained = true;
    h.store.working = undefined;
    h.store.baseline = undefined;
    h.resolve({ status: "saved", confirmedRevision: 5, confirmedText: "saved text" });
    await run;

    // The stale completion must not resurrect the discarded edit.
    expect(h.calls.finalized).toEqual([
      { text: "saved text", confirmedRevision: 5, submittedVersion: 6 },
    ]);
    expect(h.store.working).toBeUndefined();
    expect(h.store.baseline).toBeUndefined();
    expect(h.calls.errors).toEqual([]);
  });

  it("a deferred completion after a replacement editor mounted abandons", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));

    // A remount bumps the owner generation past the captured one.
    h.generationRef.current = 2;
    h.resolve({ status: "saved", confirmedRevision: 5, confirmedText: "saved text" });
    await run;

    expect(h.store.working?.text).toBe("draft");
    expect(h.calls.errors).toEqual([]);
  });

  it("a vanished row drops the saved draft quietly", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));
    h.resolve({ status: "vanished" });
    await run;

    expect(h.calls.discardedSavedDrafts).toBe(1);
    expect(h.store.working).toBeUndefined();
    expect(h.calls.errors).toEqual([]);
    expect(h.calls.finalized).toEqual([]);
  });

  it("a deferred vanished response after replacement ownership erases nothing", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));

    // A remount hands the keys to a replacement editor before the response.
    h.generationRef.current = 2;
    h.resolve({ status: "vanished" });
    await run;

    // The stale completion must not discard the replacement's saved draft.
    expect(h.calls.discardedSavedDrafts).toBe(0);
    expect(h.store.working?.text).toBe("draft");
    expect(h.calls.errors).toEqual([]);
  });

  it("a deferred conflict rejection after replacement ownership fences nothing", async () => {
    const h = createHarness();
    let attempts = 0;
    const run = runQueuedRowEditSave({
      ...h.ports,
      onSave: async () => {
        attempts += 1;
        throw new Error("queue_revision_conflict");
      },
    });

    // A remount hands the keys to a replacement editor before the rejection.
    h.generationRef.current = 2;
    await run;

    // The stale completion must not write a conflict fence into the
    // replacement editor's draft, nor surface its error.
    expect(attempts).toBe(1);
    expect(h.calls.fence).toEqual([]);
    expect(h.store.working?.queueEdit?.conflicted).toBeUndefined();
    expect(h.calls.errors).toEqual([]);
  });

  it("a fresh-snapshot conflict persists the fence and dispatches nothing", async () => {
    const h = createHarness();
    h.store.appliedRevision = 9;
    await runQueuedRowEditSave(h.ports);

    expect(h.calls.fence).toEqual([4]);
    expect(h.calls.saves).toEqual([]);
    expect(h.calls.errors).toEqual(["changed on another device"]);
    expect(h.store.working?.queueEdit?.conflicted).toBe(true);
  });

  it("a fresh-snapshot conflict with a failing fence write surfaces the storage failure", async () => {
    const h = createHarness();
    h.store.appliedRevision = 9;
    h.calls.fenceFailures = 1;
    await runQueuedRowEditSave(h.ports);

    expect(h.calls.errors).toEqual(["couldn't save"]);
    expect(h.calls.saves).toEqual([]);
    expect(h.store.working?.queueEdit?.conflicted).toBeUndefined();
  });

  it("an RPC revision conflict installs the fence at the attempted revision", async () => {
    const h = createHarness();
    let attempts = 0;
    const run = runQueuedRowEditSave({
      ...h.ports,
      onSave: async (_itemId, _text, revision) => {
        attempts += 1;
        if (attempts === 1) {
          return { status: "saved", confirmedRevision: revision, confirmedText: "saved text" };
        }
        throw new Error("queue_revision_conflict");
      },
    });
    await run;
    expect(h.calls.finalized).toHaveLength(1);

    // The user edits again (clean finalize closed the first edit), and the
    // second save hits the daemon's revision conflict.
    h.store.working = {
      text: "draft 2",
      attachments: [],
      queueEdit: { itemId: "item-1", baselineRevision: 4 },
    };
    h.store.baseline = {
      text: "row",
      attachments: [],
      queueEdit: { itemId: "item-1", baselineRevision: 4 },
    };
    await runQueuedRowEditSave({
      ...h.ports,
      onSave: async () => {
        throw new Error("queue_revision_conflict");
      },
    });

    // The fence landed at the attempted (request) revision.
    expect(h.calls.fence).toEqual([4]);
    expect(h.store.working?.queueEdit?.conflicted).toBe(true);
    expect(h.calls.errors).toEqual(["changed on another device"]);
  });

  it("an RPC conflict with a failing fence write surfaces the storage failure only", async () => {
    const h = createHarness();
    let calls = 0;
    const run = runQueuedRowEditSave({
      ...h.ports,
      onSave: async () => {
        calls += 1;
        throw new Error("queue_revision_conflict");
      },
      persistFence: async () => {
        throw new Error("Simulated fence write failure");
      },
    });
    await run;
    expect(calls).toBe(1);
    expect(h.calls.errors).toEqual(["couldn't save"]);
  });

  it("gates everything until hydration", async () => {
    const h = createHarness();
    h.store.hydrated = false;
    await runQueuedRowEditSave(h.ports);
    expect(h.calls.saves).toEqual([]);
    expect(h.calls.checkpoints).toEqual([]);
    expect(h.calls.finalized).toEqual([]);
  });

  it("an unsaved result surfaces the persist failure and finalizes nothing", async () => {
    const h = createHarness();
    const run = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));
    h.resolve({ status: "unsaved" });
    await run;
    expect(h.calls.finalized).toEqual([]);
    expect(h.calls.errors).toEqual(["couldn't save"]);
  });

  it("a no-op save finalizes without dispatching", async () => {
    const h = createHarness();
    h.store.working = { ...h.store.working!, text: "row" };
    h.store.baseline = {
      ...h.store.baseline!,
      text: "row",
      queueEdit: { itemId: "item-1", baselineRevision: 4 },
    };
    const run = runQueuedRowEditSave(h.ports);
    // The orchestrator reads the LIVE text port; keep it aligned with the row.
    await run;
    expect(h.calls.saves).toEqual([]);
    expect(h.calls.finalized).toEqual([{ text: "row", confirmedRevision: 4, submittedVersion: 6 }]);
  });

  it("a save in flight blocks re-entry", async () => {
    const h = createHarness();
    const first = runQueuedRowEditSave(h.ports);
    await vi.waitFor(() => expect(h.calls.saves).toEqual([4]));
    const second = runQueuedRowEditSave(h.ports);
    h.resolve({ status: "saved", confirmedRevision: 5, confirmedText: "saved text" });
    await Promise.all([first, second]);
    expect(h.calls.saves).toEqual([4]);
  });
});
