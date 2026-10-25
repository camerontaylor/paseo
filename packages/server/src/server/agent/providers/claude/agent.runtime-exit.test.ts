import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type {
  Options,
  Query,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

interface QueryMockOptions {
  // Runs while the session retires this query, modelling a process that dies as
  // part of the retirement handshake.
  onReturn?: () => void;
  // Awaited once the scripted events run out, so the query stays open the way a
  // real one does. Resolving it with a value delivers one more event.
  tail?: Promise<unknown>;
}

function createQueryMock(events: unknown[], options: QueryMockOptions = {}): Query {
  let index = 0;
  return {
    next: vi.fn(async () => {
      if (index < events.length) {
        return { done: false, value: events[index++] };
      }
      const late = await options.tail;
      if (late !== undefined) {
        options.tail = undefined;
        return { done: false, value: late };
      }
      return { done: true, value: undefined };
    }),
    return: vi.fn(async () => {
      options.onReturn?.();
      return { done: true, value: undefined };
    }),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

function createChildProcessStub(): ChildProcess & { killSignals: (NodeJS.Signals | number)[] } {
  const child = new EventEmitter() as ChildProcess & {
    killSignals: (NodeJS.Signals | number)[];
  };
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  child.killSignals = [];
  // A real child dies when signalled; without this the teardown path waits out
  // its full graceful + force timeout on every test.
  child.kill = ((signal?: NodeJS.Signals | number) => {
    child.killSignals.push(signal ?? "SIGTERM");
    child.emit("exit", null, typeof signal === "string" ? signal : "SIGTERM");
    return true;
  }) as ChildProcess["kill"];
  return child;
}

const COMPLETED_TURN_EVENTS = [
  {
    type: "system",
    subtype: "init",
    session_id: "claude-runtime-exit-session",
    permissionMode: "default",
    model: "opus",
  },
  { type: "assistant", message: { content: "SPAWNED" } },
  {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
    total_cost_usd: 0,
  },
];

const RUNNING_WORKFLOW_TURN_EVENTS = [
  COMPLETED_TURN_EVENTS[0],
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_workflow",
          name: "Workflow",
          input: { workflow: "spec" },
        },
      ],
    },
  },
  {
    type: "system",
    subtype: "task_started",
    task_id: "wf-1",
    tool_use_id: "toolu_workflow",
    task_type: "local_workflow",
    description: "Run the spec workflow",
  },
  {
    type: "system",
    subtype: "task_updated",
    task_id: "wf-1",
    patch: { status: "running", is_backgrounded: true },
  },
  COMPLETED_TURN_EVENTS[2],
];

const MISSING_RESUMED_CONVERSATION_RESULT = {
  type: "result",
  subtype: "error_during_execution",
  errors: ["No conversation found with session ID: claude-runtime-exit-session"],
};

const SPAWN_OPTIONS: ClaudeSpawnOptions = {
  command: "node",
  args: ["claude.js"],
  cwd: process.cwd(),
  env: {},
  signal: new AbortController().signal,
};

describe("Claude runtime exit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("reports a turn failure when the process dies while the session is idle", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS);
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.run("start a background shell");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      child.emit("exit", 1, null);

      const failure = events.find((event) => event.type === "turn_failed");
      expect(failure).toBeDefined();
      expect(failure && "error" in failure ? failure.error : "").toContain("background shells");
    } finally {
      await session.close();
    }
  });

  test("fails a running workflow when its idle Claude runtime exits", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(RUNNING_WORKFLOW_TURN_EVENTS);
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    try {
      await session.run("run a workflow in the background");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);
      child.emit("exit", 1, null);

      const workflowUpserts = events
        .filter((event) => event.type === "provider_subagent")
        .map((event) => event.event)
        .filter((event) => event.type === "upsert" && event.id === "toolu_workflow");
      expect(workflowUpserts[0]).toMatchObject({ title: "Workflow", status: "running" });
      expect(workflowUpserts.at(-1)).toMatchObject({ status: "failed" });
    } finally {
      await session.close();
    }
  });

  test("stays quiet when the process exits during an intentional teardown", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS);
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    await session.run("start a background shell");
    capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.close();
    child.emit("exit", 0, null);

    expect(events.some((event) => event.type === "turn_failed")).toBe(false);
  });

  test("stays quiet when a query restart retires the process", async () => {
    let capturedOptions: Options | undefined;
    const child = createChildProcessStub();
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      // A real query stays open between turns, so hold it open; the process
      // dies when the session retires it, as ending its stdin does in practice.
      return createQueryMock(RUNNING_WORKFLOW_TURN_EVENTS, {
        tail: new Promise<never>(() => undefined),
        onReturn: () => child.emit("exit", 0, null),
      });
    });
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.run("first turn");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      // Restarts the query on the next call, which retires the current process
      // while no turn is running.
      await session.setThinkingOption(null);
      await session.listCommands();

      expect(events.some((event) => event.type === "turn_failed")).toBe(false);
      expect(events).toContainEqual({
        type: "provider_subagent",
        provider: "claude",
        event: { type: "upsert", id: "toolu_workflow", status: "failed" },
      });
    } finally {
      await session.close();
    }
  });

  test("refuses a side question rather than tree-killing the CLI mid-turn", async () => {
    // setThinkingOption() arms queryRestartNeeded during a live turn on purpose and defers it to
    // the next one. ensureQuery() acts on that flag by tree-killing the running process, and it
    // nulls this.query first so the old pump skips failActiveTurns — so a side question taking
    // that branch would kill the turn and leave it un-terminalized, spinning forever.
    // startTurn() can never reach it (it refuses while a turn is active); this is the one caller
    // that can.
    const child = createChildProcessStub();
    const queryFactory = vi.fn(() =>
      createQueryMock([COMPLETED_TURN_EVENTS[0]], {
        tail: new Promise<never>(() => undefined),
        onReturn: () => child.emit("exit", 0, null),
      }),
    );
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      resolveVersion: async () => "2.1.227",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.startTurn("a long running turn");
      await session.setThinkingOption(null);

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      const ask = session.askSideQuestion;
      if (!ask) throw new Error("Claude sessions must expose askSideQuestion");
      await expect(ask.call(session, "quick question?", [])).resolves.toEqual({
        status: "unavailable",
      });

      // No second query means ensureQuery() never took the restart branch.
      expect(queryFactory).toHaveBeenCalledTimes(1);
      expect(child.killSignals).toEqual([]);
      expect(events.some((event) => event.type === "turn_failed")).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("still answers a side question once no turn is running", async () => {
    // The guard is about an armed restart during a live turn, not about side questions in
    // general — an idle session with the same flag set may restart freely.
    const child = createChildProcessStub();
    // The control-request method the side-question seam casts to, hoisted out of the factory so
    // the callbacks stay within the nesting limit.
    const sideQuestionRequest = vi.fn(async () => ({ response: "side answer", synthetic: false }));
    const queryFactory = vi.fn(() => {
      const query = createQueryMock([...COMPLETED_TURN_EVENTS], {
        tail: new Promise<never>(() => undefined),
        onReturn: () => child.emit("exit", 0, null),
      }) as Query & { request: unknown };
      query.request = sideQuestionRequest;
      return query;
    });
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      resolveVersion: async () => "2.1.227",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.run("first turn");
      await session.setThinkingOption(null);

      const ask = session.askSideQuestion;
      if (!ask) throw new Error("Claude sessions must expose askSideQuestion");
      const answer = await ask.call(session, "quick question?", []);

      expect(answer).toMatchObject({ status: "answered" });
      expect(queryFactory).toHaveBeenCalledTimes(2);
    } finally {
      await session.close();
    }
  });

  test("tree-kills the retired process when the resumed conversation is gone", async () => {
    let capturedOptions: Options | undefined;
    let deliverMissingConversation: ((event: unknown) => void) | undefined;
    // A single query throughout, so the only path that can kill the child is the
    // missing-conversation recovery — not the restart path in ensureQuery().
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS, {
        tail: new Promise<unknown>((resolve) => {
          deliverMissingConversation = resolve;
        }),
      });
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      // Establishes the claude session id the next result fails to resume.
      await session.run("first turn");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      deliverMissingConversation?.(MISSING_RESUMED_CONVERSATION_RESULT);

      // MCP children of the retired process outlive it unless the tree is killed.
      await vi.waitFor(() => expect(child.killSignals.length).toBeGreaterThan(0));
      expect(queryFactory).toHaveBeenCalledTimes(1);
    } finally {
      await session.close();
    }
  });

  test("leaves a mid-turn crash to the query pump", async () => {
    let rejectStream: ((error: Error) => void) | undefined;
    const tail = new Promise<never>((_resolve, reject) => {
      rejectStream = reject;
    });
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS.slice(0, 2), { tail });
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));
      const turn = session.run("start a background shell");
      await vi.waitFor(() => expect(capturedOptions?.spawnClaudeCodeProcess).toBeDefined());
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      child.emit("exit", 1, null);
      rejectStream?.(new Error("Claude Code process exited with code 1"));
      await expect(turn).rejects.toThrow("exited with code 1");

      const failures = events.filter((event) => event.type === "turn_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0] && "error" in failures[0] ? failures[0].error : "").toContain(
        "exited with code 1",
      );
    } finally {
      await session.close();
    }
  });
});
