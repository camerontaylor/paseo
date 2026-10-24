import { expect, test, vi } from "vitest";
import {
  resolveSessionSearchMatcherConfig,
  generateSessionSearchRanking,
} from "./session-search-matcher.js";
import type { PersistedConfig } from "./persisted-config.js";

test("session search requires explicit feature configuration before using provider credentials", () => {
  const persisted = { providers: { openai: { apiKey: "secret" } } } as PersistedConfig;
  expect(resolveSessionSearchMatcherConfig({ persisted, env: {} })).toBeNull();
});

test("configured search uses provider credential precedence and rejects insecure remote URLs", () => {
  const persisted = {
    features: { sessionSearch: { provider: "openai", model: "gpt-4.1-mini" } },
    providers: { openai: { apiKey: "saved", baseUrl: "https://api.openai.com/v1" } },
  } as PersistedConfig;
  expect(
    resolveSessionSearchMatcherConfig({ persisted, env: { OPENAI_API_KEY: "environment" } }),
  ).toMatchObject({ model: "gpt-4.1-mini", apiKey: "saved" });
  expect(() =>
    resolveSessionSearchMatcherConfig({
      persisted: {
        ...persisted,
        providers: { openai: { apiKey: "saved", baseUrl: "http://remote.test/v1" } },
      },
      env: {},
    }),
  ).toThrow("HTTPS");
});

test("matcher sends only bounded prompt classification without tools or storage", async () => {
  const fetcher = vi.fn(async (_url: unknown, request: RequestInit) => {
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "gpt-4.1-mini",
      tools: [],
      tool_choice: "none",
      store: false,
      max_output_tokens: 1200,
    });
    expect(body.input).toEqual([{ role: "user", content: "candidate context" }]);
    return new Response(
      JSON.stringify({
        status: "completed",
        model: "gpt-4.1-mini",
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  matches: [{ agentId: "a", confidence: 0.9, excerptIndex: 0 }],
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  });
  const ranking = await generateSessionSearchRanking({
    config: { apiKey: "secret", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
    prompt: "candidate context",
    signal: new AbortController().signal,
    fetcher: fetcher as unknown as typeof fetch,
  });
  expect(ranking.matches).toEqual([{ agentId: "a", confidence: 0.9, excerptIndex: 0 }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("matcher accepts resolved model snapshots and reasoning but rejects tool output", async () => {
  const config = { apiKey: "secret", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1" };
  const valid = {
    status: "completed",
    model: "gpt-5-mini-2025-08-07",
    output: [
      { type: "reasoning" },
      {
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify({ matches: [] }) }],
      },
    ],
  };
  const request = { config, prompt: "candidate", signal: new AbortController().signal };
  expect(
    (
      await generateSessionSearchRanking({
        ...request,
        fetcher: async () => new Response(JSON.stringify(valid)),
      })
    ).matches,
  ).toEqual([]);
  await expect(
    generateSessionSearchRanking({
      ...request,
      fetcher: async () =>
        new Response(
          JSON.stringify({ ...valid, output: [...valid.output, { type: "function_call" }] }),
        ),
    }),
  ).rejects.toThrow("unexpected output");
});

test("matcher refuses an oversized streaming response without content length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(70_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    generateSessionSearchRanking({
      config: { apiKey: "secret", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
      prompt: "candidate",
      signal: new AbortController().signal,
      fetcher: async () => new Response(stream),
    }),
  ).rejects.toThrow("too large");
  expect(cancelled).toBe(true);
});

test("matcher base URL allows loopback HTTP but no other local protocol", () => {
  const persisted = {
    features: { sessionSearch: { provider: "openai", model: "gpt-4.1-mini" } },
    providers: { openai: { apiKey: "saved", baseUrl: "http://127.0.0.1:1234/v1" } },
  } as PersistedConfig;
  expect(resolveSessionSearchMatcherConfig({ persisted, env: {} })?.baseUrl).toContain("http:");
  expect(() =>
    resolveSessionSearchMatcherConfig({
      persisted: {
        ...persisted,
        providers: { openai: { apiKey: "saved", baseUrl: "ftp://localhost/v1" } },
      },
      env: {},
    }),
  ).toThrow("HTTPS");
});
