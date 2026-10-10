import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import { isCompanionEntryPending, type CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type { StreamListOptions, StreamRow } from "@getpaseo/protocol/global-stream";
import { COMPANION_TEXT_LIMIT } from "./companion-stream.js";

export interface StreamSource {
  id: string;
  title?: string | null;
  cwd: string;
  workspaceId?: string;
  archivedAt?: string | null;
  internal?: boolean;
  companionEntries?: CompanionEntry[];
  artifacts?: AgentArtifact[];
}

/**
 * Server-side transport clamp. The wire schema admits limit<=100, but a page
 * is a transport mitigation, never a storage one: 50 rows is the declared
 * page size and a larger request cannot widen it.
 */
export const STREAM_PAGE_LIMIT = 50;

/**
 * Wire bound for the companion-entries array on snapshot payloads: same
 * transport-mitigation rationale as the page clamp, applied to the agent
 * snapshot view. Stored history stays complete.
 */
export const STREAM_SNAPSHOT_ENTRY_LIMIT = 50;

/** A projection of existing records. Never starts a provider or replays a transcript. */
export function listStreamRows(sources: Iterable<StreamSource>, options: StreamListOptions) {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const rows = collectStreamRows(sources, options).map(boundStreamRowForTransport);
  const sorted = rows
    .filter(
      (row) =>
        !search ||
        [
          row.agentTitle,
          row.cwd,
          row.item.kind === "entry" ? row.item.entry.text : row.item.artifact.path,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort(compareStreamRows);
  let after: { timestamp: string; id: string } | undefined;
  if (options.cursor) {
    const decoded: unknown = JSON.parse(Buffer.from(options.cursor, "base64url").toString());
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      decoded.some((v) => typeof v !== "string")
    ) {
      throw new Error("Invalid Stream cursor");
    }
    after = { timestamp: decoded[0], id: decoded[1] };
  }
  const remaining = after ? sorted.filter((row) => compareStreamRows(row, after!) > 0) : sorted;
  const page = remaining.slice(0, Math.min(options.limit ?? STREAM_PAGE_LIMIT, STREAM_PAGE_LIMIT));
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      last && remaining.length > page.length
        ? Buffer.from(JSON.stringify([last.timestamp, last.id])).toString("base64url")
        : null,
  };
}

function collectStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const source of sources) {
    if (source.internal || (source.archivedAt && !options.includeArchived)) continue;
    const base = {
      agentId: source.id,
      agentTitle: source.title || source.id,
      cwd: source.cwd,
      workspaceId: source.workspaceId,
      archived: Boolean(source.archivedAt),
    };
    for (const entry of source.companionEntries ?? []) {
      if (options.filter === "pending" && !isCompanionEntryPending(entry)) continue;
      if (options.filter === "pinned" && entry.kind !== "pin") continue;
      rows.push({
        ...base,
        id: JSON.stringify([source.id, "entry", entry.id]),
        timestamp: entry.timestamp,
        item: { kind: "entry", entry },
      });
    }
    if (!options.filter || options.filter === "all") {
      for (const artifact of source.artifacts ?? []) {
        rows.push({
          ...base,
          id: JSON.stringify([source.id, "artifact", artifact.path]),
          timestamp: artifact.updatedAt,
          item: { kind: "artifact", artifact },
        });
      }
    }
  }
  return rows;
}

export function compareStreamRows(
  a: Pick<StreamRow, "timestamp" | "id">,
  b: Pick<StreamRow, "timestamp" | "id">,
): number {
  return b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
}

/**
 * Read-time transport bound for entry text. Capture-time excerpting bounds new
 * entries; this covers oversized entries persisted before those bounds existed.
 * Storage is never rewritten here — the bound applies to the projected row only.
 */
export function boundStreamRowForTransport(row: StreamRow): StreamRow {
  if (row.item.kind !== "entry") return row;
  const entry = row.item.entry;
  const bounded = boundEntryTextForTransport(entry);
  if (bounded === entry) return row;
  return { ...row, item: { kind: "entry", entry: bounded } };
}

export function boundEntryTextForTransport(entry: CompanionEntry): CompanionEntry {
  let bounded = entry;
  if (bounded.text.length > COMPANION_TEXT_LIMIT) {
    bounded = { ...bounded, text: bounded.text.slice(0, COMPANION_TEXT_LIMIT), truncated: true };
  }
  if (
    bounded.kind === "q_and_a" &&
    bounded.answer &&
    bounded.answer.length > COMPANION_TEXT_LIMIT
  ) {
    bounded = { ...bounded, answer: bounded.answer.slice(0, COMPANION_TEXT_LIMIT) };
  }
  return bounded;
}
