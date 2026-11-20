import { expect, test } from "vitest";
import { getPiEffortChangeNotice } from "./effort-cache-notice.js";
import type { PiAgentMessage } from "./rpc-types.js";

const model = { provider: "opencode-go", id: "space-bunny-free" };
const change = {
  model,
  previousLevel: "high" as const,
  effectiveLevel: "low" as const,
  hasConversation: true,
  messages: [] as PiAgentMessage[],
};

test.each([
  { name: "unchanged effective effort", override: { effectiveLevel: "high" as const } },
  { name: "fresh session", override: { hasConversation: false } },
  { name: "unknown model", override: { model: null } },
  { name: "another Pi backend", override: { model: { ...model, provider: "openai-codex" } } },
])("does not warn for $name", ({ override }) => {
  expect(getPiEffortChangeNotice({ ...change, ...override })).toBeUndefined();
});

test.each([undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "reports unknown cache cost for cacheRead=%s",
  (cacheRead) => {
    expect(
      getPiEffortChangeNotice({
        ...change,
        messages: [
          { role: "assistant", ...model, model: model.id, content: [], usage: { cacheRead } },
        ],
      }),
    ).toEqual({
      type: "warning",
      message:
        "Thinking changed from high to low. On opencode-go, changing effort may invalidate the prompt cache and reprocess the conversation on the next request. The next request's cache cost is unknown. Keep the same effort to preserve cache reuse.",
    });
  },
);

test("uses the latest matching request rather than totals or another model's usage", () => {
  const messages: PiAgentMessage[] = [
    {
      role: "assistant",
      provider: model.provider,
      model: model.id,
      content: [],
      usage: { cacheRead: 17463 },
    },
    {
      role: "assistant",
      provider: model.provider,
      model: model.id,
      content: [],
      usage: { cacheRead: 18340, cacheWrite: 0 },
    },
    {
      role: "assistant",
      provider: model.provider,
      model: "another-model",
      content: [],
      usage: { cacheRead: 90000 },
    },
    {
      role: "assistant",
      provider: "openrouter",
      model: model.id,
      content: [],
      usage: { cacheRead: 80000 },
    },
    { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: "result" },
  ];
  expect(getPiEffortChangeNotice({ ...change, messages })?.message).toContain(
    "18340 cached input tokens",
  );
});

test("does not reuse an older sample when the latest matching request has no telemetry", () => {
  const messages: PiAgentMessage[] = [
    {
      role: "assistant",
      provider: model.provider,
      model: model.id,
      content: [],
      usage: { cacheRead: 18340 },
    },
    { role: "assistant", provider: model.provider, model: model.id, content: [] },
  ];
  expect(getPiEffortChangeNotice({ ...change, messages })?.message).toContain(
    "cache cost is unknown",
  );
});

test("warns without inventing a cached count when history is unavailable", () => {
  expect(getPiEffortChangeNotice(change)?.message).toContain("cache cost is unknown");
});
