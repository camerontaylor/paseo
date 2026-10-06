import { timelineItemIdentity } from "@getpaseo/protocol/timeline-identity";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { projectTimelineRows, type ProjectedTimelineRow } from "./timeline-projection.js";

function boundaryItem(item: AgentTimelineItem): AgentTimelineItem {
  switch (item.type) {
    case "assistant_message":
      return { type: item.type, text: "", messageId: item.messageId };
    case "reasoning":
      return { type: item.type, text: "" };
    case "tool_call":
      return {
        type: item.type,
        callId: item.callId,
        name: "",
        status: "running",
        error: null,
        detail: { type: "unknown", input: null, output: null },
      };
    case "plugin":
      return {
        type: item.type,
        id: item.id,
        pluginId: item.pluginId,
        kind: "",
        version: 0,
        data: null,
      };
    default:
      return { type: "notification", level: "info", message: "" };
  }
}

export class SessionSearchWriteBuffer {
  private readonly rows = new Map<number, AgentTimelineRow>();
  private boundaries: ProjectedTimelineRow[] = [];
  private latestSeq = 0;

  retain(rows: readonly AgentTimelineRow[]): void {
    for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
      this.rows.set(row.seq, row);
      if (row.seq > this.latestSeq) {
        const projected = projectTimelineRows({
          rows: [
            ...this.boundaries,
            { seq: row.seq, timestamp: "", turnId: row.turnId, item: boundaryItem(row.item) },
          ],
          mode: "projected",
        });
        const selected = new Set([...projected].sort((a, b) => a.seqEnd - b.seqEnd).slice(-400));
        this.boundaries = projected
          .filter((entry) => selected.has(entry))
          .map((entry) => Object.assign({ seq: entry.seqEnd }, entry));
        this.latestSeq = row.seq;
      } else {
        const identity = timelineItemIdentity(row.item);
        const boundary = this.boundaries.find((entry) =>
          identity !== null
            ? timelineItemIdentity(entry.item) === identity && entry.turnId === row.turnId
            : timelineItemIdentity(entry.item) === null &&
              entry.seqStart <= row.seq &&
              entry.seqEnd >= row.seq,
        );
        if (
          boundary &&
          !boundary.sourceSeqRanges.some(
            (range) => range.startSeq <= row.seq && range.endSeq >= row.seq,
          )
        ) {
          boundary.sourceSeqRanges = [
            ...boundary.sourceSeqRanges,
            { startSeq: row.seq, endSeq: row.seq },
          ].sort((a, b) => a.startSeq - b.startSeq);
        }
      }
    }
    const ranges = this.boundaries.flatMap((entry) => entry.sourceSeqRanges);
    for (const seq of this.rows.keys()) {
      if (!ranges.some((range) => range.startSeq <= seq && range.endSeq >= seq))
        this.rows.delete(seq);
    }
  }

  release(rows: readonly AgentTimelineRow[]): void {
    for (const row of rows) {
      if (this.rows.get(row.seq) !== row) continue;
      this.rows.delete(row.seq);
      for (const entry of this.boundaries) {
        entry.sourceSeqRanges = entry.sourceSeqRanges.flatMap((range) => {
          if (row.seq < range.startSeq || row.seq > range.endSeq) return [range];
          const remaining = [];
          if (range.startSeq < row.seq)
            remaining.push({ startSeq: range.startSeq, endSeq: row.seq - 1 });
          if (range.endSeq > row.seq)
            remaining.push({ startSeq: row.seq + 1, endSeq: range.endSeq });
          return remaining;
        });
      }
    }
  }

  snapshot(): AgentTimelineRow[] {
    return [...this.rows.values()];
  }
}
