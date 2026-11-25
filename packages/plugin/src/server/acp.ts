import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type {
  ProviderCatalog,
  ProviderCommand,
  ProviderConfigState,
  ProviderError,
  ProviderMode,
  ProviderNotice,
  ProviderPersistence,
  ProviderRegistration,
  ProviderTimelineItem,
  ProviderToolCallDetail,
} from "./provider.js";
import { createAcpProviderConnection } from "./acp-internal/connection.js";

interface RunAcpProviderBaseOptions {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  acpOptions?: AcpOptions;
  transformers?: readonly AcpTransformer[];
}

export type RunAcpProviderOptions = RunAcpProviderBaseOptions &
  (
    | { command: readonly [string, ...string[]]; connector?: never }
    | { connector: AcpConnector; command?: never }
  );

export type AcpStreamMessage =
  | { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown }
  | { jsonrpc: "2.0"; method: string; params?: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string; data?: unknown };
    };

export interface AcpStream {
  writable: WritableStream<AcpStreamMessage>;
  readable: ReadableStream<AcpStreamMessage>;
}

export type AcpConnector = () => AcpStream | Promise<AcpStream>;

export interface AcpOptions {
  protocol?: "auto" | "v1";
  startupTimeoutMs?: number;
  /** Global discovery initializes ACP but returns an empty catalog without opening a session. */
  workspaceOnlyCatalog?: boolean;
  /**
   * The agent only reports turns another client started as vendor turns, never Paseo's own
   * prompts, so a vendor `started` during an active prompt is a real peer turn. With this set the
   * shim opens that turn instead of dropping it, and shows a live `user_message_chunk` while a
   * vendor turn is open instead of treating it as the prompt's echo.
   */
  vendorTurnsAreNeverForeground?: boolean;
  /**
   * For an agent that lists thinking options only for the selected model: discovery selects each
   * model in turn and records the thinking options the agent lists for it, or none.
   */
  perModelThinkingOptions?: boolean;
  waitForInitialCommands?: boolean;
  initialCommandsTimeoutMs?: number;
  /**
   * For an agent that streams history after its session/load response: publish the session
   * as ready once this long passes without a history update.
   */
  loadReplayQuietPeriodMs?: number;
  /**
   * Keep a turn open after `end_turn` while qualifying tool calls are still running,
   * settling once those tools finish and the agent finishes its follow-up reply.
   */
  deferTurnOnRunningTools?: {
    /** Delay after `usage_update` closes a follow-up reply before settling. Defaults to 500ms. */
    settleDelayMs?: number;
    /** Quiet limit after qualifying tools finish if no reply settles via `usage_update`. Defaults to 120_000ms. */
    quietLimitMs?: number;
    /** Predicate deciding whether an open tool call keeps the turn open. Defaults to all running tools. */
    keepsTurnOpen?: (toolCall: AcpToolCallSnapshot) => boolean;
  };
  /** An unattended mode that approves ACP allow-once requests in the specified native mode. */
  autoAcceptMode?: {
    mode: Omit<ProviderMode, "isUnattended">;
    nativeMode: string;
    default?: boolean;
  };
}

export interface AcpContext {
  sessionId: string;
  agentCapabilities?: JsonValue;
}

export interface AcpConnectionPolicy {
  /** False when the negotiated profile never echoes this attachment's submitted text. */
  echoesUserMessages?: boolean;
  sendSessionMcpServers?: boolean;
  steering?: boolean;
  /** Successful prompt responses carry a shared turn id and role under `_meta.jcode`. */
  turnCorrelation?: boolean;
  /** Prompts accept an explicit attachment-local skill selection. */
  skillSelection?: boolean;
}

export interface AcpSessionPolicy {
  steering?: boolean;
  stopObservedTurns?: boolean;
  /** `_jcode/detach` is available on this attachment. */
  detach?: boolean;
}

/** Prompt state a transformer needs in order to add vendor metadata. */
export interface AcpPromptInfo {
  /** `undefined` leaves the selection alone, a name selects, `null` clears. */
  skill?: string | null;
}

export interface AcpPromptMetadata {
  _meta: Record<string, JsonValue>;
}

export interface AcpPolicyContext extends AcpContext {
  policy: AcpConnectionPolicy;
}

export interface AcpConfigAccess {
  read(): Promise<Readonly<Record<string, JsonValue>>>;
  set(id: string, value: JsonValue): Promise<void>;
}

/** Sends an ACP extension request to the agent. Rejects with the agent's JSON-RPC error. */
export type AcpRequest = (method: string, params: JsonValue) => Promise<JsonValue>;

export interface AcpDiscoveryContext extends AcpContext {
  config: AcpConfigAccess;
  request: AcpRequest;
}

export interface AcpConfigureContext extends AcpContext {
  config: AcpConfigAccess;
  request: AcpRequest;
  catalog(): ProviderCatalog;
  apply(change: AcpConfigChange): Promise<void>;
}

export type AcpConfigChange =
  | { target: "model"; value: string | null }
  | { target: "mode"; value: string | null }
  | { target: "thinking"; value: string | null }
  | { target: "setting"; id: string; value: JsonValue };

export interface AcpToolCallSnapshot {
  id: string;
  name?: string;
  title: string;
  kind?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  /** The call's ACP `rawInput`. */
  input: JsonValue;
  /** The call's ACP `rawOutput`. */
  output: JsonValue;
  /** The call's ACP `content` blocks. An update that sends `content` replaces them. */
  content?: JsonValue;
  locations: readonly string[];
  /** The row Paseo shows. Without it, Paseo builds the standard row for the call's ACP `kind`. */
  detail?: ProviderToolCallDetail;
}

export type AcpVendorUpdate =
  | { type: "commands"; commands: readonly ProviderCommand[] }
  | { type: "config"; config: ProviderConfigState }
  | { type: "timeline"; item: ProviderTimelineItem }
  | { type: "notice"; notice: ProviderNotice }
  | {
      type: "turn";
      /** Agent-scoped id; the shim namespaces it. */
      turnId: string;
      state: "started" | "completed" | "failed" | "canceled";
      error?: ProviderError;
    };

export interface AcpTransformer {
  initialize?(info: { agentCapabilities: JsonValue }): AcpConnectionPolicy | null;
  attach?(info: { response: JsonValue }, context: AcpContext): AcpSessionPolicy | null;
  /** Vendor metadata for a prompt. The shim sends it as `_meta` on `session/prompt`. */
  prompt?(info: AcpPromptInfo, context: AcpPolicyContext): AcpPromptMetadata | null;
  /** Decode an older saved session and supply extension metadata for session/new or session/load. */
  sessionOpen?(context: {
    persistence?: ProviderPersistence;
    systemPrompt?: string;
    agentMetadata: JsonValue;
  }): { sessionId?: string; metadata?: Readonly<Record<string, JsonValue>> };

  discover?(
    catalog: ProviderCatalog,
    context: AcpDiscoveryContext,
  ): Promise<ProviderCatalog> | ProviderCatalog;
  configure?(change: AcpConfigChange, context: AcpConfigureContext): Promise<"handled" | "pass">;
  /** Rewrites every session config snapshot before Paseo sees it. */
  config?(state: ProviderConfigState, context: AcpContext): ProviderConfigState;
  /**
   * Rewrites each advertised ACP slash command before Paseo sees it. The connection policy lets a
   * transformer classify skills only when the agent negotiated explicit skill selection.
   */
  command?(command: ProviderCommand, context: AcpPolicyContext): ProviderCommand;
  notification?(
    notification: { method: string; params: JsonValue },
    context: AcpContext,
  ): AcpVendorUpdate | readonly AcpVendorUpdate[] | null;
  /** Rewrites each update of a tool call, merged with the call's earlier updates. */
  toolCall?(
    toolCall: AcpToolCallSnapshot,
    context: AcpContext & {
      mcpServerNames?: readonly string[];
      /** The call as Paseo last presented it, after every transformer. Absent on its first update. */
      previous?: AcpToolCallSnapshot;
    },
  ): AcpToolCallSnapshot;
}

export function runAcpProvider(options: RunAcpProviderOptions): ProviderRegistration {
  const hasCommand = options.command !== undefined;
  const hasConnector = options.connector !== undefined;
  if (hasCommand === hasConnector) {
    throw new Error("ACP provider requires exactly one command or SDK connector");
  }
  if (options.command && (options.command.length === 0 || options.command[0].trim().length === 0)) {
    throw new Error("ACP provider command must contain an executable");
  }
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    icon: options.icon,
    command: options.command,
    // session/load reports the loaded session's configOptions.
    restoresSessionConfig: true,
    connect(request) {
      return createAcpProviderConnection(options, request);
    },
  };
}
