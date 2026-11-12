import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import { z } from "zod";

const connectionMetadata = z
  .object({
    interfaceVersion: z.literal(1),
    extensions: z.array(z.string()).optional(),
    sessionMcpServers: z.boolean().optional(),
  })
  .passthrough();

const attachmentMetadata = z
  .object({
    sharedControl: z
      .object({
        detach: z.boolean().optional(),
        implicitSteering: z.boolean().optional(),
        stopObservedTurn: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function metadataEnvelope<T extends z.ZodType>(metadata: T) {
  return z.object({ _meta: z.object({ jcode: metadata }).passthrough() }).passthrough();
}

const connectionEnvelope = metadataEnvelope(connectionMetadata);
const attachmentEnvelope = metadataEnvelope(attachmentMetadata);

// Contract: camerontaylor/jcode docs/ACP_FORK_INTERFACE.md at
// a047a0c07b1870043db9b655967d64866cd647ed. Only initialize carries interfaceVersion;
// attachment metadata reports effective daemon support without repeating the version.
export const jcodeCapabilities: AcpTransformer = {
  initialize({ agentCapabilities }) {
    const parsed = connectionEnvelope.safeParse(agentCapabilities);
    if (!parsed.success) return null;
    const metadata = parsed.data._meta.jcode;
    const extensions = metadata.extensions ?? [];
    return {
      // V1 never echoes this attachment's prompt or steer, including peer-turn
      // adoption. Contract: ACP_FORK_INTERFACE.md at 39fb7620589835d0c7f1a47653ab74f594b56eaa.
      echoesUserMessages: false,
      steering: extensions.includes("shared_control"),
      turnCorrelation: extensions.includes("turn_correlation"),
      skillSelection: extensions.includes("skill_selection"),
      ...(metadata.sessionMcpServers === false ? { sendSessionMcpServers: false } : {}),
    };
  },
  attach({ response }, context) {
    const initialized = connectionEnvelope.safeParse(context.agentCapabilities);
    if (!initialized.success) return null;
    const parsed = attachmentEnvelope.safeParse(response);
    if (!parsed.success) return null;
    const sharedControl = parsed.data._meta.jcode.sharedControl;
    return {
      detach: sharedControl?.detach === true,
      steering: sharedControl?.implicitSteering === true,
      stopObservedTurns: sharedControl?.stopObservedTurn === true,
    };
  },
  prompt({ skill }) {
    if (skill === undefined) return null;
    return { _meta: { jcode: { skill } } };
  },
  command(commands, context) {
    if (context.policy.skillSelection !== true) return null;
    let changed = false;
    const classified = commands.map((command) => {
      if (command.kind !== undefined) return command;
      if (!isSkillCommand(command)) return command;
      changed = true;
      return { ...command, kind: "skill" as const };
    });
    return changed ? classified : null;
  },
};

// jcode advertises built-in commands and installed skills in one list with no kind field.
// Skills are the entries whose argument hint is the skill request hint; the built-in five
// are the only other entries jcode emits.
const JCODE_BUILTIN_COMMANDS = new Set(["model", "models", "effort", "compact", "subagent"]);

function isSkillCommand(command: { name: string; argumentHint?: string }): boolean {
  if (JCODE_BUILTIN_COMMANDS.has(command.name)) return false;
  return command.argumentHint === "request for this skill (optional)";
}
