import { buildAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";

/** Keep the source plan intact so the destination can inspect or edit it before sending. */
export function buildPlanHandoffPrompt(input: {
  plan: string;
  source: AgentDeepLinkTarget;
  instruction: string;
}): string {
  return `${input.instruction}\n\n${input.plan}\n\nSource: ${buildAgentDeepLink(input.source)}`;
}
