import type { TFunction } from "i18next";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";

export function getTurnDurationLabel(durationMs: number, t: TFunction): string {
  return t("message.turnFooter.workedFor", { duration: formatDuration(durationMs) });
}

export function getAssistantTurnFooterLabel(
  completedAt: Date | undefined,
  durationMs: number | null | undefined,
  t: TFunction,
): string {
  const timestamp =
    completedAt && Number.isFinite(completedAt.getTime())
      ? formatMessageTimestamp(completedAt)
      : "";
  const duration =
    durationMs === undefined || durationMs === null || !Number.isFinite(durationMs)
      ? ""
      : getTurnDurationLabel(durationMs, t);
  return [timestamp, duration].filter(Boolean).join(" · ");
}
