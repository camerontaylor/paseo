import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { z } from "zod";
import { Ajv } from "ajv";
import { createCodexSessionSearchGeneration } from "./session-search-generation.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const schema = z.object({
  matches: z.array(z.object({ agentId: z.string(), score: z.number() })),
});
const result = { matches: [{ agentId: "existing-session", score: 0.96 }] };
const model = "gpt-configured-default";
function completed(overrides: Record<string, unknown> = {}) {
  return {
    type: "response.completed",
    response: {
      status: "completed",
      model,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(result) }],
        },
      ],
      ...overrides,
    },
  };
}
function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
async function setup(
  fetch: typeof globalThis.fetch,
  options: {
    model?: string;
    auth?: unknown;
    readSettings?: (signal?: AbortSignal) => Promise<{ model: string; codexHome: string }>;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "paseo-gpt-search-"));
  dirs.push(dir);
  const auth = JSON.stringify(
    options.auth ?? {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        account_id: "fixture-account",
      },
    },
  );
  await writeFile(path.join(dir, "auth.json"), auth, { mode: 0o600 });
  let logs = "";
  const logger = pino(
    { level: "info" },
    {
      write: (line: string) => {
        logs += line;
      },
    },
  );
  const generation = createCodexSessionSearchGeneration({
    logger,
    fetch,
    readSettings:
      options.readSettings ??
      (async () => ({
        model: options.model ?? model,
        effort: "high",
        codexHome: dir,
      })),
  });
  return {
    generation,
    dir,
    auth,
    logs: () => logs,
    request: {
      cwd: "/candidate-project",
      prompt: "candidate-context-only",
      schema,
      schemaName: "SessionSearch",
      agentTitle: "Internal matching",
    },
  };
}

describe("Codex tool-free session matching transport", () => {
  test("emits a genuinely empty tool surface to the same Codex ChatGPT consumer, with saved model and no auth writes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f = await setup(async (url, init) => {
      calls.push({ url: String(url), init });
      return sse([completed()]);
    });
    expect(await f.generation.generate(f.request)).toEqual(result);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const init = calls[0].init!;
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-access-token");
    expect(headers.get("ChatGPT-Account-ID")).toBe("fixture-account");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model,
      reasoning: { effort: "high" },
      tools: [],
      tool_choice: "none",
      parallel_tool_calls: false,
      stream: true,
      store: false,
      text: {
        format: { type: "json_schema", name: "SessionSearch", strict: true },
      },
    });
    const validate = new Ajv({ strict: false }).compile(body.text.format.schema);
    expect(validate(result)).toBe(true);
    expect(validate({ ...result, unexpected: true })).toBe(false);
    expect(validate({ matches: [{ ...result.matches[0], unexpected: true }] })).toBe(false);
    expect(validate({ matches: [{ score: 0.96 }] })).toBe(false);
    expect(body.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: f.request.prompt }],
      },
    ]);
    expect(Object.keys(body).sort()).toEqual([
      "input",
      "instructions",
      "model",
      "parallel_tool_calls",
      "reasoning",
      "store",
      "stream",
      "text",
      "tool_choice",
      "tools",
    ]);
    expect(await readFile(path.join(f.dir, "auth.json"), "utf8")).toBe(f.auth);
    expect(f.logs()).toContain('"actualModel":"gpt-configured-default"');
    expect(f.logs()).not.toContain("fixture-access-token");
    expect(f.logs()).not.toContain(f.request.prompt);
  });
  test("consumes native Codex completed items only after the terminal acknowledgement, including its empty terminal output", async () => {
    const message = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(result) }],
    };
    const f = await setup(async () =>
      sse([{ type: "response.output_item.done", item: message }, completed({ output: [] })]),
    );
    expect(await f.generation.generate(f.request)).toEqual(result);
    expect(f.logs()).toContain('"actualModel":"gpt-configured-default"');
  });
  describe.each(["terminal body", "completed item"])("%s schema validation", (transport) => {
    test.each([
      ["unknown top-level key", { ...result, unexpected: true }],
      ["unknown nested key", { matches: [{ ...result.matches[0], unexpected: true }] }],
      ["missing nested key", { matches: [{ score: 0.96 }] }],
    ])("rejects %s without retry, fallback or success receipt", async (_name, output) => {
      const message = {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      };
      let calls = 0;
      const f = await setup(async () => {
        calls++;
        return sse(
          transport === "terminal body"
            ? [completed({ output: [message] })]
            : [{ type: "response.output_item.done", item: message }, completed({ output: [] })],
        );
      });
      await expect(f.generation.generate(f.request)).rejects.toThrow(
        "GPT matching returned invalid structured output",
      );
      expect(calls).toBe(1);
      expect(f.logs()).toBe("");
      expect(await readFile(path.join(f.dir, "auth.json"), "utf8")).toBe(f.auth);
    });
  });
  test.each([
    [
      "done item without terminal acknowledgement",
      [{ type: "response.output_item.done", item: completed().response.output[0] }],
    ],
    [
      "delta without completed item",
      [
        { type: "response.output_text.delta", delta: JSON.stringify(result) },
        completed({ output: [] }),
      ],
    ],
    [
      "completed item followed by failure",
      [
        { type: "response.output_item.done", item: completed().response.output[0] },
        { type: "response.failed", response: {} },
      ],
    ],
    ["model fallback", [completed({ model: "gpt-other" })]],
    [
      "tool output",
      [
        completed({
          output: [{ type: "function_call", name: "exec", arguments: "{}" }],
        }),
      ],
    ],
    [
      "early tool output",
      [
        {
          type: "response.output_item.added",
          item: { type: "function_call", name: "exec" },
        },
        completed(),
      ],
    ],
    [
      "refusal",
      [
        completed({
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "refusal", refusal: "no" }],
            },
          ],
        }),
      ],
    ],
    [
      "invalid schema",
      [
        completed({
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: '{"matches":"bad"}' }],
            },
          ],
        }),
      ],
    ],
    ["partial stream", [{ type: "response.output_text.delta", delta: JSON.stringify(result) }]],
    [
      "failed stream",
      [
        {
          type: "response.failed",
          response: { error: { message: "private-provider-error" } },
        },
      ],
    ],
    ["missing model evidence", [completed({ model: undefined })]],
    ["oversized stream", [{ type: "response.output_text.delta", delta: "x".repeat(1_048_577) }]],
  ])("rejects %s without another request or success receipt", async (_name, events) => {
    let calls = 0;
    const f = await setup(async () => {
      calls++;
      return sse(events);
    });
    await expect(f.generation.generate(f.request)).rejects.toThrow("GPT matching");
    expect(calls).toBe(1);
    expect(f.logs()).toBe("");
  });
  test.each([401, 403, 429, 500])(
    "HTTP %s never refreshes credentials or falls back",
    async (status) => {
      let calls = 0;
      const f = await setup(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            error: { message: "fixture-access-token private-provider-error" },
          }),
          { status, headers: { "Content-Type": "application/json" } },
        );
      });
      await expect(f.generation.generate(f.request)).rejects.toThrow("GPT matching");
      expect(calls).toBe(1);
      expect(await readFile(path.join(f.dir, "auth.json"), "utf8")).toBe(f.auth);
      expect(f.logs()).toBe("");
    },
  );
  test("unsupported API-key sign-in never invokes inference", async () => {
    let calls = 0;
    const f = await setup(
      async () => {
        calls++;
        return sse([completed()]);
      },
      { auth: { auth_mode: "apikey", OPENAI_API_KEY: "fixture-key" } },
    );
    await expect(f.generation.generate(f.request)).rejects.toThrow(
      "existing Codex ChatGPT file sign-in",
    );
    expect(calls).toBe(0);
  });
  test("abort while resolving defaults is propagated before inference", async () => {
    let calls = 0;
    const abort = new AbortController();
    const f = await setup(
      async () => {
        calls++;
        return sse([completed()]);
      },
      {
        readSettings: async (signal) => {
          abort.abort(new Error("superseded"));
          signal!.throwIfAborted();
          throw new Error("unreachable");
        },
      },
    );
    await expect(f.generation.generate({ ...f.request, signal: abort.signal })).rejects.toThrow(
      "superseded",
    );
    expect(calls).toBe(0);
  });
  test("abort closes an in-flight streaming request without a partial result", async () => {
    const abort = new AbortController();
    let canceled = false;
    async function streamingFetch(_url: Parameters<typeof fetch>[0], init?: RequestInit) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), {
            once: true,
          });
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
            ),
          );
        },
        cancel() {
          canceled = true;
        },
      });
      setTimeout(() => abort.abort(new Error("superseded-stream")), 10);
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const f = await setup(streamingFetch);
    await expect(f.generation.generate({ ...f.request, signal: abort.signal })).rejects.toThrow(
      "superseded-stream",
    );
    // SDK closes its reader on abort; no success log even if a delta was received.
    expect(f.logs()).toBe("");
    expect(abort.signal.aborted || canceled).toBe(true);
  });
});
