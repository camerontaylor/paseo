import type { AgentProviderNotice } from "../../agent-sdk-types.js";
import type { PiAgentMessage, PiModel, PiThinkingLevel } from "./rpc-types.js";

interface PiEffortChange {
  model: PiModel | null | undefined;
  previousLevel: PiThinkingLevel;
  effectiveLevel: PiThinkingLevel;
  hasConversation: boolean;
  messages: readonly PiAgentMessage[];
}

export function getPiEffortChangeNotice(change: PiEffortChange): AgentProviderNotice | undefined {
  // Backend identity comes from Pi's model, not the configurable Paseo provider/profile id.
  // Measured on opencode-go/space-bunny-free; other backends have no established policy here.
  if (
    change.model?.provider !== "opencode-go" ||
    change.previousLevel === change.effectiveLevel ||
    !change.hasConversation
  ) {
    return undefined;
  }

  const latestRequest = change.messages.findLast(
    (message) =>
      message.role === "assistant" &&
      message.provider === change.model?.provider &&
      message.model === change.model?.id,
  );
  const cacheRead =
    latestRequest?.role === "assistant" ? latestRequest.usage?.cacheRead : undefined;
  const observedCache =
    typeof cacheRead === "number" && Number.isSafeInteger(cacheRead) && cacheRead > 0
      ? ` The latest request reused ${cacheRead} cached input tokens; this is an observed count, not a forecast.`
      : " The next request's cache cost is unknown.";

  return {
    type: "warning",
    message:
      `Thinking changed from ${change.previousLevel} to ${change.effectiveLevel}. ` +
      "On opencode-go, changing effort may invalidate the prompt cache and reprocess the conversation on the next request." +
      observedCache +
      " Keep the same effort to preserve cache reuse.",
  };
}
