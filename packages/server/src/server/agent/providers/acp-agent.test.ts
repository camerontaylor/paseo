import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AgentSideConnection,
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

import {
  ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS,
  ACPAgentClient,
  ACPAgentSession,
  type ACPAdmissionState,
  type ACPStopKind,
  type SpawnedACPProcess,
  type SessionStateResponse,
  buildACPClientCapabilities,
  createLoggedNdJsonStream,
  deriveModelDefinitionsFromACP,
  deriveModesFromACP,
  mapACPUsage,
  resolveACPModeSelection,
  resolveACPModelSelection,
  summarizeACPRequestError,
} from "./acp-agent.js";
import type { ProcessTerminator, TreeKillTarget } from "../../../utils/tree-kill.js";
import {
  COPILOT_AGENT_FEATURE_OPTION,
  COPILOT_ALLOW_ALL_MODE_ID,
  COPILOT_MODES,
  CopilotACPAgentClient,
  beforeCopilotModeWriter,
  transformCopilotConfigOptions,
  transformCopilotModeId,
  transformCopilotSessionResponse,
  writeCopilotProviderMode,
} from "./copilot-acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
import { parseKiroExtensionCommands } from "./kiro-acp-agent.js";
import { transformPiModels } from "./pi/agent.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
import type { AgentCapabilityFlags, AgentPersistenceHandle } from "../agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { Logger } from "pino";
import { buildStringCommandShellInvocation } from "../../../utils/string-command-shell.js";
import { asInternals } from "../../test-utils/class-mocks.js";
import * as spawnUtils from "../../../utils/spawn.js";

describe("buildACPClientCapabilities", () => {
  test("enables terminal execution on the host while keeping filesystem operations with the agent by default", () => {
    expect(buildACPClientCapabilities()).toEqual({
      fs: {
        readTextFile: false,
        writeTextFile: false,
      },
      terminal: true,
    });
  });

  test("applies provider capability overrides without dropping metadata", () => {
    expect(
      buildACPClientCapabilities(
        { source: "provider" },
        {
          fs: {
            readTextFile: true,
          },
          terminal: false,
        },
      ),
    ).toEqual({
      fs: {
        readTextFile: true,
        writeTextFile: false,
      },
      terminal: false,
      _meta: { source: "provider" },
    });
  });
});

interface ACPSessionInternals {
  sessionId: string | null;
  connection: { prompt: (...args: unknown[]) => Promise<PromptResponse> };
  activeForegroundTurnId: string | null;
  configOptions: SessionConfigOption[];
  translateSessionUpdate(update: SessionUpdate): AgentStreamEvent[];
  acpMcpServers(): unknown[];
}

interface ACPModelSelectionInternals {
  sessionId: string | null;
  connection: {
    setSessionConfigOption: (input: {
      sessionId: string;
      configId: string;
      value: string;
    }) => Promise<unknown>;
  };
  configOptions: SessionConfigOption[];
}

interface ACPConfiguredOverrideInternals {
  sessionId: string | null;
  connection: {
    setSessionMode: (input: { sessionId: string; modeId: string }) => Promise<void>;
    setSessionConfigOption: (input: {
      sessionId: string;
      configId: string;
      value: string;
    }) => Promise<unknown>;
    unstable_setSessionModel?: (input: { sessionId: string; modelId: string }) => Promise<void>;
  };
  configOptions: SessionConfigOption[];
  availableModes: Array<{ id: string; label: string; description?: string }>;
  availableModels: Array<{ modelId: string; name: string; description?: string | null }> | null;
  currentMode: string | null;
  currentModel: string | null;
  applyConfiguredOverrides(): Promise<void>;
}

function createSession(terminateProcess?: ProcessTerminator): ACPAgentSession {
  return new ACPAgentSession(
    {
      provider: "claude-acp",
      cwd: "/tmp/paseo-acp-test",
    },
    {
      provider: "claude-acp",
      logger: createTestLogger(),
      defaultCommand: ["claude", "--acp"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      ...(terminateProcess ? { terminateProcess } : {}),
    },
  );
}

// Typed substitute for the real tree-kill terminator. Records which child
// processes it was asked to terminate, so tests assert on observable state
// instead of spying on the production function. In "deferred" mode the
// terminations hang until releaseAll(), letting tests observe parallelism.
class FakeTerminator {
  readonly terminated: TreeKillTarget[] = [];
  private readonly pending: Array<() => void> = [];

  constructor(private readonly mode: "immediate" | "deferred" = "immediate") {}

  readonly terminate: ProcessTerminator = async (child) => {
    this.terminated.push(child);
    if (this.mode === "deferred") {
      await new Promise<void>((resolve) => this.pending.push(resolve));
    }
    return "terminated";
  };

  releaseAll(): void {
    for (const resolve of this.pending.splice(0)) {
      resolve();
    }
  }
}

function createSessionWithConfig(
  config: {
    provider?: string;
    modeId?: string | null;
    model?: string | null;
    featureValues?: Record<string, unknown>;
  } = {},
  logger: ReturnType<typeof createTestLogger> = createTestLogger(),
): ACPAgentSession {
  return new ACPAgentSession(
    {
      provider: config.provider ?? "claude-acp",
      cwd: "/tmp/paseo-acp-test",
      modeId: config.modeId ?? undefined,
      model: config.model ?? undefined,
      featureValues: config.featureValues,
    },
    {
      provider: config.provider ?? "claude-acp",
      logger,
      defaultCommand: ["claude", "--acp"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
    },
  );
}

function createKiroSession(
  options: { waitForInitialCommands?: boolean; initialCommandsWaitTimeoutMs?: number } = {},
  logger: ReturnType<typeof createTestLogger> = createTestLogger(),
): ACPAgentSession {
  return new ACPAgentSession(
    {
      provider: "kiro",
      cwd: "/tmp/paseo-acp-test",
    },
    {
      provider: "kiro",
      logger,
      defaultCommand: ["kiro-cli", "acp"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      extensionCommandsParser: parseKiroExtensionCommands,
      waitForInitialCommands: options.waitForInitialCommands ?? false,
      initialCommandsWaitTimeoutMs: options.initialCommandsWaitTimeoutMs,
    },
  );
}

function createTerminalChildStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new EventEmitter() as ChildProcess["stdout"];
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  child.kill = vi.fn(() => true) as ChildProcess["kill"];
  return child;
}

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

function selectConfigOption(
  category: "mode" | "model" | "thought_level",
  values: string[],
  currentValue = values[0] ?? "",
): SessionConfigOption {
  return {
    id: `${category}-option`,
    name: selectConfigOptionName(category),
    category,
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

function createCopilotSessionWithConfig(
  modeId?: string | null,
  featureValues?: Record<string, unknown>,
): ACPAgentSession {
  return new ACPAgentSession(
    {
      provider: "copilot",
      cwd: "/tmp/paseo-acp-test",
      modeId: modeId ?? undefined,
      ...(featureValues ? { featureValues } : {}),
    },
    {
      provider: "copilot",
      logger: createTestLogger(),
      defaultCommand: ["copilot", "--acp"],
      defaultModes: COPILOT_MODES,
      sessionResponseTransformer: transformCopilotSessionResponse,
      configOptionsTransformer: transformCopilotConfigOptions,
      configFeatureOptions: [COPILOT_AGENT_FEATURE_OPTION],
      modeIdTransformer: transformCopilotModeId,
      providerModeWriter: writeCopilotProviderMode,
      beforeModeWriter: beforeCopilotModeWriter,
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
    },
  );
}

function copilotModeConfigOption(currentValue: string): SessionConfigOption {
  return {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue,
    options: [
      {
        value: "https://agentclientprotocol.com/protocol/session-modes#agent",
        name: "Agent",
      },
      {
        value: "https://agentclientprotocol.com/protocol/session-modes#plan",
        name: "Plan",
      },
      {
        value: "https://agentclientprotocol.com/protocol/session-modes#autopilot",
        name: "Autopilot",
      },
    ],
  };
}

function copilotAllowAllConfigOption(currentValue: "on" | "off"): SessionConfigOption {
  return {
    id: "allow_all",
    name: "Allow All",
    category: "permissions",
    type: "select",
    currentValue,
    options: [
      { value: "on", name: "On" },
      { value: "off", name: "Off" },
    ],
  };
}

function copilotAgentConfigOption(currentValue: string): SessionConfigOption {
  return {
    id: "agent",
    name: "Agent",
    category: "_agent",
    type: "select",
    currentValue,
    options: [
      {
        value: "",
        name: "",
      },
      {
        value: "Probe Agent",
        name: "Probe Agent",
        description: "Temporary probe agent",
      },
    ],
  };
}

function selectConfigOptionName(category: "mode" | "model" | "thought_level"): string {
  if (category === "mode") {
    return "Mode";
  }
  if (category === "model") {
    return "Model";
  }
  return "Thinking";
}

function prepareConfiguredOverrideSession(
  session: ACPAgentSession,
  options: {
    currentMode?: string | null;
    availableModes?: Array<{ id: string; label: string; description?: string }>;
    currentModel?: string | null;
    availableModels?: Array<{ modelId: string; name: string; description?: string | null }> | null;
    configOptions?: SessionConfigOption[];
    connection?: Partial<ACPConfiguredOverrideInternals["connection"]>;
  } = {},
): {
  internals: ACPConfiguredOverrideInternals;
  setSessionMode: ReturnType<typeof vi.fn>;
  unstableSetSessionModel: ReturnType<typeof vi.fn>;
  setSessionConfigOption: ReturnType<typeof vi.fn>;
} {
  const setSessionMode = vi.fn(async () => undefined);
  const unstableSetSessionModel = vi.fn(async () => undefined);
  const setSessionConfigOption = vi.fn(async () => ({
    configOptions: options.configOptions ?? [],
  }));
  const internals = asInternals<ACPConfiguredOverrideInternals>(session);
  internals.sessionId = "session-1";
  internals.connection = {
    setSessionMode,
    setSessionConfigOption,
    unstable_setSessionModel: unstableSetSessionModel,
    ...options.connection,
  };
  internals.availableModes = options.availableModes ?? [];
  internals.availableModels = options.availableModels ?? null;
  internals.configOptions = options.configOptions ?? [];
  internals.currentMode = options.currentMode ?? null;
  internals.currentModel = options.currentModel ?? null;

  return { internals, setSessionMode, unstableSetSessionModel, setSessionConfigOption };
}

test("ACP setModel only uses config-option fallback when the matching select choice contains the model", async () => {
  const logger = createTestLogger();
  const childLogger = { trace: vi.fn(), warn: vi.fn() };
  vi.spyOn(logger, "child").mockReturnValue(asInternals<typeof logger>(childLogger));
  const session = createSessionWithConfig({}, logger);
  const setSessionConfigOption = vi.fn(async () => ({
    configOptions: [
      {
        id: "model-option",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "sonnet",
        options: [{ value: "sonnet", name: "Sonnet" }],
      },
    ],
  }));
  const internals = asInternals<ACPModelSelectionInternals>(session);
  internals.sessionId = "session-1";
  internals.connection = { setSessionConfigOption };
  internals.configOptions = [
    {
      id: "model-option",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "sonnet",
      options: [{ value: "sonnet", name: "Sonnet" }],
    },
  ];

  await session.setModel("sonnet");

  expect(setSessionConfigOption).toHaveBeenCalledWith({
    sessionId: "session-1",
    configId: "model-option",
    value: "sonnet",
  });

  setSessionConfigOption.mockClear();

  await expect(session.setModel("new-provider-model")).resolves.toBeUndefined();
  expect(childLogger.warn).toHaveBeenCalledWith(
    { value: "new-provider-model" },
    expect.stringContaining("is not a valid claude-acp model config option"),
  );
  expect(setSessionConfigOption).not.toHaveBeenCalled();
});

describe("createLoggedNdJsonStream", () => {
  test("routes malformed ACP stdout through the provider logger instead of console.error", async () => {
    const input = new TransformStream<Uint8Array, Uint8Array>();
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const logger = {
      warn: vi.fn(),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const stream = createLoggedNdJsonStream(output.writable, input.readable, {
      logger: asInternals<ReturnType<typeof createTestLogger>>(logger),
      provider: "gemini",
    });
    const reader = stream.readable.getReader();
    const writer = input.writable.getWriter();

    await writer.write(
      new TextEncoder().encode(
        'Please visit the following URL to authorize the application:\n{"jsonrpc":"2.0","method":"ok","params":{}}\n',
      ),
    );

    const parsed = await reader.read();

    expect(parsed.value).toEqual({ jsonrpc: "2.0", method: "ok", params: {} });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: {
          type: "SyntaxError",
          message: "ACP stdout line was not valid JSON",
        },
        provider: "gemini",
      }),
      "ACP agent emitted non-JSON stdout; ignoring line",
    );
    expect(logger.warn.mock.calls[0]?.[0]).not.toHaveProperty("linePreview");
    expect(consoleError).not.toHaveBeenCalled();

    await writer.close();
    reader.releaseLock();
    consoleError.mockRestore();
  });

  test("normalizes stringified numeric ACP response ids", async () => {
    const input = new TransformStream<Uint8Array, Uint8Array>();
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const logger = {
      warn: vi.fn(),
    };

    const stream = createLoggedNdJsonStream(output.writable, input.readable, {
      logger: asInternals<ReturnType<typeof createTestLogger>>(logger),
      provider: "deepseek-tui",
    });
    const reader = stream.readable.getReader();
    const writer = input.writable.getWriter();

    await writer.write(
      new TextEncoder().encode('{"jsonrpc":"2.0","id":"0","result":{"ok":true}}\n'),
    );

    const parsed = await reader.read();

    expect(parsed.value).toEqual({ jsonrpc: "2.0", id: 0, result: { ok: true } });
    expect(logger.warn).not.toHaveBeenCalled();

    await writer.close();
    reader.releaseLock();
  });

  test("does not log terminal control sequences from malformed ACP stdout", async () => {
    const input = new TransformStream<Uint8Array, Uint8Array>();
    const output = new TransformStream<Uint8Array, Uint8Array>();
    const logger = {
      warn: vi.fn(),
    };

    const stream = createLoggedNdJsonStream(output.writable, input.readable, {
      logger: asInternals<ReturnType<typeof createTestLogger>>(logger),
      provider: "gemini",
    });
    const reader = stream.readable.getReader();
    const writer = input.writable.getWriter();

    await writer.write(new TextEncoder().encode('\u001b[1G\u001b[0JEn\n{"ok":true}\n'));

    const parsed = await reader.read();

    expect(parsed.value).toEqual({ ok: true });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("\u001b");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("[1G");
    expect(logger.warn.mock.calls[0]?.[0]).toEqual({
      err: {
        type: "SyntaxError",
        message: "ACP stdout line was not valid JSON",
      },
      provider: "gemini",
    });

    await writer.close();
    reader.releaseLock();
  });
});

describe("ACPAgentSession terminal tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("runs single-string terminal commands through the platform shell", async () => {
    const child = createTerminalChildStub();
    const spawn = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const session = createSession();
    const shell = buildStringCommandShellInvocation({
      command: "git -C /repo status --short",
      windowsShell: "cmd",
    });

    await session.createTerminal({
      sessionId: "session-1",
      command: "git -C /repo status --short",
      cwd: "/repo",
    });

    expect(spawn).toHaveBeenCalledWith(
      shell.shell,
      shell.args,
      expect.objectContaining({
        cwd: "/repo",
        envOverlay: expect.objectContaining({ BASH_ENV: undefined }),
        shell: false,
      }),
    );
  });

  test("preserves cmd semantics for single-string terminal commands on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      const child = createTerminalChildStub();
      const spawn = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
      const session = createSession();

      await session.createTerminal({
        sessionId: "session-1",
        command: "echo %TEMP% && echo ok",
        cwd: "C:\\repo",
      });

      expect(spawn).toHaveBeenCalledWith(
        "cmd.exe",
        ["/c", "echo %TEMP% && echo ok"],
        expect.objectContaining({
          cwd: "C:\\repo",
          envOverlay: expect.objectContaining({ BASH_ENV: undefined }),
          shell: false,
        }),
      );
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  test("preserves explicit terminal argv", async () => {
    const child = createTerminalChildStub();
    const spawn = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const session = createSession();

    await session.createTerminal({
      sessionId: "session-1",
      command: "git",
      args: ["status", "--short"],
      cwd: "/repo",
    });

    expect(spawn).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  test("surfaces spawn errors through terminal output and waitForTerminalExit", async () => {
    const child = createTerminalChildStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const session = createSession();

    const terminal = await session.createTerminal({
      sessionId: "session-1",
      command: "missing-command",
    });
    child.emit("error", new Error("spawn missing-command ENOENT"));

    await expect(
      session.waitForTerminalExit({
        sessionId: "session-1",
        terminalId: terminal.terminalId,
      }),
    ).rejects.toThrow("spawn missing-command ENOENT");
    await expect(
      session.terminalOutput({
        sessionId: "session-1",
        terminalId: terminal.terminalId,
      }),
    ).resolves.toMatchObject({
      output: "spawn missing-command ENOENT\n",
      truncated: false,
    });
  });
});

describe("mapACPUsage", () => {
  test("maps ACP usage fields into Paseo usage", () => {
    expect(
      mapACPUsage({
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        cachedReadTokens: 5,
      }),
    ).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 5,
    });
  });
});

describe("deriveModesFromACP", () => {
  test("prefers explicit ACP mode state", () => {
    const result = deriveModesFromACP(
      [{ id: "fallback", label: "Fallback" }],
      {
        availableModes: [
          { id: "default", name: "Always Ask", description: "Prompt before tools" },
          { id: "plan", name: "Plan", description: "Read only" },
        ],
        currentModeId: "plan",
      },
      [],
    );

    expect(result).toEqual({
      modes: [
        { id: "default", label: "Always Ask", description: "Prompt before tools" },
        { id: "plan", label: "Plan", description: "Read only" },
      ],
      currentModeId: "plan",
    });
  });

  test("falls back to config options when explicit mode state is absent", () => {
    const result = deriveModesFromACP([{ id: "fallback", label: "Fallback" }], null, [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: "acceptEdits",
        options: [
          { value: "default", name: "Always Ask" },
          { value: "acceptEdits", name: "Accept File Edits" },
        ],
      },
    ]);

    expect(result).toEqual({
      modes: [
        { id: "default", label: "Always Ask", description: undefined },
        { id: "acceptEdits", label: "Accept File Edits", description: undefined },
      ],
      currentModeId: "acceptEdits",
    });
  });

  test("returns an empty mode list when fallback modes are empty and config only exposes thought levels", () => {
    const result = deriveModesFromACP([], null, [
      {
        id: "thought_level",
        name: "Thinking",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      },
    ]);

    expect(result).toEqual({
      modes: [],
      currentModeId: null,
    });
  });
});

describe("ACP selection validity helpers", () => {
  test("classifies advertised ACP modes and select config option choices", () => {
    const result = resolveACPModeSelection({
      modeId: "plan",
      availableModes: [
        { id: "default", label: "Always Ask" },
        { id: "plan", label: "Plan" },
      ],
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Always Ask" }],
        },
      ],
    });

    expect(result).toMatchObject({
      availableMode: { id: "plan", label: "Plan" },
      configChoice: null,
      hasAvailableModes: true,
    });
    expect(result.configOption?.id).toBe("mode");
  });

  test("classifies model select config option choices separately from advertised models", () => {
    const result = resolveACPModelSelection({
      modelId: "opus",
      availableModels: [{ modelId: "sonnet", name: "Sonnet", description: null }],
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "sonnet",
          options: [
            {
              group: "Anthropic",
              options: [{ value: "opus", name: "Opus", description: "Deep" }],
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      availableModel: null,
      configChoice: {
        value: "opus",
        name: "Opus",
        description: "Deep",
        group: "Anthropic",
      },
      hasAvailableModels: true,
    });
    expect(result.configOption?.id).toBe("model");
  });
});

describe("ACPAgentSession Zed parity", () => {
  test("applies valid stored mode/model values, routes current_mode_update, and skips invalid Cursor-style stored values with warnings", async () => {
    const validSession = createSessionWithConfig({ modeId: "plan", model: "sonnet" });
    const valid = prepareConfiguredOverrideSession(validSession, {
      currentMode: "default",
      availableModes: [
        { id: "default", label: "Always Ask" },
        { id: "plan", label: "Plan" },
      ],
      currentModel: "haiku",
      availableModels: [
        { modelId: "haiku", name: "Haiku", description: null },
        { modelId: "sonnet", name: "Sonnet", description: null },
      ],
    });

    await valid.internals.applyConfiguredOverrides();
    expect(valid.setSessionMode).toHaveBeenCalledWith({ sessionId: "session-1", modeId: "plan" });
    expect(valid.unstableSetSessionModel).toHaveBeenCalledWith({
      sessionId: "session-1",
      modelId: "sonnet",
    });

    const modeEvents = asInternals<ACPSessionInternals>(validSession).translateSessionUpdate({
      sessionUpdate: "current_mode_update",
      currentModeId: "default",
    });
    expect(modeEvents).toEqual([
      {
        type: "mode_changed",
        provider: "claude-acp",
        currentModeId: "default",
        availableModes: [
          { id: "default", label: "Always Ask" },
          { id: "plan", label: "Plan" },
        ],
      },
    ]);
    expect(await validSession.getCurrentMode()).toBe("default");

    const logger = createTestLogger();
    const childLogger = { trace: vi.fn(), warn: vi.fn() };
    vi.spyOn(logger, "child").mockReturnValue(asInternals<typeof logger>(childLogger));
    const invalidSession = createSessionWithConfig(
      { modeId: "acceptEdits", model: "opus" },
      logger,
    );
    const invalid = prepareConfiguredOverrideSession(invalidSession, {
      currentMode: "default",
      availableModes: [
        { id: "default", label: "Always Ask" },
        { id: "plan", label: "Plan" },
      ],
      currentModel: "sonnet",
      availableModels: [{ modelId: "sonnet", name: "Sonnet", description: null }],
    });

    await expect(invalid.internals.applyConfiguredOverrides()).resolves.toBeUndefined();
    expect(invalid.setSessionMode).not.toHaveBeenCalled();
    expect(invalid.unstableSetSessionModel).not.toHaveBeenCalled();
    expect(childLogger.warn).toHaveBeenCalledWith(
      { value: expect.stringContaining("acceptEdits") },
      expect.stringContaining("not valid"),
    );
    expect(childLogger.warn).toHaveBeenCalledWith(
      { value: expect.stringContaining("opus") },
      expect.stringContaining("not a valid"),
    );
  });

  test("does not use config-option fallback when Cursor-style availableModes omit the stored mode", async () => {
    const session = createSessionWithConfig({ modeId: "acceptEdits" });
    const { internals, setSessionConfigOption } = prepareConfiguredOverrideSession(session, {
      currentMode: "default",
      availableModes: [
        { id: "default", label: "Always Ask" },
        { id: "plan", label: "Plan" },
      ],
      configOptions: [selectConfigOption("mode", ["default", "acceptEdits"], "default")],
      connection: { unstable_setSessionModel: undefined },
    });

    await expect(internals.applyConfiguredOverrides()).resolves.toBeUndefined();
    expect(setSessionConfigOption).not.toHaveBeenCalled();
  });

  test("does not fail session start when configured model cannot be applied by ACP", async () => {
    const logger = createTestLogger();
    const childLogger = { trace: vi.fn(), warn: vi.fn() };
    vi.spyOn(logger, "child").mockReturnValue(asInternals<typeof logger>(childLogger));
    const session = createSessionWithConfig(
      { provider: "deepseek-tui", model: "deepseek/v4" },
      logger,
    );
    const { internals, setSessionConfigOption, unstableSetSessionModel } =
      prepareConfiguredOverrideSession(session, {
        currentModel: null,
        availableModels: null,
        configOptions: [],
        connection: { unstable_setSessionModel: undefined },
      });

    await expect(internals.applyConfiguredOverrides()).resolves.toBeUndefined();
    expect(unstableSetSessionModel).not.toHaveBeenCalled();
    expect(setSessionConfigOption).not.toHaveBeenCalled();
    expect(childLogger.warn).toHaveBeenCalledWith(
      { value: "deepseek/v4" },
      "deepseek-tui does not expose ACP model selection; using provider default model",
    );
  });

  test("routes config_option_update and refreshes derived mode, model, and thinking state", async () => {
    const session = createSession();
    const internals = asInternals<ACPSessionInternals>(session);

    const events = internals.translateSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [
        selectConfigOption("mode", ["default", "plan"], "plan"),
        selectConfigOption("model", ["sonnet", "opus"], "opus"),
        selectConfigOption("thought_level", ["low", "high"], "high"),
      ],
    });

    expect(events).toMatchObject([
      {
        type: "mode_changed",
        provider: "claude-acp",
        currentModeId: "plan",
        availableModes: [
          { id: "default", label: "default" },
          { id: "plan", label: "plan" },
        ],
      },
      {
        type: "model_changed",
        provider: "claude-acp",
        runtimeInfo: expect.objectContaining({
          model: "opus",
          thinkingOptionId: "high",
          modeId: "plan",
        }),
      },
      {
        type: "thinking_option_changed",
        provider: "claude-acp",
        thinkingOptionId: "high",
      },
    ]);
    expect(internals.configOptions).toEqual([
      selectConfigOption("mode", ["default", "plan"], "plan"),
      selectConfigOption("model", ["sonnet", "opus"], "opus"),
      selectConfigOption("thought_level", ["low", "high"], "high"),
    ]);
    expect(await session.getAvailableModes()).toEqual([
      { id: "default", label: "default" },
      { id: "plan", label: "plan" },
    ]);
    expect(await session.getCurrentMode()).toBe("plan");
    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      model: "opus",
      thinkingOptionId: "high",
      modeId: "plan",
    });
  });

  test("keeps pushed mode when a later config_option_update has no mode payload", async () => {
    const session = createSession();
    const internals = asInternals<ACPSessionInternals>(session);

    internals.translateSessionUpdate({
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
    const events = internals.translateSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [selectConfigOption("model", ["sonnet"], "sonnet")],
    });

    expect(events.map((event) => event.type)).toEqual(["model_changed"]);
    expect(await session.getCurrentMode()).toBe("plan");
    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      model: "sonnet",
      modeId: "plan",
    });
  });

  test("uses last writer when current_mode_update and config_option_update both include a mode", async () => {
    const session = createSession();
    const internals = asInternals<ACPSessionInternals>(session);

    const configEvents = internals.translateSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [selectConfigOption("mode", ["default", "plan"], "plan")],
    });
    const modeEvents = internals.translateSessionUpdate({
      sessionUpdate: "current_mode_update",
      currentModeId: "default",
    });

    expect(configEvents).toMatchObject([{ type: "mode_changed", currentModeId: "plan" }]);
    expect(modeEvents).toMatchObject([{ type: "mode_changed", currentModeId: "default" }]);
    expect(await session.getCurrentMode()).toBe("default");
  });

  test("uses canonical mode returned by setSessionConfigOption response", async () => {
    const session = createSession();
    const internals = asInternals<ACPModelSelectionInternals>(session);
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    internals.sessionId = "session-1";
    internals.configOptions = [selectConfigOption("mode", ["ask", "default"], "ask")];
    internals.connection = {
      setSessionConfigOption: vi.fn(async () => ({
        configOptions: [selectConfigOption("mode", ["ask", "default"], "default")],
      })),
    };

    await session.setMode("ask");
    unsubscribe();

    expect(await session.getCurrentMode()).toBe("default");
    expect(events).toMatchObject([
      {
        type: "mode_changed",
        provider: "claude-acp",
        currentModeId: "default",
        availableModes: [
          { id: "ask", label: "ask" },
          { id: "default", label: "default" },
        ],
      },
    ]);
  });

  test("uses canonical model returned by setSessionConfigOption response", async () => {
    const session = createSession();
    const internals = asInternals<ACPModelSelectionInternals>(session);
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    internals.sessionId = "session-1";
    internals.configOptions = [selectConfigOption("model", ["claude-sonnet", "sonnet"], "sonnet")];
    internals.connection = {
      setSessionConfigOption: vi.fn(async () => ({
        configOptions: [selectConfigOption("model", ["claude-sonnet", "sonnet"], "sonnet")],
      })),
    };

    await session.setModel("claude-sonnet");
    unsubscribe();

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({ model: "sonnet" });
    expect(events).toContainEqual({
      type: "model_changed",
      provider: "claude-acp",
      runtimeInfo: expect.objectContaining({ model: "sonnet" }),
    });
  });

  test("uses canonical thinking option returned by setSessionConfigOption response", async () => {
    const session = createSession();
    const internals = asInternals<ACPModelSelectionInternals>(session);
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    internals.sessionId = "session-1";
    internals.configOptions = [
      selectConfigOption("thought_level", ["think-hard", "high"], "think-hard"),
    ];
    internals.connection = {
      setSessionConfigOption: vi.fn(async () => ({
        configOptions: [selectConfigOption("thought_level", ["think-hard", "high"], "high")],
      })),
    };

    await session.setThinkingOption("think-hard");
    unsubscribe();

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({ thinkingOptionId: "high" });
    expect(events).toContainEqual({
      type: "thinking_option_changed",
      provider: "claude-acp",
      thinkingOptionId: "high",
    });
  });

  test("passes generic ACP permission requests through to the user", async () => {
    const session = createSessionWithConfig({
      provider: "cursor-acp",
      modeId: "https://agentclientprotocol.com/protocol/session-modes#agent",
    });
    const events: AgentStreamEvent[] = [];
    const permissionOptions: PermissionOption[] = [
      { optionId: "allow-once", name: "Allow", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ];

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => {
      events.push(event);
    });

    const permission = session.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Edit file",
        kind: "edit",
        status: "pending",
      },
      options: permissionOptions,
    } satisfies RequestPermissionRequest);

    await Promise.resolve();

    const requested = events.find((event) => event.type === "permission_requested");
    expect(requested).toMatchObject({
      type: "permission_requested",
      request: {
        actions: [
          { id: "allow-once", label: "Allow", behavior: "allow" },
          { id: "reject-once", label: "Reject", behavior: "deny" },
        ],
      },
    });
    if (requested?.type !== "permission_requested") {
      throw new Error("Expected permission request");
    }

    await session.respondToPermission(requested.request.id, { behavior: "allow" });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  test("preserves ACP chooser actions and returns the selected option", async () => {
    const session = createSessionWithConfig({
      provider: "kimi-acp",
      modeId: "https://agentclientprotocol.com/protocol/session-modes#agent",
    });
    const events: AgentStreamEvent[] = [];

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => events.push(event));

    const permission = session.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "question-1",
        title: "AskUserQuestion",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Which path should Paseo take?",
            },
          },
        ],
      },
      options: [
        { optionId: "q0_opt_0", name: "Narrow fix", kind: "allow_once" },
        { optionId: "q0_opt_1", name: "Protocol fix", kind: "allow_once" },
        { optionId: "q0_skip", name: "Skip", kind: "reject_once" },
      ],
    } satisfies RequestPermissionRequest);

    await Promise.resolve();

    const requested = events.find((event) => event.type === "permission_requested");
    expect(requested).toMatchObject({
      type: "permission_requested",
      request: {
        detail: {
          type: "plain_text",
          label: "AskUserQuestion",
          text: "Which path should Paseo take?",
        },
        actions: [
          { id: "q0_opt_0", label: "Narrow fix", behavior: "allow" },
          { id: "q0_opt_1", label: "Protocol fix", behavior: "allow" },
          { id: "q0_skip", label: "Skip", behavior: "deny" },
        ],
      },
    });
    if (requested?.type !== "permission_requested") {
      throw new Error("Expected permission request");
    }

    await session.respondToPermission(requested.request.id, {
      behavior: "allow",
      selectedActionId: "q0_opt_1",
    });

    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "q0_opt_1" },
    });
  });

  test("preserves ACP permission requests after invalid selected actions", async () => {
    const session = createSessionWithConfig({ provider: "generic-acp" });
    const events: AgentStreamEvent[] = [];

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => events.push(event));

    const permission = session.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Edit file",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    } satisfies RequestPermissionRequest);

    await Promise.resolve();

    const requested = events.find((event) => event.type === "permission_requested");
    if (requested?.type !== "permission_requested") {
      throw new Error("Expected permission request");
    }

    await expect(
      session.respondToPermission(requested.request.id, {
        behavior: "allow",
        selectedActionId: "",
      }),
    ).rejects.toThrow("does not exist");
    expect(session.getPendingPermissions()).toHaveLength(1);

    await expect(
      session.respondToPermission(requested.request.id, {
        behavior: "deny",
        selectedActionId: "allow-once",
      }),
    ).rejects.toThrow("does not match 'deny' behavior");
    expect(session.getPendingPermissions()).toHaveLength(1);

    await session.respondToPermission(requested.request.id, {
      behavior: "deny",
      selectedActionId: "reject-once",
    });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  });

  test("auto-accepts ACP permission requests when the shared feature is enabled", async () => {
    const session = createSessionWithConfig({
      provider: "cursor-acp",
      featureValues: { auto_accept: true },
    });
    const events: Array<{ type: string }> = [];

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => events.push(event as { type: string }));

    await expect(
      session.requestPermission({
        sessionId: "session-1",
        toolCall: {
          toolCallId: "tool-1",
          title: "Edit file",
          kind: "edit",
          status: "pending",
        },
        options: [
          { optionId: "allow-once", name: "Allow", kind: "allow_once" },
          { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      } satisfies RequestPermissionRequest),
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "permission_requested" }));
    expect(session.getPendingPermissions()).toEqual([]);
  });

  test("does not auto-accept ACP chooser requests", async () => {
    const session = createSessionWithConfig({
      provider: "kimi-acp",
      featureValues: { auto_accept: true },
    });
    const events: AgentStreamEvent[] = [];

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => events.push(event));

    const permission = session.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "question-1",
        title: "AskUserQuestion",
        status: "pending",
      },
      options: [
        { optionId: "q0_opt_0", name: "Narrow fix", kind: "allow_once" },
        { optionId: "q0_opt_1", name: "Protocol fix", kind: "allow_once" },
        { optionId: "q0_skip", name: "Skip", kind: "reject_once" },
      ],
    } satisfies RequestPermissionRequest);

    await Promise.resolve();

    const requested = events.find((event) => event.type === "permission_requested");
    expect(requested).toMatchObject({
      type: "permission_requested",
      request: {
        actions: [
          { id: "q0_opt_0", label: "Narrow fix", behavior: "allow" },
          { id: "q0_opt_1", label: "Protocol fix", behavior: "allow" },
          { id: "q0_skip", label: "Skip", behavior: "deny" },
        ],
      },
    });
    if (requested?.type !== "permission_requested") {
      throw new Error("Expected permission request");
    }

    await session.respondToPermission(requested.request.id, {
      behavior: "allow",
      selectedActionId: "q0_opt_0",
    });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "q0_opt_0" },
    });
  });

  test("starts auto-accepting permissions when the shared feature is toggled on", async () => {
    const session = createSessionWithConfig({ provider: "generic-acp" });
    const internals = asInternals<ACPSessionInternals>(session);
    internals.sessionId = "session-1";
    internals.connection = {};

    await session.setFeature("auto_accept", true);

    expect(session.features).toContainEqual(
      expect.objectContaining({ type: "toggle", id: "auto_accept", value: true }),
    );
    await expect(
      session.requestPermission({
        sessionId: "session-1",
        toolCall: {
          toolCallId: "tool-1",
          title: "Run command",
          kind: "execute",
          status: "pending",
        },
        options: [{ optionId: "allow-always", name: "Always allow", kind: "allow_always" }],
      } satisfies RequestPermissionRequest),
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-always" },
    });
  });

  test("surfaces an ACP permission when auto-accept has no allow option", async () => {
    const session = createSessionWithConfig({ featureValues: { auto_accept: true } });
    const events: Array<{ type: string; request?: { id: string } }> = [];
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    session.subscribe((event) => events.push(event as { type: string; request?: { id: string } }));

    const permission = session.requestPermission({
      sessionId: "session-1",
      toolCall: {
        toolCallId: "tool-1",
        title: "Unavailable approval",
        kind: "other",
        status: "pending",
      },
      options: [{ optionId: "reject-once", name: "Reject", kind: "reject_once" }],
    } satisfies RequestPermissionRequest);
    await Promise.resolve();

    const requested = events.find((event) => event.type === "permission_requested");
    expect(requested?.request?.id).toEqual(expect.any(String));
    await session.respondToPermission(requested!.request!.id, { behavior: "deny" });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  });

  test("maps Copilot Allow All mode to allow_all ACP config on session start", async () => {
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption("on"),
      ],
    }));
    const setSessionMode = vi.fn(async () => undefined);
    const session = createCopilotSessionWithConfig(COPILOT_ALLOW_ALL_MODE_ID);
    const { internals } = prepareConfiguredOverrideSession(session, {
      currentMode: "https://agentclientprotocol.com/protocol/session-modes#agent",
      availableModes: COPILOT_MODES,
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption("off"),
      ],
      connection: { setSessionConfigOption, setSessionMode },
    });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await internals.applyConfiguredOverrides();
    unsubscribe();

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "allow_all",
      value: "on",
    });
    expect(setSessionMode).not.toHaveBeenCalled();
    await expect(session.getCurrentMode()).resolves.toBe(COPILOT_ALLOW_ALL_MODE_ID);
    expect(events.some((event) => event.type === "permission_requested")).toBe(false);
  });

  test("accepts Copilot's legacy autopilot mode ID as Allow All", async () => {
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption("on"),
      ],
    }));
    const setSessionMode = vi.fn(async () => undefined);
    const session = createCopilotSessionWithConfig();
    prepareConfiguredOverrideSession(session, {
      currentMode: "https://agentclientprotocol.com/protocol/session-modes#agent",
      availableModes: COPILOT_MODES,
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption("off"),
      ],
      connection: { setSessionConfigOption, setSessionMode },
    });

    await session.setMode("https://agentclientprotocol.com/protocol/session-modes#autopilot");

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "allow_all",
      value: "on",
    });
    expect(setSessionMode).not.toHaveBeenCalled();
    await expect(session.getCurrentMode()).resolves.toBe(COPILOT_ALLOW_ALL_MODE_ID);
  });

  test("switching Copilot away from Allow All turns allow_all off before setting the ACP mode", async () => {
    const setSessionConfigOption = vi.fn(async (input: { value: string }) => ({
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption(input.value === "on" ? "on" : "off"),
      ],
    }));
    const setSessionMode = vi.fn(async () => undefined);
    const session = createCopilotSessionWithConfig(COPILOT_ALLOW_ALL_MODE_ID);
    prepareConfiguredOverrideSession(session, {
      currentMode: COPILOT_ALLOW_ALL_MODE_ID,
      availableModes: COPILOT_MODES,
      configOptions: [
        copilotModeConfigOption(COPILOT_ALLOW_ALL_MODE_ID),
        copilotAllowAllConfigOption("on"),
      ],
      connection: { setSessionConfigOption, setSessionMode },
    });

    await session.setMode("https://agentclientprotocol.com/protocol/session-modes#agent");

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "allow_all",
      value: "off",
    });
    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId: "session-1",
      modeId: "https://agentclientprotocol.com/protocol/session-modes#agent",
    });
  });

  test("trusts Copilot allow_all config updates as the current mode source", async () => {
    const session = createCopilotSessionWithConfig();
    const internals = asInternals<ACPSessionInternals>(session);

    const events = internals.translateSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [
        copilotModeConfigOption("https://agentclientprotocol.com/protocol/session-modes#agent"),
        copilotAllowAllConfigOption("on"),
      ],
    });

    expect(events).toMatchObject([
      {
        type: "mode_changed",
        provider: "copilot",
        currentModeId: COPILOT_ALLOW_ALL_MODE_ID,
        availableModes: expect.arrayContaining([
          expect.objectContaining({ id: COPILOT_ALLOW_ALL_MODE_ID, label: "Allow All" }),
        ]),
      },
    ]);
    await expect(session.getCurrentMode()).resolves.toBe(COPILOT_ALLOW_ALL_MODE_ID);
  });

  test("exposes Copilot custom agents as a select feature", () => {
    const session = createCopilotSessionWithConfig();
    const internals = asInternals<ACPSessionInternals>(session);
    internals.configOptions = [copilotAgentConfigOption("")];

    expect(session.features).toEqual([
      expect.objectContaining({
        type: "toggle",
        id: "auto_accept",
        value: false,
      }),
      {
        type: "select",
        id: "agent",
        label: "Agent",
        description: "Use a Copilot custom agent profile",
        tooltip: "Select Copilot agent",
        icon: undefined,
        value: "",
        options: [
          {
            id: "",
            label: "Default",
            description: undefined,
            isDefault: true,
            metadata: undefined,
          },
          {
            id: "Probe Agent",
            label: "Probe Agent",
            description: "Temporary probe agent",
            isDefault: false,
            metadata: undefined,
          },
        ],
      },
    ]);
  });

  test("applies configured Copilot custom agent before the first turn", async () => {
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions: [copilotAgentConfigOption("Probe Agent")],
    }));
    const session = createCopilotSessionWithConfig(null, { agent: "Probe Agent" });
    const { internals } = prepareConfiguredOverrideSession(session, {
      configOptions: [copilotAgentConfigOption("")],
      connection: { setSessionConfigOption },
    });

    await internals.applyConfiguredOverrides();

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "agent",
      value: "Probe Agent",
    });
    expect(session.features).toEqual([
      expect.objectContaining({
        id: "auto_accept",
        value: false,
      }),
      expect.objectContaining({
        id: "agent",
        value: "Probe Agent",
      }),
    ]);
  });

  test("sets Copilot custom agent through ACP config options", async () => {
    const setSessionConfigOption = vi.fn(async () => ({
      configOptions: [copilotAgentConfigOption("Probe Agent")],
    }));
    const session = createCopilotSessionWithConfig();
    prepareConfiguredOverrideSession(session, {
      configOptions: [copilotAgentConfigOption("")],
      connection: { setSessionConfigOption },
    });

    await session.setFeature("agent", "Probe Agent");

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "session-1",
      configId: "agent",
      value: "Probe Agent",
    });
    expect(session.features).toEqual([
      expect.objectContaining({
        id: "auto_accept",
        value: false,
      }),
      expect.objectContaining({
        id: "agent",
        value: "Probe Agent",
      }),
    ]);
  });
});

describe("deriveModelDefinitionsFromACP", () => {
  test("attaches shared thinking options to ACP model state", () => {
    const result = deriveModelDefinitionsFromACP(
      "claude-acp",
      {
        availableModels: [
          { modelId: "haiku", name: "Haiku", description: "Fast" },
          { modelId: "sonnet", name: "Sonnet", description: "Balanced" },
        ],
        currentModelId: "haiku",
      },
      [
        {
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
    );

    expect(result).toEqual([
      {
        provider: "claude-acp",
        id: "haiku",
        label: "Haiku",
        description: "Fast",
        isDefault: true,
        thinkingOptions: [
          {
            id: "low",
            label: "Low",
            description: undefined,
            isDefault: false,
            metadata: undefined,
          },
          {
            id: "medium",
            label: "Medium",
            description: undefined,
            isDefault: true,
            metadata: undefined,
          },
          {
            id: "high",
            label: "High",
            description: undefined,
            isDefault: false,
            metadata: undefined,
          },
        ],
        defaultThinkingOptionId: "medium",
      },
      {
        provider: "claude-acp",
        id: "sonnet",
        label: "Sonnet",
        description: "Balanced",
        isDefault: false,
        thinkingOptions: [
          {
            id: "low",
            label: "Low",
            description: undefined,
            isDefault: false,
            metadata: undefined,
          },
          {
            id: "medium",
            label: "Medium",
            description: undefined,
            isDefault: true,
            metadata: undefined,
          },
          {
            id: "high",
            label: "High",
            description: undefined,
            isDefault: false,
            metadata: undefined,
          },
        ],
        defaultThinkingOptionId: "medium",
      },
    ]);
  });
});

describe("ACPAgentClient modelTransformer", () => {
  test("applies modelTransformer after deriving ACP models", async () => {
    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              models: {
                availableModels: [
                  {
                    modelId: "openrouter/openai/gpt-4.1-mini",
                    name: "openrouter/openai/gpt-4.1-mini",
                    description: null,
                  },
                ],
                currentModelId: "openrouter/openai/gpt-4.1-mini",
              },
              configOptions: [],
            }),
          },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestACPAgentClient({
      provider: "pi",
      logger: createTestLogger(),
      defaultCommand: ["test-acp"],
      modelTransformer: transformPiModels,
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-models", force: false }),
    ).resolves.toEqual({
      models: [
        {
          provider: "pi",
          id: "openrouter/openai/gpt-4.1-mini",
          label: "gpt-4.1-mini",
          description: "openrouter/openai/gpt-4.1-mini",
          isDefault: true,
          thinkingOptions: undefined,
          defaultThinkingOptionId: undefined,
        },
      ],
      modes: [],
    });
  });
});

describe("ACPAgentClient catalog discovery without a model resolver", () => {
  test("never switches models during catalog discovery even with multiple models and a thinking picker", async () => {
    // The per-model probing that switches models lives on KimiACPAgentClient
    // (see kimi-acp-agent.test.ts). The base client ships no catalog model resolver, so a
    // slow or nonconforming ACP can't stall its catalog probe on extra setSessionConfigOption
    // round trips.
    const setSessionConfigOption = vi.fn();

    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [
                {
                  id: "model",
                  name: "Model",
                  category: "model",
                  type: "select",
                  currentValue: "model-a",
                  options: [
                    { value: "model-a", name: "Model A" },
                    { value: "model-b", name: "Model B" },
                  ],
                },
                {
                  id: "thinking",
                  name: "Thinking",
                  category: "thought_level",
                  type: "select",
                  currentValue: "off",
                  options: [
                    { value: "off", name: "Off" },
                    { value: "on", name: "On" },
                  ],
                },
              ],
            }),
            setSessionConfigOption,
          },
          initialize: { agentCapabilities: {} },
        } as unknown as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestACPAgentClient({
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["acp-agent"],
      defaultModes: [],
    });

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/acp-generic-catalog",
      force: false,
    });

    expect(setSessionConfigOption).not.toHaveBeenCalled();
    expect(catalog.models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
  });
});

describe("ACPAgentClient config features", () => {
  test("enables Auto Accept for unattended ACP creation", () => {
    const client = new ACPAgentClient({
      provider: "generic-acp",
      logger: createTestLogger(),
      defaultCommand: ["generic-acp", "acp"],
    });

    expect(
      client.resolveCreateConfig({
        provider: "generic-acp",
        requestedMode: undefined,
        featureValues: { provider_feature: "kept" },
        parent: null,
        unattended: true,
        availableModes: [],
      }),
    ).toEqual({
      modeId: undefined,
      featureValues: { provider_feature: "kept", auto_accept: true },
    });
  });

  test("preserves an explicit Auto Accept override for unattended ACP creation", () => {
    const client = new ACPAgentClient({
      provider: "generic-acp",
      logger: createTestLogger(),
      defaultCommand: ["generic-acp", "acp"],
    });

    expect(
      client.resolveCreateConfig({
        provider: "generic-acp",
        requestedMode: undefined,
        featureValues: { auto_accept: false },
        parent: null,
        unattended: true,
        availableModes: [],
      }),
    ).toEqual({ modeId: undefined, featureValues: { auto_accept: false } });
  });

  test("maps an unattended cross-provider parent to ACP Auto Accept", () => {
    const client = new ACPAgentClient({
      provider: "generic-acp",
      logger: createTestLogger(),
      defaultCommand: ["generic-acp", "acp"],
    });

    expect(
      client.resolveCreateConfig({
        provider: "generic-acp",
        requestedMode: undefined,
        featureValues: undefined,
        parent: {
          provider: "claude",
          modeId: "bypassPermissions",
          isUnattended: true,
        },
        unattended: false,
        availableModes: [{ id: "agent", label: "Agent" }],
      }),
    ).toEqual({ modeId: undefined, featureValues: { auto_accept: true } });
  });

  test("treats Auto Accept as an unattended ACP configuration", () => {
    const client = new ACPAgentClient({
      provider: "generic-acp",
      logger: createTestLogger(),
      defaultCommand: ["generic-acp", "acp"],
    });

    expect(
      client.isCreateConfigUnattended({
        modeId: null,
        config: {
          provider: "generic-acp",
          cwd: "/tmp/acp-features",
          featureValues: { auto_accept: true },
        },
        availableModes: [],
      }),
    ).toBe(true);
  });

  test("exposes Auto Accept for every ACP provider without starting a probe", async () => {
    const client = new ACPAgentClient({
      provider: "generic-acp",
      logger: createTestLogger(),
      defaultCommand: ["generic-acp", "acp"],
    });

    await expect(
      client.listFeatures({
        provider: "generic-acp",
        cwd: "/tmp/acp-features",
        featureValues: { auto_accept: true },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "toggle",
        id: "auto_accept",
        label: "Auto Accept",
        value: true,
      }),
    ]);
  });

  test("derives features from configured ACP select options", async () => {
    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              configOptions: [copilotAgentConfigOption("Probe Agent")],
            }),
          },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestACPAgentClient({
      provider: "copilot",
      logger: createTestLogger(),
      defaultCommand: ["copilot", "--acp"],
      configFeatureOptions: [COPILOT_AGENT_FEATURE_OPTION],
    });

    await expect(
      client.listFeatures({
        provider: "copilot",
        cwd: "/tmp/acp-features",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "toggle",
        id: "auto_accept",
        value: false,
      }),
      expect.objectContaining({
        type: "select",
        id: "agent",
        value: "Probe Agent",
        options: [
          expect.objectContaining({ id: "", label: "Default", isDefault: false }),
          expect.objectContaining({ id: "Probe Agent", label: "Probe Agent", isDefault: true }),
        ],
      }),
    ]);
  });
});

describe("ACPAgentClient sessionResponseTransformer", () => {
  class TestACPAgentClient extends ACPAgentClient {
    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      const response: SessionStateResponse = {
        sessionId: "session-1",
        modes: {
          availableModes: [{ id: "raw", name: "Raw", description: "Before transform" }],
          currentModeId: "raw",
        },
        models: null,
        configOptions: [],
      };

      return {
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue(response),
        },
        initialize: { agentCapabilities: {} },
      } as SpawnedACPProcess;
    }

    protected override async closeProbe(): Promise<void> {}
  }

  test("applies sessionResponseTransformer before deriving catalog modes", async () => {
    const client = new TestACPAgentClient({
      provider: "claude-acp",
      logger: createTestLogger(),
      defaultCommand: ["claude", "--acp"],
      defaultModes: [],
      sessionResponseTransformer: (response) => ({
        ...response,
        modes: {
          availableModes: [{ id: "review", name: "Review", description: "After transform" }],
          currentModeId: "review",
        },
      }),
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-modes", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [
        {
          id: "review",
          label: "Review",
          description: "After transform",
        },
      ],
    });
  });
});

describe("ACPAgentClient fetchCatalog", () => {
  test("passes the requested cwd to the catalog probe", async () => {
    const newSession = vi.fn().mockResolvedValue({ modes: null, models: null, configOptions: [] });

    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: { newSession },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestACPAgentClient({
      provider: "pi",
      logger: createTestLogger(),
      defaultCommand: ["test-acp"],
      defaultModes: [],
    });

    await client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-catalog-cwd", force: false });

    expect(newSession).toHaveBeenCalledWith({
      cwd: "/tmp/acp-catalog-cwd",
      mcpServers: [],
    });
  });

  test("returns an empty modes array when no ACP modes are reported and fallback modes are empty", async () => {
    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              modes: null,
              configOptions: [
                {
                  id: "thought_level",
                  name: "Thinking",
                  category: "thought_level",
                  type: "select",
                  currentValue: "medium",
                  options: [
                    { value: "low", name: "Low" },
                    { value: "medium", name: "Medium" },
                    { value: "high", name: "High" },
                  ],
                },
              ],
            }),
          },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    const client = new TestACPAgentClient({
      provider: "pi",
      logger: createTestLogger(),
      defaultCommand: ["test-acp"],
      defaultModes: [],
    });

    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-modes", force: false }),
    ).resolves.toEqual({
      models: [],
      modes: [],
    });
  });
});

describe("ACPAgentClient listImportableSessions", () => {
  function makeClient(args: { listSessions: ReturnType<typeof vi.fn>; supportsList?: boolean }) {
    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: { listSessions: args.listSessions },
          initialize: {
            agentCapabilities:
              args.supportsList === false ? {} : { sessionCapabilities: { list: {} } },
          },
        } as unknown as SpawnedACPProcess;
      }

      protected override async closeProbe(): Promise<void> {}
    }

    return new TestACPAgentClient({
      provider: "kimi",
      logger: createTestLogger(),
      defaultCommand: ["kimi", "acp"],
      defaultModes: [],
    });
  }

  test("forwards the requested cwd to session/list so the agent filters by directory", async () => {
    const listSessions = vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionId: "session-1",
          cwd: "/Users/moonshot",
          title: "细致查看一下本仓库内容",
          updatedAt: "2026-06-13T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    const client = makeClient({ listSessions });
    const result = await client.listImportableSessions({ cwd: "/Users/moonshot", limit: 20 });

    expect(listSessions).toHaveBeenCalledWith({ cwd: "/Users/moonshot" });
    expect(result).toEqual([
      {
        providerHandleId: "session-1",
        cwd: "/Users/moonshot",
        title: "细致查看一下本仓库内容",
        firstPromptPreview: null,
        lastPromptPreview: null,
        lastActivityAt: new Date("2026-06-13T00:00:00.000Z"),
      },
    ]);
  });

  test("omits cwd from session/list when none is requested", async () => {
    const listSessions = vi.fn().mockResolvedValue({ sessions: [], nextCursor: null });
    const client = makeClient({ listSessions });

    await client.listImportableSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledWith({});
  });

  test("stops at the requested session limit after a source-scoped page", async () => {
    const listSessions = vi.fn().mockResolvedValue({
      sessions: [
        { sessionId: "s1", cwd: "/Users/moonshot", title: null, updatedAt: null },
        { sessionId: "s2", cwd: "/Users/moonshot", title: null, updatedAt: null },
      ],
      nextCursor: "later",
    });
    const client = makeClient({ listSessions });

    await expect(
      client.listImportableSessions({ cwd: "/Users/moonshot", limit: 1 }),
    ).resolves.toHaveLength(1);
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  test("forwards cwd alongside the pagination cursor across pages", async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce({
        sessions: [{ sessionId: "s1", cwd: "/Users/moonshot", title: null, updatedAt: null }],
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        sessions: [{ sessionId: "s2", cwd: "/Users/moonshot", title: null, updatedAt: null }],
        nextCursor: null,
      });

    const client = makeClient({ listSessions });
    await client.listImportableSessions({ cwd: "/Users/moonshot" });

    expect(listSessions).toHaveBeenNthCalledWith(1, { cwd: "/Users/moonshot" });
    expect(listSessions).toHaveBeenNthCalledWith(2, {
      cursor: "cursor-2",
      cwd: "/Users/moonshot",
    });
  });
});

describe("ACP providers advertise session listing", () => {
  // The daemon's agent-manager only queries providers whose
  // capabilities.supportsSessionListing is true. Without it, ACP providers
  // (Kimi and other custom ACP agents, Copilot) are skipped and import shows
  // nothing even though listImportableSessions is implemented.
  test("generic ACP clients (e.g. Kimi) report supportsSessionListing", () => {
    const client = new GenericACPAgentClient({
      logger: createTestLogger(),
      command: ["kimi", "acp"],
    });
    expect(client.capabilities.supportsSessionListing).toBe(true);
  });

  test("Copilot ACP client reports supportsSessionListing", () => {
    const client = new CopilotACPAgentClient({ logger: createTestLogger() });
    expect(client.capabilities.supportsSessionListing).toBe(true);
  });
});

describe("transformPiModels", () => {
  test("keeps slash-free labels unchanged", () => {
    expect(
      transformPiModels([
        {
          provider: "pi",
          id: "gpt-4.1-mini",
          label: "GPT 4.1 Mini",
          description: "Fast",
        },
      ]),
    ).toEqual([
      {
        provider: "pi",
        id: "gpt-4.1-mini",
        label: "GPT 4.1 Mini",
        description: "Fast",
      },
    ]);
  });

  test("uses the last path segment as label and preserves existing descriptions", () => {
    expect(
      transformPiModels([
        {
          provider: "pi",
          id: "openrouter/openai/gpt-4.1-mini",
          label: "openrouter/openai/gpt-4.1-mini",
          description: undefined,
        },
        {
          provider: "pi",
          id: "anthropic/claude-sonnet-4",
          label: "anthropic/claude-sonnet-4",
          description: "Balanced",
        },
      ]),
    ).toEqual([
      {
        provider: "pi",
        id: "openrouter/openai/gpt-4.1-mini",
        label: "gpt-4.1-mini",
        description: "openrouter/openai/gpt-4.1-mini",
      },
      {
        provider: "pi",
        id: "anthropic/claude-sonnet-4",
        label: "claude-sonnet-4",
        description: "Balanced",
      },
    ]);
  });
});

describe("ACPAgentSession slash commands", () => {
  test("returns immediately for ACP sessions that do not wait for async command discovery", async () => {
    const session = new ACPAgentSession(
      {
        provider: "claude-acp",
        cwd: "/tmp/paseo-acp-test",
      },
      {
        provider: "claude-acp",
        logger: createTestLogger(),
        defaultCommand: ["claude", "--acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
        waitForInitialCommands: false,
      },
    );

    await expect(session.listCommands()).resolves.toEqual([]);
  });

  test("waits for async available_commands_update when enabled", async () => {
    const session = new ACPAgentSession(
      {
        provider: "claude-acp",
        cwd: "/tmp/paseo-acp-test",
      },
      {
        provider: "claude-acp",
        logger: createTestLogger(),
        defaultCommand: ["claude", "--acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
        waitForInitialCommands: true,
        initialCommandsWaitTimeoutMs: 1500,
      },
    );

    const listCommandsPromise = session.listCommands();

    asInternals<ACPSessionInternals>(session).translateSessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: "research_codebase",
          description: "Search the workspace for relevant files",
        },
        {
          name: "create_plan",
          description: "Draft a plan for the requested work",
        },
      ],
    });

    expect(await listCommandsPromise).toEqual([
      {
        name: "research_codebase",
        description: "Search the workspace for relevant files",
        argumentHint: "",
        kind: "command",
      },
      {
        name: "create_plan",
        description: "Draft a plan for the requested work",
        argumentHint: "",
        kind: "command",
      },
    ]);

    expect(await session.listCommands()).toEqual([
      {
        name: "research_codebase",
        description: "Search the workspace for relevant files",
        argumentHint: "",
        kind: "command",
      },
      {
        name: "create_plan",
        description: "Draft a plan for the requested work",
        argumentHint: "",
        kind: "command",
      },
    ]);
  });
});

describe("ACPAgentSession", () => {
  test("drops MCP servers from ACP requests when the provider does not support MCP", () => {
    const session = new ACPAgentSession(
      {
        provider: "no-mcp-acp",
        cwd: "/tmp/paseo-acp-test",
        mcpServers: {
          paseo: {
            type: "http",
            url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=agent-1",
          },
        },
      },
      {
        provider: "no-mcp-acp",
        logger: createTestLogger(),
        defaultCommand: ["no-mcp-acp", "serve"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: false,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
      },
    );

    expect(asInternals<ACPSessionInternals>(session).acpMcpServers()).toEqual([]);
  });

  test("summarizes JSON-RPC error details without stringifying objects", () => {
    const summary = summarizeACPRequestError(
      new RequestError(-32603, "Internal error", {
        details: "Droid process exited unexpectedly (exit code 1)",
      }),
    );

    expect(summary).toMatchObject({
      message: "Internal error: Droid process exited unexpectedly (exit code 1)",
      code: "-32603",
    });
    expect(summary.message).not.toContain("[object Object]");
    expect(summary.diagnostic).toContain("Droid process exited unexpectedly");
  });

  test("accepts ACP extension notifications without failing the JSON-RPC connection", async () => {
    const logger = createTestLogger();
    const trace = vi.spyOn(logger, "trace");
    const session = createSessionWithConfig({ provider: "kiro" }, logger);

    await expect(
      session.extNotification("_kiro.dev/session/initialized", {
        sessionId: "session-1",
      }),
    ).resolves.toBeUndefined();
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "kiro",
        method: "_kiro.dev/session/initialized",
        sessionId: "session-1",
      }),
      "provider.acp.extension_notification",
    );
  });

  test("maps the Kiro _kiro.dev/commands/available notification into slash commands and skills", async () => {
    const session = createKiroSession({
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: 1500,
    });
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    const listCommandsPromise = session.listCommands();

    await session.extNotification("_kiro.dev/commands/available", {
      sessionId: "session-1",
      commands: [
        {
          name: "/agent",
          description: "Select or list available agents",
          meta: { inputType: "selection", hint: "swap <name>" },
        },
      ],
      prompts: [
        {
          name: "agent-sync-doctor",
          description: "Hand off Claude or Codex state across Macs",
          arguments: [],
          serverName: "skill:config",
        },
      ],
      // Tools are not slash commands and must be ignored.
      tools: [{ name: "code", description: "Code intelligence", source: "built-in" }],
    });

    expect(await listCommandsPromise).toEqual([
      {
        name: "agent",
        description: "Select or list available agents",
        argumentHint: "swap <name>",
        kind: "command",
      },
      {
        name: "agent-sync-doctor",
        description: "Hand off Claude or Codex state across Macs",
        argumentHint: "",
        kind: "skill",
      },
    ]);
  });

  test("ignores Kiro _kiro.dev/commands/available for a different session", async () => {
    const session = createKiroSession();
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    await session.extNotification("_kiro.dev/commands/available", {
      sessionId: "other-session",
      commands: [{ name: "/agent", description: "Select or list available agents" }],
      prompts: [],
    });

    expect(await session.listCommands()).toEqual([]);
  });

  test("settles listCommands() immediately on an empty Kiro commands batch", async () => {
    // A long timeout means a resolution can only come from settleCommandsReady()
    // firing — not from the wait timer — so this test would hang if the empty
    // batch failed to unblock listCommands() (the P1 regression).
    const session = createKiroSession({
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: 60_000,
    });
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    const listCommandsPromise = session.listCommands();

    await session.extNotification("_kiro.dev/commands/available", {
      sessionId: "session-1",
      commands: [],
      prompts: [],
    });

    expect(await listCommandsPromise).toEqual([]);
  });

  test("emits assistant and reasoning chunks as deltas while user chunks stay accumulated", async () => {
    const session = createSession();
    const events: Array<{
      type: string;
      item?: { type: string; text?: string; messageId?: string };
    }> = [];
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    session.subscribe((event) => {
      events.push(
        event as { type: string; item?: { type: string; text?: string; messageId?: string } },
      );
    });

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-1",
        content: { type: "text", text: "Hey!" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-1",
        content: { type: "text", text: " How are you?" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: "Thinking" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: " more" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "user-1",
        content: { type: "text", text: "hel" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "user-1",
        content: { type: "text", text: "lo" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-2",
        content: { type: "text", text: "" },
      } as SessionUpdate,
    });

    const timeline = events
      .filter((event) => event.type === "timeline")
      .map((event) => event.item)
      .filter(Boolean);

    expect(timeline).toEqual([
      { type: "assistant_message", text: "Hey!", messageId: "assistant-1" },
      { type: "assistant_message", text: " How are you?", messageId: "assistant-1" },
      { type: "reasoning", text: "Thinking" },
      { type: "reasoning", text: " more" },
      { type: "user_message", text: "hello", messageId: "user-1" },
    ]);
  });

  test("assigns one fallback ID per contiguous assistant message", async () => {
    const session = createSession();
    const assistantMessages: Array<{ text: string; messageId?: string }> = [];
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    session.subscribe((event) => {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        assistantMessages.push(event.item);
      }
    });

    for (const text of ["First", " message"]) {
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        } as SessionUpdate,
      });
    }
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Next response" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Second message" },
      } as SessionUpdate,
    });

    expect(assistantMessages).toHaveLength(3);
    expect(assistantMessages[0].messageId).toEqual(expect.any(String));
    expect(assistantMessages[1].messageId).toBe(assistantMessages[0].messageId);
    expect(assistantMessages[2].messageId).toEqual(expect.any(String));
    expect(assistantMessages[2].messageId).not.toBe(assistantMessages[0].messageId);
  });

  test("keeps ACP configuration notifications outside the turn lifecycle", async () => {
    const session = createSession();
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "config_option_update",
        configOptions: [
          selectConfigOption("mode", ["plan", "yolo"], "yolo"),
          selectConfigOption("model", ["kimi-code/kimi-for-coding"]),
          selectConfigOption("thought_level", ["off", "on"], "on"),
        ],
      } as SessionUpdate,
    });

    expect(events.map((event) => event.type)).toEqual([
      "thread_started",
      "mode_changed",
      "model_changed",
      "thinking_option_changed",
    ]);
  });

  test("forwards out-of-prompt ACP content without inventing a turn", async () => {
    const session = createSession();
    asInternals<ACPSessionInternals>(session).sessionId = "session-1";

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => {
      events.push(event);
    });

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "unscoped-message",
        content: { type: "text", text: "Unscoped ACP update" },
      } as SessionUpdate,
    });

    expect(events).toEqual([
      {
        type: "thread_started",
        provider: "claude-acp",
        sessionId: "session-1",
      },
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "assistant_message",
          text: "Unscoped ACP update",
          messageId: "unscoped-message",
        },
      },
    ]);
  });

  test("startTurn returns before the ACP prompt settles and completes later via subscribers", async () => {
    const session = createSession();
    const events: Array<{ type: string; turnId?: string }> = [];
    let resolvePrompt!: (value: PromptResponse) => void;
    const prompt = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event as { type: string; turnId?: string });
    });

    const { turnId } = await session.startTurn("hello");

    expect(prompt).toHaveBeenCalledOnce();
    expect(events.find((event) => event.type === "turn_started")).toMatchObject({
      type: "turn_started",
      turnId,
    });
    expect(asInternals<ACPSessionInternals>(session).activeForegroundTurnId).toBe(turnId);

    resolvePrompt({ stopReason: "end_turn", usage: { outputTokens: 3 } });
    await Promise.resolve();
    await Promise.resolve();

    expect(events.find((event) => event.type === "turn_completed")).toMatchObject({
      type: "turn_completed",
      turnId,
    });
    expect(asInternals<ACPSessionInternals>(session).activeForegroundTurnId).toBeNull();
  });

  test("startTurn emits the submitted user message even when ACP does not echo it", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    let resolvePrompt!: (value: PromptResponse) => void;
    const prompt = vi.fn(
      () =>
        new Promise<PromptResponse>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    const { turnId } = await session.startTurn("hello", {
      clientMessageId: "msg-client-1",
    });

    expect(prompt).toHaveBeenCalledWith({
      sessionId: "session-1",
      messageId: "msg-client-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    expect(
      events
        .filter(
          (event) =>
            event.type === "turn_started" ||
            (event.type === "timeline" && event.item.type === "user_message"),
        )
        .map((event) => event.type),
    ).toEqual(["turn_started", "timeline"]);
    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: "claude-acp",
        turnId,
        item: {
          type: "user_message",
          text: "hello",
          messageId: "msg-client-1",
          clientMessageId: "msg-client-1",
        },
      },
    ]);

    resolvePrompt({ stopReason: "end_turn" });
  });

  test("startTurn dedupes ACP user echo chunks for the submitted message", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    const prompt = vi.fn(() => new Promise<PromptResponse>(() => {}));

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn("hello", { clientMessageId: "msg-client-1" });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg-client-1",
        content: { type: "text", text: "hello" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toHaveLength(1);
  });

  test("startTurn dedupes ACP user echo chunks without message ids for the submitted message", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    const prompt = vi.fn(() => new Promise<PromptResponse>(() => {}));

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn("hello", { clientMessageId: "msg-client-1" });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "hello" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "user_message",
          text: "hello",
          messageId: "msg-client-1",
          clientMessageId: "msg-client-1",
        },
        turnId: expect.any(String),
      },
    ]);
  });

  test("startTurn dedupes ACP user echo chunks without message ids across turns", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    let resolvePrompt!: (value: PromptResponse) => void;
    const prompt = vi.fn(
      () =>
        new Promise<PromptResponse>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn("first", { clientMessageId: "msg-client-1" });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "first" },
      } as SessionUpdate,
    });
    resolvePrompt({ stopReason: "end_turn" });
    await Promise.resolve();
    await Promise.resolve();

    await session.startTurn("second", { clientMessageId: "msg-client-2" });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "second" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "user_message",
          text: "first",
          messageId: "msg-client-1",
          clientMessageId: "msg-client-1",
        },
        turnId: expect.any(String),
      },
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "user_message",
          text: "second",
          messageId: "msg-client-2",
          clientMessageId: "msg-client-2",
        },
        turnId: expect.any(String),
      },
    ]);
  });

  test("startTurn dedupes ACP user echo chunks with provider-owned ids for the submitted message", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    const prompt = vi.fn(() => new Promise<PromptResponse>(() => {}));

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn("hello", { clientMessageId: "msg-client-1" });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg-provider-1",
        content: { type: "text", text: "hello" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "user_message",
          text: "hello",
          messageId: "msg-client-1",
          clientMessageId: "msg-client-1",
        },
        turnId: expect.any(String),
      },
    ]);
  });

  test("startTurn dedupes a provider-owned user echo streamed as text and image chunks", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    const prompt = vi.fn(() => new Promise<PromptResponse>(() => {}));

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn(
      [
        { type: "text", text: "hey" },
        { type: "image", data: "AA==", mimeType: "image/png" },
      ],
      { clientMessageId: "msg-client-1" },
    );
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg-provider-1",
        content: { type: "text", text: "hey" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg-provider-1",
        content: { type: "image", data: "AA==", mimeType: "image/png" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: session.provider,
        item: {
          type: "user_message",
          text: "hey",
          messageId: "msg-client-1",
          clientMessageId: "msg-client-1",
        },
        turnId: expect.any(String),
      },
    ]);
  });

  test("startTurn keeps an image-only provider echo when no canonical user message was emitted", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    const prompt = vi.fn(() => new Promise<PromptResponse>(() => {}));

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event);
    });

    await session.startTurn([{ type: "image", data: "AA==", mimeType: "image/png" }], {
      clientMessageId: "msg-client-1",
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data: "AA==", mimeType: "image/png" },
      } as SessionUpdate,
    });
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-1",
        content: { type: "text", text: "I see it" },
      } as SessionUpdate,
    });

    expect(
      events.filter((event) => event.type === "timeline" && event.item.type === "user_message"),
    ).toEqual([
      {
        type: "timeline",
        provider: session.provider,
        item: { type: "user_message", text: "[image]" },
        turnId: expect.any(String),
      },
    ]);
  });

  test("startTurn converts background prompt rejections into turn_failed events", async () => {
    const session = createSession();
    const events: Array<{ type: string; turnId?: string; error?: string }> = [];
    let rejectPrompt!: (error: Error) => void;
    const prompt = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectPrompt = reject;
        }),
    );

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };

    session.subscribe((event) => {
      events.push(event as { type: string; turnId?: string; error?: string });
    });

    const { turnId } = await session.startTurn("hello");

    rejectPrompt(new Error("prompt failed"));
    await Promise.resolve();
    await Promise.resolve();

    const turnFailedEvent = events.find((event) => event.type === "turn_failed");
    expect(turnFailedEvent).toMatchObject({
      type: "turn_failed",
      turnId,
      error: "prompt failed",
    });
    expect(asInternals<ACPSessionInternals>(session).activeForegroundTurnId).toBeNull();
  });

  test("flushes an image-only provider echo before a rejected turn finishes", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    let rejectPrompt!: (error: Error) => void;
    const prompt = vi.fn(
      () =>
        new Promise<PromptResponse>((_, reject) => {
          rejectPrompt = reject;
        }),
    );

    asInternals<ACPSessionInternals>(session).sessionId = "session-1";
    asInternals<ACPSessionInternals>(session).connection = { prompt };
    session.subscribe((event) => events.push(event));

    const { turnId } = await session.startTurn([
      { type: "image", data: "AA==", mimeType: "image/png" },
    ]);
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data: "AA==", mimeType: "image/png" },
      } as SessionUpdate,
    });

    rejectPrompt(new Error("prompt failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(
      events.filter((event) => event.type === "timeline" || event.type === "turn_failed"),
    ).toEqual([
      {
        type: "timeline",
        provider: session.provider,
        item: { type: "user_message", text: "[image]" },
        turnId,
      },
      expect.objectContaining({ type: "turn_failed", turnId, error: "prompt failed" }),
    ]);
  });

  test("startTurn preserves JSON-RPC error details from a real ACP prompt response", async () => {
    const session = createSession();
    const clientToAgent = new TransformStream();
    const agentToClient = new TransformStream();
    const upstreamMessage =
      "Authentication failed: Please authenticate to continue. Run `/login` to log in.";
    const upstreamData = {
      cause: "auth_required",
      errorMessage: "Please authenticate to continue. Run `/login` to log in.",
    };
    const agent: Agent = {
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {},
          authMethods: [{ id: "windsurf-api-key", name: "API Key" }],
        };
      },
      async newSession() {
        return { sessionId: "session-1" };
      },
      async prompt() {
        throw new RequestError(-32000, upstreamMessage, upstreamData);
      },
      async authenticate() {},
      async cancel() {},
    };
    const agentConnection = new AgentSideConnection(
      () => agent,
      ndJsonStream(agentToClient.writable, clientToAgent.readable),
    );
    const connection = new ClientSideConnection(
      () => ({
        async requestPermission() {
          return { outcome: { outcome: "cancelled" } };
        },
        async sessionUpdate() {},
      }),
      ndJsonStream(clientToAgent.writable, agentToClient.readable),
    );
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "Paseo test", version: "dev" },
    });
    expect(agentConnection.signal.aborted).toBe(false);
    const sessionResponse = await connection.newSession({
      cwd: "/tmp/paseo-acp-test",
      mcpServers: [],
    });
    const turnFailed = new Promise<Extract<AgentStreamEvent, { type: "turn_failed" }>>(
      (resolve) => {
        session.subscribe((event) => {
          if (event.type === "turn_failed") {
            resolve(event);
          }
        });
      },
    );

    asInternals<ACPSessionInternals>(session).sessionId = sessionResponse.sessionId;
    asInternals<ACPSessionInternals>(session).connection = connection;

    await session.startTurn("hello");

    await expect(turnFailed).resolves.toMatchObject({
      error: expect.stringContaining(upstreamMessage),
      code: "-32000",
      diagnostic: expect.stringContaining("auth_required"),
    });
    await expect(turnFailed).resolves.toMatchObject({
      error: expect.not.stringContaining("[object Object]"),
    });
  });
});

interface ACPCloseInternals {
  child: ChildProcess | null;
  connection: unknown;
  sessionId: string | null;
}

async function startTerminal(
  session: ACPAgentSession,
  child: ChildProcess,
  command = "sleep",
): Promise<string> {
  vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child as ChildProcessWithoutNullStreams);
  const terminal = await session.createTerminal({
    sessionId: "session-1",
    command,
    args: ["60"],
  });
  vi.restoreAllMocks();
  return terminal.terminalId;
}

describe("ACPAgentSession close() tree-kill", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("close() flushes a buffered provider-owned user message before unsubscribing", async () => {
    const session = createSession();
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    asInternals<ACPCloseInternals>(session).sessionId = "session-1";

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data: "AA==", mimeType: "image/png" },
      } as SessionUpdate,
    });
    expect(events).toEqual([]);

    await session.close();

    expect(events).toEqual([
      {
        type: "timeline",
        provider: session.provider,
        item: { type: "user_message", text: "[image]" },
      },
    ]);
  });

  test("close() terminates the main child process via the process tree", async () => {
    const terminator = new FakeTerminator();
    const session = createSession(terminator.terminate);
    const internals = asInternals<ACPCloseInternals>(session);

    const child = createTerminalChildStub();
    // The ACP host process is set by the live connect handshake, which has no
    // in-test seam; everything else is driven through the public API.
    internals.child = child;
    internals.connection = null;
    internals.sessionId = null;

    await session.close();

    expect(terminator.terminated).toContain(child);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("close() terminates running terminal child processes", async () => {
    const terminator = new FakeTerminator();
    const session = createSession(terminator.terminate);

    const terminalChild = createTerminalChildStub();
    await startTerminal(session, terminalChild);

    await session.close();

    expect(terminator.terminated).toContain(terminalChild);
    expect(terminalChild.kill).not.toHaveBeenCalled();
  });

  test("close() terminates terminal child processes in parallel", async () => {
    const terminator = new FakeTerminator("deferred");
    const session = createSession(terminator.terminate);

    const firstChild = createTerminalChildStub();
    const secondChild = createTerminalChildStub();
    await startTerminal(session, firstChild);
    await startTerminal(session, secondChild);

    const close = session.close();
    await Promise.resolve();

    expect(terminator.terminated).toEqual([firstChild, secondChild]);

    terminator.releaseAll();
    await close;
  });

  test("killTerminal terminates the terminal process tree without a direct SIGTERM", async () => {
    const terminator = new FakeTerminator();
    const session = createSession(terminator.terminate);

    const child = createTerminalChildStub();
    const terminalId = await startTerminal(session, child);

    await session.killTerminal({ sessionId: "session-1", terminalId });

    expect(terminator.terminated).toContain(child);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("releaseTerminal terminates and removes a running terminal", async () => {
    const terminator = new FakeTerminator();
    const session = createSession(terminator.terminate);

    const child = createTerminalChildStub();
    const terminalId = await startTerminal(session, child);

    await session.releaseTerminal({ sessionId: "session-1", terminalId });

    expect(terminator.terminated).toContain(child);
    expect(child.kill).not.toHaveBeenCalled();
    await expect(session.terminalOutput({ sessionId: "session-1", terminalId })).rejects.toThrow(
      `Unknown terminal '${terminalId}'`,
    );
  });
});

describe("ACPAgentSession initialization cleanup", () => {
  test("terminates the ACP process when session/new fails", async () => {
    const terminator = new FakeTerminator();
    const child = createProbeChildStub();

    class FailingNewSession extends ACPAgentSession {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child,
          connection: {
            newSession: vi.fn().mockRejectedValue(new Error("session/new failed")),
          } as unknown as ClientSideConnection,
          initialize: { agentCapabilities: {} },
        };
      }
    }

    const session = new FailingNewSession(
      { provider: "copilot", cwd: "/tmp/paseo-acp-test" },
      {
        provider: "copilot",
        logger: createTestLogger(),
        defaultCommand: ["copilot", "--acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
        },
        terminateProcess: terminator.terminate,
      },
    );

    await expect(session.initializeNewSession()).rejects.toThrow("session/new failed");

    expect(terminator.terminated).toContain(child);
  });

  test("terminates the ACP process when session/load fails", async () => {
    const terminator = new FakeTerminator();
    const child = createProbeChildStub();

    class FailingLoadSession extends ACPAgentSession {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child,
          connection: {
            loadSession: vi.fn().mockRejectedValue(new Error("session/load failed")),
          } as unknown as ClientSideConnection,
          initialize: { agentCapabilities: { loadSession: true } },
        };
      }
    }

    const session = new FailingLoadSession(
      { provider: "cursor", cwd: "/tmp/paseo-acp-test" },
      {
        provider: "cursor",
        logger: createTestLogger(),
        defaultCommand: ["cursor-agent", "acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
        },
        handle: { provider: "cursor", sessionId: "session-1" },
        terminateProcess: terminator.terminate,
      },
    );

    await expect(session.initializeResumedSession()).rejects.toThrow("session/load failed");

    expect(terminator.terminated).toContain(child);
  });
});

describe("ACPAgentClient probe cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("terminates the probe process tree and closes its stdio", async () => {
    const terminator = new FakeTerminator();
    const child = createProbeChildStub();

    class TestACPAgentClient extends ACPAgentClient {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child,
          connection: {
            newSession: vi.fn().mockResolvedValue({
              modes: null,
              models: null,
              configOptions: [],
            }),
          },
          initialize: { agentCapabilities: {} },
        } as SpawnedACPProcess;
      }
    }

    const client = new TestACPAgentClient({
      provider: "claude-acp",
      logger: createTestLogger(),
      defaultCommand: ["claude", "--acp"],
      defaultModes: [],
      terminateProcess: terminator.terminate,
    });

    await client.fetchCatalog({ scope: "workspace", cwd: "/tmp/acp-models", force: false });

    expect(terminator.terminated).toContain(child);
    expect(child.stdin.destroyed).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
  });
});

describe("ACP session/load invariant — cwd and mcpServers always passed", () => {
  /**
   * Shared factory: creates an ACPAgentSession subclass whose spawnProcess
   * returns stubbed ACP internals so tests can inspect connection method calls
   * without spawning real processes. Each call produces fresh vi.fn() stubs.
   */
  function makeTestSession(args: {
    capabilities?: AgentCapabilityFlags;
    handle: AgentPersistenceHandle;
    loadSession?: ReturnType<typeof vi.fn>;
    unstableResumeSession?: ReturnType<typeof vi.fn>;
  }) {
    const loadSession =
      args.loadSession ??
      vi.fn().mockResolvedValue({
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      });
    const unstableResumeSession =
      args.unstableResumeSession ??
      vi.fn().mockResolvedValue({
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      });

    class TestSession extends ACPAgentSession {
      protected override async spawnProcess(): Promise<SpawnedACPProcess> {
        return {
          child: createProbeChildStub(),
          connection: {
            prompt: vi.fn(),
            loadSession,
            unstable_resumeSession: unstableResumeSession,
          } as unknown as ClientSideConnection,
          initialize: { agentCapabilities: args.capabilities ?? {} },
        } as SpawnedACPProcess;
      }
    }

    // Pass handle through the typed constructor option (no private-field casts).
    const session = new TestSession(
      { provider: "claude-acp", cwd: "/tmp/paseo-acp-test" },
      {
        provider: "claude-acp",
        logger: createTestLogger(),
        defaultCommand: ["claude", "--acp"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
          ...args.capabilities,
        },
        handle: args.handle,
      },
    );

    return { session, loadSession, unstableResumeSession };
  }

  test("loadSession is always called with sessionId, cwd, and mcpServers even when mcpServers is empty", async () => {
    const { session, loadSession } = makeTestSession({
      capabilities: { loadSession: true, supportsMcpServers: true },
      handle: { sessionId: "session-1", provider: "claude-acp" },
    });

    await session.initializeResumedSession();

    expect(loadSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cwd: "/tmp/paseo-acp-test",
      mcpServers: [],
    });
  });

  test("preserves assistant message IDs from loadSession replay", async () => {
    let session!: ACPAgentSession;
    const loadSession = async () => {
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "assistant-replay-1",
          content: { type: "text", text: "Welcome back" },
        } as SessionUpdate,
      });
      return {
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      };
    };
    ({ session } = makeTestSession({
      capabilities: { loadSession: true },
      handle: { sessionId: "session-1", provider: "claude-acp" },
      loadSession,
    }));

    await session.initializeResumedSession();

    const history: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) {
      history.push(event);
    }
    expect(history).toEqual([
      {
        type: "timeline",
        provider: "claude-acp",
        item: {
          type: "assistant_message",
          text: "Welcome back",
          messageId: "assistant-replay-1",
        },
      },
    ]);
  });

  test("coalesces an ID-less text and image user message during loadSession replay", async () => {
    let session!: ACPAgentSession;
    const loadSession = async () => {
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "hey" },
        } as SessionUpdate,
      });
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "image", data: "AA==", mimeType: "image/png" },
        } as SessionUpdate,
      });
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "assistant-replay-1",
          content: { type: "text", text: "Hello" },
        } as SessionUpdate,
      });
      return {
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      };
    };
    ({ session } = makeTestSession({
      capabilities: { loadSession: true },
      handle: { sessionId: "session-1", provider: "test-acp" },
      loadSession,
    }));

    await session.initializeResumedSession();

    const history: AgentStreamEvent[] = [];
    for await (const event of session.streamHistory()) {
      history.push(event);
    }
    expect(history).toEqual([
      {
        type: "timeline",
        provider: session.provider,
        item: { type: "user_message", text: "hey[image]" },
      },
      {
        type: "timeline",
        provider: session.provider,
        item: {
          type: "assistant_message",
          text: "Hello",
          messageId: "assistant-replay-1",
        },
      },
    ]);
  });

  test("assigns stable fallback IDs to ID-less assistant messages during loadSession replay", async () => {
    let session!: ACPAgentSession;
    const loadSession = async () => {
      for (const text of ["Loaded", " response"]) {
        await session.sessionUpdate({
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          } as SessionUpdate,
        });
      }
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Follow up" },
        } as SessionUpdate,
      });
      await session.sessionUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Loaded second response" },
        } as SessionUpdate,
      });
      return {
        sessionId: "session-1",
        modes: null,
        models: null,
        configOptions: [],
      };
    };
    ({ session } = makeTestSession({
      capabilities: { loadSession: true },
      handle: { sessionId: "session-1", provider: "claude-acp" },
      loadSession,
    }));

    await session.initializeResumedSession();

    const assistantMessages: Array<{ text: string; messageId?: string }> = [];
    for await (const event of session.streamHistory()) {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        assistantMessages.push(event.item);
      }
    }
    expect(assistantMessages).toHaveLength(3);
    expect(assistantMessages[0].messageId).toEqual(expect.any(String));
    expect(assistantMessages[1].messageId).toBe(assistantMessages[0].messageId);
    expect(assistantMessages[2].messageId).toEqual(expect.any(String));
    expect(assistantMessages[2].messageId).not.toBe(assistantMessages[0].messageId);
  });

  test("loadSession is always called with mcpServers even when supportsMcpServers is false", async () => {
    const { session, loadSession } = makeTestSession({
      capabilities: { loadSession: true, supportsMcpServers: false },
      handle: { sessionId: "session-1", provider: "claude-acp" },
    });

    await session.initializeResumedSession();

    // Even with supportsMcpServers=false, mcpServers: [] must still be passed
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cwd: "/tmp/paseo-acp-test",
      mcpServers: [],
    });
  });

  test("unstable_resumeSession is always called with sessionId, cwd, and mcpServers", async () => {
    const { session, unstableResumeSession } = makeTestSession({
      capabilities: { sessionCapabilities: { resume: {} } },
      handle: { sessionId: "session-1", provider: "claude-acp" },
    });

    await session.initializeResumedSession();

    expect(unstableResumeSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      cwd: "/tmp/paseo-acp-test",
      mcpServers: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic ACP stop boundary.
//
// A foreground replacement may be staged while a stop is installed, but it
// cannot reserve the foreground slot, allocate a turn id, emit an event, or
// send a prompt until the stopped turn has an authoritative terminal and every
// cancellation write issued for the stop has settled with the newest one
// successful.
//
// Each test is numbered against the plan's generic ACP unit test list.
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

interface StopBoundaryLogEntry {
  msg: string;
  data: Record<string, unknown> | undefined;
}

function createStopBoundaryLogger(): { logger: Logger; logs: StopBoundaryLogEntry[] } {
  const logger = createTestLogger();
  const spy = vi.spyOn(logger, "info");
  const logs: StopBoundaryLogEntry[] = [];
  spy.mockImplementation((data: unknown, msg?: string) => {
    logs.push({
      msg: msg ?? "",
      data:
        typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined,
    });
    return logger;
  });
  return { logger, logs };
}

type ACPStopBoundaryTerminalEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

interface ACPStopBoundaryInternals {
  sessionId: string | null;
  connection: {
    prompt: (input: {
      sessionId: string;
      messageId: string;
      prompt: unknown;
    }) => Promise<PromptResponse>;
    cancel: (input: { sessionId: string }) => Promise<void>;
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
    terminalDelivered: boolean;
    cancelIssuedRevision: number;
    newestCancelSucceeded: boolean;
    cancelAttempts: Array<{
      revision: number;
      settled: boolean;
      outcome: "pending" | "success" | "rejected";
    }>;
    stagedSuccessor: { token: string } | null;
    releasedSuccessorToken: string | null;
    providerGateSatisfied: boolean;
  } | null;
  child: ChildProcess | null;
  finishTurn(turnId: string, event: ACPStopBoundaryTerminalEvent): void;
}

/** The session subclass a provider fork would build on: invalidation by token. */
class StopBoundarySession extends ACPAgentSession {
  invalidateStagedReplacement(reason: string): void {
    const stop = this.getCurrentStop();
    if (stop) {
      this.invalidateStagedSuccessor(stop, reason);
    }
  }
  /** Exposes the death-signal subscription so the harness can simulate transport death. */
  bindConnectionDeathSignal(): void {
    const connection = this.getAcpConnection();
    if (connection) {
      this.observeConnectionDeath(connection);
    }
  }
}

interface ACPStopBoundaryHarness {
  session: StopBoundarySession;
  internals: ACPStopBoundaryInternals;
  prompt: DeferredCalls<PromptResponse>;
  cancel: DeferredCalls<void>;
  connectionDeath: AbortController;
  events: AgentStreamEvent[];
  logs: StopBoundaryLogEntry[];
}

function createStopBoundarySession(terminateProcess?: ProcessTerminator): ACPStopBoundaryHarness {
  const { logger, logs } = createStopBoundaryLogger();
  const session = new StopBoundarySession(
    { provider: "claude-acp", cwd: "/tmp/paseo-acp-test" },
    {
      provider: "claude-acp",
      logger,
      defaultCommand: ["claude", "--acp"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      ...(terminateProcess ? { terminateProcess } : {}),
    },
  );

  const prompt = createDeferredCalls<PromptResponse>();
  const cancel = createDeferredCalls<void>();
  const connectionDeath = new AbortController();
  const internals = asInternals<ACPStopBoundaryInternals>(session);
  internals.sessionId = "session-1";
  internals.connection = {
    prompt: prompt.fn,
    cancel: cancel.fn,
    // Death is simulated by aborting the connection's close signal, matching
    // the SDK's ClientSideConnection#signal behavior.
    signal: connectionDeath.signal,
  };
  internals.connectionRevision = 1;
  session.bindConnectionDeathSignal();

  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));

  return { session, internals, prompt, cancel, connectionDeath, events, logs };
}

/** Drains promise microtasks without touching the fake clock. */
async function flushMicrotasks(count = 10): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function startForegroundTurn(harness: ACPStopBoundaryHarness, text: string): Promise<string> {
  const { turnId } = await harness.session.startTurn(text);
  return turnId;
}

/**
 * True once `promise` settles inside a fixed window of resolved microtasks. The
 * race makes the check deterministic: no clock, no sleep, and a rejection that
 * arrives inside the window is handled, not reported unhandled.
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

function turnStartedIds(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === "turn_started" ? [event.turnId] : []));
}

function turnTerminalTypes(events: AgentStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
      ? [event.type]
      : [],
  );
}

function userMessageEchoes(events: AgentStreamEvent[]): number {
  return events.filter((event) => event.type === "timeline" && event.item.type === "user_message")
    .length;
}

function cancelledTurnEvent(turnId: string, reason: string): ACPStopBoundaryTerminalEvent {
  return { type: "turn_canceled", provider: "claude-acp", reason, turnId };
}

describe("ACPAgentSession stop boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("1. holds the replacement until the cancellation write settles and the terminal arrives", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");

    const interrupting = harness.session.interrupt();
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.cancel.calls).toHaveLength(1);

    const staged = harness.session.startTurn("replacement");
    expect(harness.prompt.calls).toHaveLength(1);

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    await flushMicrotasks();

    // The write settled, but the turn has no terminal yet: nothing is released.
    expect(harness.prompt.calls).toHaveLength(1);
    expect(turnStartedIds(harness.events)).toEqual([turnId]);
    expect(await hasSettled(staged)).toBe(false);

    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
  });

  test("2. holds the replacement until the terminal arrives and the cancellation write settles", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");

    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
    expect(harness.events[harness.events.length - 1]).toMatchObject({
      type: "turn_canceled",
      turnId,
    });
    expect(harness.prompt.calls).toHaveLength(1);
    expect(await hasSettled(staged)).toBe(false);

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
  });

  test("3. releases exactly one successor when the two facts arrive in either order", async () => {
    for (const order of ["cancel-first", "terminal-first"] as const) {
      const harness = createStopBoundarySession();
      const turnId = await startForegroundTurn(harness, "first");
      const interrupting = harness.session.interrupt();
      const staged = harness.session.startTurn("replacement");

      if (order === "cancel-first") {
        harness.cancel.calls[0]?.resolve();
        await interrupting;
        await flushMicrotasks();
        expect(harness.prompt.calls).toHaveLength(1);
        harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
      } else {
        harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
        await flushMicrotasks();
        expect(harness.prompt.calls).toHaveLength(1);
        harness.cancel.calls[0]?.resolve();
        await interrupting;
      }
      await flushMicrotasks();

      const successor = await staged;
      expect(harness.prompt.calls).toHaveLength(2);
      expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
      expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
      expect(harness.internals.admissionState).toBe("running");
      expect(harness.internals.activeForegroundTurnId).toBe(successor.turnId);
      expect(harness.internals.stop).toBeNull();
    }
  });

  test("4. keeps the session stopping with no successor prompt and no synthetic terminal when the write rejects", async () => {
    const harness = createStopBoundarySession();
    await startForegroundTurn(harness, "first");

    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.cancel.calls[0]?.reject(new Error("cancel failed"));
    await expect(interrupting).rejects.toThrow("cancel failed");

    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.prompt.calls).toHaveLength(1);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.terminalObserved).toBe(true);
    expect(harness.internals.stop?.cancelAttempts).toEqual([
      { revision: 1, settled: true, outcome: "rejected" },
    ]);
    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
    expect(await hasSettled(staged)).toBe(false);
  });

  test("5. releases only after a newer successful write recovers an older rejected one", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");

    const firstStop = harness.session.interrupt();
    harness.cancel.calls[0]?.reject(new Error("cancel failed"));
    await expect(firstStop).rejects.toThrow("cancel failed");
    const stopId = harness.internals.stop?.stopId;

    const staged = harness.session.startTurn("replacement");
    const secondStop = harness.session.interrupt();
    await expect(staged).rejects.toThrow("invalidated (interrupt)");
    expect(harness.internals.stop?.stopId).toBe(stopId);
    expect(harness.internals.stop?.stoppedTurnId).toBe(turnId);
    expect(harness.cancel.calls).toHaveLength(2);
    expect(harness.internals.stop?.cancelIssuedRevision).toBe(2);

    harness.cancel.calls[1]?.resolve();
    await secondStop;
    expect(await hasSettled(staged)).toBe(true);

    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.internals.stop?.cancelAttempts).toEqual([
      { revision: 1, settled: true, outcome: "rejected" },
      { revision: 2, settled: true, outcome: "success" },
    ]);
    expect(harness.prompt.calls).toHaveLength(1);

    const successor = await harness.session.startTurn("replacement-2");
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
    expect(harness.internals.admissionState).toBe("running");
    expect(harness.internals.stop).toBeNull();
  });

  test("6. stays stopping when the newest write rejects after an older success", async () => {
    const harness = createStopBoundarySession();
    await startForegroundTurn(harness, "first");

    const firstStop = harness.session.interrupt();
    harness.cancel.calls[0]?.resolve();
    await firstStop;

    const staged = harness.session.startTurn("replacement");
    const secondStop = harness.session.interrupt();
    await expect(staged).rejects.toThrow("invalidated (interrupt)");

    harness.cancel.calls[1]?.reject(new Error("cancel failed"));
    await expect(secondStop).rejects.toThrow("cancel failed");

    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.prompt.calls).toHaveLength(1);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.cancelAttempts).toEqual([
      { revision: 1, settled: true, outcome: "success" },
      { revision: 2, settled: true, outcome: "rejected" },
    ]);
  });

  test("7. waits for every issued write to settle, requires the newest to succeed, and writes nothing after release", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");

    const firstStop = harness.session.interrupt();
    const secondStop = harness.session.interrupt();
    const thirdStop = harness.session.interrupt();
    expect(harness.cancel.calls).toHaveLength(3);
    expect(harness.cancel.inputs).toEqual([
      { sessionId: "session-1" },
      { sessionId: "session-1" },
      { sessionId: "session-1" },
    ]);
    expect(harness.internals.stop?.cancelIssuedRevision).toBe(3);

    const staged = harness.session.startTurn("replacement");

    // Settlement order belongs to the connection; only the newest write has to
    // succeed, and only once nothing is left outstanding.
    harness.cancel.calls[1]?.resolve();
    await secondStop;
    expect(await hasSettled(staged)).toBe(false);

    harness.cancel.calls[0]?.resolve();
    await firstStop;
    expect(await hasSettled(staged)).toBe(false);

    harness.cancel.calls[2]?.resolve();
    await thirdStop;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.cancel.calls).toHaveLength(3);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
    expect(harness.internals.stop).toBeNull();
  });

  test("8. rejects a start that races a running foreground turn", async () => {
    const harness = createStopBoundarySession();
    await startForegroundTurn(harness, "first");

    await expect(harness.session.startTurn("second")).rejects.toThrow(
      "A foreground turn is already active",
    );
    expect(harness.prompt.calls).toHaveLength(1);
    expect(harness.internals.admissionState).toBe("running");
  });

  test("9. rejects a second start while one successor is staged and keeps the first waiter", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    await expect(harness.session.startTurn("other")).rejects.toThrow(
      "A foreground turn is already active",
    );
    expect(harness.internals.stop?.stagedSuccessor).not.toBeNull();
    expect(harness.internals.stop?.releasedSuccessorToken).toBeNull();

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
  });

  test("10. reserves nothing when the session identity changes before the commit", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    // A replacement connection while the stop is installed: the stop can no
    // longer prove anything on the new identity.
    const replacementPrompt = createDeferredCalls<PromptResponse>();
    harness.internals.connection = {
      prompt: replacementPrompt.fn,
      cancel: harness.cancel.fn,
    };
    harness.internals.connectionRevision = 2;

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.prompt.calls).toHaveLength(1);
    expect(replacementPrompt.calls).toHaveLength(0);
    expect(turnStartedIds(harness.events)).toEqual([turnId]);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(await hasSettled(staged)).toBe(false);

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow("still being stopped");
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.stopId).toBe(stopId);
  });

  test("11. commits the successor synchronously once the gates release it", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    // When the awaited admission resolves, the turn id, the turn_started event,
    // and the prompt write already exist: nothing observable sits between the
    // reservation and the start.
    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
    expect(harness.prompt.inputs[1]).toMatchObject({
      sessionId: "session-1",
      messageId: expect.any(String),
    });
    expect(harness.internals.activeForegroundTurnId).toBe(successor.turnId);
    expect(harness.internals.admissionState).toBe("running");
    expect(harness.internals.stop).toBeNull();
  });

  test("12. rejects the staged waiter at the deadline without sending, echoing, or opening readiness", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS - 1);
    expect(await hasSettled(staged)).toBe(false);
    expect(harness.prompt.calls).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await expect(staged).rejects.toThrow(
      `claude-acp replacement turn was not admitted within ${ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS}ms`,
    );

    expect(harness.prompt.calls).toHaveLength(1);
    expect(turnStartedIds(harness.events)).toEqual([turnId]);
    expect(userMessageEchoes(harness.events)).toBe(1);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.stagedSuccessor).toBeNull();
    expect(harness.internals.stop?.stopId).toBe(stopId);
    void interrupting;
  });

  test("13. leaves an expired waiter dead and admits a later request on its own facts", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow("not admitted");

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    // The expired waiter cannot be resurrected: no prompt appears for it when
    // the stop's facts complete.
    expect(harness.prompt.calls).toHaveLength(1);

    const successor = await harness.session.startTurn("replacement-2");
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
    expect(harness.internals.stop).toBeNull();
  });

  test("14. invalidates a staged successor by token while the stop identity stays put", async () => {
    const harness = createStopBoundarySession();
    await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    harness.session.invalidateStagedReplacement("manager-cancelled");
    await expect(staged).rejects.toThrow("invalidated (manager-cancelled)");
    expect(harness.internals.stop?.stopId).toBe(stopId);
    expect(harness.internals.stop?.stagedSuccessor).toBeNull();
    expect(harness.prompt.calls).toHaveLength(1);

    // The invalidated deadline is gone with it: the next staged successor gets a
    // full window instead of expiring on the previous one's clock.
    const next = harness.session.startTurn("replacement-2");
    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS - 1);
    expect(await hasSettled(next)).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(next).rejects.toThrow("not admitted");
    void interrupting;
  });

  test("15. retries the same stop with a new attempt revision and drops the staged successor", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const firstStop = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    const secondStop = harness.session.interrupt();
    await expect(staged).rejects.toThrow("invalidated (interrupt)");
    expect(harness.internals.stop?.stopId).toBe(stopId);
    expect(harness.internals.stop?.stoppedTurnId).toBe(turnId);
    expect(harness.cancel.calls).toHaveLength(2);
    expect(harness.internals.stop?.cancelIssuedRevision).toBe(2);

    harness.cancel.calls[1]?.resolve();
    await secondStop;
    harness.cancel.calls[0]?.resolve();
    await firstStop;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.prompt.calls).toHaveLength(1);
    expect(harness.internals.admissionState).toBe("stopping");

    const successor = await harness.session.startTurn("replacement-2");
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
  });

  test("16. rejects the waiter on close, tears the child down, and ignores late settlements", async () => {
    const terminator = new FakeTerminator();
    const harness = createStopBoundarySession(terminator.terminate);
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    const child = createTerminalChildStub();
    harness.internals.child = child;

    harness.cancel.calls[0]?.resolve();
    await interrupting;

    const stagedRejection = expect(staged).rejects.toThrow("invalidated (closed)");
    const closing = harness.session.close();
    await flushMicrotasks();
    // Close issues its own cancellation write on the way out; settle it.
    expect(harness.cancel.calls).toHaveLength(2);
    harness.cancel.calls[1]?.resolve();
    await closing;

    await stagedRejection;
    // The dropped stop settled through the one death path: its write, which
    // had resolved as the SDK's swallowed-write "success", is now rejected.
    const deathSettled = harness.logs.find((log) => log.msg === "provider.acp.stop_death_settled");
    expect(deathSettled?.data).toMatchObject({ stopId, attempts: 1, reason: "closed" });
    expect(terminator.terminated).toContain(child);

    const eventCount = harness.events.length;
    // The terminal that arrives after close emits nothing: the session is closed
    // and produces no stale terminal.
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(harness.events).toHaveLength(eventCount);
    expect(turnStartedIds(harness.events)).toEqual([turnId]);
    expect(harness.prompt.calls).toHaveLength(1);
    await expect(harness.session.startTurn("late")).rejects.toThrow("claude-acp session is closed");
    expect(harness.internals.child).toBeNull();
  });

  test("17. routes a permission denial through the same boundary before cancelling", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");

    const permission = harness.session.requestPermission({
      sessionId: "session-1",
      toolCall: { toolCallId: "tool-1", title: "Edit file", kind: "edit", status: "pending" },
      options: [
        { optionId: "allow-once", name: "Allow", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    } satisfies RequestPermissionRequest);
    await flushMicrotasks();

    const requested = harness.events.find((event) => event.type === "permission_requested");
    if (requested?.type !== "permission_requested") {
      throw new Error("Expected a permission request");
    }

    const denying = harness.session.respondToPermission(requested.request.id, {
      behavior: "deny",
      interrupt: true,
    });
    await flushMicrotasks();

    expect(harness.internals.admissionState).toBe("stopping");
    expect(harness.internals.stop?.stoppedTurnId).toBe(turnId);
    expect(harness.cancel.calls).toHaveLength(1);
    expect(harness.cancel.inputs).toEqual([{ sessionId: "session-1" }]);
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });

    const staged = harness.session.startTurn("replacement");
    expect(harness.prompt.calls).toHaveLength(1);
    expect(await hasSettled(staged)).toBe(false);

    harness.cancel.calls[0]?.resolve();
    await denying;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
  });

  test("18. keeps a duplicate and a late stopped-turn terminal from clearing the successor", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    // The terminal lands while the cancellation write is still outstanding, so
    // the stop stays installed and proof can be replayed against it.
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
    expect(harness.internals.stop?.terminalObserved).toBe(true);
    expect(harness.internals.stop?.terminalDelivered).toBe(true);
    expect(harness.internals.admissionState).toBe("stopping");

    // Same explicit id, same stop: proof is idempotent and the event is not
    // delivered a second time.
    harness.internals.finishTurn(turnId, {
      type: "turn_failed",
      provider: "claude-acp",
      error: "duplicate terminal",
      turnId,
    });
    await flushMicrotasks();
    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    await flushMicrotasks();

    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);

    // The stopped turn's id again, now that a successor owns the foreground
    // slot: the late terminal is dropped instead of clearing it.
    harness.internals.finishTurn(turnId, cancelledTurnEvent(turnId, "late"));
    await flushMicrotasks();

    expect(harness.internals.activeForegroundTurnId).toBe(successor.turnId);
    expect(harness.internals.admissionState).toBe("running");
    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled"]);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);
  });

  test("19. keeps an old connection's settled cancellation write from opening a replaced session", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");
    const stopId = harness.internals.stop?.stopId;

    const replacementPrompt = createDeferredCalls<PromptResponse>();
    harness.internals.connection = {
      prompt: replacementPrompt.fn,
      cancel: harness.cancel.fn,
    };
    harness.internals.connectionRevision = 2;

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    // The write settled successfully and the terminal arrived, but neither is
    // proof on an identity the stop did not capture.
    expect(harness.internals.stop?.cancelAttempts).toEqual([
      { revision: 1, settled: true, outcome: "success" },
    ]);
    expect(harness.internals.stop?.terminalObserved).toBe(false);
    expect(harness.internals.admissionState).toBe("stopping");
    expect(turnStartedIds(harness.events)).toEqual([turnId]);
    expect(harness.prompt.calls).toHaveLength(1);
    expect(replacementPrompt.calls).toHaveLength(0);

    vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
    await expect(staged).rejects.toThrow("not admitted");
    expect(replacementPrompt.calls).toHaveLength(0);
    expect(harness.internals.stop?.stopId).toBe(stopId);
  });

  test("20. rolls back only the failed successor's reservation when its prompt send rejects", async () => {
    const harness = createStopBoundarySession();
    const turnId = await startForegroundTurn(harness, "first");
    const interrupting = harness.session.interrupt();
    const staged = harness.session.startTurn("replacement");

    harness.cancel.calls[0]?.resolve();
    await interrupting;
    harness.prompt.calls[0]?.resolve({ stopReason: "cancelled" });
    await flushMicrotasks();

    // The successor is admitted through the released gates and its prompt is
    // sent; the send then fails.
    const successor = await staged;
    expect(harness.prompt.calls).toHaveLength(2);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId]);

    harness.prompt.calls[1]?.reject(new Error("prompt send failed"));
    await flushMicrotasks();

    // The failed send rolls back only the successor's own reservation: the
    // turn_failed is delivered for the successor alone, and the resolved stop
    // is not re-fenced over the session.
    expect(turnTerminalTypes(harness.events)).toEqual(["turn_canceled", "turn_failed"]);
    expect(harness.events[harness.events.length - 1]).toMatchObject({
      type: "turn_failed",
      turnId: successor.turnId,
    });
    expect(harness.internals.stop).toBeNull();
    expect(harness.internals.admissionState).toBe("idle");
    expect(harness.internals.activeForegroundTurnId).toBeNull();

    // A later start is evaluated on its own facts, not blocked by the old stop.
    const next = await harness.session.startTurn("next");
    expect(harness.prompt.calls).toHaveLength(3);
    expect(turnStartedIds(harness.events)).toEqual([turnId, successor.turnId, next.turnId]);
    expect(harness.internals.admissionState).toBe("running");
  });

  test("21. settles the ledger rejected and rejects the staged successor immediately on observed death", async () => {
    // An in-flight (pending) cancel write: death settles it rejected, and the
    // staged successor is rejected without burning the admission deadline.
    {
      const harness = createStopBoundarySession();
      const turnId = await startForegroundTurn(harness, "first");
      const interrupting = harness.session.interrupt();
      const staged = harness.session.startTurn("replacement");
      const stopId = harness.internals.stop?.stopId;

      // Observed death over the connection's close signal, with the write and
      // the admission deadline both still pending.
      harness.connectionDeath.abort();
      await flushMicrotasks();

      // Immediate rejection: asserted before any fake time has advanced.
      await expect(staged).rejects.toThrow("invalidated (connection-aborted)");
      expect(harness.internals.stop?.stopId).toBe(stopId);
      expect(harness.internals.stop?.cancelAttempts).toEqual([
        { revision: 1, settled: true, outcome: "rejected" },
      ]);
      expect(harness.internals.stop?.newestCancelSucceeded).toBe(false);
      expect(harness.internals.stop?.stagedSuccessor).toBeNull();
      expect(harness.internals.stop?.terminalObserved).toBe(false);
      expect(harness.prompt.calls).toHaveLength(1);
      expect(turnStartedIds(harness.events)).toEqual([turnId]);
      expect(turnTerminalTypes(harness.events)).toEqual([]);

      // The write resolves after death, mimicking the SDK's swallowed write
      // error on a dead pipe: the real settlement path must not reopen the
      // ledger death closed.
      harness.cancel.calls[0]?.resolve();
      await interrupting;
      await flushMicrotasks();
      expect(harness.internals.stop?.cancelAttempts).toEqual([
        { revision: 1, settled: true, outcome: "rejected" },
      ]);
      expect(harness.internals.stop?.newestCancelSucceeded).toBe(false);

      // The cleared deadline stays quiet when the clock runs out.
      vi.advanceTimersByTime(ACP_STOPPED_TURN_ADMISSION_TIMEOUT_MS);
      await flushMicrotasks();
      expect(harness.prompt.calls).toHaveLength(1);
      expect(turnStartedIds(harness.events)).toEqual([turnId]);

      const deathSettled = harness.logs.find(
        (log) => log.msg === "provider.acp.stop_death_settled",
      );
      expect(deathSettled?.data).toMatchObject({
        stopId,
        attempts: 1,
        reason: "connection-aborted",
      });
    }

    // The inverted mode: the cancel write RESOLVED — the SDK swallows write
    // errors on a dead pipe, so an undelivered cancel recorded a settled
    // success. Death must override the false success.
    {
      const harness = createStopBoundarySession();
      const turnId = await startForegroundTurn(harness, "first");
      const interrupting = harness.session.interrupt();
      harness.cancel.calls[0]?.resolve();
      await interrupting;
      const staged = harness.session.startTurn("replacement");

      expect(harness.internals.stop?.cancelAttempts).toEqual([
        { revision: 1, settled: true, outcome: "success" },
      ]);
      expect(harness.internals.stop?.newestCancelSucceeded).toBe(true);

      harness.connectionDeath.abort();
      await flushMicrotasks();

      await expect(staged).rejects.toThrow("invalidated (connection-aborted)");
      expect(harness.internals.stop?.cancelAttempts).toEqual([
        { revision: 1, settled: true, outcome: "rejected" },
      ]);
      expect(harness.internals.stop?.newestCancelSucceeded).toBe(false);
      expect(harness.prompt.calls).toHaveLength(1);
      expect(turnStartedIds(harness.events)).toEqual([turnId]);
    }
  });

  test("exposes the provider-neutral seams a provider subclass builds on", () => {
    class SeamProbe extends ACPAgentSession {
      readSeams(name: string): {
        launchEnvValue: string | undefined;
        missingLaunchEnvValue: string | undefined;
        foregroundTurnId: string | null;
        admissionState: ACPAdmissionState;
        stopId: string | null;
      } {
        return {
          launchEnvValue: this.getLaunchEnv(name),
          missingLaunchEnvValue: this.getLaunchEnv("PASEO_MISSING_KEY"),
          foregroundTurnId: this.getForegroundTurnId(),
          admissionState: this.getAdmissionState(),
          stopId: this.getCurrentStop()?.stopId ?? null,
        };
      }
    }

    const session = new SeamProbe(
      { provider: "claude-acp", cwd: "/tmp/paseo-acp-test" },
      {
        provider: "claude-acp",
        logger: createTestLogger(),
        defaultCommand: ["claude", "--acp"],
        defaultModes: [],
        capabilities: { supportsStreaming: true },
        launchEnv: { PASEO_ACP_STOP_SCOPE: "adapter-owned" },
      },
    );

    expect(session.readSeams("PASEO_ACP_STOP_SCOPE")).toEqual({
      launchEnvValue: "adapter-owned",
      missingLaunchEnvValue: undefined,
      foregroundTurnId: null,
      admissionState: "idle",
      stopId: null,
    });
  });
});
