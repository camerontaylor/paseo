import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type {
  ProviderCatalog,
  ProviderCommand,
  ProviderConfigState,
  ProviderError,
  ProviderNotice,
  ProviderRegistration,
  ProviderTimelineItem,
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
  waitForInitialCommands?: boolean;
  initialCommandsTimeoutMs?: number;
}

export interface AcpContext {
  sessionId: string;
  agentCapabilities?: JsonValue;
}

export interface AcpConnectionPolicy {
  sendSessionMcpServers?: boolean;
  steering?: boolean;
}

export interface AcpSessionPolicy {
  steering?: boolean;
  stopObservedTurns?: boolean;
}

export interface AcpConfigAccess {
  read(): Promise<Readonly<Record<string, JsonValue>>>;
  set(id: string, value: JsonValue): Promise<void>;
}

export interface AcpDiscoveryContext extends AcpContext {
  config: AcpConfigAccess;
}

export interface AcpConfigureContext extends AcpContext {
  config: AcpConfigAccess;
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
  input: JsonValue;
  output: JsonValue;
  locations: readonly string[];
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
  discover?(
    catalog: ProviderCatalog,
    context: AcpDiscoveryContext,
  ): Promise<ProviderCatalog> | ProviderCatalog;
  configure?(change: AcpConfigChange, context: AcpConfigureContext): Promise<"handled" | "pass">;
  notification?(
    notification: { method: string; params: JsonValue },
    context: AcpContext,
  ): AcpVendorUpdate | readonly AcpVendorUpdate[] | null;
  toolCall?(toolCall: AcpToolCallSnapshot, context: AcpContext): AcpToolCallSnapshot;
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
    connect(request) {
      return createAcpProviderConnection(options, request);
    },
  };
}
