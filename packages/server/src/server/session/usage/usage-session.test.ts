import pino from "pino";
import { z } from "zod";
import { expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession } from "./usage-session.js";

test.each([false, true])("lists reports with streaming %s", async (streaming) => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports(options) {
        requested.push({ forceRefresh: options.forceRefresh, reportIds: options.reportIds });
        options.onReport?.(entry);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({
    type: "usage.list_reports.request",
    requestId: "list",
    streaming,
  });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  if (!streaming) {
    const legacyResponse = z.object({
      type: z.literal("usage.list_reports.response"),
      payload: z.object({ requestId: z.string(), reports: z.array(z.unknown()) }),
    });
    expect(emitted.map((message) => legacyResponse.parse(message))).toEqual([
      { type: "usage.list_reports.response", payload: { requestId: "list", reports: [entry] } },
    ]);
  }
  expect(emitted).toEqual([
    ...(streaming
      ? [{ type: "usage.list_reports.update", payload: { requestId: "list", report: entry } }]
      : []),
    {
      type: "usage.list_reports.response",
      payload: { requestId: "list", reports: [entry], error: null },
    },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

test("streaming request failures terminate with an error response and no updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({
    type: "usage.list_reports.request",
    requestId: "failed",
    streaming: true,
  });
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: { requestId: "failed", reports: [], error: "Plugin runtime is unavailable" },
    },
  ]);
});

test("older clients receive an existing rpc_error on failure", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "old" });
  expect(emitted).toEqual([
    {
      type: "rpc_error",
      payload: {
        requestId: "old",
        requestType: "usage.list_reports.request",
        error: "Plugin runtime is unavailable",
        code: "usage_list_reports_failed",
      },
    },
  ]);
});
