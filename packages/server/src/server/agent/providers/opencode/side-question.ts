import type { AssistantMessage, Part } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import { withTimeout } from "../../../../utils/promise-timeout.js";
import type { SideAnswer, SideConversationExchange } from "../../agent-sdk-types.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";

const SIDE_QUESTION_POLL_INTERVAL_MS = 25;
// Backstop for callers that pass no signal. The manager races its own 30s timeout and aborts,
// so this only has to stop the poll from outliving the daemon.
const SIDE_QUESTION_WAIT_TIMEOUT_MS = 60_000;
// The fork is persisted on disk, so cleanup must not be skipped on abort -- only bounded.
const SIDE_QUESTION_CLEANUP_TIMEOUT_MS = 5_000;

const SIDE_QUESTION_TIMED_OUT: SideAnswer = { status: "timed_out", threading: "threaded" };

const SIDE_QUESTION_TOOLS = {
  "*": false,
  bash: false,
  edit: false,
  write: false,
  patch: false,
  read: false,
  grep: false,
  glob: false,
  list: false,
  task: false,
  todowrite: false,
  todoread: false,
  webfetch: false,
  websearch: false,
  codesearch: false,
  skill: false,
  question: false,
} as const;

interface OpenCodeSideQuestionMessage {
  info: { role: "user" | "assistant" } | AssistantMessage;
  parts: Part[];
}

export interface OpenCodeSideQuestionClient {
  session: {
    fork(input: {
      sessionID: string;
      directory: string;
    }): Promise<{ data?: { id: string }; error?: unknown }>;
    promptAsync(input: {
      sessionID: string;
      directory: string;
      messageID: string;
      parts: Array<{ type: "text"; text: string }>;
      tools: Record<string, boolean>;
      system: string;
      model?: { providerID: string; modelID: string };
      agent?: string;
      variant?: string;
    }): Promise<{ error?: unknown }>;
    messages(
      input: {
        sessionID: string;
        directory: string;
      },
      // Mirrors the SDK's per-call RequestOptions: Config extends RequestInit, so a signal
      // here binds to the Request the SDK builds and cancels the refetch while it is in
      // flight. The SDK then settles with { error: AbortError } instead of throwing.
      options?: { signal?: AbortSignal },
    ): Promise<{ data?: OpenCodeSideQuestionMessage[]; error?: unknown }>;
    delete(input: { sessionID: string; directory: string }): Promise<{ error?: unknown }>;
  };
}

function formatSideQuestion(
  question: string,
  history: readonly SideConversationExchange[],
): string {
  if (history.length === 0) return question;
  const prior = history
    .map(
      (exchange, index) =>
        `Earlier side exchange ${index + 1}:\nQuestion: ${exchange.question}\nAnswer: ${exchange.answer}`,
    )
    .join("\n\n");
  return `${prior}\n\nCurrent side question:\n${question}`;
}

function readAnswer(
  messages: readonly OpenCodeSideQuestionMessage[],
  parentMessageId: string,
): SideAnswer | null {
  const message = messages.find(
    (candidate): candidate is OpenCodeSideQuestionMessage & { info: AssistantMessage } =>
      candidate.info.role === "assistant" &&
      "parentID" in candidate.info &&
      candidate.info.parentID === parentMessageId,
  );
  if (!message || message.info.time.completed === undefined) return null;
  if (message.info.error) {
    return {
      status: "failed",
      error: toDiagnosticErrorMessage(message.info.error),
      threading: "threaded",
    };
  }
  const textParts = message.parts.filter(
    (part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.ignored,
  );
  const content = textParts
    .map((part) => part.text)
    .join("")
    .trim();
  if (!content) {
    return {
      status: "failed",
      error: "OpenCode completed the side question without an answer",
      threading: "threaded",
    };
  }
  return {
    status: "answered",
    content,
    synthetic: textParts.every((part) => part.synthetic === true),
    threading: "threaded",
  };
}

/** Sleeps until the delay elapses or the signal aborts, without leaving a timer pending. */
function waitForNextPoll(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  return new Promise<void>((resolve) => {
    timer = setTimeout(resolve, delayMs);
    timer.unref();
    if (!signal) return;
    onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

async function waitForAnswer(input: {
  client: OpenCodeSideQuestionClient;
  sessionId: string;
  cwd: string;
  messageId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SideAnswer> {
  const deadline = Date.now() + (input.timeoutMs ?? SIDE_QUESTION_WAIT_TIMEOUT_MS);
  for (;;) {
    // Checked before the request too: each poll refetches the whole forked conversation, so a
    // doomed poll should not start. The signal passed below cancels one already in flight.
    if (input.signal?.aborted || Date.now() >= deadline) return SIDE_QUESTION_TIMED_OUT;
    const response = await input.client.session.messages(
      {
        sessionID: input.sessionId,
        directory: input.cwd,
      },
      input.signal ? { signal: input.signal } : undefined,
    );
    if (response.error) {
      // An aborted refetch is the caller calling the question off, so it settles the same
      // way the loop-top check does -- not as a failed answer with the SDK's AbortError.
      if (input.signal?.aborted) return SIDE_QUESTION_TIMED_OUT;
      throw new Error(toDiagnosticErrorMessage(response.error));
    }
    const answer = readAnswer(response.data ?? [], input.messageId);
    if (answer) return answer;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return SIDE_QUESTION_TIMED_OUT;
    await waitForNextPoll(Math.min(SIDE_QUESTION_POLL_INTERVAL_MS, remainingMs), input.signal);
  }
}

export async function askOpenCodeSideQuestion(input: {
  client: OpenCodeSideQuestionClient;
  parentSessionId: string;
  cwd: string;
  question: string;
  history: readonly SideConversationExchange[];
  messageId: string;
  logger: Logger;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SideAnswer> {
  const forkResponse = await input.client.session.fork({
    sessionID: input.parentSessionId,
    directory: input.cwd,
  });
  if (forkResponse.error || !forkResponse.data?.id) {
    throw new Error(toDiagnosticErrorMessage(forkResponse.error ?? "missing fork session id"));
  }

  const forkSessionId = forkResponse.data.id;
  input.logger.debug(
    { forkSessionId, parentSessionId: input.parentSessionId },
    "Created persisted OpenCode side-question fork; daemon exit before cleanup may leave it behind",
  );
  try {
    const promptResponse = await input.client.session.promptAsync({
      sessionID: forkSessionId,
      directory: input.cwd,
      messageID: input.messageId,
      parts: [{ type: "text", text: formatSideQuestion(input.question, input.history) }],
      tools: SIDE_QUESTION_TOOLS,
      system:
        "Answer the user's side question directly. Do not call or request any tools. Treat earlier side exchanges as context only.",
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      ...(input.variant ? { variant: input.variant } : {}),
    });
    if (promptResponse.error) throw new Error(toDiagnosticErrorMessage(promptResponse.error));
    return await waitForAnswer({
      client: input.client,
      sessionId: forkSessionId,
      cwd: input.cwd,
      messageId: input.messageId,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
  } finally {
    let cleanupError: unknown;
    try {
      // Deliberately not gated on input.signal: an aborted wait still has a fork to delete.
      const deleteResponse = await withTimeout(
        input.client.session.delete({ sessionID: forkSessionId, directory: input.cwd }),
        SIDE_QUESTION_CLEANUP_TIMEOUT_MS,
        "Timed out deleting OpenCode side-question fork",
      );
      cleanupError = deleteResponse.error;
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError !== undefined) {
      input.logger.warn(
        {
          err: cleanupError,
          leakedSessionId: forkSessionId,
          parentSessionId: input.parentSessionId,
        },
        "Failed to delete persisted OpenCode side-question fork",
      );
    }
  }
}
