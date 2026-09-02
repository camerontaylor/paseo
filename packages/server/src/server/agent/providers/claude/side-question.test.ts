import { afterEach, describe, expect, it, vi } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentSession, SideAnswer, SideConversationExchange } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import { askClaudeSideQuestion, getClaudeSideQuestionThreading } from "./side-question.js";

describe("Claude side question threading gate", () => {
  it("gates history at the exact 2.1.227 floor", () => {
    expect(getClaudeSideQuestionThreading("2.1.225")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.1.226")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.1.227")).toBe("threaded");
    expect(getClaudeSideQuestionThreading("2.1.228")).toBe("threaded");
  });

  it("compares each version segment numerically rather than lexically", () => {
    expect(getClaudeSideQuestionThreading("1.9.9")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.0.999")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.1.99")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.2.0")).toBe("threaded");
    expect(getClaudeSideQuestionThreading("3.0.0")).toBe("threaded");
    expect(getClaudeSideQuestionThreading("10.0.0")).toBe("threaded");
  });

  it("falls back to single_shot when the version is missing or unreadable", () => {
    expect(getClaudeSideQuestionThreading(undefined)).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("unknown")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("2.1")).toBe("single_shot");
  });

  it("reads versions the shared --version parser accepts", () => {
    // parseClaudeCodeVersion is the same reader resolveClaudeCodeVersion() uses, so raw
    // `claude --version` output and prerelease suffixes resolve to their numeric core
    // instead of tripping the unreadable-version fallback. A leading `v` still does not
    // parse — its word boundary is missing — so it lands on the safe fallback.
    expect(getClaudeSideQuestionThreading("2.1.227 (Claude Code)")).toBe("threaded");
    expect(getClaudeSideQuestionThreading("wrapper 1.0.0\n2.1.226 (Claude Code)")).toBe(
      "single_shot",
    );
    expect(getClaudeSideQuestionThreading("2.1.227-beta.1")).toBe("threaded");
    expect(getClaudeSideQuestionThreading("2.1.226-beta.1")).toBe("single_shot");
    expect(getClaudeSideQuestionThreading("v2.1.227")).toBe("single_shot");
  });
});

describe("Claude side question requests", () => {
  it("passes history only for threaded requests", async () => {
    const request = vi.fn().mockResolvedValue({ response: "answer", synthetic: true });
    const query = { request } as unknown as Query;
    const history = [{ question: "before?", answer: "before" }];
    await askClaudeSideQuestion({ query, question: "now?", history, threading: "threaded" });
    expect(request).toHaveBeenCalledWith({
      subtype: "side_question",
      question: "now?",
      history: [{ question: "before?", response: "before" }],
    });
    request.mockClear();
    await askClaudeSideQuestion({ query, question: "now?", history, threading: "single_shot" });
    expect(request).toHaveBeenCalledWith({ subtype: "side_question", question: "now?" });
  });
});

type AskSideQuestion = (
  question: string,
  history: readonly SideConversationExchange[],
  options?: { signal?: AbortSignal },
) => Promise<SideAnswer>;

function askSideQuestionOf(session: AgentSession): AskSideQuestion {
  const ask = session.askSideQuestion;
  if (!ask) throw new Error("Claude sessions must expose askSideQuestion");
  return ask.bind(session);
}

function createSideQuestionQueryMock(response: string): Query {
  return {
    request: vi.fn(async () => ({ response, synthetic: false })),
    next: vi.fn(async () => ({ done: true, value: undefined })),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    applyFlagSettings: vi.fn(async () => undefined),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as Query;
}

interface SideQuestionHarness {
  queryFactory: ReturnType<typeof vi.fn>;
  resolveVersion: ReturnType<typeof vi.fn>;
  createSession: () => Promise<AgentSession>;
}

function createHarness(
  resolveVersion: () => Promise<string>,
  options?: { resolveBinary?: () => Promise<string> },
): SideQuestionHarness {
  const queryFactory = vi.fn(() => createSideQuestionQueryMock("side answer"));
  const resolveVersionMock = vi.fn(resolveVersion);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: options?.resolveBinary ?? (async () => "/test/claude/bin"),
    resolveVersion: resolveVersionMock,
  });
  return {
    queryFactory,
    resolveVersion: resolveVersionMock,
    createSession: () => client.createSession({ provider: "claude", cwd: process.cwd() }),
  };
}

describe("Claude session side questions", () => {
  const openSessions: AgentSession[] = [];

  afterEach(async () => {
    while (openSessions.length > 0) {
      await openSessions.pop()?.close();
    }
  });

  async function openSession(harness: SideQuestionHarness): Promise<AgentSession> {
    const session = await harness.createSession();
    openSessions.push(session);
    return session;
  }

  it("does not spawn a Claude process for a session closed during version discovery", async () => {
    let releaseVersion: (() => void) | undefined;
    const harness = createHarness(async () => {
      await new Promise<void>((resolve) => {
        releaseVersion = resolve;
      });
      return "2.1.227";
    });
    const session = await openSession(harness);

    const answer = askSideQuestionOf(session)("still there?", []);
    await vi.waitFor(() => expect(releaseVersion).toBeDefined());
    await session.close();
    releaseVersion?.();

    await expect(answer).resolves.toEqual({
      status: "unavailable",
      reason: "session_closed",
    });
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });

  it("reports unavailable without probing when the session is already closed", async () => {
    const harness = createHarness(async () => "2.1.227");
    const session = await openSession(harness);
    await session.close();

    await expect(askSideQuestionOf(session)("still there?", [])).resolves.toEqual({
      status: "unavailable",
      reason: "session_closed",
    });
    expect(harness.resolveVersion).not.toHaveBeenCalled();
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });

  it("reports unavailable without probing when the caller's signal is already aborted", async () => {
    const harness = createHarness(async () => "2.1.227");
    const session = await openSession(harness);

    await expect(
      askSideQuestionOf(session)("still there?", [], { signal: AbortSignal.abort() }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(harness.resolveVersion).not.toHaveBeenCalled();
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });

  it("does not bind the caller's signal to the shared version probe", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const queryFactory = vi.fn(() => createSideQuestionQueryMock("side answer"));
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      resolveVersion: async (signal) => {
        seenSignal = signal;
        return "2.1.227";
      },
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
    openSessions.push(session);

    const answer = await askSideQuestionOf(session)("hello?", [], { signal: controller.signal });
    // The probe is memoized across every thread's side questions, so it must not carry any
    // one caller's signal: AgentManager aborts each caller's signal when that caller settles.
    expect(seenSignal).toBeUndefined();
    expect(answer).toMatchObject({ status: "answered", threading: "threaded" });
  });

  it("keeps the shared probe alive when one concurrent caller aborts", async () => {
    let releaseVersion: ((version: string) => void) | undefined;
    const harness = createHarness(
      () =>
        new Promise<string>((resolve) => {
          releaseVersion = resolve;
        }),
    );
    const session = await openSession(harness);
    const ask = askSideQuestionOf(session);

    const firstController = new AbortController();
    const first = ask("from thread one?", [], { signal: firstController.signal });
    await vi.waitFor(() => expect(releaseVersion).toBeDefined());
    const second = ask("from thread two?", []);
    firstController.abort();
    releaseVersion?.("2.1.227");

    // The aborted caller is turned away by its own aborted check; the other thread keeps the
    // memoized probe's result instead of re-probing (or falling back to single_shot).
    await expect(first).resolves.toEqual({ status: "unavailable" });
    await expect(second).resolves.toMatchObject({
      status: "answered",
      threading: "threaded",
    });
    expect(harness.resolveVersion).toHaveBeenCalledTimes(1);
  });

  it("probes `claude --version` once per session", async () => {
    const harness = createHarness(async () => "2.1.227");
    const session = await openSession(harness);
    const ask = askSideQuestionOf(session);

    await expect(ask("first?", [])).resolves.toMatchObject({
      status: "answered",
      threading: "threaded",
    });
    await expect(
      ask("second?", [{ question: "first?", answer: "side answer" }]),
    ).resolves.toMatchObject({
      status: "answered",
      threading: "threaded",
    });

    expect(harness.resolveVersion).toHaveBeenCalledTimes(1);
    expect(harness.queryFactory).toHaveBeenCalledTimes(1);
  });

  it("retries the version probe after a failure instead of caching the fallback", async () => {
    let attempts = 0;
    const harness = createHarness(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("claude --version exploded");
      return "2.1.227";
    });
    const session = await openSession(harness);
    const ask = askSideQuestionOf(session);

    await expect(ask("first?", [])).resolves.toMatchObject({ threading: "single_shot" });
    await expect(ask("second?", [])).resolves.toMatchObject({ threading: "threaded" });
    expect(harness.resolveVersion).toHaveBeenCalledTimes(2);
  });
});

describe("Claude session closed guard", () => {
  const openSessions: AgentSession[] = [];

  afterEach(async () => {
    while (openSessions.length > 0) {
      await openSessions.pop()?.close();
    }
  });

  async function openSession(harness: SideQuestionHarness): Promise<AgentSession> {
    const session = await harness.createSession();
    openSessions.push(session);
    return session;
  }

  // The five public ensureQuery() entry points that predate the guard. Each must refuse a
  // closed session instead of spawning an untracked Claude CLI process tree for it.
  const closedSessionRefusals: Array<
    [name: string, call: (session: AgentSession) => Promise<unknown>]
  > = [
    ["setMode", (session) => session.setMode("default")],
    ["setModel", (session) => session.setModel!(null)],
    ["listCommands", (session) => session.listCommands!()],
    ["revertFiles", (session) => session.revertFiles!({ messageId: "msg_1" })],
  ];

  it.each(closedSessionRefusals)(
    "%s refuses a closed session without spawning",
    async (_name, call) => {
      const harness = createHarness(async () => "2.1.227");
      const session = await openSession(harness);
      await session.close();

      await expect(call(session)).rejects.toThrow("Claude session is closed");
      expect(harness.queryFactory).not.toHaveBeenCalled();
    },
  );

  it("does not spawn when close() lands while query options are being built", async () => {
    let releaseBinary: ((binary: string) => void) | undefined;
    const harness = createHarness(async () => "2.1.227", {
      resolveBinary: () =>
        new Promise<string>((resolve) => {
          releaseBinary = resolve;
        }),
    });
    const session = await openSession(harness);

    const pending = session.listCommands!();
    await vi.waitFor(() => expect(releaseBinary).toBeDefined());
    await session.close();
    releaseBinary?.("/test/claude/bin");

    await expect(pending).rejects.toThrow("Claude session is closed");
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });

  it("fails a turn instead of spawning when close() lands mid-options during startTurn", async () => {
    let releaseBinary: ((binary: string) => void) | undefined;
    const harness = createHarness(async () => "2.1.227", {
      resolveBinary: () =>
        new Promise<string>((resolve) => {
          releaseBinary = resolve;
        }),
    });
    const session = await openSession(harness);
    const events: string[] = [];
    session.subscribe((event) => {
      events.push(event.type);
    });

    const started = session.startTurn("hello");
    await vi.waitFor(() => expect(releaseBinary).toBeDefined());
    await session.close();
    releaseBinary?.("/test/claude/bin");

    await expect(started).resolves.toEqual({ turnId: expect.any(String) });
    // close() cancels the active turn before ensureQuery() can throw, so the turn settles as
    // canceled rather than failed — the ensureQuery throw only fails turns close() cannot cancel.
    await vi.waitFor(() => expect(events).toContain("turn_canceled"));
    expect(events).not.toContain("turn_failed");
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });

  it("maps a mid-options close during askSideQuestion to unavailable", async () => {
    let releaseBinary: ((binary: string) => void) | undefined;
    const harness = createHarness(async () => "2.1.227", {
      resolveBinary: () =>
        new Promise<string>((resolve) => {
          releaseBinary = resolve;
        }),
    });
    const session = await openSession(harness);

    const answer = askSideQuestionOf(session)("still there?", []);
    await vi.waitFor(() => expect(releaseBinary).toBeDefined());
    await session.close();
    releaseBinary?.("/test/claude/bin");

    await expect(answer).resolves.toEqual({
      status: "unavailable",
      reason: "session_closed",
    });
    expect(harness.queryFactory).not.toHaveBeenCalled();
  });
});
