import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnProcess, terminateProcess } from "../process.js";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type AgentCapabilities,
  type ContentBlock,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionInfo,
  type SessionNotification,
  type SessionUpdate,
  type ToolCall,
  type ToolCallUpdate,
  type Stream,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type {
  AcpConfigAccess,
  AcpConfigChange,
  AcpConfigureContext,
  AcpConnectionPolicy,
  AcpRequest,
  AcpSessionPolicy,
  AcpToolCallSnapshot,
  AcpTransformer,
  AcpVendorUpdate,
  RunAcpProviderOptions,
} from "../acp.js";
import { standardToolCallDetail } from "./tool-call-detail.js";
import {
  PROVIDER_PROTOCOL_VERSION,
  ProviderEventSchema,
  ProviderInputSchema,
  negotiateProviderCapabilities,
  requireProviderCapabilities,
  type ProviderCatalog,
  type ProviderCapability,
  type ProviderCommand,
  type ProviderConfigState,
  type ProviderConnectRequest,
  type ProviderConnection,
  type ProviderError,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderModel,
  type ProviderPermissionResponse,
  type ProviderToolCallDetail,
  type ProviderPersistence,
  type ProviderPrompt,
  type ProviderSessionConfig,
  type ProviderSetting,
  type ProviderTimelineItem,
  type ProviderUsage,
} from "../provider.js";

/**
 * How long a cancelled vendor turn may take to report its own terminal before Paseo ends it
 * locally. The agent aborts the turn and answers `session/cancel` promptly; this only bounds a
 * daemon that acknowledges the cancel and never reports the end.
 */
const VENDOR_TURN_CANCEL_GRACE_MS = 1_000;

// Contract: jcode docs/ACP_FORK_INTERFACE.md, "Turn correlation on prompt responses". Both
// fields are required together under `_meta.jcode`; anything else is treated as absent
// correlation, which keeps the legacy behavior instead of guessing an attribution.
const promptCorrelationSchema = z.object({
  _meta: z.object({
    jcode: z.object({
      turnId: z.string().nullable(),
      role: z.enum(["origin", "steer", "none"]),
    }),
  }),
});

function mergePolicy<T extends object>(current: T, next: T | null | undefined): T {
  if (!next) return current;
  const merged = { ...current };
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== undefined && current[key] !== false) merged[key] = next[key];
  }
  return merged;
}

const ADAPTER_CAPABILITIES = [
  "prompt.message",
  "prompt.command",
  "session.configure",
  "session.detach",
  "permission",
] as const;

interface AcpBoundarySession {
  runtime: AcpRuntime;
  capabilities: readonly ProviderCapability[];
  mutationLane: Promise<void>;
}

export async function createAcpProviderConnection(
  options: RunAcpProviderOptions,
  request: ProviderConnectRequest,
): Promise<ProviderConnection> {
  if (!request.versions.includes(PROVIDER_PROTOCOL_VERSION)) {
    throw new Error(`ACP adapter requires provider protocol ${PROVIDER_PROTOCOL_VERSION}`);
  }
  const probe = await AcpRuntime.start({
    options,
    launch: request.launch,
    boundarySessionId: "capability-probe",
    env: {},
    emit: () => undefined,
  });
  const supportedCapabilities: ProviderCapability[] = [...ADAPTER_CAPABILITIES];
  if (options.acpOptions?.vendorTurnsAreNeverForeground)
    supportedCapabilities.push("session.shared_turns");
  if (probe.connectionPolicy.steering === true) supportedCapabilities.push("prompt.steer");
  if (probe.agentCapabilities.promptCapabilities?.image) {
    supportedCapabilities.push("prompt.image");
  }
  if (probe.agentCapabilities.sessionCapabilities?.list) {
    supportedCapabilities.push("session.list");
  }
  if (probe.agentCapabilities.loadSession) {
    supportedCapabilities.push("session.persistence");
  }
  if (options.acpOptions?.deferTurnOnRunningTools) {
    supportedCapabilities.push("prompt.steer");
  }
  await probe.close();
  const capabilities = negotiateProviderCapabilities(request.capabilities, supportedCapabilities);
  const listeners = new Set<(event: ProviderEvent) => void>();
  const sessions = new Map<string, AcpBoundarySession>();
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const emit = (event: ProviderEvent) => {
    if (closed) return;
    const parsed = ProviderEventSchema.parse(event);
    for (const listener of listeners) listener(parsed);
  };
  const state: AcpConnectionState = {
    options,
    launch: request.launch,
    capabilities,
    sessions,
    emit,
    isClosed: () => closed,
  };

  return {
    version: PROVIDER_PROTOCOL_VERSION,
    capabilities,
    async send(input) {
      if (closed) throw new Error("ACP provider connection is closed");
      input = ProviderInputSchema.parse(input);
      validateAdmission(input, { capabilities, sessions });
      const operation = Promise.resolve().then(async () => {
        if (closed) return undefined;
        await dispatch(input, state);
        return undefined;
      });
      const settled = operation.catch((error) => {
        emitOperationFailure(input, emit, error);
      });
      inFlight.add(settled);
      void settled.finally(() => inFlight.delete(settled));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      if (closePromise) return closePromise;
      // The boundary stops delivering events once it closes, so report the turn this close ends
      // while listeners still receive them.
      for (const session of sessions.values()) session.runtime.closeVendorTurn();
      closed = true;
      closePromise = (async () => {
        const active = [...sessions.values()];
        sessions.clear();
        await Promise.all(active.map(({ runtime }) => runtime.closeSession()));
        // Closing the transports releases admissions waiting on active prompts. Operations that
        // were still opening a session observe closed and close their own runtime.
        await Promise.all(inFlight);
        listeners.clear();
      })();
      return closePromise;
    },
  };
}

interface AcpConnectionState {
  launch?: ProviderLaunch;
  options: RunAcpProviderOptions;
  capabilities: readonly ProviderCapability[];
  sessions: Map<string, AcpBoundarySession>;
  emit(event: ProviderEvent): void;
  isClosed(): boolean;
}

function validateAdmission(
  input: ProviderInput,
  state: Pick<AcpConnectionState, "capabilities" | "sessions">,
): void {
  if (input.type === "session.open") {
    if (state.sessions.has(input.sessionId))
      throw new Error(`Session already exists: ${input.sessionId}`);
    requireProviderCapabilities(state.capabilities, input);
    return;
  }
  if (!("sessionId" in input)) {
    requireProviderCapabilities(state.capabilities, input);
    return;
  }
  // Close and detach are idempotent: a repeated request for a session this attachment already
  // released still succeeds without touching the provider.
  if (
    (input.type === "session.close" || input.type === "session.detach") &&
    !state.sessions.has(input.sessionId)
  ) {
    requireProviderCapabilities(state.capabilities, input);
    return;
  }
  const session = requireSession(state as AcpConnectionState, input.sessionId);
  requireProviderCapabilities(session.capabilities, input);
}

function emitOperationFailure(
  input: ProviderInput,
  emit: (event: ProviderEvent) => void,
  error: unknown,
): void {
  const failure = { message: describeError(error) };
  if (input.type === "session.prompt") {
    emit({
      type: "session.prompt_result",
      sessionId: input.sessionId,
      clientMessageId: input.prompt.clientMessageId,
      result: { type: "failed", error: failure },
    });
    return;
  }
  if ("requestId" in input) {
    emit({ type: "request.failed", requestId: input.requestId, error: failure });
    return;
  }
  if ("sessionId" in input) {
    emit({ type: "session.runtime_failed", sessionId: input.sessionId, error: failure });
  }
}

async function dispatch(input: ProviderInput, state: AcpConnectionState): Promise<void> {
  switch (input.type) {
    case "catalog":
      await discover(input, state);
      return;
    case "sessions":
      await listSessions(input, state);
      return;
    case "session.open":
      await openSession(input, state);
      return;
    case "session.prompt": {
      const session = requireSession(state, input.sessionId);
      await mutateSession(session, session.runtime.preparePrompt(input));
      return;
    }
    case "session.interrupt": {
      const session = requireSession(state, input.sessionId);
      const retired = await session.runtime.interrupt();
      state.emit({ type: "request.completed", requestId: input.requestId });
      if (retired) retireSession(state, input.sessionId);
      return;
    }
    case "session.detach": {
      const session = state.sessions.get(input.sessionId);
      if (session) {
        await session.runtime.detach();
        state.sessions.delete(input.sessionId);
      }
      state.emit({ type: "request.completed", requestId: input.requestId });
      return;
    }
    case "session.permission":
      requireSession(state, input.sessionId).runtime.respondToPermission(
        input.permissionId,
        input.response,
      );
      return;
    case "session.configure": {
      const session = requireSession(state, input.sessionId);
      await mutateSession(session, () => session.runtime.configure(input.changes));
      state.emit({ type: "request.completed", requestId: input.requestId });
      return;
    }
    case "session.close": {
      const session = state.sessions.get(input.sessionId);
      if (!session) {
        state.emit({ type: "request.completed", requestId: input.requestId });
        return;
      }
      state.sessions.delete(input.sessionId);
      await session.runtime.closeSession();
      state.emit({ type: "session.closed", sessionId: input.sessionId });
      state.emit({ type: "request.completed", requestId: input.requestId });
      return;
    }
    case "session.archive":
    case "session.unarchive":
    case "session.revert":
      state.emit({
        type: "request.failed",
        requestId: input.requestId,
        error: { message: `${input.type} is not supported by this ACP provider` },
      });
  }
}

async function discover(
  input: Extract<ProviderInput, { type: "catalog" }>,
  state: AcpConnectionState,
): Promise<void> {
  const runtime = await AcpRuntime.start({
    options: state.options,
    launch: state.launch,
    boundarySessionId: "catalog",
    cwd: input.cwd,
    env: {},
    emit: state.emit,
  });
  try {
    let catalog = await runtime.discover(input.cwd);
    const context = runtime.configContext();
    for (const transformer of state.options.transformers ?? []) {
      if (transformer.discover) {
        catalog = await transformer.discover(catalog, context);
      }
    }
    state.emit({ type: "catalog", requestId: input.requestId, catalog });
  } finally {
    await runtime.closeSession();
  }
}

async function listSessions(
  input: Extract<ProviderInput, { type: "sessions" }>,
  state: AcpConnectionState,
): Promise<void> {
  const runtime = await AcpRuntime.start({
    options: state.options,
    launch: state.launch,
    boundarySessionId: "sessions",
    env: {},
    emit: state.emit,
  });
  try {
    const selected = await runtime.listSessions({ cwd: input.cwd, limit: input.limit });
    state.emit({
      type: "sessions",
      requestId: input.requestId,
      sessions: selected.map((session) => ({
        persistence: nativePersistence(session.sessionId),
        cwd: session.cwd,
        title: session.title ?? undefined,
        updatedAt: session.updatedAt ?? undefined,
      })),
    });
  } finally {
    await runtime.close();
  }
}

function retireSession(state: AcpConnectionState, sessionId: string): void {
  if (state.sessions.delete(sessionId)) {
    state.emit({ type: "session.closed", sessionId });
  }
}

async function openSession(
  input: Extract<ProviderInput, { type: "session.open" }>,
  state: AcpConnectionState,
): Promise<void> {
  if (state.sessions.has(input.sessionId))
    throw new Error(`Session already exists: ${input.sessionId}`);
  const runtime = await AcpRuntime.start({
    options: state.options,
    launch: state.launch,
    boundarySessionId: input.sessionId,
    cwd: input.config.cwd,
    env: input.config.env,
    emit: state.emit,
    onRetired: () => retireSession(state, input.sessionId),
  });
  try {
    const capabilities = await runtime.open(input, state.capabilities, state.isClosed);
    if (state.isClosed()) {
      await runtime.closeSession();
      return;
    }
    state.sessions.set(input.sessionId, {
      runtime,
      capabilities,
      mutationLane: Promise.resolve(),
    });
    state.emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

async function mutateSession(
  session: AcpBoundarySession,
  operation: () => Promise<void>,
): Promise<void> {
  const result = session.mutationLane.then(operation);
  session.mutationLane = result.catch(() => undefined);
  return result;
}

function requireSession(state: AcpConnectionState, sessionId: string): AcpBoundarySession {
  const session = state.sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session: ${sessionId}`);
  return session;
}

interface StartRuntimeOptions {
  launch?: ProviderLaunch;
  options: RunAcpProviderOptions;
  boundarySessionId: string;
  cwd?: string;
  env: Readonly<Record<string, string>>;
  emit(event: ProviderEvent): void;
  onRetired?: () => void;
}

interface PendingPermission {
  request: RequestPermissionRequest;
  turnId: string | undefined;
  resolve(response: RequestPermissionResponse): void;
}

type DeferredTurnOutcome =
  | { type: "complete"; terminalizeTools: boolean }
  | { type: "cancel" }
  | { type: "fail"; error: { message: string } };

interface DeferredTurnState {
  timer: ReturnType<typeof setTimeout> | null;
  resolve(outcome: DeferredTurnOutcome): void;
}

type DeferredReplyState = "idle" | "open" | "settled_with_open_tools" | "settled";

interface ActivePrompt {
  turnId: string;
  settled: Promise<void>;
  cancelling: boolean;
  wirePromptsInFlight: number;
  wirePromptLane: Promise<void>;
  lastPromptResponseWireSeq: number | null;
  crossedEndTurn: boolean;
  replyState: DeferredReplyState;
  deferred: DeferredTurnState | null;
}

function newActivePrompt(turnId: string, settled: Promise<void>): ActivePrompt {
  return {
    turnId,
    settled,
    cancelling: false,
    wirePromptsInFlight: 1,
    wirePromptLane: Promise.resolve(),
    lastPromptResponseWireSeq: null,
    crossedEndTurn: false,
    replyState: "idle",
    deferred: null,
  };
}

const DEFAULT_DEFERRED_SETTLE_DELAY_MS = 500;
const SESSION_SCAN_LIMIT = 500;
// COMPAT(acpAutoAccept): added in v0.17.4, remove after 2027-05-23. The generic ACP adapter saves
// its Auto Accept toggle as this setting on agents that later moved to a bundled ACP provider.
const LEGACY_AUTO_ACCEPT_SETTING = "auto_accept";
const DEFAULT_DEFERRED_QUIET_LIMIT_MS = 120_000;

interface AcpToolCallState {
  source: AcpToolCallSnapshot;
  presentation: AcpToolCallSnapshot;
}

class AcpRuntime {
  readonly connection: ClientSideConnection;
  agentCapabilities: AgentCapabilities = {};
  connectionPolicy: AcpConnectionPolicy = {};
  private sessionPolicy: AcpSessionPolicy = {};
  private sharedTurns = false;
  nativeSessionId = "";
  private readonly child: ChildProcessWithoutNullStreams | null;
  private readonly transportFailure: Promise<void>;
  private emit: (event: ProviderEvent) => void;
  private readonly messages = new Map<string, string>();
  private readonly toolCalls = new Map<string, AcpToolCallState>();
  private mcpServerNames: readonly string[] = [];
  private readonly liveOpenToolIds = new Set<string>();
  private readonly canceledToolCallIds = new Set<string>();
  // Running tool rows published by transformers; the turn's terminal closes any left open.
  private readonly vendorToolCalls = new Map<string, ToolCallTimelineItem>();
  private readonly pendingCompactions = new Set<string>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly transformers: readonly AcpTransformer[];
  private readonly vendorTurnsAreNeverForeground: boolean;
  private configOptions: SessionConfigOption[] = [];
  private modes: NewSessionResponse["modes"] = null;
  private commandWaiter: (() => void) | null = null;
  private receivedInitialCommands = false;
  private messageSequence = 0;
  /**
   * Fallback ids for streamed chunks that carry no `messageId`, one per
   * chunk kind. Consecutive chunks of a kind continue the same timeline
   * item; a chunk of another kind, a tool call, a plan, or a turn boundary
   * ends it (#4699).
   */
  private readonly fallbackChunkIds = new Map<
    "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk",
    string
  >();
  /**
   * Replay updates count as history until the session reports ready.
   * Once ready, suppress late replay rows until the first prompt.
   */
  private replayWindow: "replay" | "skip" | null = null;
  private lastLoadHistoryAt = 0;
  private lastPartialWireAt = 0;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private deferredRetirement: Promise<boolean> | null = null;
  private deferredFinalized = false;
  private processFailed = false;
  private processFailureMessage: string | null = null;
  private configTransaction = false;
  private stagedTransformerConfig: ProviderConfigState | null = null;
  private readonly closeConnector: (options?: {
    force?: boolean;
    timeoutMs?: number;
  }) => Promise<void>;
  private readonly whenConnectorClosed: () => Promise<void> | null;
  private notificationLane: Promise<void> = Promise.resolve();
  private promptLane: Promise<void> = Promise.resolve();
  private incomingWireSeq = 0;
  private readonly sessionUpdateWireSeqs: number[] = [];
  private autoAccept = false;
  private hasToolPolicy = false;
  private activePrompt: ActivePrompt | null = null;
  private lastUsage: ProviderUsage = {};
  private readonly outstandingSteers = new Map<
    string,
    { attachedTurnId: string; settled: Promise<void> }
  >();
  /** A prompt admitted but not sent yet, waiting for an open vendor turn to end. */
  private parkedAdmission: { cancel(): void } | null = null;
  private vendorTurnCancelTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by a user stop; a prompt admitted before it is dropped instead of sent. */
  private stopGeneration = 0;
  /**
   * The vendor turn a transformer reported and Paseo did not prompt. Only one can be
   * open: the agent runs one turn at a time, so a new start means the old turn is over.
   */
  private vendorTurn: {
    turnId: string;
    remoteTurnId: string;
    settled: Promise<void>;
    resolve(): void;
  } | null = null;
  /** One FIFO slot per inbound session/update, so vendor updates can follow them. */
  private readonly updateSlots = new UpdateSlots();
  private readonly promptResponses = new PromptResponseOrder();
  private readonly steerEchoes = new Map<string, string>();
  private detachPromise: Promise<void> | null = null;
  private detached = false;
  /** Shared execution ids whose terminal or usage has already been published. */
  private readonly settledSharedTurns = new Set<string>();
  private readonly settledLocalTurns = new Set<string>();
  private readonly reportedSharedUsage = new Set<string>();
  private readonly localTurnIds = new Map<string, string>();
  private bufferedUserChunk: Extract<
    SessionUpdate,
    { sessionUpdate: "user_message_chunk" }
  > | null = null;

  static async start(options: StartRuntimeOptions): Promise<AcpRuntime> {
    let child: ChildProcessWithoutNullStreams | null = null;
    let spawnFailure: Promise<never> | null = null;
    let stream: Stream;
    let closeConnector: (options?: {
      force?: boolean;
      timeoutMs?: number;
    }) => Promise<void> = async () => {};
    let whenConnectorClosed: () => Promise<void> | null = () => null;
    let onPartialWireRead: (() => void) | null = null;
    if (options.options.command) {
      // COMPAT(pluginProviderLaunch): added in v0.10.0, remove after 2027-03-29 once plugin host floor >= v0.10.0.
      // Standalone callers and older hosts do not send a daemon-resolved launch.
      const launch = options.launch ?? {
        command: options.options.command[0],
        args: options.options.command.slice(1),
        env: process.env,
      };
      child = spawnProcess(launch.command, launch.args, {
        cwd: options.cwd,
        env: { ...launch.env, ...options.env },
        stdio: "pipe",
      });
      spawnFailure = new Promise<never>((_resolve, reject) => child!.once("error", reject));
      child.stderr.on("data", () => undefined);
      const output = Writable.toWeb(child.stdin) as unknown as Parameters<typeof ndJsonStream>[0];
      const rawInput = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
      const input = observePartialWireReads(rawInput, () => onPartialWireRead?.()) as Parameters<
        typeof ndJsonStream
      >[1];
      stream = ndJsonStream(output, input);
    } else {
      const owned = ownConnectorStream(await options.options.connector());
      stream = owned.stream;
      closeConnector = owned.close;
      whenConnectorClosed = owned.whenClosed;
    }
    const runtime = new AcpRuntime(stream, child, closeConnector, whenConnectorClosed, options);
    onPartialWireRead = () => runtime.notePartialWireRead();
    try {
      const initialize = withTimeout(
        runtime.call(
          runtime.connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: { name: "paseo", version: "1" },
          }),
        ),
        options.options.acpOptions?.startupTimeoutMs ?? 10_000,
        `ACP provider ${options.options.id} did not initialize`,
      );
      const initialized = spawnFailure
        ? await Promise.race([initialize, spawnFailure])
        : await initialize;
      runtime.agentCapabilities = initialized.agentCapabilities ?? {};
      for (const transformer of runtime.transformers) {
        runtime.connectionPolicy = mergePolicy(
          runtime.connectionPolicy,
          transformer.initialize?.({
            agentCapabilities: jsonValue(runtime.agentCapabilities),
          }),
        );
      }
      return runtime;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  private constructor(
    stream: Stream,
    child: ChildProcessWithoutNullStreams | null,
    closeConnector: (options?: { force?: boolean; timeoutMs?: number }) => Promise<void>,
    whenConnectorClosed: () => Promise<void> | null,
    private readonly options: StartRuntimeOptions,
  ) {
    this.child = child;
    this.closeConnector = closeConnector;
    this.whenConnectorClosed = whenConnectorClosed;
    this.emit = options.emit;
    this.transformers = options.options.transformers ?? [];
    this.vendorTurnsAreNeverForeground =
      options.options.acpOptions?.vendorTurnsAreNeverForeground === true;
    const client: Client = {
      requestPermission: (request) => this.requestPermission(request),
      sessionUpdate: (notification) => {
        const wireSeq = this.sessionUpdateWireSeqs.shift() ?? ++this.incomingWireSeq;
        return this.enqueueNotification(() => {
          try {
            this.sessionUpdate(notification, wireSeq);
          } finally {
            this.updateSlots.settleDelivered(notification);
          }
        });
      },
    };
    this.connection = new ClientSideConnection(
      () => client,
      routeIncomingMessages(
        stream,
        (method, params) => this.vendorNotification(method, params),
        this.updateSlots,
        this.promptResponses,
        (message) => this.observeWireMessage(message),
      ),
    );
    const processClosed = child
      ? new Promise<void>((resolve) => child.once("close", () => resolve()))
      : null;
    // EOF can precede the subprocess close event. Preserve its exit diagnostic and
    // publish failure before rejected RPCs release pending steering work.
    this.transportFailure = this.connection.closed.then(async () => {
      await this.drainNotifications();
      if (processClosed) await settlesWithin(processClosed, 1_000);
      return this.handleUnexpectedTransportClose();
    });
    child?.on("error", (error) => {
      const message = describeError(error);
      if (this.processFailed) return;
      this.processFailed = true;
      this.processFailureMessage = message;
      if (!this.closing && this.nativeSessionId) {
        this.emit({
          type: "session.runtime_failed",
          sessionId: this.options.boundarySessionId,
          error: { message },
        });
      }
      this.settlePendingWork(message);
    });
    child?.once("close", (code, signal) => {
      if (this.closing || this.processFailed || !this.nativeSessionId) return;
      const message = `ACP process exited (${signal ?? code ?? "unknown"})`;
      this.processFailed = true;
      this.processFailureMessage = message;
      this.emit({
        type: "session.runtime_failed",
        sessionId: this.options.boundarySessionId,
        error: { message },
      });
      this.settlePendingWork(message);
    });
  }

  async open(
    input: Extract<ProviderInput, { type: "session.open" }>,
    connectionCapabilities: readonly ProviderCapability[],
    isConnectionClosed: () => boolean,
  ): Promise<readonly ProviderCapability[]> {
    const mcpServers =
      this.connectionPolicy.sendSessionMcpServers === false ? [] : toAcpMcpServers(input.config);
    this.mcpServerNames = mcpServers.map((server) => server.name);
    let nativeSessionId = readNativeSessionId(input.persistence);
    const metadata: Record<string, unknown> = {
      _paseo: {
        systemPrompt: input.config.systemPrompt,
        providerOptions: input.config.providerOptions,
        toolPolicy: input.config.toolPolicy,
        persist: input.config.persist,
      },
    };
    nativeSessionId = this.prepareSessionOpen(input, nativeSessionId, metadata);
    let response: Pick<NewSessionResponse, "modes" | "configOptions">;
    if (nativeSessionId) {
      // ACP agents replay the loaded session's updates before session/load resolves,
      // so the native id must be registered first for them to pass the session filter.
      this.nativeSessionId = nativeSessionId;
      this.replayWindow = input.history === "replay" ? "replay" : "skip";
      try {
        response = await this.call(
          this.connection.loadSession({
            sessionId: nativeSessionId,
            cwd: input.config.cwd,
            mcpServers,
            _meta: metadata,
          }),
        );
        await this.drainNotifications();
      } finally {
        if (!this.options.options.acpOptions?.loadReplayQuietPeriodMs) this.replayWindow = null;
      }
      // Replayed chunks leave their fallback ids behind; the live stream that follows starts
      // its own items even when the agent replays without message ids.
      this.fallbackChunkIds.clear();
    } else {
      const newSession = await this.call(
        this.connection.newSession({
          cwd: input.config.cwd,
          mcpServers,
          _meta: metadata,
        }),
      );
      response = newSession;
      this.nativeSessionId = newSession.sessionId;
    }
    this.modes = response.modes ?? null;
    this.configOptions = response.configOptions ?? [];
    for (const transformer of this.transformers) {
      this.sessionPolicy = mergePolicy(
        this.sessionPolicy,
        transformer.attach?.(
          { response: jsonValue(response) },
          { sessionId: input.sessionId, agentCapabilities: jsonValue(this.agentCapabilities) },
        ),
      );
    }
    this.sharedTurns = connectionCapabilities.includes("session.shared_turns");
    this.hasToolPolicy = Boolean(input.config.toolPolicy);
    await this.applyInitialConfig(input.config);
    const sessionCapabilities = this.sessionCapabilities(connectionCapabilities);
    this.emit({
      type: "session.opened",
      requestId: input.requestId,
      sessionId: input.sessionId,
      capabilities: sessionCapabilities,
      restoration: "core",
      persistence: nativePersistence(this.nativeSessionId),
      title: input.config.title,
      cwd: input.config.cwd,
    });
    this.emitOmittedMcpNotice(input);
    this.emitConfig();
    await this.finishSessionOpen(isConnectionClosed);
    return sessionCapabilities;
  }

  private async finishSessionOpen(isConnectionClosed: () => boolean): Promise<void> {
    if (this.options.options.acpOptions?.waitForInitialCommands) {
      await this.waitForInitialCommands();
    }
    const quietPeriod = this.options.options.acpOptions?.loadReplayQuietPeriodMs;
    if (this.replayWindow && quietPeriod && quietPeriod > 0) {
      await this.waitForLoadReplay(quietPeriod, isConnectionClosed);
      this.replayWindow = "skip";
    }
    if (this.processFailed && !isConnectionClosed()) {
      throw new Error(this.processFailureMessage ?? "ACP process exited during session open");
    }
  }

  private prepareSessionOpen(
    input: Extract<ProviderInput, { type: "session.open" }>,
    nativeSessionId: string | null,
    metadata: Record<string, unknown>,
  ): string | null {
    for (const transformer of this.transformers) {
      const prepared = transformer.sessionOpen?.({
        persistence: input.persistence,
        systemPrompt: input.config.systemPrompt,
        agentMetadata: jsonValue(this.agentCapabilities._meta ?? null),
      });
      nativeSessionId ??= prepared?.sessionId ?? null;
      Object.assign(metadata, prepared?.metadata);
    }
    return nativeSessionId;
  }

  private sessionCapabilities(
    connectionCapabilities: readonly ProviderCapability[],
  ): ProviderCapability[] {
    // The fork setting remains configurable without native mode options.
    const sessionCapabilities = connectionCapabilities.filter(
      (capability) =>
        capability !== "session.detach" &&
        (capability !== "prompt.steer" ||
          (this.connectionPolicy.steering === true && this.sessionPolicy.steering === true)),
    );
    if (this.sessionPolicy.detach === true) sessionCapabilities.push("session.detach");
    return sessionCapabilities;
  }

  private emitOmittedMcpNotice(input: Extract<ProviderInput, { type: "session.open" }>): void {
    const omittedServers = Object.keys(input.config.mcpServers);
    if (this.connectionPolicy.sendSessionMcpServers === false && omittedServers.length > 0) {
      this.emit({
        type: "session.notice",
        sessionId: input.sessionId,
        notice: {
          id: "acp-session-mcp-omitted",
          severity: "info",
          title: "Session MCP servers were not sent",
          description: `${omittedServers.join(", ")}. Configure these servers in the agent's own MCP configuration.`,
        },
      });
    }
  }

  async discover(cwd?: string): Promise<ProviderCatalog> {
    if (cwd === undefined && this.options.options.acpOptions?.workspaceOnlyCatalog) {
      return { models: [], modes: [] };
    }
    const response = await this.call(
      this.connection.newSession({ cwd: cwd ?? process.cwd(), mcpServers: [] }),
    );
    this.nativeSessionId = response.sessionId;
    this.modes = response.modes ?? null;
    this.configOptions = response.configOptions ?? [];
    let catalog = toProviderCatalog(this.modes, this.configOptions);
    if (this.options.options.acpOptions?.perModelThinkingOptions) {
      catalog = { ...catalog, models: await this.modelsWithOwnThinkingOptions(catalog) };
    }
    const autoAcceptMode = this.options.options.acpOptions?.autoAcceptMode;
    if (!autoAcceptMode) return catalog;
    return {
      ...catalog,
      modes: [...catalog.modes, { ...autoAcceptMode.mode, isUnattended: true }],
      defaultMode: autoAcceptMode.default ? autoAcceptMode.mode.id : catalog.defaultMode,
    };
  }

  /**
   * Selects each model in the discovery session to read the thinking options the agent lists for
   * it, then selects the opening model again for the transformers that run after discovery.
   */
  private async modelsWithOwnThinkingOptions(catalog: ProviderCatalog): Promise<ProviderModel[]> {
    const models: ProviderModel[] = [];
    for (const model of catalog.models) {
      await this.selectModel(model.id);
      const { thinkingOptions, thinkingOption } = toProviderConfigState(
        this.modes,
        this.configOptions,
      );
      models.push({
        ...model,
        thinkingOptions: [...thinkingOptions],
        defaultThinkingOptionId: thinkingOption,
      });
    }
    if (catalog.defaultModel) await this.selectModel(catalog.defaultModel);
    return models;
  }

  private async selectModel(model: string): Promise<void> {
    if (selectedValue(modelOption(this.configOptions)) === model) return;
    await this.applyNativeConfigChange({ target: "model", value: model });
  }

  preparePrompt(input: Extract<ProviderInput, { type: "session.prompt" }>): () => Promise<void> {
    const stopGeneration = this.stopGeneration;
    return () => this.prompt(input, stopGeneration);
  }

  private prompt(
    input: Extract<ProviderInput, { type: "session.prompt" }>,
    stopGeneration: number,
  ): Promise<void> {
    if (this.detached) return Promise.reject(new Error("Session was detached from the agent"));
    if (this.closing || this.processFailed || this.deferredRetirement) {
      return Promise.reject(new Error("ACP session is closed"));
    }
    this.assertPromptSelection(input.prompt);
    if (input.prompt.delivery === "steer") {
      // A turn deferred on running background tools takes steers into its follow-up reply.
      if (this.activePrompt?.deferred) {
        this.steerDeferredPrompt(input);
        return Promise.resolve();
      }
      return this.steer(input);
    }
    // A stop cancels the prompts waiting when it is pressed, not prompts admitted after it.
    const admission = this.promptLane.then(() => this.admitPrompt(input, stopGeneration));
    this.promptLane = admission.catch(() => undefined);
    return admission;
  }

  /**
   * Explicit skill selection is an advertised jcode extension. Silent removal would leave the
   * client believing the selection took effect; a steer cannot carry it either, because the
   * daemon may insert the prompt into a turn that already started.
   */
  private assertPromptSelection(prompt: ProviderPrompt): void {
    if (prompt.skill === undefined) return;
    if (this.connectionPolicy.skillSelection !== true) {
      throw new Error("This agent does not advertise explicit skill selection");
    }
    if (prompt.delivery === "steer") {
      throw new Error("A skill selection needs an idle session");
    }
  }

  private promptMetadata(prompt: ProviderPrompt): Record<string, JsonValue> | undefined {
    let metadata: Record<string, JsonValue> | undefined;
    for (const transformer of this.transformers) {
      const transformed = transformer.prompt?.(
        { skill: prompt.skill },
        { sessionId: this.options.boundarySessionId, policy: this.connectionPolicy },
      );
      if (transformed?._meta) metadata = Object.assign(metadata ?? {}, transformed._meta);
    }
    return metadata;
  }

  private promptParams(prompt: ProviderPrompt) {
    const metadata = this.promptMetadata(prompt);
    return {
      sessionId: this.nativeSessionId,
      prompt: toAcpPrompt(prompt),
      ...(metadata === undefined ? {} : { _meta: metadata }),
    };
  }

  private classifyCommands(commands: readonly ProviderCommand[]): ProviderCommand[] {
    const context = { sessionId: this.options.boundarySessionId, policy: this.connectionPolicy };
    return commands.map((command) => {
      let entry = command;
      for (const transformer of this.transformers) {
        entry = transformer.command?.(entry, context) ?? entry;
      }
      return entry;
    });
  }

  /** Terminal identities are only needed to suppress a late duplicate; bound a long session. */
  private remember(set: Set<string>, key: string): void {
    set.add(key);
    if (set.size > 1_024) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }

  private rememberTurn(remoteTurnId: string, localTurnId: string): void {
    this.localTurnIds.set(remoteTurnId, localTurnId);
    if (this.localTurnIds.size > 1_024) {
      const oldest = this.localTurnIds.keys().next().value;
      if (oldest !== undefined) this.localTurnIds.delete(oldest);
    }
  }

  private promptCorrelation(
    response: unknown,
  ): { turnId: string | null; role: "origin" | "steer" | "none" } | null {
    if (this.connectionPolicy.turnCorrelation !== true) return null;
    const parsed = promptCorrelationSchema.safeParse(jsonValue(response));
    if (!parsed.success) return null;
    return parsed.data._meta.jcode;
  }

  /** Emits one terminal for a local turn, so a correlated shared turn cannot complete twice. */
  private endLocalTurn(
    turnId: string,
    state: "completed" | "failed" | "canceled",
    error?: ProviderError,
    options?: { preserveQualifyingOpenTools?: boolean; suppressTrailingToolEcho?: boolean },
  ): boolean {
    if (this.settledLocalTurns.has(turnId)) return false;
    this.remember(this.settledLocalTurns, turnId);
    this.finishPromptTurn(turnId, state, error, options);
    return true;
  }

  /**
   * Several prompt responses can name one shared execution. The first one settles its terminal;
   * later responses, including a vendor `_jcode/turn` terminal for the same id, publish nothing.
   */
  private finishSharedTurn(
    remoteTurnId: string,
    localTurnId: string,
    state: "completed" | "failed" | "canceled",
    error?: ProviderError,
  ): boolean {
    this.rememberTurn(remoteTurnId, localTurnId);
    const alreadySettled = this.settledSharedTurns.has(remoteTurnId);
    if (!alreadySettled) this.remember(this.settledSharedTurns, remoteTurnId);
    // The prompt owns the visible turn. A peer bracket for the same execution closes without a
    // second terminal, and its open chunk is flushed by the shutdown below.
    if (this.vendorTurn?.remoteTurnId === remoteTurnId) {
      this.endVendorTurn(state, error, { emitTerminal: false });
    }
    // A vendor terminal can settle the shared execution before this response arrives. Settle this
    // local id anyway; `endLocalTurn` deduplicates when the bracket already used the same id.
    return this.endLocalTurn(localTurnId, state, error);
  }

  /** Usage belongs to the execution, not to every response that shared it. */
  private reportPromptUsage(
    correlation: { turnId: string | null; role: "origin" | "steer" | "none" },
    localTurnId: string,
    response: unknown,
  ): void {
    if (correlation.role !== "origin" || correlation.turnId === null) return;
    if (this.reportedSharedUsage.has(correlation.turnId)) return;
    this.remember(this.reportedSharedUsage, correlation.turnId);
    const usage = (jsonValue(response) as { usage?: unknown }).usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) return;
    const value = usage as Record<string, unknown>;
    const numeric = (key: string): number | undefined =>
      typeof value[key] === "number" ? (value[key] as number) : undefined;
    const inputTokens = numeric("inputTokens");
    const outputTokens = numeric("outputTokens");
    const cachedInputTokens = numeric("cachedReadTokens");
    if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      cachedInputTokens === undefined
    ) {
      return;
    }
    this.emit({
      type: "session.usage",
      sessionId: this.options.boundarySessionId,
      turnId: localTurnId,
      usage: { inputTokens, outputTokens, cachedInputTokens },
    });
  }

  private async steer(input: Extract<ProviderInput, { type: "session.prompt" }>): Promise<void> {
    const turnId = this.activePrompt?.turnId ?? this.vendorTurn?.turnId;
    const clientMessageId = input.prompt.clientMessageId;
    if (!turnId) {
      this.emit({
        type: "session.prompt_result",
        sessionId: this.options.boundarySessionId,
        clientMessageId,
        result: { type: "failed", error: { message: "No active turn to steer" } },
      });
      return;
    }
    const text = promptEchoText(input.prompt);
    if (text && this.connectionPolicy.echoesUserMessages !== false) {
      this.steerEchoes.set(clientMessageId, text);
    }
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: {
        type: "user_message",
        id: clientMessageId,
        clientMessageId,
        text,
      },
    });
    const rolloverId = `acp:${clientMessageId}`;
    const releaseResponse = this.promptResponses.register();
    const settled = this.call(this.connection.prompt(this.promptParams(input.prompt))).then(
      async (response) => {
        await this.drainNotifications();
        this.expireSteerEcho(clientMessageId);
        const correlation = this.promptCorrelation(response);
        if (this.activePrompt?.turnId === rolloverId) {
          this.activePrompt = null;
          const state = response.stopReason === "cancelled" ? "canceled" : "completed";
          // A steer response names the shared execution but does not own its terminal: the
          // origin response (or the vendor turn) does. Only an uncorrelated or role-none
          // response keeps the legacy rollover behavior.
          if (correlation?.role === "origin" && correlation.turnId !== null) {
            // A pending steer can become the origin of a new execution. Its local rollover turn
            // is the visible owner and must settle here even though the request was a steer.
            this.reportPromptUsage(correlation, rolloverId, response);
            this.finishSharedTurn(correlation.turnId, rolloverId, state);
          } else if (correlation === null || correlation.role === "none") {
            this.endLocalTurn(rolloverId, state);
          }
        }
        releaseResponse();
        return undefined;
      },
      async (error) => {
        await this.drainNotifications();
        this.expireSteerEcho(clientMessageId);
        const isRollover = this.activePrompt?.turnId === rolloverId;
        if (isRollover) this.activePrompt = null;
        if (this.closing || this.processFailed) {
          releaseResponse();
          return;
        }
        if (isRollover) {
          this.terminalizeTransientItems("failed");
          this.emit({
            type: "session.turn",
            sessionId: this.options.boundarySessionId,
            turnId: rolloverId,
            state: "failed",
            error: { message: describeError(error) },
          });
        }
        this.emit({
          type: "session.notice",
          sessionId: this.options.boundarySessionId,
          notice: {
            id: `acp-steer-${clientMessageId}`,
            severity: "warning",
            title: "Steering failed",
            description: describeError(error),
          },
        });
        releaseResponse();
      },
    );
    const wasPending = this.outstandingSteers.size > 0;
    this.outstandingSteers.set(clientMessageId, { attachedTurnId: turnId, settled });
    if (!wasPending) this.emitPendingWork(true);
    void settled.finally(() => {
      if (this.outstandingSteers.delete(clientMessageId) && this.outstandingSteers.size === 0) {
        this.emitPendingWork(false);
      }
    });
    this.emit({
      type: "session.prompt_result",
      sessionId: this.options.boundarySessionId,
      clientMessageId,
      result: { type: "steer", turnId },
    });
  }

  private async admitPrompt(
    input: Extract<ProviderInput, { type: "session.prompt" }>,
    stopGeneration: number,
  ): Promise<void> {
    while (this.activePrompt) {
      const active = this.activePrompt;
      // Replacing a foreground prompt is not a user stop of the prompts queued behind it.
      if (active.deferred && active.wirePromptsInFlight === 0) {
        // Wire session/prompt already resolved; finish the deferred turn without sending
        // session/cancel so running background tools stay alive into the follow-up turn.
        this.finishDeferredTurn(active, { type: "complete", terminalizeTools: false });
      } else if (!this.sharedTurns) {
        const retired = await this.interruptTurn();
        if (retired) {
          // Notify caller that the session closed before failing the replacement prompt.
          this.options.onRetired?.();
          throw new Error("ACP session retired after stopping deferred background work");
        }
      }
      await active.settled;
      if (this.closing || this.processFailed || this.deferredRetirement) {
        throw new Error("ACP session is closed");
      }
    }
    // A vendor turn belongs to another client attached to the same agent session; the agent
    // queues this prompt behind it anyway. Waiting keeps the user's message after the peer
    // output and stops peer chunks from being attributed to the foreground turn. A new vendor
    // turn can open while the previous one closes, so wait for the chain to drain.
    let wakeParked!: () => void;
    const parked = new Promise<void>((resolve) => {
      wakeParked = resolve;
    });
    this.parkedAdmission = { cancel: wakeParked };
    const stopped = () => stopGeneration < this.stopGeneration;
    try {
      while (this.vendorTurn) {
        if (stopped()) break;
        const open = this.vendorTurn;
        await Promise.race([open.settled, parked]);
        if (stopped()) break;
      }
    } finally {
      this.parkedAdmission = null;
    }
    if (this.closing) return;
    const text = promptEchoText(input.prompt);
    this.replayWindow = null;
    const turnId = `acp:${input.prompt.clientMessageId}`;
    this.fallbackChunkIds.clear();
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: {
        type: "user_message",
        id: input.prompt.clientMessageId,
        text,
        clientMessageId: input.prompt.clientMessageId,
      },
    });
    this.emit({
      type: "session.prompt_result",
      sessionId: this.options.boundarySessionId,
      clientMessageId: input.prompt.clientMessageId,
      result: { type: "turn", turnId },
    });
    this.emit({
      type: "session.turn",
      sessionId: this.options.boundarySessionId,
      turnId,
      state: "started",
    });
    if (stopped()) {
      // A stop the user asked for: the prompt was admitted but never sent, so it ends the way an
      // interrupted prompt ends instead of as a failure.
      this.emit({
        type: "session.turn",
        sessionId: this.options.boundarySessionId,
        turnId,
        state: "canceled",
      });
      return;
    }
    const activePrompt: ActivePrompt = {
      turnId,
      settled: Promise.resolve(),
      cancelling: false,
      wirePromptsInFlight: 1,
      wirePromptLane: Promise.resolve(),
      lastPromptResponseWireSeq: null,
      crossedEndTurn: false,
      replyState: "idle",
      deferred: null,
    };
    // The SDK dispatches notifications without awaiting them, so the prompt response can resolve
    // while earlier session updates are still queued. Apply them before the turn ends.
    const echoText = text;
    if (echoText && this.connectionPolicy.echoesUserMessages !== false) {
      this.steerEchoes.set(input.prompt.clientMessageId, echoText);
    }
    const releaseResponse = this.promptResponses.register();
    const settled = this.call(this.connection.prompt(this.promptParams(input.prompt))).then(
      async (response): Promise<void> => {
        await this.drainNotifications();
        activePrompt.wirePromptsInFlight -= 1;
        const correlation = this.promptCorrelation(response);
        const sharedExecution = correlation?.turnId != null && correlation.role !== "none";
        if (response.usage && !sharedExecution) {
          this.lastUsage = {
            ...this.lastUsage,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cachedInputTokens: response.usage.cachedReadTokens ?? undefined,
          };
          this.emit({
            type: "session.usage",
            sessionId: this.options.boundarySessionId,
            turnId,
            usage: this.lastUsage,
          });
        }
        const state = response.stopReason === "cancelled" ? "canceled" : "completed";
        if (
          response.stopReason === "end_turn" &&
          !sharedExecution &&
          this.shouldDeferTurn(activePrompt)
        ) {
          // Release the wire first: settling the deferred turn waits on later session updates.
          releaseResponse();
          await this.settleDeferredPrompt(activePrompt);
          return undefined;
        }
        if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
        this.finishTurnPermissions(turnId);
        if (correlation === null || correlation.role === "none" || correlation.turnId === null) {
          this.endLocalTurn(turnId, state);
        } else {
          this.reportPromptUsage(correlation, turnId, response);
          this.finishSharedTurn(correlation.turnId, turnId, state);
        }
        releaseResponse();
        return undefined;
      },
      async (error): Promise<void> => {
        await this.drainNotifications();
        activePrompt.wirePromptsInFlight -= 1;
        this.finishTurnPermissions(turnId);
        if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
        this.endLocalTurn(turnId, "failed", { message: describeError(error) });
        releaseResponse();
        return undefined;
      },
    );
    activePrompt.settled = settled;
    this.activePrompt = activePrompt;
    void settled.finally(() => {
      this.expireSteerEcho(input.prompt.clientMessageId);
      if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
    });
  }

  interrupt(): Promise<boolean> {
    // A prompt parked behind a vendor turn has not reached the agent, so a session-wide cancel
    // would not stop it: drop every prompt admitted before the stop here instead.
    this.stopGeneration += 1;
    this.parkedAdmission?.cancel();
    const cancelled = this.vendorTurn;
    if (cancelled && !this.activePrompt && this.sessionPolicy.stopObservedTurns === false) {
      this.emit({
        type: "session.notice",
        sessionId: this.options.boundarySessionId,
        notice: {
          id: "acp-stop-observed-turn",
          severity: "warning",
          title: "Cannot stop another client's turn",
          description: "This attachment cannot stop another client's turn.",
        },
      });
      return Promise.reject(new Error("This attachment cannot stop another client's turn"));
    }
    // Only an agent that reports peer turns as vendor turns is known to stop the peer turn when
    // it is cancelled; for any other agent the turn may keep running, so do not end it locally.
    if (cancelled && !this.activePrompt && this.vendorTurnsAreNeverForeground) {
      this.scheduleVendorTurnCancel(cancelled.turnId);
    }
    return this.interruptTurn();
  }

  private async interruptTurn(): Promise<boolean> {
    if (this.deferredRetirement) return this.deferredRetirement;
    const active = this.activePrompt;
    const deferredTurnId = active?.deferred ? active.turnId : null;
    if (active && deferredTurnId) {
      const retirement = this.retireDeferredTurn(active, deferredTurnId).catch((error) => {
        if (this.deferredRetirement === retirement) this.deferredRetirement = null;
        throw error;
      });
      this.deferredRetirement = retirement;
      return retirement;
    }
    if (active) active.cancelling = true;
    try {
      await this.call(this.connection.cancel({ sessionId: this.nativeSessionId }));
    } finally {
      // An agent may wait for its outstanding permission replies before ending the prompt.
      if (active) {
        this.finishTurnPermissions(active.turnId);
      }
    }
    return false;
  }

  private finalizeDeferredTurn(deferredTurnId: string, emitRetired: boolean): void {
    if (this.deferredFinalized) return;
    this.deferredFinalized = true;
    this.endLocalTurn(deferredTurnId, "canceled", undefined, {
      suppressTrailingToolEcho: true,
    });
    if (emitRetired) this.options.onRetired?.();
  }

  private async retireDeferredTurn(active: ActivePrompt, deferredTurnId: string): Promise<boolean> {
    active.cancelling = true;
    // Record open tools owned by Stop before writing session/cancel so any failure
    // update arriving during cancel preserves their canceled state.
    for (const id of this.liveOpenToolIds) this.canceledToolCallIds.add(id);
    let cancelTimedOut = false;
    if (!this.closing) {
      try {
        await withTimeout(
          this.call(this.connection.cancel({ sessionId: this.nativeSessionId })),
          1_000,
          `ACP session ${this.nativeSessionId} did not accept cancel`,
        );
      } catch {
        cancelTimedOut = true;
      } finally {
        // An agent may wait for its outstanding permission replies before ending the prompt.
        this.finishTurnPermissions(active.turnId);
      }
    }
    // ACP v1 has no response or end boundary for session/cancel once session/prompt
    // already returned. Close the process first while the turn still appears running,
    // then emit the canceled turn synchronously before request.completed and session.closed
    // so queued work and config changes immediately observe the retired session.
    try {
      await this.close({ force: cancelTimedOut, timeoutMs: 1_000 });
    } catch (error) {
      void this.whenConnectorClosed()?.then(
        () => this.finalizeDeferredTurn(deferredTurnId, true),
        () => undefined,
      );
      throw error;
    }
    this.finalizeDeferredTurn(deferredTurnId, false);
    return true;
  }

  /**
   * A cancel the agent acknowledges but never reports a terminal for would hold the vendor turn,
   * and every prompt behind it, forever. End it locally once the grace period passes.
   */
  private scheduleVendorTurnCancel(turnId: string): void {
    if (this.vendorTurnCancelTimer) clearTimeout(this.vendorTurnCancelTimer);
    this.vendorTurnCancelTimer = setTimeout(() => {
      this.vendorTurnCancelTimer = null;
      if (this.vendorTurn?.turnId !== turnId) return;
      console.warn(`Vendor turn ${turnId} reported no terminal after cancel; ending it locally`);
      this.endVendorTurn("canceled", { message: "Canceled by Paseo" });
    }, VENDOR_TURN_CANCEL_GRACE_MS);
  }

  /** Follows `nextCursor` until `limit` sessions, the last page, or the scan cap. */
  async listSessions({ cwd, limit }: { cwd?: string; limit?: number }): Promise<SessionInfo[]> {
    const wanted = Math.min(limit ?? SESSION_SCAN_LIMIT, SESSION_SCAN_LIMIT);
    const sessions: SessionInfo[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.call(this.connection.listSessions({ cwd, cursor }));
      sessions.push(...page.sessions);
      cursor = page.nextCursor ?? undefined;
      if (cursor !== undefined) {
        // An agent that repeats a cursor would otherwise page forever.
        if (seen.has(cursor)) break;
        seen.add(cursor);
      }
    } while (cursor && sessions.length < wanted);
    return sessions.slice(0, wanted);
  }

  async drainNotifications(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await this.notificationLane;
  }

  respondToPermission(
    permissionId: string,
    response: Extract<ProviderInput, { type: "session.permission" }>["response"],
  ): void {
    const pending = this.permissions.get(permissionId);
    if (!pending) return;
    const active = this.activePrompt;
    if (active?.cancelling && pending.turnId === active.turnId) return;
    const selected = selectPermissionOption(pending.request.options, response);
    if (response.selectedActionId !== undefined && !selected) {
      throw new Error(
        `ACP permission action '${response.selectedActionId}' does not exist or does not match '${response.behavior}' behavior`,
      );
    }
    this.resolvePermission(permissionId, pending, {
      outcome: selected
        ? { outcome: "selected", optionId: selected.optionId }
        : { outcome: "cancelled" },
    });
  }

  private finishTurnPermissions(turnId: string): void {
    for (const [permissionId, pending] of this.permissions) {
      if (pending.turnId === turnId) {
        this.resolvePermission(permissionId, pending, { outcome: { outcome: "cancelled" } });
      }
    }
  }

  private resolvePermission(
    permissionId: string,
    pending: PendingPermission,
    response: RequestPermissionResponse,
  ): void {
    this.permissions.delete(permissionId);
    pending.resolve(response);
    this.emit({
      type: "session.permission_resolved",
      sessionId: this.options.boundarySessionId,
      permissionId,
    });
    if (this.activePrompt?.deferred) this.scheduleDeferredSettle();
  }

  async configure(
    changes: Extract<ProviderInput, { type: "session.configure" }>["changes"],
  ): Promise<void> {
    const autoAcceptMode = this.options.options.acpOptions?.autoAcceptMode;
    if (
      autoAcceptMode &&
      changes.mode !== undefined &&
      (changes.mode === autoAcceptMode.mode.id) !== this.autoAccept &&
      (this.activePrompt || this.permissions.size > 0)
    ) {
      throw new Error(
        `Finish or stop the current turn before switching to or from ${autoAcceptMode.mode.label}.`,
      );
    }
    const requested: AcpConfigChange[] = [];
    if (changes.model !== undefined) requested.push({ target: "model", value: changes.model });
    if (changes.mode !== undefined) requested.push({ target: "mode", value: changes.mode });
    if (changes.thinkingOption !== undefined) {
      requested.push({ target: "thinking", value: changes.thinkingOption });
    }
    for (const [id, value] of Object.entries(changes.settings ?? {})) {
      requested.push({ target: "setting", id, value });
    }
    const ordered = this.inAgentOrder(requested);
    const previousAutoAccept = this.autoAccept;
    const previousModes = this.modes ? structuredClone(this.modes) : null;
    const previousOptions = structuredClone(this.configOptions);
    this.configTransaction = true;
    this.stagedTransformerConfig = null;
    let committedConfig: ProviderConfigState | null = null;
    try {
      for (const change of ordered) await this.applyConfigChange(change);
      committedConfig =
        this.stagedTransformerConfig ?? toProviderConfigState(this.modes, this.configOptions);
    } catch (error) {
      try {
        await this.restoreConfig(previousModes, previousOptions);
      } catch (rollbackError) {
        const failure = new AggregateError(
          [error, rollbackError],
          `ACP configuration failed and rollback could not restore the previous state`,
        );
        this.emit({
          type: "session.runtime_failed",
          sessionId: this.options.boundarySessionId,
          error: { message: describeError(failure) },
        });
        await this.close();
        throw failure;
      }
      this.autoAccept = previousAutoAccept;
      this.modes = previousModes;
      this.configOptions = previousOptions;
      this.stagedTransformerConfig = null;
      throw error;
    } finally {
      this.configTransaction = false;
    }
    this.stagedTransformerConfig = null;
    this.emitConfigSnapshot(committedConfig);
  }

  /** Ends an open vendor turn before the boundary connection stops delivering events. */
  closeVendorTurn(): void {
    this.endVendorTurn("canceled", { message: "Session closed by Paseo" });
    this.clearOutstandingSteers();
  }

  /**
   * Leave the shared agent session without closing it. The agent keeps any inserted work running;
   * Paseo settles its own waits and drops the attachment. This is deliberately not `session/close`,
   * which owns the agent-side session and can terminate the work another client owns.
   */
  async detach(): Promise<void> {
    if (this.sessionPolicy.detach !== true) {
      throw new Error("This agent session does not support detach");
    }
    if (!this.detached) {
      this.detachPromise ??= this.call(
        this.connection.extMethod("_jcode/detach", { sessionId: this.nativeSessionId }),
      )
        .then(() => {
          this.detached = true;
          this.settleDetached();
          return undefined;
        })
        .finally(() => {
          this.detachPromise = null;
        });
      await this.detachPromise;
    }
    await this.close();
  }

  /** Settle everything Paseo waits on without publishing a global idle or a failed turn. */
  private settleDetached(): void {
    this.promptResponses.flush();
    this.clearOutstandingSteers();
    this.endVendorTurn("canceled", { message: "Session detached by Paseo" });
    if (this.activePrompt) {
      this.endLocalTurn(this.activePrompt.turnId, "canceled", {
        message: "Session detached by Paseo",
      });
      this.activePrompt = null;
    }
    this.updateSlots.flush();
    for (const permission of this.permissions.values()) {
      permission.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.permissions.clear();
    this.commandWaiter?.();
    this.commandWaiter = null;
  }

  async closeSession(): Promise<void> {
    if (this.nativeSessionId) {
      await withTimeout(
        this.call(this.connection.closeSession({ sessionId: this.nativeSessionId })),
        1_000,
        `ACP session ${this.nativeSessionId} did not close`,
      ).catch(() => undefined);
    }
    await this.close();
  }

  close(options?: { force?: boolean; timeoutMs?: number }): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const promise = this.closeInternal(options).catch((error) => {
      if (this.closePromise === promise) this.closePromise = null;
      throw error;
    });
    this.closePromise = promise;
    return promise;
  }

  private async closeInternal(options?: { force?: boolean; timeoutMs?: number }): Promise<void> {
    this.settlePendingWork();
    await this.closeConnector(options);
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    await terminateProcess(child, "SIGTERM");
    if (await settlesWithin(closed, 1_000)) return;
    await terminateProcess(child);
    if (!(await settlesWithin(closed, 1_000))) {
      throw new Error(`ACP provider ${this.options.options.id} did not terminate after SIGKILL`);
    }
  }

  private async applyInitialConfig(config: ProviderSessionConfig): Promise<void> {
    // A shared turn may already have the requested configuration. Apply mutations in agent's
    // option order, checking effective values after each mutation because one can reset another.
    const requested: AcpConfigChange[] = [];
    if (config.model) requested.push({ target: "model", value: config.model });
    const autoAcceptMode = this.options.options.acpOptions?.autoAcceptMode;
    const { settings, legacyAutoAccept } = this.withoutLegacyAutoAccept(config.settings);
    // The toggle stays saved after a mode is chosen here, so it counts only while the saved mode
    // is one the generic adapter wrote.
    const mode =
      legacyAutoAccept && autoAcceptMode && !this.offersMode(config.mode)
        ? autoAcceptMode.mode.id
        : (config.mode ?? (autoAcceptMode?.default ? autoAcceptMode.mode.id : undefined));
    if (mode) requested.push({ target: "mode", value: mode });
    if (config.thinkingOption) {
      requested.push({ target: "thinking", value: config.thinkingOption });
    }
    for (const [id, value] of Object.entries(settings)) {
      requested.push({ target: "setting", id, value });
    }
    for (const change of this.inAgentOrder(requested)) {
      if (this.isEffectiveConfig(change)) continue;
      await this.applyConfigChange(change);
    }
  }

  /** Whether the agent already reports this value, so applying it again would be a no-op. */
  private isEffectiveConfig(change: AcpConfigChange): boolean {
    const current = toProviderConfigState(this.modes, this.configOptions);
    switch (change.target) {
      case "model":
        return change.value === current.model;
      case "mode":
        return change.value === current.mode;
      case "thinking":
        return change.value === current.thinkingOption;
      case "setting":
        return change.value === configValues(this.configOptions)[change.id];
    }
  }

  private offersMode(mode: string | undefined): boolean {
    if (mode === undefined) return false;
    if (mode === this.options.options.acpOptions?.autoAcceptMode?.mode.id) return true;
    return toProviderCatalog(this.modes, this.configOptions).modes.some(({ id }) => id === mode);
  }

  /** Reads the generic ACP adapter's saved Auto Accept toggle unless the agent has such a setting. */
  private withoutLegacyAutoAccept(settings: Readonly<Record<string, JsonValue>>): {
    settings: Readonly<Record<string, JsonValue>>;
    legacyAutoAccept: boolean;
  } {
    if (this.configOptions.some((option) => option.id === LEGACY_AUTO_ACCEPT_SETTING)) {
      return { settings, legacyAutoAccept: false };
    }
    const { [LEGACY_AUTO_ACCEPT_SETTING]: saved, ...rest } = settings;
    return { settings: rest, legacyAutoAccept: saved === true };
  }

  // One option can reset another: choosing an fx provider also selects that provider's saved
  // model, so a model applied first would be lost. Agents list the option that decides first.
  private inAgentOrder(changes: readonly AcpConfigChange[]): AcpConfigChange[] {
    const position = (change: AcpConfigChange): number => {
      const configId = this.configIdFor(change);
      const index = this.configOptions.findIndex((option) => option.id === configId);
      return index === -1 ? this.configOptions.length : index;
    };
    return changes.toSorted((left, right) => position(left) - position(right));
  }

  private configIdFor(change: AcpConfigChange): string | undefined {
    if (change.target === "setting") return change.id;
    if (change.target === "model") return modelOption(this.configOptions)?.id;
    if (change.target === "thinking") {
      return this.configOptions.find((option) => option.category === "thought_level")?.id;
    }
    return modeOption(this.configOptions)?.id;
  }

  private async applyConfigChange(change: AcpConfigChange): Promise<void> {
    if (change.target === "setting" && change.id === "auto_accept") {
      if (this.activePrompt || this.permissions.size > 0) {
        throw new Error("Finish or stop the current turn before switching auto-accept.");
      }
      this.autoAccept = !this.hasToolPolicy && change.value === true;
      return;
    }
    const autoAcceptMode = this.options.options.acpOptions?.autoAcceptMode;
    if (
      change.target === "mode" &&
      autoAcceptMode &&
      (this.autoAccept || change.value === autoAcceptMode.mode.id)
    ) {
      const enableAutoAccept = change.value === autoAcceptMode.mode.id;
      const nativeMode = enableAutoAccept ? autoAcceptMode.nativeMode : change.value;
      this.autoAccept = false;
      if (nativeMode !== this.nativeModeId()) {
        await this.applyNativeConfigChange({ target: "mode", value: nativeMode });
      }
      if (nativeMode !== this.nativeModeId()) {
        throw new Error(`ACP agent did not switch to mode '${nativeMode}'`);
      }
      this.autoAccept = enableAutoAccept;
      return;
    }
    const context: AcpConfigureContext = {
      ...this.configContext(),
      catalog: () => toProviderCatalog(this.modes, this.configOptions),
      apply: (nativeChange) => this.applyNativeConfigChange(nativeChange),
    };
    for (const transformer of this.transformers) {
      if ((await transformer.configure?.(change, context)) === "handled") {
        return;
      }
    }
    await this.applyNativeConfigChange(change);
  }

  private async applyNativeConfigChange(change: AcpConfigChange): Promise<void> {
    if (change.target === "mode" && this.modes && !modeOption(this.configOptions)) {
      if (!change.value) {
        throw new Error("ACP session does not expose mode configuration");
      }
      await this.call(
        this.connection.setSessionMode({
          sessionId: this.nativeSessionId,
          modeId: change.value,
        }),
      );
      this.modes = { ...this.modes, currentModeId: change.value };
      return;
    }
    const configId = this.configIdFor(change);
    if (!configId) {
      throw new Error(`ACP session does not expose ${change.target} configuration`);
    }
    if (change.value === null) {
      throw new Error(`ACP configuration ${configId} cannot be cleared`);
    }
    const response = await this.call(
      this.connection.setSessionConfigOption({
        sessionId: this.nativeSessionId,
        configId,
        ...(typeof change.value === "boolean"
          ? { type: "boolean" as const, value: change.value }
          : { value: String(change.value) }),
      }),
    );
    this.configOptions = response.configOptions;
  }

  configContext() {
    return {
      sessionId: this.options.boundarySessionId,
      config: this.configAccess(),
      request: this.request,
    };
  }

  private readonly request: AcpRequest = async (method, params) =>
    jsonValue(
      await this.call(this.connection.extMethod(method, params as Record<string, unknown>)),
    );

  private configAccess(): AcpConfigAccess {
    return {
      read: async () => configValues(this.configOptions),
      set: async (id, value) => {
        if (typeof value !== "string" && typeof value !== "boolean") {
          throw new Error(`ACP configuration ${id} accepts only string or boolean values`);
        }
        const response = await this.call(
          this.connection.setSessionConfigOption({
            sessionId: this.nativeSessionId,
            configId: id,
            ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
          }),
        );
        this.configOptions = response.configOptions;
      },
    };
  }

  private emitConfig(): void {
    if (this.configTransaction) return;
    this.emitConfigSnapshot(toProviderConfigState(this.modes, this.configOptions));
  }

  private nativeModeId(): string | undefined {
    return selectedValue(modeOption(this.configOptions)) ?? this.modes?.currentModeId;
  }

  private emitConfigSnapshot(config: ProviderConfigState): void {
    config = {
      ...config,
      settings: [
        ...(config.settings ?? []).filter((setting) => setting.id !== "auto_accept"),
        { type: "toggle", id: "auto_accept", label: "Auto-accept", value: this.autoAccept },
      ],
    };
    const autoAcceptMode = this.options.options.acpOptions?.autoAcceptMode;
    if (autoAcceptMode) {
      if (this.nativeModeId() !== autoAcceptMode.nativeMode) this.autoAccept = false;
      config = {
        ...config,
        mode: this.autoAccept ? autoAcceptMode.mode.id : config.mode,
        modes: [...config.modes, { ...autoAcceptMode.mode, isUnattended: true }],
      };
    }
    const context = { sessionId: this.options.boundarySessionId };
    for (const transformer of this.transformers) {
      config = transformer.config?.(config, context) ?? config;
    }
    this.emit({
      type: "session.config",
      sessionId: this.options.boundarySessionId,
      config,
    });
  }

  private async restoreConfig(
    modes: NewSessionResponse["modes"],
    options: readonly SessionConfigOption[],
  ): Promise<void> {
    if (
      !modeOption(options) &&
      modes?.currentModeId &&
      this.modes?.currentModeId !== modes.currentModeId
    ) {
      await this.call(
        this.connection.setSessionMode({
          sessionId: this.nativeSessionId,
          modeId: modes.currentModeId,
        }),
      );
    }
    const currentValues = configValues(this.configOptions);
    for (const option of options) {
      const value = option.currentValue;
      if (currentValues[option.id] === value) continue;
      await this.call(
        this.connection.setSessionConfigOption({
          sessionId: this.nativeSessionId,
          configId: option.id,
          ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
        }),
      );
    }
  }

  private async requestPermission(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    await this.notificationLane;
    if (this.closing || this.processFailed || this.activePrompt?.cancelling) {
      return { outcome: { outcome: "cancelled" } };
    }
    if (
      this.autoAccept &&
      request.sessionId === this.nativeSessionId &&
      !this.hasToolPolicy &&
      (!this.options.options.acpOptions?.autoAcceptMode ||
        this.nativeModeId() === this.options.options.acpOptions.autoAcceptMode.nativeMode)
    ) {
      const allowOptions = request.options.filter((option) => option.kind.startsWith("allow"));
      const allowOnce = allowOptions.find((option) => option.kind === "allow_once");
      if (
        allowOnce &&
        new Set(allowOptions.map((option) => option.kind)).size === allowOptions.length
      ) {
        return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
      }
    }
    const permissionId = `permission:${request.toolCall.toolCallId}`;
    const { presentation } = this.presentToolCall(request.toolCall);
    return new Promise((resolve) => {
      this.permissions.set(permissionId, { request, resolve, turnId: this.activePrompt?.turnId });
      if (this.activePrompt?.deferred) this.scheduleDeferredSettle();
      this.emit({
        type: "session.permission",
        sessionId: this.options.boundarySessionId,
        request: {
          id: permissionId,
          name: request.toolCall.name ?? request.toolCall.title ?? "Tool",
          kind: "tool",
          title: request.toolCall.title ?? undefined,
          input: jsonRecord(request.toolCall.rawInput),
          detail: toolCallDetail(presentation),
          actions: request.options.map((option) => ({
            id: option.optionId,
            label: option.name,
            behavior: option.kind.startsWith("allow") ? "allow" : "deny",
          })),
        },
      });
    });
  }

  private observeWireMessage(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    if (record.method === "session/update") {
      this.sessionUpdateWireSeqs.push(++this.incomingWireSeq);
      return;
    }
    if (
      !("method" in record) &&
      "id" in record &&
      typeof record.result === "object" &&
      record.result !== null &&
      typeof (record.result as Record<string, unknown>).stopReason === "string" &&
      this.activePrompt &&
      this.activePrompt.lastPromptResponseWireSeq === null
    ) {
      this.activePrompt.lastPromptResponseWireSeq = ++this.incomingWireSeq;
    }
  }

  private isPostWirePrompt(active: ActivePrompt, wireSeq: number): boolean {
    return active.lastPromptResponseWireSeq !== null && wireSeq > active.lastPromptResponseWireSeq;
  }

  private sessionUpdate(notification: SessionNotification, wireSeq: number): void {
    // The attachment has been left. Late updates belong to work the agent kept running for
    // another client and must not be rendered here.
    if (this.detached) return;
    if (notification.sessionId !== this.nativeSessionId) return;
    if (this.replayWindow && isReplayHistoryUpdate(notification.update)) {
      this.lastLoadHistoryAt = performance.now();
    }
    if (this.replayWindow === "skip" && !this.vendorTurn) {
      if (isSessionStateUpdate(notification.update)) {
        this.reduceStateUpdate(notification.update, wireSeq);
      }
      return;
    }
    if (
      !this.replayWindow &&
      !this.activePrompt &&
      !this.vendorTurn &&
      [
        "agent_message_chunk",
        "agent_thought_chunk",
        "user_message_chunk",
        "tool_call",
        "tool_call_update",
        "plan",
      ].includes(notification.update.sessionUpdate)
    ) {
      const next = this.outstandingSteers.entries().next().value;
      if (next) {
        const [clientMessageId, steer] = next;
        const turnId = `acp:${clientMessageId}`;
        this.activePrompt = newActivePrompt(turnId, steer.settled);
        this.fallbackChunkIds.clear();
        this.emit({
          type: "session.turn",
          sessionId: this.options.boundarySessionId,
          turnId,
          state: "started",
        });
      }
    }
    if (
      this.replayWindow === "replay" &&
      notification.update.sessionUpdate === "user_message_chunk"
    ) {
      this.reduceUserMessageChunk(notification.update);
      return;
    }
    this.reduceUpdate(notification.update, wireSeq);
  }

  private reduceUpdate(update: SessionUpdate, wireSeq: number): void {
    if (update.sessionUpdate !== "user_message_chunk") this.flushBufferedUserChunk();
    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk" ||
      update.sessionUpdate === "user_message_chunk"
    ) {
      if (update.sessionUpdate === "user_message_chunk") {
        this.reduceLiveUserChunk(update);
        return;
      }
      // A chunk of one kind ends every other kind's open item, whatever its
      // content or id: reasoning, then text, then reasoning again are three items.
      this.fallbackChunkIds.delete(
        update.sessionUpdate === "agent_message_chunk"
          ? "agent_thought_chunk"
          : "agent_message_chunk",
      );
      this.fallbackChunkIds.delete("user_message_chunk");
      if (update.content.type !== "text") return;
      const id = this.resolveChunkId(update.sessionUpdate, update.messageId);
      const text = `${this.messages.get(id) ?? ""}${update.content.text}`;
      this.messages.set(id, text);
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: {
          type: update.sessionUpdate === "agent_message_chunk" ? "assistant_message" : "reasoning",
          id,
          text,
          ...(update.sessionUpdate === "agent_message_chunk"
            ? { messageId: update.messageId ?? undefined }
            : {}),
        },
      });
      this.noteDeferredChunk(update.sessionUpdate, wireSeq);
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      if (update.sessionUpdate === "tool_call") this.fallbackChunkIds.clear();
      this.reduceToolCall(update, wireSeq);
      return;
    }
    if (update.sessionUpdate === "plan") this.fallbackChunkIds.clear();
    this.reduceStateUpdate(update, wireSeq);
  }

  private reduceLiveUserChunk(
    update: Extract<SessionUpdate, { sessionUpdate: "user_message_chunk" }>,
  ): void {
    if (this.steerEchoes.size > 0) this.reconcileSteerEcho(update);
    else this.reduceUserMessageChunk(update);
  }

  private reconcileSteerEcho(
    update: Extract<SessionUpdate, { sessionUpdate: "user_message_chunk" }>,
  ): void {
    if (update.content.type !== "text") {
      this.flushBufferedUserChunk();
      this.reduceUserMessageChunk(update);
      return;
    }
    if (this.bufferedUserChunk && this.bufferedUserChunk.messageId !== update.messageId) {
      this.flushBufferedUserChunk();
    }
    const previous = this.bufferedUserChunk;
    const text =
      (previous?.content.type === "text" ? previous.content.text : "") + update.content.text;
    this.bufferedUserChunk = { ...update, content: { type: "text", text } };
    // ACP native IDs need not equal our local submission IDs. Generic providers
    // offer no origin correlation, so retain text matching for their own echoes.
    const echoes = [...this.steerEchoes];
    const exact = echoes.find(([, echo]) => echo === text);
    if (exact) {
      this.fallbackChunkIds.clear();
      this.steerEchoes.delete(exact[0]);
      this.bufferedUserChunk = null;
    } else if (!echoes.some(([, echo]) => echo.startsWith(text))) {
      this.flushBufferedUserChunk();
    }
  }

  private flushBufferedUserChunk(): void {
    const chunk = this.bufferedUserChunk;
    this.bufferedUserChunk = null;
    if (chunk) this.reduceUserMessageChunk(chunk);
  }

  private expireSteerEcho(clientMessageId: string): void {
    this.steerEchoes.delete(clientMessageId);
    const content = this.bufferedUserChunk?.content;
    if (
      content?.type === "text" &&
      ![...this.steerEchoes.values()].some((echo) => echo.startsWith(content.text))
    ) {
      this.flushBufferedUserChunk();
    }
  }

  // Historical user messages arrive only as replayed chunks; a live prompt
  // already echoes its own user message when it is admitted.
  private reduceUserMessageChunk(
    update: Extract<SessionUpdate, { sessionUpdate: "user_message_chunk" }>,
  ): void {
    this.fallbackChunkIds.delete("agent_message_chunk");
    this.fallbackChunkIds.delete("agent_thought_chunk");
    if (update.content.type !== "text") return;
    const id = this.resolveChunkId("user_message_chunk", update.messageId);
    const text = `${this.messages.get(id) ?? ""}${update.content.text}`;
    this.messages.set(id, text);
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: {
        type: "user_message",
        id,
        text,
        ...(update.messageId ? { messageId: update.messageId } : {}),
      },
    });
  }

  private resolveChunkId(
    kind: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk",
    messageId: string | null | undefined,
  ): string {
    if (messageId) {
      this.fallbackChunkIds.delete(kind);
      // Native IDs identify a message within its chunk kind. Timeline IDs must
      // also distinguish reasoning from replies and from generated fallback IDs.
      return JSON.stringify([kind, messageId]);
    }
    let id = this.fallbackChunkIds.get(kind);
    if (!id) {
      id = `${kind}:${++this.messageSequence}`;
      this.fallbackChunkIds.set(kind, id);
    }
    return id;
  }

  private reduceStateUpdate(update: SessionUpdate, wireSeq: number): void {
    if (update.sessionUpdate === "plan") {
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: {
          type: "todo",
          id: "acp-plan",
          items: update.entries.map((entry, index) => ({
            id: String(index),
            text: entry.content,
            completed: entry.status === "completed",
            status: entry.status,
          })),
        },
      });
      return;
    }
    if (update.sessionUpdate === "available_commands_update") {
      const commands = update.availableCommands.map((command) => ({
        name: command.name,
        description: command.description,
        argumentHint: command.input?.hint,
      }));
      this.emit({
        type: "session.commands",
        sessionId: this.options.boundarySessionId,
        commands: this.classifyCommands(commands),
      });
      this.receivedInitialCommands = true;
      this.commandWaiter?.();
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      const option = modeOption(this.configOptions);
      if (option?.type === "select") {
        this.configOptions = this.configOptions.map((candidate) =>
          candidate === option ? { ...option, currentValue: update.currentModeId } : candidate,
        );
      }
      if (this.modes) this.modes = { ...this.modes, currentModeId: update.currentModeId };
      this.emitConfig();
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      this.configOptions = update.configOptions;
      this.emitConfig();
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.lastUsage = {
        ...this.lastUsage,
        contextWindowUsedTokens: update.used,
        contextWindowMaxTokens: update.size,
        totalCostUsd: update.cost?.currency === "USD" ? update.cost.amount : undefined,
      };
      this.emit({
        type: "session.usage",
        sessionId: this.options.boundarySessionId,
        turnId: this.vendorTurn?.turnId ?? this.activePrompt?.turnId,
        usage: this.lastUsage,
      });
      this.noteDeferredUsageUpdate(wireSeq);
      return;
    }
    if (update.sessionUpdate === "compaction_update") {
      if (update.status === "completed") this.pendingCompactions.delete(update.compactionId);
      else this.pendingCompactions.add(update.compactionId);
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: {
          type: "compaction",
          id: update.compactionId,
          status: update.status === "completed" ? "completed" : "loading",
        },
      });
      if (this.activePrompt?.deferred) this.scheduleDeferredSettle();
    }
  }

  private terminalizeTransientItems(
    state: "completed" | "failed" | "canceled",
    options?: { preserveQualifyingOpenTools?: boolean; suppressTrailingToolEcho?: boolean },
  ): void {
    const preserve = options?.preserveQualifyingOpenTools === true;
    for (const [id, tool] of this.toolCalls) {
      const snapshot = tool.presentation;
      if (snapshot.status !== "pending" && snapshot.status !== "in_progress") continue;
      if (preserve && this.liveOpenToolIds.has(id) && this.toolKeepsTurnOpen(snapshot)) continue;
      this.liveOpenToolIds.delete(id);
      if (options?.suppressTrailingToolEcho) this.canceledToolCallIds.add(id);
      const completed: AcpToolCallSnapshot = {
        ...snapshot,
        status: state === "completed" ? "completed" : "failed",
      };
      this.toolCalls.set(id, {
        source: { ...tool.source, status: completed.status },
        presentation: completed,
      });
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: terminalToolItem(toolTimelineItem(snapshot), state),
      });
    }
    for (const item of this.vendorToolCalls.values()) {
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: terminalToolItem(item, state),
      });
    }
    this.vendorToolCalls.clear();
    for (const id of this.pendingCompactions) {
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: { type: "compaction", id, status: "completed" },
      });
    }
    this.pendingCompactions.clear();
  }

  /** Merges an update into the call's earlier updates and runs it through the transformers. */
  private presentToolCall(update: ToolCall | ToolCallUpdate): AcpToolCallState {
    const tool = this.toolCalls.get(update.toolCallId);
    const source = mergeToolCallSnapshot(update, tool?.source);
    const context = {
      sessionId: this.options.boundarySessionId,
      mcpServerNames: this.mcpServerNames,
      previous: tool?.presentation,
    };
    let presentation: AcpToolCallSnapshot = source;
    for (const transformer of this.transformers)
      presentation = transformer.toolCall?.(presentation, context) ?? presentation;
    return { source, presentation };
  }

  private reduceToolCall(
    update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
    wireSeq: number,
  ): void {
    if (
      update.sessionUpdate === "tool_call_update" &&
      this.canceledToolCallIds.has(update.toolCallId)
    ) {
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      this.canceledToolCallIds.delete(update.toolCallId);
    }
    const tool = this.toolCalls.get(update.toolCallId);
    const current = tool?.presentation;
    const wasOpenQualifying =
      current !== undefined &&
      this.liveOpenToolIds.has(current.id) &&
      this.toolKeepsTurnOpen(current);
    const { source, presentation: snapshot } = this.presentToolCall(update);
    this.toolCalls.set(snapshot.id, { source, presentation: snapshot });
    const isOpen = snapshot.status === "pending" || snapshot.status === "in_progress";
    if (this.replayWindow === null) {
      if (isOpen) this.liveOpenToolIds.add(snapshot.id);
      else this.liveOpenToolIds.delete(snapshot.id);
    }
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: toolTimelineItem(snapshot),
    });
    const isOpenQualifying =
      this.liveOpenToolIds.has(snapshot.id) && this.toolKeepsTurnOpen(snapshot);
    this.noteDeferredToolTransition(wasOpenQualifying, isOpenQualifying, isOpen, snapshot, wireSeq);
  }

  /**
   * Resolves once the notification's deferred updates are applied. The inbound stream awaits it,
   * so no later wire message reaches the SDK while this notification waits for earlier updates.
   */
  private vendorNotification(method: string, params: unknown): Promise<void> {
    const notification = { method, params: jsonValue(params) };
    const context = { sessionId: this.options.boundarySessionId };
    const deferred: AcpVendorUpdate[] = [];
    for (const transformer of this.transformers) {
      const transformed = transformer.notification?.(notification, context);
      if (!transformed) continue;
      const updates = Array.isArray(transformed) ? transformed : [transformed];
      for (const update of updates) {
        // Configuration transactions read the transformer's config synchronously.
        if (update.type === "config") this.emitVendorUpdate(update);
        else deferred.push(update);
      }
    }
    if (deferred.length === 0) return Promise.resolve();
    // The SDK may have read a session/update from the stream without dispatching it yet, so
    // join the lane only once every update that arrived before this notification is applied.
    return this.updateSlots
      .settled()
      .then(() => {
        if (this.closing || this.processFailed) return undefined;
        return this.enqueueNotification(() => {
          for (const update of deferred) this.emitVendorUpdate(update);
        });
      })
      .catch((error: unknown) => {
        console.error("Error applying ACP vendor notification", error);
      });
  }

  private emitVendorUpdate(update: AcpVendorUpdate): void {
    if (update.type === "commands") {
      this.emit({
        type: "session.commands",
        sessionId: this.options.boundarySessionId,
        commands: this.classifyCommands(update.commands),
      });
    } else if (update.type === "config") {
      if (this.configTransaction) this.stagedTransformerConfig = update.config;
      else this.emitConfigSnapshot(update.config);
    } else if (update.type === "timeline") {
      if (update.item.type === "tool_call") {
        if (update.item.status === "running") this.vendorToolCalls.set(update.item.id, update.item);
        else this.vendorToolCalls.delete(update.item.id);
      }
      this.emit({
        type: "timeline.item",
        sessionId: this.options.boundarySessionId,
        item: update.item,
      });
    } else if (update.type === "turn") {
      this.reduceVendorTurn(update);
    } else {
      this.emit({
        type: "session.notice",
        sessionId: this.options.boundarySessionId,
        notice: update.notice,
      });
    }
  }

  private reduceVendorTurn(update: Extract<AcpVendorUpdate, { type: "turn" }>): void {
    const turnId = `acp-vendor:${update.turnId}`;
    if (update.state === "started") {
      // A correlated prompt already owns this execution. Opening a second bracket would show the
      // same work twice and end it with a second terminal.
      if (
        this.connectionPolicy.turnCorrelation === true &&
        (this.localTurnIds.has(update.turnId) || this.settledSharedTurns.has(update.turnId))
      ) {
        console.debug(`Ignoring vendor turn ${turnId}: its shared turn is already settled`);
        return;
      }
      // A turn boundary ends the previous turn's open chunk, and a peer turn without user
      // content would otherwise append its first chunk to the last replayed message.
      this.fallbackChunkIds.clear();
      // Unless the provider says every vendor turn is a peer turn, the agent should not report
      // Paseo's own prompt as one.
      if (this.activePrompt && !this.vendorTurnsAreNeverForeground) {
        console.debug(`Ignoring vendor turn ${turnId}: a foreground prompt is active`);
        return;
      }
      // The foreground prompt already published a start for this execution. Adopt the vendor
      // bracket as an alias of that local id instead of publishing a second started lifecycle.
      if (
        this.activePrompt &&
        this.vendorTurnsAreNeverForeground &&
        this.connectionPolicy.turnCorrelation === true
      ) {
        this.openVendorTurn(this.activePrompt.turnId, update.turnId, false);
        return;
      }
      this.openVendorTurn(turnId, update.turnId, true);
      return;
    }
    if (this.vendorTurn?.remoteTurnId !== update.turnId) {
      console.debug(`Ignoring vendor turn ${turnId} ${update.state}: no matching open turn`);
      return;
    }
    // A correlated prompt response may have settled this execution already.
    const duplicate =
      this.connectionPolicy.turnCorrelation === true && this.settledSharedTurns.has(update.turnId);
    this.endVendorTurn(update.state, update.error, { emitTerminal: !duplicate });
    if (!duplicate) this.remember(this.settledSharedTurns, update.turnId);
  }

  private endVendorTurn(
    state: "completed" | "failed" | "canceled",
    error?: ProviderError,
    options: { emitTerminal?: boolean } = {},
  ): void {
    const open = this.vendorTurn;
    if (!open) return;
    this.flushBufferedUserChunk();
    this.steerEchoes.clear();
    this.vendorTurn = null;
    if (this.vendorTurnCancelTimer) {
      clearTimeout(this.vendorTurnCancelTimer);
      this.vendorTurnCancelTimer = null;
    }
    if (options.emitTerminal !== false) this.endLocalTurn(open.turnId, state, error);
    open.resolve();
  }

  private openVendorTurn(turnId: string, remoteTurnId: string, emitStart: boolean): void {
    if (this.vendorTurn) {
      const previous = this.vendorTurn.turnId;
      this.endVendorTurn("completed");
      console.warn(`Vendor turn acp-vendor:${remoteTurnId} started while ${previous} was open`);
    }
    let resolve!: () => void;
    const settled = new Promise<void>((next) => {
      resolve = next;
    });
    this.vendorTurn = { turnId, remoteTurnId, settled, resolve };
    if (emitStart) {
      this.emit({
        type: "session.turn",
        sessionId: this.options.boundarySessionId,
        turnId,
        state: "started",
      });
    }
  }

  private call<Value>(operation: Promise<Value>): Promise<Value> {
    const closed = this.transportFailure.then(() => {
      throw new Error("ACP transport closed unexpectedly");
    });
    return Promise.race([operation, closed]).catch(async (error) => {
      if (this.connection.signal.aborted) await this.transportFailure;
      throw error;
    });
  }

  private enqueueNotification(operation: () => void): Promise<void> {
    const result = this.notificationLane.then(operation);
    this.notificationLane = result.catch(() => undefined);
    return result;
  }

  private handleUnexpectedTransportClose(): void {
    if (this.closing || this.processFailed) return;
    const message = "ACP transport closed unexpectedly";
    this.processFailed = true;
    this.processFailureMessage = message;
    this.endVendorTurn("failed", { message: "ACP transport closed" });
    if (this.nativeSessionId) {
      this.emit({
        type: "session.runtime_failed",
        sessionId: this.options.boundarySessionId,
        error: { message },
      });
    }
    this.settlePendingWork(message);
  }

  private emitPendingWork(pending: boolean): void {
    this.emit({ type: "session.pending_work", sessionId: this.options.boundarySessionId, pending });
  }

  private clearOutstandingSteers(): void {
    const wasPending = this.outstandingSteers.size > 0;
    this.outstandingSteers.clear();
    if (wasPending) this.emitPendingWork(false);
  }

  private settlePendingWork(failureMessage?: string): void {
    this.promptResponses.flush();
    this.clearOutstandingSteers();
    // A user-initiated close leaves the peer turn running on the agent's side, so it was
    // canceled rather than failed; only a broken transport fails it.
    this.endVendorTurn(
      this.closing ? "canceled" : "failed",
      this.closing ? { message: "Session closed by Paseo" } : { message: "ACP transport closed" },
    );
    this.updateSlots.flush();
    for (const permission of this.permissions.values()) {
      permission.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.permissions.clear();
    if (this.activePrompt?.deferred) {
      this.finishDeferredTurn(
        this.activePrompt,
        failureMessage ? { type: "fail", error: { message: failureMessage } } : { type: "cancel" },
      );
    }
    this.commandWaiter?.();
    this.commandWaiter = null;
  }

  private finishPromptTurn(
    turnId: string,
    state: "completed" | "failed" | "canceled",
    error?: { message: string },
    options?: { preserveQualifyingOpenTools?: boolean; suppressTrailingToolEcho?: boolean },
  ): void {
    this.fallbackChunkIds.clear();
    this.terminalizeTransientItems(state, options);
    this.finishTurnPermissions(turnId);
    if (state === "failed") {
      this.emit({
        type: "session.turn",
        sessionId: this.options.boundarySessionId,
        turnId,
        state,
        error: error ?? { message: "ACP turn failed" },
      });
      return;
    }
    this.emit({
      type: "session.turn",
      sessionId: this.options.boundarySessionId,
      turnId,
      state,
    });
  }

  private steerDeferredPrompt(input: Extract<ProviderInput, { type: "session.prompt" }>): void {
    const active = this.activePrompt;
    const deferred = active?.deferred;
    if (!active || !deferred || active.cancelling || this.closing || this.processFailed) {
      this.emit({
        type: "session.prompt_result",
        sessionId: this.options.boundarySessionId,
        clientMessageId: input.prompt.clientMessageId,
        result: {
          type: "failed",
          error: {
            message: "ACP session can only steer while waiting on deferred background tools",
          },
        },
      });
      return;
    }
    if (input.prompt.clearPendingPermissions) {
      this.finishTurnPermissions(active.turnId);
    }
    const prompt = toAcpPrompt(input.prompt);
    active.wirePromptsInFlight += 1;
    this.scheduleDeferredSettle();
    this.replayWindow = null;
    this.fallbackChunkIds.clear();
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: {
        type: "user_message",
        id: input.prompt.clientMessageId,
        text: prompt
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        clientMessageId: input.prompt.clientMessageId,
      },
    });
    this.emit({
      type: "session.prompt_result",
      sessionId: this.options.boundarySessionId,
      clientMessageId: input.prompt.clientMessageId,
      result: { type: "steer", turnId: active.turnId },
    });
    const runSteer = async (): Promise<void> => {
      try {
        if (
          this.closing ||
          this.processFailed ||
          active.cancelling ||
          active.deferred !== deferred
        ) {
          return;
        }
        this.fallbackChunkIds.clear();
        active.lastPromptResponseWireSeq = null;
        if (active.replyState === "settled_with_open_tools") active.replyState = "idle";
        const response = await this.call(
          this.connection.prompt({ sessionId: this.nativeSessionId, prompt }),
        );
        await this.drainNotifications();
        if (this.closing || this.deferredRetirement || active.deferred !== deferred) return;
        if (response.usage) {
          this.lastUsage = {
            ...this.lastUsage,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cachedInputTokens: response.usage.cachedReadTokens ?? undefined,
          };
          this.emit({
            type: "session.usage",
            sessionId: this.options.boundarySessionId,
            turnId: active.turnId,
            usage: this.lastUsage,
          });
        }
        if (response.stopReason === "cancelled") {
          this.finishDeferredTurn(active, { type: "cancel" });
          return;
        }
        if (response.stopReason !== "end_turn" && active.wirePromptsInFlight === 1) {
          this.finishDeferredTurn(active, { type: "complete", terminalizeTools: true });
        }
      } catch (error) {
        await this.drainNotifications();
        if (this.closing || this.deferredRetirement || active.deferred !== deferred) return;
        if (this.processFailed) {
          this.finishDeferredTurn(active, {
            type: "fail",
            error: { message: describeError(error) },
          });
        } else {
          this.emit({
            type: "session.notice",
            sessionId: this.options.boundarySessionId,
            notice: {
              id: `acp:steer-error:${input.prompt.clientMessageId}`,
              severity: "error",
              title: "Follow-up prompt failed",
              description: describeError(error),
            },
          });
        }
      } finally {
        if (active.lastPromptResponseWireSeq === null) {
          active.lastPromptResponseWireSeq = this.incomingWireSeq;
        }
        active.wirePromptsInFlight -= 1;
        this.scheduleDeferredSettle();
      }
    };
    active.wirePromptLane = active.wirePromptLane.then(runSteer);
  }

  private async settleDeferredPrompt(active: ActivePrompt): Promise<void> {
    this.fallbackChunkIds.clear();
    const outcome = await new Promise<DeferredTurnOutcome>((resolve) => {
      active.deferred = { timer: null, resolve };
      this.scheduleDeferredSettle();
    });
    if (this.closing || this.deferredRetirement) return;
    if (outcome.type === "fail") {
      this.endLocalTurn(active.turnId, "failed", outcome.error);
      return;
    }
    this.endLocalTurn(
      active.turnId,
      outcome.type === "cancel" ? "canceled" : "completed",
      undefined,
      {
        preserveQualifyingOpenTools: outcome.type === "complete" && !outcome.terminalizeTools,
        suppressTrailingToolEcho: outcome.type === "cancel",
      },
    );
  }

  private toolKeepsTurnOpen(snapshot: AcpToolCallSnapshot): boolean {
    const defer = this.options.options.acpOptions?.deferTurnOnRunningTools;
    if (!defer) return false;
    return defer.keepsTurnOpen ? defer.keepsTurnOpen(snapshot) : true;
  }

  private hasQualifyingOpenTools(): boolean {
    for (const id of this.liveOpenToolIds) {
      const snapshot = this.toolCalls.get(id)?.presentation;
      if (snapshot && this.toolKeepsTurnOpen(snapshot)) return true;
    }
    return false;
  }

  private hasDeferredBlockers(): boolean {
    return (
      (this.activePrompt?.wirePromptsInFlight ?? 0) > 0 ||
      this.hasQualifyingOpenTools() ||
      this.permissions.size > 0 ||
      this.pendingCompactions.size > 0
    );
  }

  private shouldDeferTurn(active: ActivePrompt): boolean {
    if (!this.options.options.acpOptions?.deferTurnOnRunningTools) return false;
    if (active.cancelling || this.closing || this.processFailed) return false;
    return this.hasQualifyingOpenTools() || active.crossedEndTurn;
  }

  private finishDeferredTurn(active: ActivePrompt, outcome: DeferredTurnOutcome): void {
    const deferred = active.deferred;
    if (!deferred) return;
    if (deferred.timer) clearTimeout(deferred.timer);
    active.deferred = null;
    deferred.resolve(outcome);
  }

  private noteDeferredToolTransition(
    wasOpenQualifying: boolean,
    isOpenQualifying: boolean,
    isOpen: boolean,
    snapshot: AcpToolCallSnapshot,
    wireSeq: number,
  ): void {
    const active = this.activePrompt;
    if (!active || wasOpenQualifying === isOpenQualifying) return;
    if (!active.deferred && !this.isPostWirePrompt(active, wireSeq)) return;
    if (!active.deferred && wasOpenQualifying && !isOpen && this.toolKeepsTurnOpen(snapshot)) {
      active.crossedEndTurn = true;
    }
    if (isOpenQualifying) active.replyState = "idle";
    if (active.deferred) this.scheduleDeferredSettle();
  }

  private noteDeferredChunk(
    kind: "agent_message_chunk" | "agent_thought_chunk",
    wireSeq: number,
  ): void {
    const active = this.activePrompt;
    if (!active || !this.isPostWirePrompt(active, wireSeq)) return;
    if (kind === "agent_message_chunk") active.replyState = "open";
    else if (active.replyState !== "open") active.replyState = "idle";
    if (active.deferred) this.scheduleDeferredSettle();
  }

  private noteDeferredUsageUpdate(wireSeq: number): void {
    const active = this.activePrompt;
    if (!active || !this.isPostWirePrompt(active, wireSeq) || active.replyState !== "open") return;
    active.replyState = this.hasQualifyingOpenTools() ? "settled_with_open_tools" : "settled";
    if (active.deferred) this.scheduleDeferredSettle();
  }

  private scheduleDeferredSettle(): void {
    const active = this.activePrompt;
    const deferred = active?.deferred;
    const config = this.options.options.acpOptions?.deferTurnOnRunningTools;
    if (!active || !deferred || !config || active.cancelling) return;
    if (deferred.timer) {
      clearTimeout(deferred.timer);
      deferred.timer = null;
    }
    if (this.hasDeferredBlockers()) return;
    const settled =
      active.replyState === "settled" || active.replyState === "settled_with_open_tools";
    const delayMs = settled
      ? (config.settleDelayMs ?? DEFAULT_DEFERRED_SETTLE_DELAY_MS)
      : (config.quietLimitMs ?? DEFAULT_DEFERRED_QUIET_LIMIT_MS);
    deferred.timer = setTimeout(() => {
      deferred.timer = null;
      void this.trySettleDeferredTurn(active, deferred);
    }, delayMs);
  }

  private async trySettleDeferredTurn(
    active: ActivePrompt,
    deferred: DeferredTurnState,
  ): Promise<void> {
    await this.drainNotifications();
    if (
      this.closing ||
      this.processFailed ||
      active.cancelling ||
      active.deferred !== deferred ||
      deferred.timer !== null ||
      this.hasDeferredBlockers()
    ) {
      return;
    }
    this.finishDeferredTurn(active, { type: "complete", terminalizeTools: true });
  }

  private waitForInitialCommands(): Promise<void> {
    if (this.receivedInitialCommands) return Promise.resolve();
    const timeoutMs = this.options.options.acpOptions?.initialCommandsTimeoutMs ?? 1_000;
    const commands = new Promise<void>((resolve) => {
      this.commandWaiter = resolve;
    });
    return withTimeout(commands, timeoutMs, "ACP agent did not publish initial commands")
      .catch(() => undefined)
      .finally(() => {
        this.commandWaiter = null;
      });
  }

  private notePartialWireRead(): void {
    if (this.replayWindow) this.lastPartialWireAt = performance.now();
  }

  // An agent that streams history after its session/load response sends no end marker,
  // so the history ends once a quiet period passes without a history update.
  private async waitForLoadReplay(
    quietPeriod: number,
    isConnectionClosed: () => boolean,
  ): Promise<void> {
    const start = performance.now();
    while (!this.closing && !this.processFailed && !isConnectionClosed()) {
      const lastActivityAt = Math.max(start, this.lastLoadHistoryAt, this.lastPartialWireAt);
      const remaining = lastActivityAt + quietPeriod - performance.now();
      // A stalled event loop reaches the quiet period with history still unread in the pipe.
      // setImmediate lets the loop read pending input once before the silence is trusted.
      await new Promise<void>((resolve) => {
        if (remaining > 0) setTimeout(resolve, remaining);
        else setImmediate(resolve);
      });
      await this.notificationLane;
      if (
        remaining <= 0 &&
        Math.max(start, this.lastLoadHistoryAt, this.lastPartialWireAt) === lastActivityAt
      ) {
        return;
      }
    }
  }
}

function observePartialWireReads(
  input: ReadableStream<Uint8Array>,
  onPartialRead: () => void,
): ReadableStream<Uint8Array> {
  let incompleteLine = false;
  return input.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const wasIncomplete = incompleteLine;
        incompleteLine = hasTrailingIncompleteLine(chunk, incompleteLine);
        if (wasIncomplete || incompleteLine) onPartialRead();
        controller.enqueue(chunk);
      },
    }),
  );
}

function hasTrailingIncompleteLine(chunk: Uint8Array, incompleteLine: boolean): boolean {
  const newline = chunk.lastIndexOf(0x0a);
  const start = newline === -1 ? 0 : newline + 1;
  if (newline !== -1) incompleteLine = false;
  for (let index = start; index < chunk.length; index += 1) {
    const byte = chunk[index];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d) return true;
  }
  return incompleteLine;
}

function isReplayHistoryUpdate(update: SessionUpdate): boolean {
  return (
    update.sessionUpdate === "user_message_chunk" ||
    update.sessionUpdate === "agent_message_chunk" ||
    update.sessionUpdate === "agent_thought_chunk" ||
    update.sessionUpdate === "tool_call" ||
    update.sessionUpdate === "tool_call_update" ||
    update.sessionUpdate === "plan" ||
    update.sessionUpdate === "compaction_update"
  );
}

function isSessionStateUpdate(update: SessionUpdate): boolean {
  return (
    update.sessionUpdate === "available_commands_update" ||
    update.sessionUpdate === "config_option_update" ||
    update.sessionUpdate === "current_mode_update" ||
    update.sessionUpdate === "usage_update"
  );
}

function routeIncomingMessages(
  stream: Stream,
  receiveVendor: (method: string, params: unknown) => Promise<void>,
  updateSlots: UpdateSlots,
  promptResponses: PromptResponseOrder,
  observeWire: (message: unknown) => void,
): Stream {
  const clientMethods = new Set<string>(Object.values(CLIENT_METHODS));
  const writer = stream.writable.getWriter();
  return {
    writable: new WritableStream({
      write(message) {
        if ("method" in message && message.method === "session/prompt" && "id" in message) {
          promptResponses.sent(message.id);
        }
        return writer.write(message);
      },
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
    readable: stream.readable.pipeThrough(
      new TransformStream({
        async transform(message, controller) {
          if ("method" in message && !("id" in message)) {
            if (!clientMethods.has(message.method)) {
              // The SDK dispatches extensions asynchronously and can resolve a later response first.
              // Run synchronous vendor transforms in wire order, inside the configuration transaction.
              // Awaiting holds every later message back until this one's updates are applied, so a
              // session/update that follows it on the wire cannot reach the lane ahead of it.
              try {
                await receiveVendor(message.method, message.params);
              } catch (error) {
                console.error("Error handling ACP vendor notification", error);
              }
              return;
            }
            // Reserve the update's place before it can reach the client, so a vendor notification
            // that follows it on the wire can wait for it to be applied.
            if (message.method === CLIENT_METHODS.session_update) {
              updateSlots.admit(message.params);
            }
          }
          observeWire(message);
          if (!("method" in message) && "id" in message) {
            const boundary = promptResponses.response(message.id);
            if (boundary) {
              await updateSlots.settled();
              controller.enqueue(message);
              await boundary;
              return;
            }
          }
          controller.enqueue(message);
        },
      }),
    ),
  };
}

class PromptResponseOrder {
  private readonly pending: Array<{ done: Promise<void>; release(): void }> = [];
  private readonly sentRequests = new Map<
    string | number,
    { done: Promise<void>; release(): void }
  >();

  register(): () => void {
    let resolve!: () => void;
    const done = new Promise<void>((next) => {
      resolve = next;
    });
    const entry = {
      done,
      release: () => {
        const index = this.pending.indexOf(entry);
        if (index !== -1) this.pending.splice(index, 1);
        for (const [id, sent] of this.sentRequests) {
          if (sent === entry) this.sentRequests.delete(id);
        }
        resolve();
      },
    };
    this.pending.push(entry);
    return entry.release;
  }

  sent(id: string | number | null): void {
    const entry = this.pending.shift();
    if (entry && id !== null) this.sentRequests.set(id, entry);
  }

  response(id: string | number | null): Promise<void> | undefined {
    if (id === null) return undefined;
    const entry = this.sentRequests.get(id);
    this.sentRequests.delete(id);
    return entry?.done;
  }

  flush(): void {
    for (const entry of this.pending.splice(0)) entry.release();
    for (const entry of this.sentRequests.values()) entry.release();
    this.sentRequests.clear();
  }
}

/**
 * Bound on how long a vendor update waits for the `session/update`s that preceded it on the wire.
 * The SDK dispatches a notification in the same read iteration that reads it, so a slot is
 * normally claimed within microtasks; one still unclaimed this long belongs to an update the SDK
 * dropped for failing validation. The value only bounds a pathological stall, so it sits far above
 * any real dispatch delay and far below a user noticing.
 */
const SLOT_SETTLE_TIMEOUT_MS = 250;

/**
 * One slot per inbound session/update, in wire order. The SDK dispatches notifications in
 * arrival order, but it can read an update from the stream before dispatching the one before it,
 * so a vendor notification that follows an update on the wire must wait for that update's slot.
 *
 * The SDK validates a notification before it reaches the client and drops it when validation
 * fails, so a delivery is paired with its slot by containment rather than by delivery count: the
 * validated notification is built from the raw params by stripping unknown keys and filling
 * defaults, so every value it carries is already present in the payload the slot recorded.
 */
interface UpdateSlot {
  promise: Promise<void>;
  raw: unknown;
  resolve(): void;
  /** A waiter already gave up on this slot; later waiters skip it. */
  expired: boolean;
}

class UpdateSlots {
  private readonly open: UpdateSlot[] = [];
  admit(raw: unknown): void {
    let resolve!: () => void;
    const promise = new Promise<void>((next) => {
      resolve = next;
    });
    this.open.push({ promise, raw, resolve, expired: false });
  }

  /** Called after the delivered update has been applied. */
  settleDelivered(notification: SessionNotification): void {
    const delivered = this.open.findIndex((slot) => containsUpdate(slot.raw, notification));
    // Resolve the delivered slot and every slot before it: those were dropped by validation, so
    // they will never be delivered and cannot hold the vendor lane.
    //
    // When nothing matches, release the oldest slot instead. The SDK can replace a field it
    // could not parse (`defaultOnError`), which makes containment miss the real slot; falling
    // back keeps the lane moving at the cost of possibly releasing a vendor update before the
    // update it was waiting on. A stall is the worse failure, and the wait is bounded anyway.
    this.settleThrough(delivered === -1 ? 0 : delivered);
  }

  /**
   * Resolves once every update admitted so far has been applied, or after
   * `SLOT_SETTLE_TIMEOUT_MS`. A slot the SDK never claims belongs to an update it dropped for
   * failing validation, and nothing else will ever report it; without the bound, a vendor
   * terminal would wait forever and every later prompt would wait behind that vendor turn.
   *
   * When the bound fires, the slots it covered expire, so the next waiter does not pay the bound
   * again for the same dropped update. Expired slots stay open: a late delivery still pairs with
   * its own slot by containment instead of falling back to the oldest open one.
   */
  settled(): Promise<void> {
    const last = this.open.findLast((slot) => !slot.expired);
    if (!last) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      const timer = setTimeout(() => {
        for (const slot of this.open) {
          slot.expired = true;
          if (slot === last) break;
        }
        finish();
      }, SLOT_SETTLE_TIMEOUT_MS);
      void last.promise.then(() => {
        clearTimeout(timer);
        finish();
        return undefined;
      });
    });
  }

  /** Nothing will be dispatched again: release every waiter. */
  flush(): void {
    while (this.open.length > 0) this.open.shift()!.resolve();
  }

  private settleThrough(index: number): void {
    for (let settled = 0; settled <= index; settled += 1) this.open.shift()?.resolve();
  }
}

/**
 * True when `validated` can be the SDK's parsed form of `raw`: zod strips keys it does not know
 * and fills defaults, so every value the validated object carries must already be in the raw
 * payload. A missing key is accepted only for a value zod could have filled in (`undefined`, or
 * an empty array for the collection defaults).
 */
function containsUpdate(raw: unknown, validated: unknown): boolean {
  if (validated === undefined) return true;
  if (Array.isArray(validated)) {
    if (!Array.isArray(raw)) return validated.length === 0;
    return validated.every((value, index) => containsUpdate(raw[index], value));
  }
  if (validated !== null && typeof validated === "object") {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
    const source = raw as Record<string, unknown>;
    return Object.entries(validated).every(([key, value]) =>
      key in source ? containsUpdate(source[key], value) : value === undefined,
    );
  }
  return Object.is(raw, validated);
}

function selectPermissionOption(
  options: RequestPermissionRequest["options"],
  response: ProviderPermissionResponse,
): RequestPermissionRequest["options"][number] | null {
  if (response.selectedActionId !== undefined) {
    return (
      options.find(
        (option) =>
          option.optionId === response.selectedActionId &&
          permissionOptionBehavior(option) === response.behavior,
      ) ?? null
    );
  }
  return options.find((option) => permissionOptionBehavior(option) === response.behavior) ?? null;
}

function permissionOptionBehavior(
  option: RequestPermissionRequest["options"][number],
): ProviderPermissionResponse["behavior"] {
  return option.kind.startsWith("allow") ? "allow" : "deny";
}

function ownConnectorStream(source: Stream): {
  stream: Stream;
  close(options?: { force?: boolean; timeoutMs?: number }): Promise<void>;
  whenClosed(): Promise<void> | null;
} {
  const reader = source.readable.getReader();
  const writer = source.writable.getWriter();
  let closing: Promise<void> | null = null;
  const stream: Stream = {
    readable: new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    }),
    writable: new WritableStream({
      write: (message) => writer.write(message),
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
  };
  return {
    stream,
    whenClosed: () => closing,
    async close(options?: { force?: boolean; timeoutMs?: number }) {
      if (!closing) {
        const closeWrite = options?.force
          ? writer.abort(new Error("Paseo aborted the ACP connector"))
          : writer.close();
        closing = Promise.allSettled([
          reader.cancel(new Error("Paseo closed the ACP connector")),
          closeWrite,
        ]).then((results) => {
          if (options?.timeoutMs === undefined) return undefined;
          const rejected = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          if (rejected) throw rejected.reason;
          return undefined;
        });
      }
      if (options?.timeoutMs !== undefined) {
        await withTimeout(closing, options.timeoutMs, "ACP connector did not close");
      } else {
        await closing.catch(() => undefined);
      }
    },
  };
}

function mergeToolCallSnapshot(
  update: ToolCall | ToolCallUpdate,
  current: AcpToolCallSnapshot | undefined,
): AcpToolCallSnapshot {
  return {
    id: update.toolCallId,
    name: firstText(update.name, current?.name),
    title: firstText(update.title, current?.title, update.name) ?? "Tool call",
    kind: firstText(update.kind, current?.kind),
    status: firstDefined(update.status, current?.status, "pending") ?? "pending",
    input: jsonValue(firstDefined(update.rawInput, current?.input, null)),
    output: jsonValue(firstDefined(update.rawOutput, current?.output, null)),
    locations: update.locations?.map((location) => location.path) ?? current?.locations ?? [],
    content: update.content === undefined ? current?.content : jsonValue(update.content),
  };
}

function firstDefined<Value>(...values: Array<Value | undefined>): Value | undefined {
  return values.find((value) => value !== undefined);
}

function firstText(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function toAcpMcpServers(config: ProviderSessionConfig) {
  return Object.entries(config.mcpServers).map(([name, server]) => {
    if (server.type === "stdio") {
      return {
        name,
        command: server.command,
        args: server.args ?? [],
        env: Object.entries(server.env ?? {}).map(([key, value]) => ({ name: key, value })),
      };
    }
    return {
      type: server.type,
      name,
      url: server.url,
      headers: Object.entries(server.headers ?? {}).map(([key, value]) => ({ name: key, value })),
    };
  });
}

function toAcpPrompt(
  prompt: Extract<ProviderInput, { type: "session.prompt" }>["prompt"],
): ContentBlock[] {
  if (prompt.input.type === "command") {
    // An explicit skill selection is the command. Sending the slash form as well would reach
    // jcode as literal prompt text, because explicit metadata suppresses textual recognition.
    if (prompt.skill !== undefined) {
      // Clearing with no text is a selection-only action; the recorded wire shape is no content.
      if (prompt.skill === null && prompt.input.arguments === "") return [];
      return [{ type: "text", text: prompt.input.arguments }];
    }
    const suffix = prompt.input.arguments ? ` ${prompt.input.arguments}` : "";
    return [{ type: "text", text: `/${prompt.input.name}${suffix}` }];
  }
  if (
    prompt.skill === null &&
    prompt.input.content.every((content) => content.type === "text" && content.text === "")
  ) {
    return [];
  }
  return prompt.input.content.map((content) => {
    if (content.type === "text" || content.type === "image") return content;
    return { type: "text", text: JSON.stringify(content) };
  });
}

/** The user message Paseo shows. It is the submitted slash form even when the wire omits it. */
function promptEchoText(
  prompt: Extract<ProviderInput, { type: "session.prompt" }>["prompt"],
): string {
  if (prompt.input.type === "command") {
    const suffix = prompt.input.arguments ? ` ${prompt.input.arguments}` : "";
    return `/${prompt.input.name}${suffix}`;
  }
  return prompt.input.content
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("\n");
}

function nativePersistence(sessionId: string): ProviderPersistence {
  return { version: 1, data: { sessionId } };
}

function readNativeSessionId(persistence: ProviderPersistence | undefined): string | null {
  if (
    !persistence ||
    typeof persistence.data !== "object" ||
    persistence.data === null ||
    Array.isArray(persistence.data)
  )
    return null;
  return typeof persistence.data.sessionId === "string" ? persistence.data.sessionId : null;
}

function toProviderConfigState(
  modes: NewSessionResponse["modes"],
  options: readonly SessionConfigOption[],
): ProviderConfigState {
  const model = modelOption(options);
  const thinking = options.find((option) => option.category === "thought_level");
  const modeConfig = modeOption(options);
  return {
    model: selectedValue(model),
    mode: selectedValue(modeConfig) ?? modes?.currentModeId,
    thinkingOption: selectedValue(thinking),
    models: selectOptions(model).map((option) => ({ id: option.value, label: option.label })),
    modes: modeConfig
      ? selectOptions(modeConfig).map((option) => ({
          id: option.value,
          label: option.label,
          description: option.description,
        }))
      : (modes?.availableModes.map((mode) => ({
          id: mode.id,
          label: mode.name,
          description: mode.description ?? undefined,
        })) ?? []),
    thinkingOptions: selectOptions(thinking).map((option) => ({
      id: option.value,
      label: option.label,
    })),
    settings: options
      .filter(
        (option) =>
          option !== model && option.category !== "thought_level" && option !== modeConfig,
      )
      .map(toProviderSetting),
  };
}

// ACP's category is a grouping hint, so one category can hold several controls. fx files its
// provider first, then the model, Fast, and Ultrafast under "model".
function modelOption(options: readonly SessionConfigOption[]): SessionConfigOption | undefined {
  const candidates = options.filter((option) => option.category === "model");
  return candidates.find((option) => option.id === "model") ?? candidates[0];
}

function modeOption(options: readonly SessionConfigOption[]): SessionConfigOption | undefined {
  return options.find((option) => option.category === "mode" && option.type === "select");
}

function toProviderCatalog(
  modes: NewSessionResponse["modes"],
  options: readonly SessionConfigOption[],
): ProviderCatalog {
  const state = toProviderConfigState(modes, options);
  return {
    models: state.models,
    modes: state.modes,
    thinkingOptions: state.thinkingOptions,
    defaultModel: state.model,
    defaultMode: state.mode,
    defaultThinkingOption: state.thinkingOption,
  };
}

function toProviderSetting(option: SessionConfigOption): ProviderSetting {
  if (option.type === "boolean") {
    return {
      type: "toggle",
      id: option.id,
      label: option.name,
      description: option.description ?? undefined,
      value: option.currentValue,
    };
  }
  return {
    type: "select",
    id: option.id,
    label: option.name,
    description: option.description ?? undefined,
    value: option.currentValue,
    options: selectOptions(option).map(({ label, value }) => ({ label, value })),
  };
}

function selectOptions(
  option: SessionConfigOption | undefined,
): Array<{ label: string; value: string; description?: string }> {
  if (!option || option.type === "boolean") return [];
  return option.options.flatMap((candidate) =>
    "group" in candidate
      ? candidate.options.map((nested) => ({
          label: nested.name,
          value: nested.value,
          description: nested.description ?? undefined,
        }))
      : [
          {
            label: candidate.name,
            value: candidate.value,
            description: candidate.description ?? undefined,
          },
        ],
  );
}

function selectedValue(option: SessionConfigOption | undefined): string | undefined {
  return option && option.type !== "boolean" ? option.currentValue : undefined;
}

function configValues(
  options: readonly SessionConfigOption[],
): Readonly<Record<string, ReturnType<typeof jsonValue>>> {
  return Object.fromEntries(options.map((option) => [option.id, option.currentValue]));
}

type ToolCallTimelineItem = Extract<ProviderTimelineItem, { type: "tool_call" }>;

function toolCallDetail(snapshot: AcpToolCallSnapshot): ProviderToolCallDetail {
  return snapshot.detail ?? standardToolCallDetail(snapshot);
}

function toolTimelineItem(snapshot: AcpToolCallSnapshot): ToolCallTimelineItem {
  const detail = toolCallDetail(snapshot);
  const status =
    snapshot.status === "in_progress" || snapshot.status === "pending"
      ? "running"
      : snapshot.status;
  const base = {
    type: "tool_call" as const,
    id: snapshot.id,
    callId: snapshot.id,
    name: snapshot.name ?? snapshot.title,
    detail,
  };
  if (status === "failed") {
    return { ...base, status, error: snapshot.output ?? { message: "Tool failed" } };
  }
  return { ...base, status, error: null };
}

// A row the turn left open ends with the turn. The wire contract requires a non-null error on a
// failed tool call, so a canceled turn cancels its rows instead of failing them.
function terminalToolItem(
  item: ToolCallTimelineItem,
  state: "completed" | "failed" | "canceled",
): ToolCallTimelineItem {
  if (state === "failed") {
    return { ...item, status: "failed", error: item.error ?? { message: "Turn failed" } };
  }
  return { ...item, status: state, error: null };
}

function jsonValue(value: unknown) {
  return z.json().parse(value);
}

function jsonRecord(value: unknown): Record<string, ReturnType<typeof jsonValue>> {
  if (value === undefined) return {};
  const parsed = jsonValue(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return parsed;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  message: string,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
        return undefined;
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
        return undefined;
      },
    );
  });
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
