import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SideAnswer,
  SideConversationExchange,
  SideConversationThreading,
} from "../../agent-sdk-types.js";
import { compareVersions } from "./model-manifest.js";

/**
 * First Claude Code release whose `side_question` control request accepts prior
 * exchanges. Older CLIs answer the question but ignore (or reject) `history`.
 */
export const CLAUDE_SIDE_QUESTION_HISTORY_FLOOR = "2.1.227";

interface SideQuestionRequest {
  subtype: "side_question";
  question: string;
  history?: Array<{ question: string; response: string }>;
}

interface SideQuestionResponse {
  response: string | null;
  synthetic: boolean;
}

interface SideQuestionQuery {
  request(input: SideQuestionRequest): Promise<SideQuestionResponse>;
}

export function getClaudeSideQuestionThreading(
  version: string | undefined,
): SideConversationThreading {
  if (version === undefined) return "single_shot";
  // compareVersions parses both sides with the shared `claude --version` reader — it
  // tolerates wrapper noise and suffixes — and reports any unreadable side as below, so
  // everything the parser rejects falls back to the shape every CLI understands.
  return compareVersions(version, CLAUDE_SIDE_QUESTION_HISTORY_FLOOR) >= 0
    ? "threaded"
    : "single_shot";
}

export async function askClaudeSideQuestion(input: {
  query: Query;
  question: string;
  history: readonly SideConversationExchange[];
  threading: SideConversationThreading;
}): Promise<SideAnswer> {
  // The CLI supports this control request before the SDK exposes it in Query's public types.
  const query = input.query as unknown as SideQuestionQuery;
  const result = await query.request({
    subtype: "side_question",
    question: input.question,
    ...(input.threading === "threaded"
      ? { history: input.history.map(({ question, answer }) => ({ question, response: answer })) }
      : {}),
  });
  if (result.response === null) {
    return {
      status: "failed",
      error: "Claude returned no side answer",
      threading: input.threading,
    };
  }
  return {
    status: "answered",
    content: result.response,
    synthetic: result.synthetic,
    threading: input.threading,
  };
}
