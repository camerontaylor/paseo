import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import type { ForkAgentRequest } from "@/hooks/use-fork-agent";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { SelectedAssistantText } from "./types";

export function useSelectionToolbarActions(input: {
  active: boolean;
  readOnly: boolean;
  agentId: string;
  context: AgentScreenAgent;
  forkAgent: (request: ForkAgentRequest) => Promise<void>;
}) {
  const onReply = useStableEvent(async (selection: SelectedAssistantText) => {
    await input.forkAgent({
      agentId: input.agentId,
      agent: input.context,
      workspaceId: input.context.workspaceId,
      target: "side",
      boundary: selection.boundary,
      initialPrompt: selection.quote,
    });
  });
  return {
    active: input.active && !input.readOnly,
    onReply: input.context.workspaceId ? onReply : undefined,
  };
}
