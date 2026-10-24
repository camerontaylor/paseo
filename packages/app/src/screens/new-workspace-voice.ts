import type { MessagePayload } from "@/composer/types";

/** A voice start creates an agent without sending a first turn. */
export async function createNewWorkspaceAgentForVoice(input: {
  cwd: string | null;
  createChatAgent: (payload: MessagePayload) => Promise<{ agentId: string } | null>;
}): Promise<string | null> {
  const result = await input.createChatAgent({
    text: "",
    attachments: [],
    cwd: input.cwd ?? "",
  });
  return result?.agentId ?? null;
}
