import { randomUUID } from "node:crypto";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamEntryUpdate } from "@getpaseo/protocol/global-stream";
import { COMPANION_MANUAL_ENTRY_LIMIT, COMPANION_TEXT_LIMIT, retainCompanionEntries } from "./companion-stream.js";

export function applyStreamEntryUpdate(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
): CompanionEntry[] {
  if (input.action === "update_status") {
    if (!input.status) throw new Error("Status is required");
    const target = entries.find((entry) => entry.id === input.entryId);
    if (!target || (target.kind !== "question" && target.kind !== "feature_request"))
      throw new Error("Stream item no longer exists or cannot be changed");
    return retainCompanionEntries(
      entries.map((entry) => (entry === target ? { ...target, status: input.status! } : entry)),
    );
  }
  if (input.action === "remove_pin") {
    if (!entries.some((entry) => entry.id === input.entryId && entry.kind === "pin"))
      throw new Error("Pinned item no longer exists");
    return entries.filter((entry) => entry.id !== input.entryId);
  }
  const text = input.text?.trim();
  const isManualCreate = input.action === "add_pin" || input.action === "add_q_and_a";
  if (!text || (text.length > COMPANION_TEXT_LIMIT && !isManualCreate)) {
    throw new Error("Enter between 1 and 4000 characters");
  }
  const entry = createEntry(entries, input, text);
  const exists = entries.some((item) => item.id === entry.id);
  if (!exists) {
    // Manual-entry admission: a NEW pin or Q&A is refused once the ceiling is
    // reached — an explicit user-facing bound where nothing is silently
    // dropped. Upserts (edits of an existing id) stay possible at capacity,
    // and captured entries never consult the cap.
    enforceManualEntryAdmission(entries, entry);
  }
  return retainCompanionEntries(
    exists
      ? entries.map((item) => (item.id === entry.id ? clipManualEntryText(entry) : item))
      : [...entries, clipManualEntryText(entry)],
  );
}

function enforceManualEntryAdmission(entries: CompanionEntry[], entry: CompanionEntry): void {
  if (entry.kind !== "pin" && entry.kind !== "q_and_a") return;
  // A pin created with an explicit entryId that already exists is an edit and
  // was handled by the upsert branch; a brand-new pin or any Q&A (Q&A creation
  // has no client-supplied identity in either engine) is a new manual entry.
  const manualCount = countManualEntries(entries);
  if (manualCount >= COMPANION_MANUAL_ENTRY_LIMIT) {
    throw new Error(
      `Stream pin limit reached (${COMPANION_MANUAL_ENTRY_LIMIT}). Remove one to add another.`,
    );
  }
}

function countManualEntries(entries: CompanionEntry[]): number {
  return entries.reduce(
    (count, entry) => count + (entry.kind === "pin" || entry.kind === "q_and_a" ? 1 : 0),
    0,
  );
}

/**
 * Legacy-path clip: the new RPC schema caps text at 4000 before the engine,
 * so only the legacy companion RPC (schema without maxLength) can arrive with
 * oversized manual text. Carried behavior clips it with the excerpt flag
 * instead of rejecting.
 */
function clipManualEntryText(entry: CompanionEntry): CompanionEntry {
  if (entry.kind !== "pin" && entry.kind !== "q_and_a") return entry;
  let clipped = entry;
  if (clipped.text.length > COMPANION_TEXT_LIMIT) {
    clipped = { ...clipped, text: clipped.text.slice(0, COMPANION_TEXT_LIMIT), truncated: true };
  }
  if (clipped.kind === "q_and_a" && clipped.answer && clipped.answer.length > COMPANION_TEXT_LIMIT) {
    clipped = { ...clipped, answer: clipped.answer.slice(0, COMPANION_TEXT_LIMIT) };
  }
  return clipped;
}

function createEntry(
  entries: CompanionEntry[],
  input: StreamEntryUpdate,
  text: string,
): CompanionEntry {
  const common = { timestamp: new Date().toISOString(), text, truncated: false };
  switch (input.action) {
    case "add_question": {
      const id = `question:${input.entryId ?? randomUUID()}`;
      const existing = entries.find((entry) => entry.id === id);
      return {
        ...common,
        id,
        timestamp: existing?.timestamp ?? common.timestamp,
        kind: "question",
        status: input.status ?? "open",
      };
    }
    case "add_pin": {
      const id = `pin:${input.entryId ?? randomUUID()}`;
      return {
        ...common,
        id,
        timestamp: entries.find((entry) => entry.id === id)?.timestamp ?? common.timestamp,
        kind: "pin",
        sourceId: input.sourceId,
      };
    }
    case "add_q_and_a":
      return { ...common, id: `qa:${randomUUID()}`, kind: "q_and_a", answer: input.answerText };
    default:
      throw new Error("Unknown Stream action");
  }
}
