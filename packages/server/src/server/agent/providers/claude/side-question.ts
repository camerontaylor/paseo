import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SideAnswer,
  SideConversationExchange,
  SideConversationThreading,
} from "../../agent-sdk-types.js";
import { parseClaudeCodeVersion } from "./model-manifest.js";

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
  /**
   * Optional on purpose: the SDK's own wrapper reads this as `synthetic ?? false`, so a CLI
   * that omits it is answering correctly. Our protocol schema requires a boolean, and the
   * generated validator drops the whole message when one is missing — so absent must become
   * `false` here rather than travel as `undefined`.
   */
  synthetic?: boolean;
}

interface SideQuestionQuery {
  request(
    input: SideQuestionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SideQuestionResponse>;
}

export function getClaudeSideQuestionThreading(
  version: string | undefined,
): SideConversationThreading {
  if (version === undefined) return "single_shot";
  // parseClaudeCodeVersion is the shared reader for `claude --version` output, so it
  // tolerates wrapper noise and suffixes. Anything it cannot read at all — including an
  // unset version — falls back to the shape every CLI understands.
  const parsed = parseClaudeCodeVersion(version);
  const floor = parseClaudeCodeVersion(CLAUDE_SIDE_QUESTION_HISTORY_FLOOR);
  if (!parsed || !floor) return "single_shot";
  return isAtOrAboveVersion(parsed, floor) ? "threaded" : "single_shot";
}

function isAtOrAboveVersion(
  version: readonly [number, number, number],
  floor: readonly [number, number, number],
): boolean {
  for (let index = 0; index < version.length; index += 1) {
    if (version[index] !== floor[index]) return version[index] > floor[index];
  }
  return true;
}

export async function askClaudeSideQuestion(input: {
  query: Query;
  question: string;
  history: readonly SideConversationExchange[];
  threading: SideConversationThreading;
  signal?: AbortSignal;
}): Promise<SideAnswer> {
  // The CLI supports this control request before the SDK exposes it in Query's public types.
  const query = input.query as unknown as SideQuestionQuery;
  const controlRequest: SideQuestionRequest = {
    subtype: "side_question",
    question: input.question,
    ...(input.threading === "threaded"
      ? { history: input.history.map(({ question, answer }) => ({ question, response: answer })) }
      : {}),
  };
  let result: SideQuestionResponse;
  try {
    // Query.request honours signal.abort by dropping its pending-response entry and sending
    // control_cancel_request to the CLI. Without it an abandoned question keeps generating and
    // leaks that entry for the life of the session. Passed only when there is a signal, so the
    // call keeps its single-argument shape otherwise.
    result = await (input.signal
      ? query.request(controlRequest, { signal: input.signal })
      : query.request(controlRequest));
  } catch (error) {
    if (input.signal?.aborted) {
      return { status: "timed_out", threading: input.threading };
    }
    throw error;
  }
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
    synthetic: result.synthetic === true,
    threading: input.threading,
  };
}
