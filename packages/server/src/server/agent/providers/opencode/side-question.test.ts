import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { askOpenCodeSideQuestion, type OpenCodeSideQuestionClient } from "./side-question.js";

function assistantMessage(parentID: string, text: string) {
  return {
    info: {
      id: "assistant-1",
      sessionID: "fork-1",
      role: "assistant" as const,
      time: { created: 1, completed: 2 },
      parentID,
      modelID: "model",
      providerID: "provider",
      mode: "build",
      agent: "build",
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: "part-1",
        sessionID: "fork-1",
        messageID: "assistant-1",
        type: "text" as const,
        text,
      },
    ],
  };
}

function createClient() {
  const fork = vi.fn(async () => ({ data: { id: "fork-1" } }));
  const promptAsync = vi.fn(async () => ({}));
  const messages = vi
    .fn<OpenCodeSideQuestionClient["session"]["messages"]>()
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ data: [assistantMessage("question-1", "The answer")] });
  const deleteSession = vi.fn(async () => ({}));
  const client: OpenCodeSideQuestionClient = {
    session: { fork, promptAsync, messages, delete: deleteSession },
  };
  return { client, fork, promptAsync, messages, deleteSession };
}

// A refetch that hangs until the caller's signal aborts, mirroring what the real SDK does
// with the per-call signal option: with throwOnError unset it settles { error: AbortError }
// rather than throwing. Only the abort can settle it, so a test that resolves did so
// because the cancellation worked.
function hangingRefetch(): OpenCodeSideQuestionClient["session"]["messages"] {
  const abortError = () =>
    Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  return (_input, options) =>
    new Promise((resolve) => {
      const settleAborted = () => resolve({ error: abortError() });
      if (options?.signal?.aborted) {
        settleAborted();
        return;
      }
      options?.signal?.addEventListener("abort", settleAborted, { once: true });
    });
}

describe("OpenCode side questions", () => {
  test("answers on a persisted fork without tools and deletes the fork", async () => {
    const { client, fork, promptAsync, deleteSession } = createClient();

    const result = await askOpenCodeSideQuestion({
      client,
      parentSessionId: "parent-1",
      cwd: "/workspace",
      question: "What should I do next?",
      history: [{ question: "What changed?", answer: "The parser changed." }],
      messageId: "question-1",
      logger: createTestLogger(),
      model: { providerID: "provider", modelID: "model" },
      agent: "build",
      variant: "high",
    });

    expect(result).toEqual({
      status: "answered",
      content: "The answer",
      synthetic: false,
      threading: "threaded",
    });
    expect(fork).toHaveBeenCalledWith({ sessionID: "parent-1", directory: "/workspace" });
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "fork-1",
        directory: "/workspace",
        messageID: "question-1",
        model: { providerID: "provider", modelID: "model" },
        agent: "build",
        variant: "high",
        parts: [
          {
            type: "text",
            text: expect.stringContaining("Earlier side exchange 1"),
          },
        ],
      }),
    );
    expect(Object.values(promptAsync.mock.calls[0]![0].tools)).not.toContain(true);
    expect(deleteSession).toHaveBeenCalledWith({
      sessionID: "fork-1",
      directory: "/workspace",
    });
  });

  test("deletes the persisted fork when prompt dispatch fails", async () => {
    const { client, promptAsync, deleteSession } = createClient();
    promptAsync.mockResolvedValueOnce({ error: { message: "dispatch failed" } });

    await expect(
      askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
      }),
    ).rejects.toThrow("dispatch failed");
    expect(deleteSession).toHaveBeenCalledWith({
      sessionID: "fork-1",
      directory: "/workspace",
    });
  });

  test("stops polling and reports a timeout when the caller aborts", async () => {
    vi.useFakeTimers();
    try {
      const { client, messages, deleteSession } = createClient();
      messages.mockReset();
      messages.mockResolvedValue({ data: [] });
      const controller = new AbortController();

      const answer = askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(messages).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(1);

      controller.abort();

      await expect(answer).resolves.toEqual({ status: "timed_out", threading: "threaded" });
      expect(messages).toHaveBeenCalledTimes(1);
      expect(deleteSession).toHaveBeenCalledWith({
        sessionID: "fork-1",
        directory: "/workspace",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cancels an in-flight refetch when the caller aborts mid-poll", async () => {
    const { client, messages, deleteSession } = createClient();
    messages.mockReset();
    messages.mockImplementation(hangingRefetch());
    const controller = new AbortController();

    const answer = askOpenCodeSideQuestion({
      client,
      parentSessionId: "parent-1",
      cwd: "/workspace",
      question: "Why?",
      history: [],
      messageId: "question-1",
      logger: createTestLogger(),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(1));
    // The signal rides the SDK's per-call options, not the query parameters.
    expect(messages).toHaveBeenCalledWith(
      { sessionID: "fork-1", directory: "/workspace" },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(answer).resolves.toEqual({ status: "timed_out", threading: "threaded" });
    expect(messages).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith({
      sessionID: "fork-1",
      directory: "/workspace",
    });
  });

  test("does not refetch the conversation when the signal is already aborted", async () => {
    const { client, messages, deleteSession } = createClient();

    await expect(
      askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
        signal: AbortSignal.abort(),
      }),
    ).resolves.toEqual({ status: "timed_out", threading: "threaded" });
    expect(messages).not.toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalledWith({
      sessionID: "fork-1",
      directory: "/workspace",
    });
  });

  test("stops polling at the deadline when no signal is supplied", async () => {
    vi.useFakeTimers();
    try {
      const { client, messages, deleteSession } = createClient();
      messages.mockReset();
      messages.mockResolvedValue({ data: [] });

      const answer = askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
        timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(answer).resolves.toEqual({ status: "timed_out", threading: "threaded" });
      // Polls at 0ms, 25ms, 50ms, and 75ms; the 100ms deadline stops the loop.
      expect(messages).toHaveBeenCalledTimes(4);
      expect(deleteSession).toHaveBeenCalledWith({
        sessionID: "fork-1",
        directory: "/workspace",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("returns the answer when fork deletion never settles", async () => {
    vi.useFakeTimers();
    try {
      const { client, deleteSession } = createClient();
      deleteSession.mockImplementationOnce(() => new Promise<{ error?: unknown }>(() => {}));

      const answer = askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
      });
      await vi.advanceTimersByTimeAsync(25);
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(answer).resolves.toEqual({
        status: "answered",
        content: "The answer",
        synthetic: false,
        threading: "threaded",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not hide an answer when cleanup fails", async () => {
    const { client, deleteSession } = createClient();
    deleteSession.mockResolvedValueOnce({ error: { message: "delete failed" } });

    await expect(
      askOpenCodeSideQuestion({
        client,
        parentSessionId: "parent-1",
        cwd: "/workspace",
        question: "Why?",
        history: [],
        messageId: "question-1",
        logger: createTestLogger(),
      }),
    ).resolves.toEqual({
      status: "answered",
      content: "The answer",
      synthetic: false,
      threading: "threaded",
    });
  });
});
