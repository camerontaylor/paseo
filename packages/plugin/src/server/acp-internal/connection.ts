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
  type ListSessionsResponse,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
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
  AcpConnectionPolicy,
  AcpSessionPolicy,
  AcpToolCallSnapshot,
  AcpTransformer,
  AcpVendorUpdate,
  RunAcpProviderOptions,
} from "../acp.js";
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
  type ProviderPermissionResponse,
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
    case "session.prompt":
      await requireSession(state, input.sessionId).runtime.prompt(input);
      return;
    case "session.interrupt":
      await requireSession(state, input.sessionId).runtime.interrupt();
      state.emit({ type: "request.completed", requestId: input.requestId });
      return;
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
    env: {},
    emit: state.emit,
  });
  try {
    let catalog = await runtime.discover(input.cwd);
    const config = runtime.configAccess();
    for (const transformer of state.options.transformers ?? []) {
      if (transformer.discover) {
        catalog = await transformer.discover(catalog, { sessionId: "catalog", config });
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
    const selected = await runtime.listSessions(input.cwd, input.limit);
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
    env: input.config.env,
    emit: state.emit,
  });
  try {
    const capabilities = await runtime.open(input, state.capabilities);
    if (state.isClosed()) {
      await runtime.closeSession();
      return;
    }
    state.sessions.set(input.sessionId, {
      runtime,
      capabilities,
      mutationLane: Promise.resolve(),
    });
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
  env: Readonly<Record<string, string>>;
  emit(event: ProviderEvent): void;
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
  private readonly toolCalls = new Map<string, AcpToolCallSnapshot>();
  // Running tool rows published by transformers; the turn's terminal closes any left open.
  private readonly vendorToolCalls = new Map<string, ToolCallTimelineItem>();
  private readonly pendingCompactions = new Set<string>();
  private readonly permissions = new Map<
    string,
    { request: RequestPermissionRequest; resolve(response: RequestPermissionResponse): void }
  >();
  private readonly transformers: readonly AcpTransformer[];
  private readonly vendorTurnsAreNeverForeground: boolean;
  private configOptions: SessionConfigOption[] = [];
  private autoAccept = false;
  private hasToolPolicy = false;
  private modes: NewSessionResponse["modes"] = null;
  private commandWaiter: (() => void) | null = null;
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
   * Active while a persisted session loads. ACP agents replay the loaded
   * session's updates before session/load resolves; the value follows the
   * open request's history contract.
   */
  private replayWindow: "replay" | "skip" | null = null;
  private closing = false;
  private processFailed = false;
  private configTransaction = false;
  private stagedTransformerConfig: ProviderConfigState | null = null;
  private readonly closeConnector: () => Promise<void>;
  private notificationLane: Promise<void> = Promise.resolve();
  private promptLane: Promise<void> = Promise.resolve();
  private activePrompt: { turnId: string; settled: Promise<void> } | null = null;
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
    let closeConnector = async () => {};
    if (options.options.command) {
      // COMPAT(pluginProviderLaunch): added in v0.10.0, remove after 2027-03-29 once plugin host floor >= v0.10.0.
      // Standalone callers and older hosts do not send a daemon-resolved launch.
      const launch = options.launch ?? {
        command: options.options.command[0],
        args: options.options.command.slice(1),
        env: process.env,
      };
      child = spawnProcess(launch.command, launch.args, {
        env: { ...launch.env, ...options.env },
        stdio: "pipe",
      });
      spawnFailure = new Promise<never>((_resolve, reject) => child!.once("error", reject));
      child.stderr.on("data", () => undefined);
      const output = Writable.toWeb(child.stdin) as unknown as Parameters<typeof ndJsonStream>[0];
      const input = Readable.toWeb(child.stdout) as unknown as Parameters<typeof ndJsonStream>[1];
      stream = ndJsonStream(output, input);
    } else {
      const owned = ownConnectorStream(await options.options.connector());
      stream = owned.stream;
      closeConnector = owned.close;
    }
    const runtime = new AcpRuntime(stream, child, closeConnector, options);
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
    closeConnector: () => Promise<void>,
    private readonly options: StartRuntimeOptions,
  ) {
    this.child = child;
    this.closeConnector = closeConnector;
    this.emit = options.emit;
    this.transformers = options.options.transformers ?? [];
    this.vendorTurnsAreNeverForeground =
      options.options.acpOptions?.vendorTurnsAreNeverForeground === true;
    const client: Client = {
      requestPermission: (request) => this.requestPermission(request),
      sessionUpdate: (notification) =>
        this.enqueueNotification(() => {
          try {
            this.sessionUpdate(notification);
          } finally {
            this.updateSlots.settleDelivered(notification);
          }
        }),
    };
    this.connection = new ClientSideConnection(
      () => client,
      routeVendorNotifications(
        stream,
        (method, params) => this.vendorNotification(method, params),
        this.updateSlots,
        this.promptResponses,
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
      if (this.processFailed) return;
      this.processFailed = true;
      if (!this.closing && this.nativeSessionId) {
        this.emit({
          type: "session.runtime_failed",
          sessionId: this.options.boundarySessionId,
          error: { message: describeError(error) },
        });
      }
      this.settlePendingWork();
    });
    child?.once("close", (code, signal) => {
      if (this.closing || this.processFailed || !this.nativeSessionId) return;
      this.processFailed = true;
      this.emit({
        type: "session.runtime_failed",
        sessionId: this.options.boundarySessionId,
        error: { message: `ACP process exited (${signal ?? code ?? "unknown"})` },
      });
      this.settlePendingWork();
    });
  }

  async open(
    input: Extract<ProviderInput, { type: "session.open" }>,
    connectionCapabilities: readonly ProviderCapability[],
  ): Promise<readonly ProviderCapability[]> {
    const mcpServers =
      this.connectionPolicy.sendSessionMcpServers === false ? [] : toAcpMcpServers(input.config);
    const nativeSessionId = readNativeSessionId(input.persistence);
    const metadata = {
      _paseo: {
        systemPrompt: input.config.systemPrompt,
        providerOptions: input.config.providerOptions,
        toolPolicy: input.config.toolPolicy,
        persist: input.config.persist,
      },
    };
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
        this.replayWindow = null;
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
    this.modes = response.modes;
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
    // The local auto_accept toggle is configurable even without vendor options.
    const sessionCapabilities = connectionCapabilities.filter(
      (capability) =>
        capability !== "session.detach" &&
        (capability !== "prompt.steer" ||
          (this.connectionPolicy.steering === true && this.sessionPolicy.steering === true)),
    );
    if (this.sessionPolicy.detach === true) sessionCapabilities.push("session.detach");
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
    this.emitConfig();
    if (this.options.options.acpOptions?.waitForInitialCommands) {
      await this.waitForInitialCommands();
    }
    this.emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
    return sessionCapabilities;
  }

  async discover(cwd?: string): Promise<ProviderCatalog> {
    if (cwd === undefined && this.options.options.acpOptions?.workspaceOnlyCatalog) {
      return { models: [], modes: [] };
    }
    const response = await this.call(
      this.connection.newSession({ cwd: cwd ?? process.cwd(), mcpServers: [] }),
    );
    this.nativeSessionId = response.sessionId;
    this.modes = response.modes;
    this.configOptions = response.configOptions ?? [];
    return toProviderCatalog(response.modes, response.configOptions ?? []);
  }

  prompt(input: Extract<ProviderInput, { type: "session.prompt" }>): Promise<void> {
    if (this.detached) return Promise.reject(new Error("Session was detached from the agent"));
    this.assertPromptSelection(input.prompt);
    if (input.prompt.delivery === "steer") return this.steer(input);
    // A stop cancels the prompts waiting when it is pressed, not prompts admitted after it.
    const stopGeneration = this.stopGeneration;
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
    let classified: ProviderCommand[] = [...commands];
    const context = {
      sessionId: this.options.boundarySessionId,
      policy: this.connectionPolicy,
    };
    for (const transformer of this.transformers) {
      const next = transformer.command?.(classified, context);
      if (next) classified = [...next];
    }
    return classified;
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
  ): boolean {
    if (this.settledLocalTurns.has(turnId)) return false;
    this.remember(this.settledLocalTurns, turnId);
    this.fallbackChunkIds.clear();
    this.terminalizeTransientItems(state);
    this.emit({
      type: "session.turn",
      sessionId: this.options.boundarySessionId,
      turnId,
      state,
      ...(error === undefined ? {} : { error }),
    });
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
      if (!this.sharedTurns) await this.interruptTurn();
      await active.settled;
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
            turnId,
            usage: this.lastUsage,
          });
        }
        if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
        const state = response.stopReason === "cancelled" ? "canceled" : "completed";
        const correlation = this.promptCorrelation(response);
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
        if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
        this.endLocalTurn(turnId, "failed", { message: describeError(error) });
        releaseResponse();
        return undefined;
      },
    );
    this.activePrompt = { turnId, settled };
    void settled.finally(() => {
      this.expireSteerEcho(input.prompt.clientMessageId);
      if (this.activePrompt?.turnId === turnId) this.activePrompt = null;
    });
  }

  interrupt(): Promise<void> {
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

  private interruptTurn(): Promise<void> {
    return this.call(this.connection.cancel({ sessionId: this.nativeSessionId }));
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

  /** Follows `nextCursor` until the requested limit is reached or the agent has no more pages. */
  async listSessions(cwd?: string, limit?: number): Promise<ListSessionsResponse["sessions"]> {
    const sessions: ListSessionsResponse["sessions"] = [];
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    for (;;) {
      const response = await this.call(this.connection.listSessions({ cwd, cursor }));
      sessions.push(...response.sessions);
      cursor = response.nextCursor;
      if (!cursor) break;
      // An agent that repeats a cursor would otherwise page forever.
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (limit !== undefined && sessions.length >= limit) break;
    }
    return limit === undefined ? sessions : sessions.slice(0, limit);
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
    if (!pending) throw new Error(`Unknown ACP permission: ${permissionId}`);
    const selected = selectPermissionOption(pending.request.options, response);
    if (response.selectedActionId !== undefined && !selected) {
      throw new Error(
        `ACP permission action '${response.selectedActionId}' does not exist or does not match '${response.behavior}' behavior`,
      );
    }
    this.permissions.delete(permissionId);
    pending.resolve({
      outcome: selected
        ? { outcome: "selected", optionId: selected.optionId }
        : { outcome: "cancelled" },
    });
    this.emit({
      type: "session.permission_resolved",
      sessionId: this.options.boundarySessionId,
      permissionId,
    });
  }

  async configure(
    changes: Extract<ProviderInput, { type: "session.configure" }>["changes"],
  ): Promise<void> {
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
    const previousModes = this.modes ? structuredClone(this.modes) : null;
    const previousOptions = structuredClone(this.configOptions);
    const previousAutoAccept = this.autoAccept;
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
      this.modes = previousModes;
      this.configOptions = previousOptions;
      this.autoAccept = previousAutoAccept;
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

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.settlePendingWork();
    await this.closeConnector();
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
    if (config.mode) requested.push({ target: "mode", value: config.mode });
    if (config.thinkingOption) {
      requested.push({ target: "thinking", value: config.thinkingOption });
    }
    for (const [id, value] of Object.entries(config.settings)) {
      requested.push({ target: "setting", id, value });
    }
    for (const change of this.inAgentOrder(requested)) {
      const current = toProviderConfigState(this.modes, this.configOptions);
      if (change.target === "model" && change.value === current.model) continue;
      if (change.target === "mode" && change.value === current.mode) continue;
      if (change.target === "thinking" && change.value === current.thinkingOption) continue;
      if (
        change.target === "setting" &&
        change.value === configValues(this.configOptions)[change.id]
      )
        continue;
      await this.applyConfigChange(change);
    }
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
    return this.configOptions.find((option) => option.category === "mode")?.id;
  }

  private async applyConfigChange(change: AcpConfigChange): Promise<void> {
    // Paseo owns this policy; it is not an agent ACP config option.
    if (change.target === "setting" && change.id === "auto_accept") {
      this.autoAccept = !this.hasToolPolicy && change.value === true;
      return;
    }
    const access = this.configAccess();
    for (const transformer of this.transformers) {
      if (
        (await transformer.configure?.(change, {
          sessionId: this.options.boundarySessionId,
          config: access,
        })) === "handled"
      ) {
        return;
      }
    }
    if (change.target === "mode") {
      if (!change.value || !this.modes) {
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

  configAccess(): AcpConfigAccess {
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

  private emitConfigSnapshot(config: ProviderConfigState): void {
    config = {
      ...config,
      settings: [
        ...(config.settings ?? []).filter((setting) => setting.id !== "auto_accept"),
        { type: "toggle", id: "auto_accept", label: "Auto-accept", value: this.autoAccept },
      ],
    };
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
    if (modes?.currentModeId && this.modes?.currentModeId !== modes.currentModeId) {
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

  private requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const allows = request.options.filter((option) => option.kind === "allow_once");
    if (this.autoAccept && allows.length === 1) {
      return Promise.resolve({ outcome: { outcome: "selected", optionId: allows[0]!.optionId } });
    }
    const permissionId = `permission:${request.toolCall.toolCallId}`;
    return new Promise((resolve) => {
      this.permissions.set(permissionId, { request, resolve });
      this.emit({
        type: "session.permission",
        sessionId: this.options.boundarySessionId,
        request: {
          id: permissionId,
          name: request.toolCall.name ?? request.toolCall.title ?? "Tool",
          kind: "tool",
          title: request.toolCall.title ?? undefined,
          input: jsonRecord(request.toolCall.rawInput),
          actions: request.options.map((option) => ({
            id: option.optionId,
            label: option.name,
            behavior: option.kind.startsWith("allow") ? "allow" : "deny",
          })),
        },
      });
    });
  }

  private sessionUpdate(notification: SessionNotification): void {
    // The attachment has been left. Late updates belong to work the agent kept running for
    // another client and must not be rendered here.
    if (this.detached) return;
    if (notification.sessionId !== this.nativeSessionId) return;
    // A held peer update that follows the vendor turn's `started` is live, not replayed history:
    // keep it even when the caller asked to skip the loaded history.
    if (this.replayWindow === "skip" && !this.vendorTurn) return;
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
        this.activePrompt = { turnId, settled: steer.settled };
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
    this.reduceUpdate(notification.update);
  }

  private reduceUpdate(update: SessionUpdate): void {
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
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      if (update.sessionUpdate === "tool_call") this.fallbackChunkIds.clear();
      this.reduceToolCall(update);
      return;
    }
    if (update.sessionUpdate === "plan") this.fallbackChunkIds.clear();
    this.reduceStateUpdate(update);
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

  private reduceStateUpdate(update: SessionUpdate): void {
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
      this.commandWaiter?.();
      this.commandWaiter = null;
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
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
    }
  }

  private terminalizeTransientItems(state: "completed" | "failed" | "canceled"): void {
    for (const [id, snapshot] of this.toolCalls) {
      if (snapshot.status !== "pending" && snapshot.status !== "in_progress") continue;
      const completed: AcpToolCallSnapshot = {
        ...snapshot,
        status: state === "completed" ? "completed" : "failed",
      };
      this.toolCalls.set(id, completed);
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

  private reduceToolCall(update: ToolCall | ToolCallUpdate): void {
    const current = this.toolCalls.get(update.toolCallId);
    let snapshot = mergeToolCallSnapshot(update, current);
    const context = { sessionId: this.options.boundarySessionId };
    for (const transformer of this.transformers)
      snapshot = transformer.toolCall?.(snapshot, context) ?? snapshot;
    this.toolCalls.set(snapshot.id, snapshot);
    this.emit({
      type: "timeline.item",
      sessionId: this.options.boundarySessionId,
      item: toolTimelineItem(snapshot),
    });
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
    this.processFailed = true;
    this.endVendorTurn("failed", { message: "ACP transport closed" });
    if (this.nativeSessionId) {
      this.emit({
        type: "session.runtime_failed",
        sessionId: this.options.boundarySessionId,
        error: { message: "ACP transport closed unexpectedly" },
      });
    }
    this.settlePendingWork();
  }

  private emitPendingWork(pending: boolean): void {
    this.emit({ type: "session.pending_work", sessionId: this.options.boundarySessionId, pending });
  }

  private clearOutstandingSteers(): void {
    const wasPending = this.outstandingSteers.size > 0;
    this.outstandingSteers.clear();
    if (wasPending) this.emitPendingWork(false);
  }

  private settlePendingWork(): void {
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
    this.commandWaiter?.();
    this.commandWaiter = null;
  }

  private waitForInitialCommands(): Promise<void> {
    const timeoutMs = this.options.options.acpOptions?.initialCommandsTimeoutMs ?? 1_000;
    const commands = new Promise<void>((resolve) => {
      this.commandWaiter = resolve;
    });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
    return Promise.race([commands, timeout]).finally(() => {
      this.commandWaiter = null;
    });
  }
}

function routeVendorNotifications(
  stream: Stream,
  receive: (method: string, params: unknown) => Promise<void>,
  updateSlots: UpdateSlots,
  promptResponses: PromptResponseOrder,
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
                await receive(message.method, message.params);
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
  close(): Promise<void>;
} {
  const reader = source.readable.getReader();
  const writer = source.writable.getWriter();
  let closed = false;
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
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        reader.cancel(new Error("Paseo closed the ACP connector")),
        writer.close(),
      ]);
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
  return {
    model: selectedValue(model),
    mode: modes?.currentModeId,
    thinkingOption: selectedValue(thinking),
    models: selectOptions(model).map((option) => ({ id: option.value, label: option.label })),
    modes:
      modes?.availableModes.map((mode) => ({
        id: mode.id,
        label: mode.name,
        description: mode.description ?? undefined,
      })) ?? [],
    thinkingOptions: selectOptions(thinking).map((option) => ({
      id: option.value,
      label: option.label,
    })),
    settings: options
      .filter(
        (option) =>
          option !== model &&
          option.category !== "thought_level" &&
          !(modes && option.category === "mode"),
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
    options: selectOptions(option),
  };
}

function selectOptions(
  option: SessionConfigOption | undefined,
): Array<{ label: string; value: string }> {
  if (!option || option.type === "boolean") return [];
  return option.options.flatMap((candidate) =>
    "group" in candidate
      ? candidate.options.map((nested) => ({ label: nested.name, value: nested.value }))
      : [{ label: candidate.name, value: candidate.value }],
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

function toolTimelineItem(snapshot: AcpToolCallSnapshot): ToolCallTimelineItem {
  const input = jsonRecord(snapshot.input);
  const isEdit = snapshot.kind === "edit" || snapshot.name?.toLowerCase().includes("edit") === true;
  const detail = isEdit
    ? {
        type: "edit" as const,
        filePath:
          typeof input.filePath === "string" ? input.filePath : (snapshot.locations[0] ?? ""),
        oldString: typeof input.oldString === "string" ? input.oldString : undefined,
        newString: typeof input.newString === "string" ? input.newString : undefined,
        unifiedDiff: typeof input.unifiedDiff === "string" ? input.unifiedDiff : undefined,
      }
    : { type: "unknown" as const, input: snapshot.input, output: snapshot.output };
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
  if (status === "failed") return { ...base, status, error: snapshot.output };
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
