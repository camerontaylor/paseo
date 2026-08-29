import { describe, expect, it } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentManager } from "../agent-manager.js";
import type {
  AgentClient,
  AgentSession,
  AgentSessionConfig,
  FetchCatalogOptions,
  SideConversationExchange,
} from "../agent-sdk-types.js";
import { FakeRewindSession, REWIND_TEST_CAPABILITIES } from "../rewind/test-rewind-session.js";

class SideQuestionSession extends FakeRewindSession {
  readonly calls: Array<{
    question: string;
    history: readonly SideConversationExchange[];
  }> = [];

  async askSideQuestion(question: string, history: readonly SideConversationExchange[]) {
    this.calls.push({ question, history });
    return {
      status: "answered" as const,
      content: `answer ${this.calls.length}`,
      synthetic: false,
      threading: "threaded" as const,
    };
  }
}

class SideQuestionClient implements AgentClient {
  readonly provider = "claude";
  readonly capabilities = REWIND_TEST_CAPABILITIES;

  constructor(readonly session: SideQuestionSession) {}

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    return this.session;
  }

  async resumeSession(): Promise<AgentSession> {
    return this.session;
  }

  async fetchCatalog(_options: FetchCatalogOptions) {
    return { models: [], modes: [] };
  }

  async isAvailable() {
    return true;
  }
}

describe("AgentManager side-conversation seam", () => {
  it("dispatches through the session seam and threads only the side-conversation history", async () => {
    const session = new SideQuestionSession();
    const manager = new AgentManager({
      clients: { claude: new SideQuestionClient(session) },
      logger: createTestLogger(),
      idFactory: () => "00000000-0000-4000-8000-000000000911",
    });
    const agent = await manager.createAgent({ provider: "claude", cwd: process.cwd() }, undefined, {
      workspaceId: undefined,
    });

    await manager.askSideQuestion(agent.id, "thread", "first?");
    await manager.askSideQuestion(agent.id, "thread", "follow-up?");

    expect(session.calls).toEqual([
      { question: "first?", history: [] },
      {
        question: "follow-up?",
        history: [{ question: "first?", answer: "answer 1" }],
      },
    ]);
    expect(manager.fetchTimeline(agent.id, { limit: 100 }).rows).toEqual([]);
    expect(manager.getSideConversation(agent.id, "thread")?.items).toEqual([
      { type: "user_message", text: "first?" },
      { type: "assistant_message", text: "answer 1" },
      { type: "user_message", text: "follow-up?" },
      { type: "assistant_message", text: "answer 2" },
    ]);
  });
});
