import {
  productionStat,
  type DiffStat as DiffStatValue,
  type LineStat,
} from "@getpaseo/protocol/diff-stat";

export interface ChangeStatsSummary {
  /** Production total, or null when the host sent no breakdown. */
  production: LineStat | null;
  /** Whether the production group has any lines worth showing. */
  showProduction: boolean;
  /** Whether production contains estimated (comment-excluded) lines. */
  estimated: boolean;
}

/**
 * Rendering decisions for the change summary, kept free of React so they can be
 * tested directly. Returns null when there is nothing to render.
 */
export function summarizeChangeStats(
  stat: DiffStatValue & { supported: boolean },
): ChangeStatsSummary | null {
  if (stat.additions === 0 && stat.deletions === 0) return null;
  const breakdown = stat.supported ? stat.breakdown : undefined;
  const production = breakdown ? productionStat(breakdown) : null;
  return {
    production,
    showProduction:
      production !== null && (production.additions !== 0 || production.deletions !== 0),
    estimated: Boolean(
      breakdown && (breakdown.commentsIncluded.additions || breakdown.commentsIncluded.deletions),
    ),
  };
}
