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
    return {
      steering: metadata.extensions?.includes("shared_control") === true,
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
      steering: sharedControl?.implicitSteering === true,
      stopObservedTurns: sharedControl?.stopObservedTurn === true,
    };
  },
};
