import type { AgentArtifact } from "@getpaseo/protocol/agent-types";
import {
  isCompanionEntryPending,
  companionSourceRole,
  type CompanionEntry,
} from "@getpaseo/protocol/companion-stream";
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

/** Bound each response while keeping the stored history intact. */
export const STREAM_PAGE_LIMIT = 50;
export const STREAM_SNAPSHOT_ENTRY_LIMIT = 50;

const isPendingRow = (row: StreamRow) =>
  row.item.kind === "entry" && isCompanionEntryPending(row.item.entry);
const rowSourceRole = (row: StreamRow) =>
  row.item.kind === "entry" ? companionSourceRole(row.item.entry) : "agent";

/** A projection of existing records. Never starts a provider or replays a transcript. */
export function listStreamRows(sources: Iterable<StreamSource>, options: StreamListOptions) {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const rows = collectStreamRows(sources, {
    ...options,
    filter: options.filter === "pinned" ? "pinned" : "all",
  });
  const counts = {
    total: rows.length,
    open: rows.filter(isPendingRow).length,
    done: rows.filter((row) => !isPendingRow(row)).length,
    user: rows.filter((row) => rowSourceRole(row) === "user").length,
    agent: rows.filter((row) => rowSourceRole(row) === "agent").length,
    unknown: rows.filter((row) => rowSourceRole(row) === "unknown").length,
    matching: 0,
  };
  const rank = (row: StreamRow) =>
    options.asksOnly && row.item.kind === "entry" && row.item.entry.ask?.state === "done" ? 1 : 0;
  const compare = (a: StreamRow, b: StreamRow) => rank(a) - rank(b) || compareStreamRows(a, b);
  const sorted = rows
    .filter(
      (row) =>
        (!options.sourceRole ||
          options.sourceRole === "all" ||
          rowSourceRole(row) === options.sourceRole) &&
        (!(options.state === "open" || options.filter === "pending") || isPendingRow(row)) &&
        (options.state !== "done" || !isPendingRow(row)),
    )
    .filter(
      (row) =>
        !search ||
        [
          row.agentTitle,
          row.cwd,
          row.item.kind === "entry" ? row.item.entry.text : row.item.artifact.path,
          row.item.kind === "entry" && row.item.entry.kind === "q_and_a"
            ? row.item.entry.answer
            : "",
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort(compare);
  // A cursor belongs to one host request scope. It cannot silently page a
  // different conversation or filter after the client changes controls.
  const cursorScope = JSON.stringify([
    options.agentId ?? null,
    options.asksOnly === true,
    options.includeMessageInventory === true,
    options.sourceRole ?? "all",
    options.state ?? "all",
    options.filter ?? "all",
    search,
    options.includeArchived === true,
  ]);
  const after = options.cursor ? decodeStreamCursor(options.cursor, cursorScope) : undefined;
  const remaining = after
    ? sorted.filter((row) => (rank(row) - after!.rank || compareStreamRows(row, after!)) > 0)
    : sorted;
  const page = remaining.slice(0, Math.min(options.limit ?? STREAM_PAGE_LIMIT, STREAM_PAGE_LIMIT));
  const last = page.at(-1);
  return {
    rows: page.map(boundStreamRowForTransport),
    counts: { ...counts, matching: sorted.length },
    nextCursor:
      last && remaining.length > page.length
        ? Buffer.from(JSON.stringify([last.timestamp, last.id, rank(last), cursorScope])).toString(
            "base64url",
          )
        : null,
  };
}

function decodeStreamCursor(
  cursor: string,
  scope: string,
): { timestamp: string; id: string; rank: number } {
  const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 4 ||
    typeof decoded[0] !== "string" ||
    typeof decoded[1] !== "string" ||
    (decoded[2] !== 0 && decoded[2] !== 1) ||
    decoded[3] !== scope
  )
    throw new Error("Invalid Stream cursor");
  return { timestamp: decoded[0], id: decoded[1], rank: decoded[2] };
}

function collectStreamRows(
  sources: Iterable<StreamSource>,
  options: StreamListOptions,
): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const source of sources) {
    if (options.agentId && source.id !== options.agentId) continue;
    if (isHiddenSource(source, options)) continue;
    const base = {
      agentId: source.id,
      agentTitle: source.title || source.id,
      cwd: source.cwd,
      workspaceId: source.workspaceId,
      archived: Boolean(source.archivedAt),
    };
    for (const entry of source.companionEntries ?? []) {
      if (!includeEntry(entry, options)) continue;
      if (options.filter === "pending" && !isCompanionEntryPending(entry)) continue;
      if (options.filter === "pinned" && entry.kind !== "pin") continue;
      rows.push({
        ...base,
        id: JSON.stringify([source.id, "entry", entry.id]),
        timestamp: entry.timestamp,
        item: { kind: "entry", entry },
      });
    }
    if (!options.asksOnly && (!options.filter || options.filter === "all")) {
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

function isHiddenSource(source: StreamSource, options: StreamListOptions): boolean {
  return Boolean(source.internal || (source.archivedAt && !options.includeArchived));
}

function includeEntry(entry: CompanionEntry, options: StreamListOptions): boolean {
  if (entry.source && !options.includeMessageInventory && !entry.ask) return false;
  if (!options.asksOnly || entry.ask) return true;
  return Boolean(options.includeMessageInventory && entry.messageReview?.state === "unreviewed");
}

/** Bound historical text only on the wire; never rewrite durable entries on reads. */
export function boundStreamRowForTransport(row: StreamRow): StreamRow {
  if (row.item.kind !== "entry") return row;
  const bounded = boundEntryTextForTransport(row.item.entry);
  return bounded === row.item.entry ? row : { ...row, item: { kind: "entry", entry: bounded } };
}

export function boundEntryTextForTransport(entry: CompanionEntry): CompanionEntry {
  let bounded = entry;
  if (bounded.text.length > COMPANION_TEXT_LIMIT)
    bounded = { ...bounded, text: bounded.text.slice(0, COMPANION_TEXT_LIMIT), truncated: true };
  if (bounded.kind === "q_and_a" && bounded.answer && bounded.answer.length > COMPANION_TEXT_LIMIT)
    bounded = {
      ...bounded,
      answer: bounded.answer.slice(0, COMPANION_TEXT_LIMIT),
      truncated: true,
    };
  return bounded;
}
