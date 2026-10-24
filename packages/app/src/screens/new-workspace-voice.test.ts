import { describe, expect, it, vi } from "vitest";
import { createNewWorkspaceAgentForVoice } from "./new-workspace-voice";

describe("new workspace voice agent", () => {
  it("creates one agent with no prompt in the selected directory", async () => {
    const createChatAgent = vi.fn().mockResolvedValue({ agentId: "agent-1" });
    await expect(createNewWorkspaceAgentForVoice({ cwd: "/repo", createChatAgent })).resolves.toBe(
      "agent-1",
    );
    expect(createChatAgent).toHaveBeenCalledExactlyOnceWith({
      text: "",
      attachments: [],
      cwd: "/repo",
    });
  });

  it("leaves voice stopped when agent creation fails", async () => {
    const createChatAgent = vi.fn().mockResolvedValue(null);
    await expect(
      createNewWorkspaceAgentForVoice({ cwd: null, createChatAgent }),
    ).resolves.toBeNull();
  });
});
