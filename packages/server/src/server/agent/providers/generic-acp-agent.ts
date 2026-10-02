import type { Logger } from "pino";
import { z } from "zod";

import type {
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
} from "../agent-sdk-types.js";
import { checkProviderLaunchAvailable, resolveProviderLaunch } from "../provider-launch-config.js";
import {
  ACPAgentClient,
  type ACPCatalogModelResolver,
  type ACPClientCapabilityMeta,
  type ACPConfigFeatureOption,
  DEFAULT_ACP_CAPABILITIES,
  type ACPExtensionCommandsParser,
} from "./acp-agent.js";
import {
  buildBinaryDiagnosticRows,
  formatProviderDiagnostic,
  type DiagnosticEntry,
  toDiagnosticErrorMessage,
} from "./diagnostic-utils.js";

const GenericACPCommandWaitOptionsSchema = z.object({
  waitForInitialCommands: z.boolean().optional(),
  initialCommandsWaitTimeoutMs: z.number().int().positive().optional(),
});

interface GenericACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  waitForInitialCommands?: boolean;
  initialCommandsWaitTimeoutMs?: number;
  diagnosticPhaseTimeoutMs?: number;
  clientCapabilityMeta?: ACPClientCapabilityMeta;
  configFeatureOptions?: ACPConfigFeatureOption[];
  extensionCommandsParser?: ACPExtensionCommandsParser;
  catalogModelResolver?: ACPCatalogModelResolver;
  now?: () => number;
}

export class GenericACPAgentClient extends ACPAgentClient {
  private readonly genericOptions: GenericACPAgentClientOptions;
  private readonly command: [string, ...string[]];
  private readonly providerId?: string;
  private readonly label?: string;
  private readonly diagnosticPhaseTimeoutMs?: number;

  constructor(options: GenericACPAgentClientOptions) {
    super({
      provider: "acp",
      logger: options.logger,
      runtimeSettings: {
        env: options.env,
      },
      defaultCommand: options.command,
      capabilities: DEFAULT_ACP_CAPABILITIES,
      // ACP agents advertise slash commands with available_commands_update after
      // session/new, so the first listCommands() waits for that batch.
      waitForInitialCommands: options.waitForInitialCommands ?? true,
      initialCommandsWaitTimeoutMs: options.initialCommandsWaitTimeoutMs,
      clientCapabilityMeta: options.clientCapabilityMeta,
      configFeatureOptions: options.configFeatureOptions,
      extensionCommandsParser: options.extensionCommandsParser,
      catalogModelResolver: options.catalogModelResolver,
      now: options.now,
    });

    this.genericOptions = options;
    this.command = options.command;
    this.providerId = options.providerId;
    this.label = options.label;
    this.diagnosticPhaseTimeoutMs = options.diagnosticPhaseTimeoutMs;
  }

  override async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return this.forSessionOptions(config.providerOptions).createSessionWithConfiguredWait(
      config,
      launchContext,
    );
  }

  override async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const storedOptions = (handle.metadata as Partial<AgentSessionConfig> | undefined)?.providerOptions;
    return this.forSessionOptions(overrides?.providerOptions ?? storedOptions).resumeSessionWithConfiguredWait(
      handle,
      overrides,
      launchContext,
    );
  }

  private forSessionOptions(
    providerOptions: AgentSessionConfig["providerOptions"],
  ): GenericACPAgentClient {
    const waitOptions = GenericACPCommandWaitOptionsSchema.parse(providerOptions ?? {});
    const waitForInitialCommands =
      this.genericOptions.waitForInitialCommands ?? waitOptions.waitForInitialCommands ?? true;
    const initialCommandsWaitTimeoutMs =
      this.genericOptions.initialCommandsWaitTimeoutMs ?? waitOptions.initialCommandsWaitTimeoutMs;

    if (
      waitForInitialCommands === (this.genericOptions.waitForInitialCommands ?? true) &&
      initialCommandsWaitTimeoutMs === this.genericOptions.initialCommandsWaitTimeoutMs
    ) {
      return this;
    }

    // The ACP base reads wait settings at construction, so configure a client for this session.
    return new GenericACPAgentClient({
      ...this.genericOptions,
      waitForInitialCommands,
      initialCommandsWaitTimeoutMs,
    });
  }

  private createSessionWithConfiguredWait(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return super.createSession(config, launchContext);
  }

  private resumeSessionWithConfiguredWait(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return super.resumeSession(handle, overrides, launchContext);
  }

  protected override async resolveLaunchCommand(): Promise<{ command: string; args: string[] }> {
    return {
      command: this.command[0],
      args: this.command.slice(1),
    };
  }

  override async isAvailable(): Promise<boolean> {
    const launch = await this.resolveConfiguredLaunch();
    const availability = await checkProviderLaunchAvailable(launch);
    return availability.available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    const providerName = formatProviderName(this.label, this.providerId);
    const entries: DiagnosticEntry[] = [
      { label: "Provider ID", value: this.providerId ?? "unknown" },
      { label: "Configured command", value: this.command.join(" ") },
    ];
    const versionProbe = buildVersionProbeCommand(this.command);

    try {
      const launch = await this.resolveConfiguredLaunch();
      const availability = await checkProviderLaunchAvailable(launch);
      entries.push(
        ...(await buildBinaryDiagnosticRows(launch, availability, {
          binaryLabel: "Launcher binary",
          versionCommand: {
            command: versionProbe.command,
            args: versionProbe.args,
            env: this.runtimeSettings?.env,
          },
        })),
      );
    } catch (error) {
      entries.push({
        label: "Launcher binary",
        value: `error: ${toDiagnosticErrorMessage(error)}`,
      });
    }

    entries.push(
      {
        label: "Version command",
        value: formatCommand(versionProbe.command, versionProbe.args),
      },
      ...(await this.getACPProbeRowsForDiagnostic()),
    );

    return {
      diagnostic: formatProviderDiagnostic(providerName, entries),
    };
  }

  private async resolveConfiguredLaunch() {
    return resolveProviderLaunch({
      commandConfig: { mode: "replace", argv: this.command },
      defaultBinary: this.command[0],
    });
  }

  private async getACPProbeRowsForDiagnostic() {
    try {
      return await this.buildACPProbeDiagnosticRows({
        phaseTimeoutMs: this.diagnosticPhaseTimeoutMs,
      });
    } catch (error) {
      return [
        {
          label: "ACP probe",
          value: `error: ${toDiagnosticErrorMessage(error)}`,
        },
      ];
    }
  }
}

export interface CommandInvocation {
  command: string;
  args: string[];
}

function formatProviderName(label: string | undefined, providerId: string | undefined): string {
  if (label) {
    return `${label} (ACP)`;
  }
  if (providerId) {
    return `${providerId} (ACP)`;
  }
  return "Custom ACP";
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export function buildVersionProbeCommand(command: [string, ...string[]]): CommandInvocation {
  const [launcher, ...args] = command;
  if (isPackageRunner(launcher)) {
    return {
      command: launcher,
      args: [...takePackageRunnerPrefix(args), "--version"],
    };
  }

  return {
    command: launcher,
    args: ["--version"],
  };
}

function isPackageRunner(command: string): boolean {
  return ["npx", "bunx", "pnpm", "uvx"].includes(command);
}

function takePackageRunnerPrefix(args: string[]): string[] {
  if (args.length === 0) {
    return [];
  }
  if (args[0] === "dlx") {
    return ["dlx", ...takePackageSpecPrefix(args.slice(1))];
  }
  return takePackageSpecPrefix(args);
}

function takePackageSpecPrefix(args: string[]): string[] {
  const prefix: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    prefix.push(arg);
    if (arg === "--package" || arg === "-p") {
      if (args[index + 1]) {
        prefix.push(args[index + 1]);
        index += 1;
      }
      continue;
    }
    if (!arg.startsWith("-")) {
      break;
    }
  }
  return prefix;
}
