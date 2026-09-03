import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PromptResponse, SessionNotification } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import {
  ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS,
  type ACPAdmissionState,
  type ACPAgentSessionOptions,
  type ACPStopKind,
  type SpawnedACPProcess,
} from "./acp-agent.js";
import {
  GjcACPAgentClient,
  GjcACPAgentSession,
  resolveGjcAbortScope,
  validateGjcTerminalAbortResult,
} from "./gjc-acp-agent.js";
import type { ProcessTerminator } from "../../../utils/tree-kill.js";
import type {
  AgentPromptInput,
  AgentSessionConfig,
  AgentStreamEvent,
  SteerActiveTurnOptions,
} from "../agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { asInternals } from "../../test-utils/class-mocks.js";

// ─────────────────────────────────────────────────────────────────────────────
// GJC fork provider.
//
// GJC 0.15.5 runs turns Paseo did not start. The mirror gives that activity an
// explicit turn id, and an ownerless stop releases only when a validated
// terminal `turn.abort` result and a post-stop idle are both present, in either
// order.
//
// Each test is numbered against the plan's GJC unit test list.
// ─────────────────────────────────────────────────────────────────────────────

interface DeferredResolution<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface DeferredCalls<T> {
  fn: (input: unknown) => Promise<T>;
  calls: Array<DeferredResolution<T>>;
  inputs: unknown[];
}

function createDeferredCalls<T>(): DeferredCalls<T> {
  const calls: Array<DeferredResolution<T>> = [];
  const inputs: unknown[] = [];
  const fn = (input: unknown) => {
    inputs.push(input);
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    calls.push({ promise, resolve, reject });
    return promise;
  };
  return { fn, calls, inputs };
}

/** Drains promise microtasks without touching the fake clock. */
async function flushMicrotasks(count = 10): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

/**
 * True once `promise` settles inside a fixed window of resolved microtasks. No
 * clock, no sleep, and a rejection that arrives in the window is handled rather
 * than reported unhandled.
 */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    flushMicrotasks().then(() => false),
  ]);
}

type GjcTerminalEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

interface GjcControlRequest {
  method: string;
  params: Record<string, unknown>;
}

interface GjcLogEntry {
  msg: string;
  data: Record<string, unknown> | undefined;
}

interface GjcSessionInternals {
  sessionId: string | null;
  connection: {
    prompt: (input: {
      sessionId: string;
      messageId: string;
      prompt: unknown;
    }) => Promise<PromptResponse>;
    cancel: (input: { sessionId: string }) => Promise<void>;
    extMethod: (
      method: string,
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    signal?: AbortSignal;
  } | null;
  connectionRevision: number;
  activeForegroundTurnId: string | null;
  admissionState: ACPAdmissionState;
  stop: {
    stopId: string;
    stoppedTurnId: string;
    kind: ACPStopKind;
    terminalObserved: boolean;
    cancelAttempts: Array<{ revision: number; settled: boolean; outcome: string }>;
    stagedSuccessor: { token: string } | null;
    releasedSuccessorToken: string | null;
  } | null;
  finishTurn(turnId: string, event: GjcTerminalEvent): void;
  ownerlessStop: {
    attemptRevision: number;
    result: {
      revision: number;
      verdict: { kind: string; disposition: string; reason?: string };
    } | null;
  } | null;
}

interface GjcHarness {
  session: TestableGjcSession;
  internals: GjcSessionInternals;
  prompt: DeferredCalls<PromptResponse>;
  cancel: DeferredCalls<void>;
  control: DeferredCalls<Record<string, unknown>>;
  controlRequests: GjcControlRequest[];
  events: AgentStreamEvent[];
  connectionDeath: AbortController;
  logs: GjcLogEntry[];
  sessionId: string;
}

/** Exposes the death-signal subscription so the harness can simulate transport death. */
class TestableGjcSession extends GjcACPAgentSession {
  bindConnectionDeathSignal(): void {
    const connection = this.getAcpConnection();
    if (connection) {
      this.observeConnectionDeath(connection);
    }
  }
}

function createHarnessLogger(): { logger: Logger; logs: GjcLogEntry[] } {
  const logger = createTestLogger();
  const logs: GjcLogEntry[] = [];
  const record = (data: unknown, msg?: string) => {
    logs.push({
      msg: msg ?? "",
      data:
        typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined,
    });
    return logger;
  };
  vi.spyOn(logger, "info").mockImplementation(record);
  vi.spyOn(logger, "warn").mockImplementation(record);
  return { logger, logs };
}

function createGjcHarness(
  options: { abortScope?: string; terminateProcess?: ProcessTerminator } = {},
): GjcHarness {
  const { logger, logs } = createHarnessLogger();
  const session = new TestableGjcSession(
    { provider: "gjc", cwd: "/tmp/paseo-gjc-test" },
    {
      provider: "gjc",
      logger,
      defaultCommand: ["gjc", "acp"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      ...(options.abortScope === undefined
        ? {}
        : { launchEnv: { GJC_ACP_ABORT_SCOPE: options.abortScope } }),
      ...(options.terminateProcess ? { terminateProcess: options.terminateProcess } : {}),
    },
  );

  const prompt = createDeferredCalls<PromptResponse>();
  const cancel = createDeferredCalls<void>();
  const control = createDeferredCalls<Record<string, unknown>>();
  const connectionDeath = new AbortController();
  const controlRequests: GjcControlRequest[] = [];
  const internals = asInternals<GjcSessionInternals>(session);
  internals.sessionId = "session-1";
  internals.connection = {
    prompt: prompt.fn,
    cancel: cancel.fn,
    extMethod: (method: string, params: Record<string, unknown>) => {
      controlRequests.push({ method, params });
      return control.fn(params);
    },
    signal: connectionDeath.signal,
  };
  internals.connectionRevision = 1;
  session.bindConnectionDeathSignal();

  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));

  return {
    session,
    internals,
    prompt,
    cancel,
    control,
    controlRequests,
    connectionDeath,
    events,
    logs,
    sessionId: "session-1",
  };
}

function sendPhase(harness: GjcHarness, phase: string): Promise<void> {
  const update: SessionNotification = {
    sessionId: harness.sessionId,
    update: { sessionUpdate: "session_info_update", _meta: { gjcPhase: phase } },
  };
  return harness.session.sessionUpdate(update);
}

function turnStartedIds(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === "turn_started" ? [event.turnId] : []));
}

function turnTerminalEvents(events: AgentStreamEvent[]): GjcTerminalEvent[] {
  return events.flatMap((event) =>
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
      ? [event]
      : [],
  );
}

function mirrorIds(events: AgentStreamEvent[]): string[] {
  return turnStartedIds(events).filter((turnId) => turnId.startsWith("gjc-autonomous-"));
}

function firstControlRequest(harness: GjcHarness): Record<string, unknown> {
  const request = harness.controlRequests[0];
  if (!request) {
    throw new Error("no control request was sent");
  }
  return request.params;
}

function abortRequests(harness: GjcHarness): Array<Record<string, unknown>> {
  return harness.controlRequests
    .filter((request) => request.method === "_gjc/sdk/control")
    .map((request) => request.params)
    .filter((params) => params.operation === "turn.abort");
}

/** GJC 0.15.5 `terminalAbort` result for a `turn`-scope stop. */
function turnScopeSafeResult(scope: string): Record<string, unknown> {
  return {
    ok: true,
    selection: scope,
    turn: "stopped",
    ownedWork: "left_running",
    automaticDelivery: "enabled",
    resumeOnOwnedCompletion: true,
  };
}

/** GJC 0.15.5 `terminalAbort` result for an `owned`-scope stop. */
function ownedScopeSafeResult(scope: string): Record<string, unknown> {
  return {
    ok: true,
    selection: scope,
    turn: "stopped",
    ownedWork: "stopped",
    automaticDelivery: "none",
    resumeOnOwnedCompletion: false,
  };
}

function noActiveTurnResult(scope: string): Record<string, unknown> {
  return { ok: true, selection: scope, turn: "no_active_turn", terminal: "terminal_no_effect" };
}

function steerOptions(expectedTurnId: string): SteerActiveTurnOptions {
  return { expectedTurnId };
}

describe("gjc abort scope resolution", () => {
  test("maps every configured value to a scope or refuses the session", () => {
    expect(resolveGjcAbortScope(undefined)).toBe("turn");
    expect(resolveGjcAbortScope("")).toBe("turn");
    expect(resolveGjcAbortScope("turn")).toBe("turn");
    expect(resolveGjcAbortScope("owned")).toBe("owned");
    for (const invalid of ["Turn", "owned ", "auto", "true"]) {
      expect(() => resolveGjcAbortScope(invalid)).toThrow(/GJC_ACP_ABORT_SCOPE/);
    }
  });
});

describe("GjcACPAgentSession ownerless boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Plan GJC test 1 — mirror identity.
  test("1. ownerless working mints one stable explicit gjc-autonomous- id", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");

    const started = turnStartedIds(harness.events);
    expect(started).toHaveLength(1);
    const mirrorId = started[0] as string;
    expect(mirrorId).toMatch(/^gjc-autonomous-[0-9a-f-]{36}$/);
    expect(harness.internals.stop).toBeNull();
    expect(harness.controlRequests).toHaveLength(0);

    // The id is retained through a stop and its retry: still the same id.
    const stopping = harness.session.interrupt();
    expect(abortRequests(harness)).toHaveLength(1);
    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");

    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(harness.logs.some((log) => log.msg === "provider.gjc.ownerless_stop_released")).toBe(
      true,
    );
  });

  // Plan GJC test 2 — edge idempotence.
  test("2. duplicate working is idempotent", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    await sendPhase(harness, "working");
    await sendPhase(harness, "working");

    const started = turnStartedIds(harness.events);
    expect(started).toHaveLength(1);
    expect(harness.logs.filter((log) => log.msg === "provider.gjc.phase_edge")).toHaveLength(1);
  });

  // Plan GJC test 3 — natural completion closes exactly that id once.
  test("3. natural idle closes exactly that id once", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;

    await sendPhase(harness, "idle");
    // A duplicate idle edge moves nothing: same phase, no new revision.
    await sendPhase(harness, "idle");

    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_completed", provider: "gjc", turnId: mirrorId },
    ]);
    expect(harness.internals.stop).toBeNull();
  });

  // Plan GJC test 4 — foreground activity owns the slot.
  test("4. foreground working/idle does not open a competing ownerless mirror", async () => {
    const harness = createGjcHarness();
    const foregroundTurnId = (await harness.session.startTurn("ship it")).turnId;
    await sendPhase(harness, "working");
    await sendPhase(harness, "idle");

    expect(mirrorIds(harness.events)).toEqual([]);
    expect(turnStartedIds(harness.events)).toEqual([foregroundTurnId]);

    harness.prompt.calls[0]?.resolve({ stopReason: "end_turn" });
    await flushMicrotasks();
    await sendPhase(harness, "idle");

    expect(turnTerminalEvents(harness.events).map((event) => event.turnId)).toEqual([
      foregroundTurnId,
    ]);
    expect(harness.internals.admissionState).toBe("idle");
  });

  // Plan GJC test 5 — replay suppression stays intact.
  test("5. no mirror opens from a phase edge delivered while history replays", async () => {
    let replayingSession!: GjcACPAgentSession;
    const loadSession = vi.fn().mockImplementation(async () => {
      // GJC publishes gjcPhase through session_info_update. During replay the
      // mapper drops it, so the session must not treat such an edge as live
      // activity even if a transport delivered one.
      await replayingSession.sessionUpdate({
        sessionId: "session-1",
        update: { sessionUpdate: "session_info_update", _meta: { gjcPhase: "working" } },
      });
      return { sessionId: "session-1", modes: null, models: null, configOptions: [] };
    });

    const { logger } = createHarnessLogger();
    class ReplayingGjcSession extends GjcACPAgentSession {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: createProbeChildStub(),
          connection: { loadSession } as unknown as SpawnedACPProcess["connection"],
          initialize: { agentCapabilities: { loadSession: true } },
        } as unknown as SpawnedACPProcess;
      }
    }
    replayingSession = new ReplayingGjcSession(
      { provider: "gjc", cwd: "/tmp/paseo-gjc-test" },
      {
        provider: "gjc",
        logger,
        defaultCommand: ["gjc", "acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
        handle: { sessionId: "session-1", provider: "gjc" },
        // A real tree-kill would wait on the stub child under fake timers.
        terminateProcess: async () => "terminated",
      },
    );

    const events: AgentStreamEvent[] = [];
    replayingSession.subscribe((event) => events.push(event));
    await replayingSession.initializeResumedSession();

    expect(mirrorIds(events)).toEqual([]);
    await replayingSession.close();
    expect(mirrorIds(events)).toEqual([]);
  });

  // Plan GJC tests 6, 7, 8 — configured scope is sent exactly.
  test("6. missing GJC_ACP_ABORT_SCOPE sends scope turn", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    expect(harness.session.configuredAbortScope).toBe("turn");
    expect(firstControlRequest(harness)).toEqual({
      sessionId: "session-1",
      operation: "turn.abort",
      input: { mode: "terminal", scope: "turn", idempotencyKey: expect.any(String) },
    });

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");
  });

  test("7. explicit turn sends turn", async () => {
    const harness = createGjcHarness({ abortScope: "turn" });
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    expect(firstControlRequest(harness)).toEqual({
      sessionId: "session-1",
      operation: "turn.abort",
      input: { mode: "terminal", scope: "turn", idempotencyKey: expect.any(String) },
    });

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");
  });

  test("8. explicit owned sends owned", async () => {
    const harness = createGjcHarness({ abortScope: "owned" });
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    expect(firstControlRequest(harness)).toEqual({
      sessionId: "session-1",
      operation: "turn.abort",
      input: { mode: "terminal", scope: "owned", idempotencyKey: expect.any(String) },
    });

    harness.control.calls[0]?.resolve(ownedScopeSafeResult("owned"));
    await stopping;
    await sendPhase(harness, "idle");
  });

  // Plan GJC test 9 — fail closed on an invalid scope.
  test("9. invalid configured value fails closed before control or prompt activity", () => {
    for (const invalid of ["Turn", "owned ", "terminal"]) {
      expect(() => createGjcHarness({ abortScope: invalid })).toThrow(
        new RegExp(`Invalid GJC_ACP_ABORT_SCOPE value "${invalid}"`),
      );
    }
    // Nothing exists to send a control request or prompt from: a session that
    // refused to construct never reaches the ACP connection.
    expect(resolveGjcAbortScope("owned")).toBe("owned");
  });

  // Plan GJC test 10 — the turn-scope safe row is one fact, not a release.
  test("10. turn-scope safe result is one fact and still waits for idle", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    expect(harness.prompt.calls).toHaveLength(0);

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();

    expect(abortRequests(harness)).toHaveLength(1);
    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(await hasSettled(staged)).toBe(false);
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" &&
          log.data?.disposition === "stopped_left_running" &&
          log.data?.verdict === "safe",
      ),
    ).toBe(true);

    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events).map((event) => event.type)).toEqual([
      "turn_canceled",
    ]);
    expect(harness.prompt.calls).toHaveLength(1);
    await staged;
  });

  // Plan GJC test 11 — the owned-scope safe row.
  test("11. owned-scope safe result is one fact and still waits for idle", async () => {
    const harness = createGjcHarness({ abortScope: "owned" });
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    harness.control.calls[0]?.resolve(ownedScopeSafeResult("owned"));
    await stopping;
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.internals.stop?.terminalObserved).toBe(false);

    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events).map((event) => event.type)).toEqual([
      "turn_canceled",
    ]);
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" &&
          log.data?.disposition === "stopped_stopped" &&
          log.data?.scope === "owned",
      ),
    ).toBe(true);
  });

  // Plan GJC test 12 — selection must match the configured scope exactly.
  test("12. exact selection mismatch is rejected", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    // An owned-scope result delivered for a turn-scope request.
    harness.control.calls[0]?.resolve(ownedScopeSafeResult("owned"));
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" && log.data?.disposition === "selection_mismatch",
      ),
    ).toBe(true);
  });

  // Plan GJC test 13 — owned work reported uncertain is never safe.
  test("13. ownedWork uncertain is rejected", async () => {
    const harness = createGjcHarness({ abortScope: "owned" });
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    harness.control.calls[0]?.resolve({
      ok: true,
      selection: "owned",
      turn: "stopped",
      ownedWork: "uncertain",
      automaticDelivery: "none",
      resumeOnOwnedCompletion: false,
    });
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");
  });

  // Plan GJC test 14 — no_active_turn is conditional, never sufficient alone.
  test("14. no_active_turn is conditional and releases only with eligible idle", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.control.calls[0]?.resolve(noActiveTurnResult("turn"));
    await stopping;
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(await hasSettled(staged)).toBe(false);

    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events).map((event) => event.type)).toEqual([
      "turn_canceled",
    ]);
    expect(harness.prompt.calls).toHaveLength(1);
    await staged;
  });

  // Plan GJC test 15 — every unsafe or ambiguous shape stays stopping.
  test("15. uncertain, no_effect, no_store, unknown, ok:false, malformed, and rejected results stay stopping", async () => {
    const unsafePayloads: Array<{ name: string; payload: unknown }> = [
      {
        name: "uncertain",
        payload: {
          ok: true,
          selection: "turn",
          turn: "uncertain",
          ownedWork: "left_running",
          automaticDelivery: "enabled",
          resumeOnOwnedCompletion: true,
        },
      },
      {
        name: "no_effect",
        payload: { ok: true, selection: "turn", turn: "no_effect", terminal: "terminal_no_effect" },
      },
      {
        name: "no_store",
        payload: { ok: true, selection: "turn", turn: "no_store", terminal: "terminal_no_effect" },
      },
      {
        name: "unknown disposition",
        payload: { ok: true, selection: "turn", turn: "warp_forward" },
      },
      {
        name: "ok:false",
        payload: { ok: false, error: { code: "busy", message: "still working" } },
      },
      { name: "null payload", payload: null },
      { name: "array payload", payload: ["stopped"] },
      { name: "string payload", payload: "stopped" },
    ];

    for (const { name, payload } of unsafePayloads) {
      const harness = createGjcHarness();
      await sendPhase(harness, "working");
      const stopping = harness.session.interrupt();
      harness.control.calls[0]?.resolve(payload as Record<string, unknown>);
      await stopping;
      await sendPhase(harness, "idle");
      await flushMicrotasks();

      expect(turnTerminalEvents(harness.events), name).toEqual([]);
      expect(harness.prompt.calls, name).toHaveLength(0);
      expect(harness.internals.admissionState, name).toBe("stopping");
      expect(harness.internals.stop?.terminalObserved, name).toBe(false);
      expect(harness.internals.stop?.stagedSuccessor, name).toBeNull();
      await harness.session.close();
    }

    // A transport rejection is recorded like any other rejected result: the
    // interrupt caller is not failed (the write was already dispatched), the
    // rejection is logged, and the boundary stays closed.
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    harness.control.calls[0]?.reject(new Error("connection closed"));
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();
    expect(turnTerminalEvents(harness.events), "transport rejection").toEqual([]);
    expect(harness.prompt.calls, "transport rejection").toHaveLength(0);
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" && log.data?.disposition === "transport_rejected",
      ),
    ).toBe(true);
  });

  // Plan GJC test 16 — success then idle.
  test("16. safe success before idle withholds the terminal until idle, then releases the successor", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();
    expect(harness.prompt.calls).toHaveLength(0);
    expect(await hasSettled(staged)).toBe(false);

    await sendPhase(harness, "idle");
    await flushMicrotasks();

    const terminals = turnTerminalEvents(harness.events);
    expect(terminals).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(harness.prompt.calls).toHaveLength(1);
    const stagedTurnId = (await staged).turnId;
    expect(stagedTurnId).not.toBe(mirrorId);
    expect(turnStartedIds(harness.events)).toEqual([mirrorId, stagedTurnId]);
  });

  // Plan GJC test 17 — idle then success.
  test("17. idle before safe success withholds the terminal until the response", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    await sendPhase(harness, "idle");
    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(await hasSettled(staged)).toBe(false);

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(harness.prompt.calls).toHaveLength(1);
    await staged;
  });

  // Plan GJC test 18 — idle before a failed result never releases.
  test("18. idle before a failed or ambiguous response emits no terminal and sends no prompt", async () => {
    for (const payload of [
      { ok: false, error: { code: "busy", message: "abort rejected" } },
      { ok: true, selection: "turn", turn: "uncertain", reason: "replay_pending" },
      null,
    ]) {
      const harness = createGjcHarness();
      await sendPhase(harness, "working");
      const stopping = harness.session.interrupt();
      const staged = harness.session.startTurn("replacement");

      await sendPhase(harness, "idle");
      harness.control.calls[0]?.resolve(payload as Record<string, unknown>);
      await stopping;
      await flushMicrotasks();

      expect(turnTerminalEvents(harness.events), JSON.stringify(payload)).toEqual([]);
      expect(harness.prompt.calls, JSON.stringify(payload)).toHaveLength(0);
      expect(await hasSettled(staged), JSON.stringify(payload)).toBe(false);
      await harness.session.close();
    }
  });

  // Plan GJC test 19 — a failed result poisons the result fact for later idles.
  test("19. failed response before idle keeps later idles from releasing", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    harness.control.calls[0]?.resolve({ ok: true, selection: "turn", turn: "uncertain" });
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");

    const next = harness.session.startTurn("replacement");
    expect(await hasSettled(next)).toBe(false);
    expect(harness.prompt.calls).toHaveLength(0);
  });

  // Plan GJC test 20 — a working edge invalidates an eligible idle.
  test("20. idle then working invalidates the idle; success waits for a later idle", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const stopping = harness.session.interrupt();

    await sendPhase(harness, "idle");
    await sendPhase(harness, "working");
    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(mirrorIds(harness.events)).toEqual([mirrorId]);
    expect(harness.logs.some((log) => log.msg === "provider.gjc.idle_invalidated")).toBe(true);

    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
  });

  // Plan GJC test 21 — idles observed before the stop are not eligible.
  test("21. idle observed before stop installation is not eligible", async () => {
    const harness = createGjcHarness();
    // The stale idle is observed while a foreground turn owns the slot, before
    // any stop exists.
    const foregroundTurnId = (await harness.session.startTurn("foreground")).turnId;
    await sendPhase(harness, "idle");
    harness.prompt.calls[0]?.resolve({ stopReason: "end_turn" });
    await flushMicrotasks();

    // A new ownerless episode installs the stop; the earlier idle predates it.
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events).at(-1) as string;
    const mirrorTerminals = () =>
      turnTerminalEvents(harness.events).filter((event) => event.turnId === mirrorId);
    expect(mirrorTerminals()).toEqual([]);

    const stopping = harness.session.interrupt();
    harness.control.calls[0]?.resolve(noActiveTurnResult("turn"));
    await stopping;
    await flushMicrotasks();

    // The conditional result and the pre-install idle never release the mirror.
    expect(mirrorTerminals()).toEqual([]);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.stoppedTurnId).toBe(mirrorId);
    expect(turnStartedIds(harness.events)).toEqual([foregroundTurnId, mirrorId]);
  });

  // Plan GJC test 22 — nothing may move after close.
  test("22. late response and idle after close are ignored and emit no stale terminal", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const stopping = harness.session.interrupt();
    await harness.session.close();

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(turnStartedIds(harness.events)).toEqual([mirrorId]);
    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);
  });

  // Plan GJC test 23 — explicit ids keep a delayed terminal off the successor.
  test("23. a delayed explicit-id terminal cannot be attributed to the successor", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();
    const successorTurnId = (await staged).turnId;
    expect(harness.prompt.calls).toHaveLength(1);

    // The mirror's terminal arrives again, late, after the successor is running.
    harness.internals.finishTurn(mirrorId, {
      type: "turn_completed",
      provider: "gjc",
      turnId: mirrorId,
    });

    expect(harness.prompt.calls).toHaveLength(1);
    expect(turnTerminalEvents(harness.events).map((event) => event.turnId)).toEqual([mirrorId]);
    expect(harness.internals.admissionState).toBe("running");

    // The successor still settles on its own terminal.
    harness.prompt.calls[0]?.resolve({ stopReason: "end_turn" });
    await flushMicrotasks();
    expect(turnTerminalEvents(harness.events).map((event) => event.turnId)).toEqual([
      mirrorId,
      successorTurnId,
    ]);
    expect(harness.internals.admissionState).toBe("idle");
  });

  // Plan GJC test 24 — repeated Stop keeps identity, moves the attempt revision.
  test("24. repeated ownerless Stop keeps stop and turn id, bumps the idempotency key, and invalidates the staged successor separately", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const first = harness.session.interrupt();
    expect(abortRequests(harness)).toHaveLength(1);

    const staged = harness.session.startTurn("replacement");
    const second = harness.session.interrupt();

    expect(await hasSettled(staged)).toBe(true);
    expect(harness.prompt.calls).toHaveLength(0);

    const requests = abortRequests(harness);
    expect(requests).toHaveLength(2);
    const firstInput = requests[0]?.input as { scope: string; idempotencyKey: string };
    const secondInput = requests[1]?.input as { scope: string; idempotencyKey: string };
    expect(firstInput.scope).toBe("turn");
    expect(secondInput.scope).toBe("turn");
    expect(secondInput.idempotencyKey).not.toBe(firstInput.idempotencyKey);
    const [firstStopId, firstRevision] = firstInput.idempotencyKey.split(":");
    const [secondStopId, secondRevision] = secondInput.idempotencyKey.split(":");
    expect(firstStopId).toBe(secondStopId);
    expect(firstStopId).toBe(harness.internals.stop?.stopId);
    expect(firstRevision).toBe("1");
    expect(secondRevision).toBe("2");

    // The staged successor was invalidated through its own token, not by
    // touching stop identity.
    harness.control.calls[0]?.resolve({ ok: true, selection: "turn", turn: "uncertain" });
    harness.control.calls[1]?.resolve(turnScopeSafeResult("turn"));
    await first;
    await second;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(harness.internals.stop?.stoppedTurnId).toBe(mirrorId);
    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(harness.prompt.calls).toHaveLength(0);
  });

  // Plan GJC test 25 — a retry's success still needs a current idle.
  test("25. success on retry still requires a current eligible idle", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const first = harness.session.interrupt();
    harness.control.calls[0]?.resolve({ ok: true, selection: "turn", turn: "uncertain" });
    await first;

    // An idle arrives, then working resumes the owned work: the idle fact is
    // gone again before the retry succeeds.
    await sendPhase(harness, "idle");
    await sendPhase(harness, "working");

    const second = harness.session.interrupt();
    harness.control.calls[1]?.resolve(turnScopeSafeResult("turn"));
    await second;
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);

    await sendPhase(harness, "idle");
    await flushMicrotasks();
    expect(turnTerminalEvents(harness.events)).toHaveLength(1);
  });

  // Plan GJC test 26 — a staged replacement is invalidated, never prompted.
  test("26. a Stop while a replacement is staged sends no replacement prompt", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const repeated = harness.session.interrupt();

    // The first abort came back ambiguous and the retry succeeded.
    harness.control.calls[0]?.resolve({ ok: true, selection: "turn", turn: "uncertain" });
    await stopping;
    harness.control.calls[1]?.resolve(turnScopeSafeResult("turn"));
    await repeated;
    expect(await hasSettled(staged)).toBe(true);
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(harness.prompt.calls).toHaveLength(0);
    expect(turnTerminalEvents(harness.events)).toHaveLength(1);

    // Admission is open again only for a successor that starts after release.
    const next = await harness.session.startTurn("after release");
    expect(harness.prompt.calls).toHaveLength(1);
    expect(next.turnId).not.toBe("");
  });

  // Plan GJC test 27 — the deadline rejects with the response fact missing.
  test("27. ownerless admission deadline rejects with an unresolved response fact", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    await sendPhase(harness, "idle");

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow(
      `gjc replacement turn was not admitted within ${ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS}ms`,
    );

    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.terminalObserved).toBe(false);
    const deadline = harness.logs.find((log) => log.msg === "provider.acp.admission_deadline");
    expect(deadline?.data?.unresolved).toEqual({
      terminal: true,
      cancelWrites: false,
      providerGate: true,
      // The idle already arrived; the abort result is what is missing.
      providerGateFacts: ["gjc.abort_result"],
    });
    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await harness.session.close();
  });

  // Plan GJC test 28 — the deadline rejects with the idle fact missing.
  test("28. ownerless admission deadline rejects with an unresolved idle fact", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow(
      `gjc replacement turn was not admitted within ${ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS}ms`,
    );

    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.terminalObserved).toBe(false);
    const deadline = harness.logs.find((log) => log.msg === "provider.acp.admission_deadline");
    expect(deadline?.data?.unresolved).toEqual({
      terminal: true,
      cancelWrites: false,
      providerGate: true,
      // The safe abort result already arrived; the idle is what is missing.
      providerGateFacts: ["gjc.idle"],
    });
  });

  // Plan GJC test 29 — foreground stops use ACP cancel only.
  test("29. a foreground GJC stop calls ACP cancel and never terminal control", async () => {
    const harness = createGjcHarness();
    await harness.session.startTurn("foreground");
    const stopping = harness.session.interrupt();

    expect(harness.cancel.calls).toHaveLength(1);
    expect(harness.controlRequests).toHaveLength(0);
    expect(harness.internals.stop?.kind).toBe("foreground");

    harness.cancel.calls[0]?.resolve();
    await stopping;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.controlRequests).toHaveLength(0);
    expect(harness.internals.admissionState).toBe("stopping");
  });

  // Plan GJC test 30 — an ownerless stop uses terminal control only.
  test("30. an ownerless GJC stop calls terminal control and never a synthetic ACP cancel", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();

    expect(abortRequests(harness)).toHaveLength(1);
    expect(firstControlRequest(harness)).toMatchObject({ operation: "turn.abort" });
    expect(harness.cancel.calls).toHaveLength(0);
    expect(harness.internals.stop?.kind).toBe("provider-owned");
    expect(harness.internals.stop?.cancelAttempts).toEqual([]);

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await sendPhase(harness, "idle");
    await flushMicrotasks();

    expect(harness.cancel.calls).toHaveLength(0);
    expect(turnTerminalEvents(harness.events)).toHaveLength(1);
  });

  // Plan GJC test 32 — issue-and-return: interrupt() returns once the abort
  // write is dispatched, before the control response settles.
  test("32. interrupt resolves before the control response, the response validates later, and a late rejection never terminalizes", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;

    // The write is issued synchronously and interrupt() resolves while the
    // control response is still pending.
    const stopping = harness.session.interrupt();
    expect(abortRequests(harness)).toHaveLength(1);
    expect(await hasSettled(stopping)).toBe(true);
    const control = harness.control.calls[0];
    if (!control) {
      throw new Error("the abort control request was not issued");
    }
    expect(await hasSettled(control.promise)).toBe(false);

    // The response validates whenever it arrives; the release still waits for
    // an eligible idle, on the stop's own facts.
    control.resolve(turnScopeSafeResult("turn"));
    await flushMicrotasks();
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" &&
          log.data?.disposition === "stopped_left_running" &&
          log.data?.verdict === "safe",
      ),
    ).toBe(true);
    expect(turnTerminalEvents(harness.events)).toEqual([]);

    await sendPhase(harness, "idle");
    await flushMicrotasks();
    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(harness.logs.some((log) => log.msg === "provider.gjc.ownerless_stop_released")).toBe(
      true,
    );

    // A later attempt's rejection arrives after its interrupt() returned: it is
    // recorded as transport_rejected and logged, and no terminal is emitted for
    // the mirror from the rejection path.
    await sendPhase(harness, "working");
    const retryMirrorId = mirrorIds(harness.events).at(-1) as string;
    expect(retryMirrorId).not.toBe(mirrorId);

    const retry = harness.session.interrupt();
    expect(abortRequests(harness)).toHaveLength(2);
    expect(await hasSettled(retry)).toBe(true);
    const rejectedControl = harness.control.calls[1];
    if (!rejectedControl) {
      throw new Error("the retry control request was not issued");
    }
    rejectedControl.reject(new Error("connection closed"));
    await flushMicrotasks();

    expect(turnTerminalEvents(harness.events)).toEqual([
      { type: "turn_canceled", provider: "gjc", reason: "Interrupted", turnId: mirrorId },
    ]);
    expect(mirrorIds(harness.events)).toEqual([mirrorId, retryMirrorId]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.internals.stop?.stoppedTurnId).toBe(retryMirrorId);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(
      harness.logs.some(
        (log) =>
          log.msg === "provider.gjc.abort_result" &&
          log.data?.disposition === "transport_rejected" &&
          log.data?.verdict === "reject",
      ),
    ).toBe(true);
    const lateRejections = harness.logs.filter(
      (log) => log.msg === "provider.gjc.abort_transport_rejected",
    );
    expect(lateRejections).toHaveLength(1);
    const lateRejection = lateRejections[0];
    if (!lateRejection?.data) {
      throw new Error("the late rejection was not logged");
    }
    expect(lateRejection.data).toMatchObject({
      stopId: harness.internals.stop?.stopId,
      sessionId: "session-1",
      turnId: retryMirrorId,
      revision: 1,
      scope: "turn",
    });
    expect((lateRejection.data.err as Error).message).toBe("connection closed");
  });

  // Plan GJC test 34 — steering sends one turn.steer with a fresh client ref.
  test("34. a text steer sends one turn.steer with a fresh client ref and returns accepted", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;

    const first = harness.session.steerActiveTurn("shift focus", steerOptions(mirrorId));
    expect(harness.controlRequests).toHaveLength(1);
    const firstRequest = harness.controlRequests[0] as GjcControlRequest;
    expect(firstRequest.method).toBe("_gjc/sdk/control");
    expect(firstRequest.params).toEqual({
      sessionId: "session-1",
      operation: "turn.steer",
      input: { text: "shift focus", clientRef: expect.any(String) },
    });
    harness.control.calls[0]?.resolve({ accepted: true });
    expect(await first).toEqual({ status: "accepted" });

    // A second steer mints a new client ref rather than reusing one.
    const second = harness.session.steerActiveTurn("and the rest", steerOptions(mirrorId));
    harness.control.calls[1]?.resolve({ accepted: true });
    expect(await second).toEqual({ status: "accepted" });
    const refs = harness.controlRequests.map(
      (request) => (request.params.input as { clientRef: string }).clientRef,
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]).not.toBe(refs[1]);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(harness.cancel.calls).toHaveLength(0);
    expect(abortRequests(harness)).toHaveLength(0);
  });

  // Plan GJC test 35 — non-text, wrong-target, and failed steers back off.
  test("35. error and non-text paths return unavailable and never interrupt, retry, or prompt", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const mirrorId = turnStartedIds(harness.events)[0] as string;
    const imageInput: AgentPromptInput = [{ type: "image", data: "Zm9v", mimeType: "image/png" }];

    expect(await harness.session.steerActiveTurn(imageInput, steerOptions(mirrorId))).toEqual({
      status: "unavailable",
    });
    expect(await harness.session.steerActiveTurn("text", steerOptions("some-other-turn"))).toEqual({
      status: "unavailable",
    });
    expect(harness.controlRequests).toHaveLength(0);

    // A transport failure is reported as unavailable and does not interrupt,
    // retry, or touch the mirror.
    const failing = harness.session.steerActiveTurn("text", steerOptions(mirrorId));
    harness.control.calls[0]?.reject(new Error("transport closed"));
    expect(await failing).toEqual({ status: "unavailable" });
    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.internals.stop).toBeNull();

    // GJC's control envelope answers failures with a resolved {ok:false}.
    const rejected = harness.session.steerActiveTurn("text", steerOptions(mirrorId));
    harness.control.calls[1]?.resolve({ ok: false, error: { code: "busy", message: "no turn" } });
    expect(await rejected).toEqual({ status: "unavailable" });

    const declined = harness.session.steerActiveTurn("text", steerOptions(mirrorId));
    harness.control.calls[2]?.resolve({ accepted: false });
    expect(await declined).toEqual({ status: "unavailable" });

    expect(abortRequests(harness)).toHaveLength(0);
    expect(harness.cancel.calls).toHaveLength(0);
    expect(harness.prompt.calls).toHaveLength(0);
    expect(mirrorIds(harness.events)).toEqual([mirrorId]);
  });

  // Plan P5 death settlement — unnumbered: 24 and 33 are reserved by later units
  // (P3, P4), and 32 belongs to P2's issue-and-return test.
  test("observed death settles the ownerless abort as a transport_death reject that a late reply cannot overwrite", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    await sendPhase(harness, "idle");
    expect(abortRequests(harness)).toHaveLength(1);

    // Death is observed while the control response is still pending. The SDK
    // never rejects a pending request when the read loop ends, so without
    // settlement the staged successor would burn the whole admission deadline.
    harness.connectionDeath.abort();
    await flushMicrotasks();

    // The staged successor is rejected immediately, before any fake time has
    // advanced, and the ownerless stop never touched ACP cancel.
    await expect(staged).rejects.toThrow("invalidated (connection-aborted)");
    expect(harness.cancel.calls).toHaveLength(0);

    // The death verdict is recorded through the ordinary result path.
    const abortResults = harness.logs.filter((log) => log.msg === "provider.gjc.abort_result");
    expect(abortResults).toHaveLength(1);
    expect(abortResults[0]?.data).toMatchObject({
      disposition: "transport_death",
      verdict: "reject",
    });
    expect(abortResults[0]?.data?.reason).toContain("connection-aborted");

    // A late real reply for the settled attempt cannot overwrite the death
    // verdict and cannot release the stop over a dead transport.
    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await flushMicrotasks();
    expect(harness.logs.filter((log) => log.msg === "provider.gjc.abort_result")).toHaveLength(1);
    expect(harness.internals.ownerlessStop?.result?.verdict).toMatchObject({
      disposition: "transport_death",
    });
    expect(turnTerminalEvents(harness.events)).toEqual([]);
    expect(harness.prompt.calls).toHaveLength(0);

    // The gate descriptor names the real reason at the deadline instead of the
    // bare fact.
    const restaged = harness.session.startTurn("replacement-2");
    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(restaged).rejects.toThrow("not admitted");
    const deadline = harness.logs.find((log) => log.msg === "provider.acp.admission_deadline");
    expect(deadline?.data?.unresolved).toMatchObject({
      terminal: true,
      cancelWrites: false,
      providerGate: true,
      providerGateFacts: [expect.stringContaining("gjc.abort_result (transport_death")],
    });

    await harness.session.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider env wiring and deadline fact naming.
//
// The scope is configured on the provider, so it has to reach the session
// through the client's own factory rather than a hand-built session options
// object. These tests construct through GjcACPAgentClient for exactly that
// path.
// ─────────────────────────────────────────────────────────────────────────────

/** Registry-shaped capabilities, unused by these tests but required by the type. */
const WIRING_CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

describe("provider env wiring and deadline facts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Exposes the protected session factory so a test can build through the client. */
  class ExposedGjcClient extends GjcACPAgentClient {
    buildSession(config: AgentSessionConfig, options: ACPAgentSessionOptions) {
      return this.createAgentSession(config, options);
    }
  }

  const wiringConfig: AgentSessionConfig = { provider: "acp", cwd: "/tmp/paseo-gjc-test" };

  /** The option keys mirror what provider-registry.ts hands a derived client. */
  function createWiringClient(providerEnv: Record<string, string>) {
    const { logger } = createHarnessLogger();
    const client = new ExposedGjcClient({
      logger,
      command: ["gjc", "acp"],
      env: providerEnv,
      providerId: "gjc",
      label: "GJC",
    });
    return client;
  }

  function wiringSessionOptions(launchEnv?: Record<string, string>): ACPAgentSessionOptions {
    return {
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["gjc", "acp"],
      defaultModes: [],
      capabilities: WIRING_CAPABILITIES,
      ...(launchEnv ? { launchEnv } : {}),
    };
  }

  test("provider env configures the abort scope the session resolves", () => {
    const client = createWiringClient({ GJC_ACP_ABORT_SCOPE: "owned" });
    const session = client.buildSession(wiringConfig, wiringSessionOptions()) as GjcACPAgentSession;
    expect(session.configuredAbortScope).toBe("owned");
  });

  test("per-create launch env overrides the provider env for the same key", () => {
    const client = createWiringClient({
      GJC_ACP_ABORT_SCOPE: "owned",
      GJC_OTHER_VAR: "provider-value",
    });
    const session = client.buildSession(
      wiringConfig,
      wiringSessionOptions({ GJC_ACP_ABORT_SCOPE: "turn" }),
    ) as GjcACPAgentSession;

    expect(session.configuredAbortScope).toBe("turn");
    // The provider env is not dropped, only outranked.
    expect(asInternals<{ launchEnv?: Record<string, string> }>(session).launchEnv).toEqual({
      GJC_ACP_ABORT_SCOPE: "turn",
      GJC_OTHER_VAR: "provider-value",
    });
  });

  test("an invalid provider scope fails closed before any process starts", async () => {
    const client = createWiringClient({ GJC_ACP_ABORT_SCOPE: "sometimes" });
    await expect(client.createSession(wiringConfig)).rejects.toThrow(
      'Invalid GJC_ACP_ABORT_SCOPE value "sometimes"',
    );
  });

  test("an admission deadline with neither provider fact names both", async () => {
    const harness = createGjcHarness();
    await sendPhase(harness, "working");
    const stopping = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow(
      `gjc replacement turn was not admitted within ${ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS}ms`,
    );

    const deadline = harness.logs.find((log) => log.msg === "provider.acp.admission_deadline");
    expect(deadline?.data?.unresolved).toEqual({
      terminal: true,
      cancelWrites: false,
      providerGate: true,
      providerGateFacts: ["gjc.abort_result", "gjc.idle"],
    });
    expect(harness.prompt.calls).toHaveLength(0);

    harness.control.calls[0]?.resolve(turnScopeSafeResult("turn"));
    await stopping;
    await harness.session.close();
  });
});

describe("validateGjcTerminalAbortResult", () => {
  // Plan GJC tests 10-15 — the validation matrix, unit-level.
  test("accepts exactly the two terminal-safe rows and the conditional row for their own scope", () => {
    expect(validateGjcTerminalAbortResult(turnScopeSafeResult("turn"), "turn")).toEqual({
      kind: "safe",
      disposition: "stopped_left_running",
    });
    expect(validateGjcTerminalAbortResult(ownedScopeSafeResult("owned"), "owned")).toEqual({
      kind: "safe",
      disposition: "stopped_stopped",
    });
    expect(validateGjcTerminalAbortResult(noActiveTurnResult("turn"), "turn")).toEqual({
      kind: "conditional",
      disposition: "no_active_turn",
    });
    // Extra documented replay metadata is ignored.
    expect(
      validateGjcTerminalAbortResult(
        { ...turnScopeSafeResult("turn"), replay: { responseState: "final" } },
        "turn",
      ),
    ).toEqual({ kind: "safe", disposition: "stopped_left_running" });
  });

  test("rejects cross-scope, uncertain, no-effect, no-store, malformed, and failed results", () => {
    const rejects: unknown[] = [
      turnScopeSafeResult("owned"),
      ownedScopeSafeResult("turn"),
      {
        ok: true,
        selection: "owned",
        turn: "stopped",
        ownedWork: "uncertain",
        automaticDelivery: "none",
        resumeOnOwnedCompletion: false,
      },
      { ok: true, selection: "turn", turn: "stopped", ownedWork: "left_running" },
      { ok: true, selection: "turn", turn: "uncertain" },
      { ok: true, selection: "turn", turn: "no_effect", terminal: "terminal_no_effect" },
      { ok: true, selection: "turn", turn: "no_store", terminal: "terminal_no_effect" },
      { ok: true, selection: "turn", turn: "no_active_turn" },
      { ok: false, error: { code: "busy", message: "x" } },
      { selection: "turn" },
      null,
      undefined,
      "stopped",
      7,
      ["stopped"],
    ];
    for (const payload of rejects) {
      const turnVerdict = validateGjcTerminalAbortResult(payload, "turn");
      const ownedVerdict = validateGjcTerminalAbortResult(payload, "owned");
      expect(turnVerdict.kind, JSON.stringify(payload)).toBe("reject");
      expect(ownedVerdict.kind, JSON.stringify(payload)).toBe("reject");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Probe stubs, shared with the acp-agent.test.ts harness idioms.
// ─────────────────────────────────────────────────────────────────────────────

function createDestroyableStream(): { destroyed: boolean; destroy: () => void } {
  const stream = {
    destroyed: false,
    destroy() {
      stream.destroyed = true;
    },
  };
  return stream;
}

function createProbeChildStub(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdin = createDestroyableStream() as unknown as ChildProcessWithoutNullStreams["stdin"];
  child.stdout = createDestroyableStream() as unknown as ChildProcessWithoutNullStreams["stdout"];
  child.stderr = createDestroyableStream() as unknown as ChildProcessWithoutNullStreams["stderr"];
  child.kill = vi.fn(() => true) as ChildProcessWithoutNullStreams["kill"];
  return child;
}
