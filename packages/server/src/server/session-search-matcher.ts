import { z } from "zod";
import type { PersistedConfig } from "./persisted-config.js";

const RankingSchema = z.object({
  matches: z
    .array(
      z.object({
        agentId: z.string(),
        confidence: z.number().min(0).max(1),
        excerptIndex: z.number().int().nonnegative(),
      }),
    )
    .max(8),
});
export type SessionSearchRanking = z.infer<typeof RankingSchema>;

export interface SessionSearchMatcherConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
}

export function resolveSessionSearchMatcherConfig(input: {
  persisted: PersistedConfig;
  env: NodeJS.ProcessEnv;
}): SessionSearchMatcherConfig | null {
  const feature = input.persisted.features?.sessionSearch;
  if (!feature) return null;
  const apiKey = (input.persisted.providers?.openai?.apiKey ?? input.env.OPENAI_API_KEY)?.trim();
  const baseUrl = (
    input.persisted.providers?.openai?.baseUrl ??
    input.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).trim();
  if (!apiKey)
    throw new Error(
      "Session search needs an OpenAI API key in providers.openai or OPENAI_API_KEY.",
    );
  const url = new URL(baseUrl);
  if (!isSupportedMatcherUrl(url))
    throw new Error("Session search needs an HTTPS OpenAI base URL.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Session search base URL must not include credentials or a query.");
  return { model: feature.model, apiKey, baseUrl: url.toString() };
}

function isSupportedMatcherUrl(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

const rankingJsonSchema = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          confidence: { type: "number" },
          excerptIndex: { type: "integer" },
        },
        required: ["agentId", "confidence", "excerptIndex"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
} as const;

/** Public Responses classification: no tools, no storage, bounded input and output. */
export async function generateSessionSearchRanking(input: {
  config: SessionSearchMatcherConfig;
  prompt: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<SessionSearchRanking> {
  if (input.prompt.length > 360_000) throw new Error("Session search context is too large.");
  const endpoint = new URL(input.config.baseUrl);
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + "/responses";
  const response = await (input.fetcher ?? fetch)(endpoint, {
    method: "POST",
    redirect: "error",
    signal: input.signal,
    headers: { Authorization: "Bearer " + input.config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.config.model,
      input: [{ role: "user", content: input.prompt }],
      tools: [],
      tool_choice: "none",
      store: false,
      max_output_tokens: 1200,
      text: {
        format: {
          type: "json_schema",
          name: "session_search_ranking",
          strict: true,
          schema: rankingJsonSchema,
        },
      },
    }),
  });
  if (!response.ok) throw new Error("Session search provider failed (" + response.status + ").");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > 128_000)
    throw new Error("Session search provider response is too large.");
  if (!response.body) throw new Error("Session search provider returned no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 128_000) {
        await reader.cancel();
        throw new Error("Session search provider response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  const parsed = z
    .object({
      status: z.literal("completed"),
      model: z.string(),
      output: z
        .array(
          z.object({
            type: z.string(),
            status: z.string().optional(),
            role: z.string().optional(),
            content: z
              .array(z.object({ type: z.string(), text: z.string().optional() }))
              .optional(),
          }),
        )
        .max(8),
    })
    .parse(JSON.parse(raw));
  // The public API may resolve a model alias to a dated snapshot. The requested model
  // controls selection; the returned model is informational and is deliberately not re-matched.
  if (!parsed.model) throw new Error("Session search provider returned no model.");
  const messages = parsed.output.filter(
    (item) => item.type === "message" && item.status === "completed" && item.role === "assistant",
  );
  if (
    messages.length !== 1 ||
    parsed.output.some((item) => item.type !== "message" && item.type !== "reasoning")
  )
    throw new Error("Session search provider returned an unexpected output.");
  const parts = messages[0]?.content ?? [];
  if (parts.length !== 1 || parts[0]?.type !== "output_text" || !parts[0].text)
    throw new Error("Session search provider returned no completed classification.");
  return RankingSchema.parse(JSON.parse(parts[0].text));
}
