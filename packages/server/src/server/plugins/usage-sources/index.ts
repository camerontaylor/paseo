import { z } from "zod";
import type { Logger } from "pino";
import {
  UsageReportSchema,
  type ProviderUsage,
  type UsageReportEntry,
  type UsageProblem,
  type UsageReport,
} from "@getpaseo/protocol/messages";

export interface UsageSource {
  id: string;
  label: string;
  icon?: string;
  discover(): Promise<unknown>;
  fetch(input: unknown): Promise<unknown>;
}

interface KnownReport {
  source: UsageSource;
  inputs: [unknown, ...unknown[]];
  label?: string;
}

/** Owns account identity, ordered logins for each account, and the five-minute fetch cache. */
export class UsageSourceRegistry {
  private generation = 0;
  private readonly sources = new Map<string, UsageSource>();
  private readonly known = new Map<string, KnownReport>();
  private readonly cache = new Map<string, { at: number; entry: UsageReportEntry }>();
  private readonly pending = new Map<string, Promise<UsageReportEntry>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 300_000,
    private readonly logger: Pick<Logger, "warn"> = { warn: console.warn },
  ) {}

  register(source: UsageSource): void {
    if (this.sources.has(source.id)) throw new Error(`Duplicate usage source: ${source.id}`);
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
    this.invalidateReports((key) => key.startsWith(`${id}:`));
  }

  invalidateReports(predicate: (id: string) => boolean): void {
    this.generation++;
    for (const map of [this.known, this.cache, this.pending]) {
      for (const id of map.keys()) if (predicate(id)) map.delete(id);
    }
  }

  async listReports(
    options: { forceRefresh?: boolean; reportIds?: string[] } = {},
  ): Promise<UsageReportEntry[]> {
    const generation = this.generation;
    const discovered =
      !options.reportIds ||
      options.reportIds.some((id) => !this.known.has(id) && !this.cache.has(id))
        ? await this.discoverReportIds()
        : undefined;
    if (generation !== this.generation) return this.listReports(options);
    const ids = options.reportIds ?? discovered!;
    const reports = await Promise.all(
      [...new Set(ids)].flatMap((id) => {
        const known = this.known.get(id);
        return known ? [this.fetchId(id, known, options.forceRefresh)] : [];
      }),
    );
    return generation === this.generation ? reports : this.listReports(options);
  }

  private async discoverReportIds(): Promise<string[]> {
    const generation = this.generation;
    const discovered = await Promise.all(
      [...this.sources.values()].map(async (source) => {
        try {
          const accounts = z
            .array(
              z.union([
                z.object({
                  key: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
                  label: z.string().optional(),
                  input: z.json(),
                }),
                z
                  .object({
                    providerId: z.string().regex(/^[A-Za-z0-9._-]{1,119}$/),
                    label: z.string(),
                  })
                  .catchall(z.json()),
              ]),
            )
            .parse(await source.discover());
          if (generation !== this.generation) return [];
          const knownReports = new Map<string, KnownReport>();
          const ids: string[] = [];
          for (const account of accounts) {
            const key = "providerId" in account ? `provider.${account.providerId}` : account.key;
            const input = "providerId" in account ? account : account.input;
            const id = `${source.id}:${key}`;
            ids.push(id);
            const known = knownReports.get(id);
            if (known) known.inputs.push(input);
            else knownReports.set(id, { source, inputs: [input], label: account.label });
          }
          for (const key of this.known.keys()) {
            if (key.startsWith(`${source.id}:`)) this.known.delete(key);
          }
          for (const [id, known] of knownReports) this.known.set(id, known);
          return ids;
        } catch (error) {
          if (generation !== this.generation) return [];
          for (const key of this.known.keys()) {
            if (key.startsWith(`${source.id}:`)) this.known.delete(key);
          }
          this.logger.warn({ sourceId: source.id, err: error }, "Usage source discovery failed");
          return [];
        }
      }),
    );
    const ids = discovered.flat();
    if (generation !== this.generation) return [];
    const current = new Set(ids);
    for (const id of this.known.keys())
      if (!current.has(id)) {
        this.known.delete(id);
        this.cache.delete(id);
        this.pending.delete(id);
      }
    return ids;
  }

  // COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
  async listLegacyUsage(): Promise<{ fetchedAt: string; providers: ProviderUsage[] }> {
    const reports = await this.listReports();
    return {
      fetchedAt: reports.length
        ? reports.reduce(
            (oldest, entry) => (entry.fetchedAt < oldest ? entry.fetchedAt : oldest),
            reports[0]!.fetchedAt,
          )
        : new Date(this.now()).toISOString(),
      providers: reports.map((entry) => {
        const prefix = `${entry.sourceId}:provider.`;
        const custom = entry.id.startsWith(prefix);
        let displayName = entry.sourceLabel;
        if (entry.account.label) displayName = `${entry.sourceLabel} (${entry.account.label})`;
        if (custom) displayName = entry.account.label ?? entry.sourceLabel;
        const provider: ProviderUsage = {
          providerId: custom ? entry.id.slice(prefix.length) : entry.sourceId,
          displayName,
          status: entry.report.status,
          planLabel: entry.report.status === "available" ? (entry.report.planLabel ?? null) : null,
          windows: entry.report.status === "available" ? entry.report.windows : [],
          balances: entry.report.status === "available" ? (entry.report.balances ?? []) : [],
          details: entry.report.status === "available" ? (entry.report.details ?? []) : [],
          error: legacyError(entry.report, this.now()),
        };
        if (custom) provider.baseProviderId = entry.sourceId;
        return provider;
      }),
    };
  }

  private fetchId(id: string, known: KnownReport, forceRefresh = false): Promise<UsageReportEntry> {
    const cached = this.cache.get(id);
    if (!forceRefresh && cached && this.now() - cached.at < this.ttlMs)
      return Promise.resolve(cached.entry);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const generation = this.generation;
    const request = (async () => {
      const entry: UsageReportEntry = {
        id,
        sourceId: known.source.id,
        sourceLabel: known.source.label,
        icon: known.source.icon,
        account: { label: known.label },
        fetchedAt: new Date(this.now()).toISOString(),
        report: await this.fetchWithFallback(known),
      };
      if (generation === this.generation && this.known.get(id) === known)
        this.writeCache(id, entry);
      return entry;
    })();
    this.pending.set(id, request);
    void request.finally(() => {
      if (this.pending.get(id) === request) this.pending.delete(id);
    });
    return request;
  }

  private writeCache(id: string, entry: UsageReportEntry): void {
    const at = this.now();
    for (const [cachedId, cached] of this.cache) {
      if (at - cached.at >= this.ttlMs) this.cache.delete(cachedId);
    }
    this.cache.set(id, { at, entry });
  }

  private async fetchWithFallback(known: KnownReport): Promise<UsageReport> {
    let report = await this.fetchLogin(known.source, known.inputs[0]);
    for (const input of known.inputs.slice(1)) {
      if (report.status === "available") break;
      report = await this.fetchLogin(known.source, input);
    }
    return report;
  }

  private async fetchLogin(source: UsageSource, input: unknown): Promise<UsageReport> {
    try {
      return UsageReportSchema.parse(await source.fetch(input));
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// The legacy RPC has only an error string; the current app owns its own presentation.
// COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
function legacyProblem(problem: UsageProblem, now: number): string {
  if (problem.kind === "no_quota") return problem.detail;
  const remedy = problem.refreshedBy
    ? `Run ${problem.refreshedBy} to refresh it.`
    : "Sign in again.";
  if (problem.kind === "rejected") return `Login rejected (HTTP ${problem.status}). ${remedy}`;
  const elapsed = Math.max(0, now - Date.parse(problem.expiresAt));
  let ago = "just now";
  if (elapsed >= 86_400_000) ago = `${Math.floor(elapsed / 86_400_000)}d ago`;
  else if (elapsed >= 3_600_000) ago = `${Math.floor(elapsed / 3_600_000)}h ago`;
  else if (elapsed >= 60_000) ago = `${Math.floor(elapsed / 60_000)}m ago`;
  return `Login expired ${ago}. ${remedy}`;
}

// COMPAT(providerUsageList): added in v0.1.98, remove after 2027-03-26.
function legacyError(report: UsageReport, now: number): string | null {
  if (report.status === "error") return report.error;
  if (report.status === "unavailable") return legacyProblem(report.problem, now);
  return null;
}
