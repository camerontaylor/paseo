import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonConnectionError } from "@getpaseo/client/internal/daemon-client";
import { resolveCallerAgentId as resolveRunCallerAgentId } from "../../utils/caller-agent.js";
import { connectToDaemon } from "../../utils/client.js";
import {
  resolveExistingRunWorkspace,
  runRunCommand,
  waitsForFinish,
  resolveRunThinkingOption,
  type AgentRunOptions,
} from "./run";

vi.mock("../../utils/client.js", () => ({ connectToDaemon: vi.fn() }));

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

// Answers fetchAgent the way a daemon does: an unknown id is an error.
function daemonWithAgents(...agentIds: string[]) {
  return {
    async fetchAgent({ agentId }: { agentId: string }) {
      if (!agentIds.includes(agentId)) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return { agent: { id: agentId } };
    },
  };
}

describe("run wait policy", () => {
  it("waits by default and stops waiting on --no-wait or a legacy alias", () => {
    expect(waitsForFinish({})).toBe(true);
    expect(waitsForFinish({ wait: false })).toBe(false);
    expect(waitsForFinish({ background: true })).toBe(false);
    expect(waitsForFinish({ detach: true })).toBe(false);
  });
});

describe("managed agent caller context", () => {
  it("uses a trimmed PASEO_AGENT_ID when the target daemon runs that agent", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("parent-agent"), {
        PASEO_AGENT_ID: "  parent-agent  ",
      }),
    ).resolves.toBe("parent-agent");
  });

  it("runs without a caller when PASEO_AGENT_ID belongs to another daemon", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("other-agent"), {
        PASEO_AGENT_ID: "parent-agent",
      }),
    ).resolves.toBeUndefined();
  });

  it.each(["DAEMON_CONNECTION_LOST", "DAEMON_REQUEST_TIMEOUT"] as const)(
    "preserves %s instead of dropping the caller",
    async (code) => {
      const disconnectedDaemon = {
        async fetchAgent(): Promise<never> {
          throw new DaemonConnectionError("Caller lookup transport failed", code);
        },
      };

      await expect(
        resolveRunCallerAgentId(disconnectedDaemon, { PASEO_AGENT_ID: "parent-agent" }),
      ).rejects.toBeInstanceOf(DaemonConnectionError);
    },
  );

  it("omits blank caller ids", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents(), { PASEO_AGENT_ID: "   " }),
    ).resolves.toBeUndefined();
  });
});

describe("existing run workspace resolution", () => {
  it("queries the daemon for an exact workspace id and uses its directory", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/two" }],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "workspace-2")).resolves.toEqual({
      id: "workspace-2",
      cwd: "/workspace/two",
    });
    expect(fetchWorkspaces).toHaveBeenCalledWith({
      filter: { query: "workspace-2" },
      page: { limit: 200 },
    });
  });

  it("rejects a workspace id absent from daemon state", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "missing")).rejects.toMatchObject(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: missing",
      },
    );
  });
});

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(
    options: Omit<AgentRunOptions, "daemonTarget">,
    messageMatch: RegExp,
  ) {
    await expect(
      runRunCommand("do something", { ...options, daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --new-workspace combined with --workspace", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", workspace: "ws-1" },
      /--new-workspace and --workspace cannot be combined/,
    );
  });

  it("allows explicit worktree workspace creation through validation", async () => {
    // Explicit workspace creation with no --workspace
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand(
        "do something",
        { newWorkspace: "worktree", provider: undefined, daemonTarget },
        {} as never,
      ),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("rejects unknown new workspace kinds", async () => {
    await expectInvalidOptions({ newWorkspace: "container" }, /Unsupported new workspace kind/);
  });

  it("rejects two workspace creation flags", async () => {
    await expectInvalidOptions(
      { newWorkspace: "local", worktree: "legacy-slug" },
      /--new-workspace and --worktree cannot be combined/,
    );
  });

  it("rejects an unknown worktree creation mode before connecting", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", worktreeMode: "container" },
      /Unsupported worktree mode/,
    );
  });
});

describe("run thinking defaults", () => {
  const models = [
    { id: "default-model", label: "Default", isDefault: true, defaultThinkingOptionId: "medium" },
    {
      id: "chosen-model",
      label: "Chosen",
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
  ];

  it.each([
    { model: "chosen-model", expected: "high" },
    { model: undefined, expected: "medium" },
    { model: "unlisted-model", expected: undefined },
  ])("resolves the effort for $model", async ({ model, expected }) => {
    const listProviderModels = vi.fn().mockResolvedValue({ models });
    await expect(
      resolveRunThinkingOption(
        { listProviderModels },
        {
          provider: "custom",
          model,
          cwd: "/workspace",
          thinking: undefined,
        },
      ),
    ).resolves.toBe(expected);
    expect(listProviderModels).toHaveBeenCalledWith("custom", { cwd: "/workspace" });
  });

  it("preserves explicit thinking without querying models", async () => {
    const listProviderModels = vi.fn();
    await expect(
      resolveRunThinkingOption(
        { listProviderModels },
        {
          provider: "custom",
          model: "chosen-model",
          cwd: "/workspace",
          thinking: "low",
        },
      ),
    ).resolves.toBe("low");
    expect(listProviderModels).not.toHaveBeenCalled();
  });

  it("leaves effort unset when the chosen model has no default", async () => {
    const listProviderModels = vi.fn().mockResolvedValue({
      models: [
        { id: "chosen-model", label: "Chosen", thinkingOptions: [{ id: "low", label: "Low" }] },
      ],
    });
    await expect(
      resolveRunThinkingOption(
        { listProviderModels },
        {
          provider: "custom",
          model: "chosen-model",
          cwd: "/workspace",
          thinking: undefined,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("reports catalog errors instead of guessing a default", async () => {
    const listProviderModels = vi.fn().mockResolvedValue({ error: "Catalog unavailable" });
    await expect(
      resolveRunThinkingOption(
        { listProviderModels },
        {
          provider: "custom",
          model: "chosen-model",
          cwd: "/workspace",
          thinking: undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", message: "Catalog unavailable" });
  });
});

describe("run command thinking wiring", () => {
  const outputSchema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };

  function createClient() {
    return {
      fetchWorkspaces: vi.fn().mockResolvedValue({
        entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/resolved" }],
        pageInfo: { nextCursor: null },
      }),
      listProviderModels: vi.fn().mockResolvedValue({
        models: [{ id: "chosen-model", label: "Chosen", defaultThinkingOptionId: "high" }],
      }),
      createAgent: vi.fn().mockResolvedValue({
        id: "created-agent",
        provider: "custom",
        cwd: "/workspace/resolved",
        title: null,
        status: "idle",
      }),
      waitForFinish: vi.fn().mockResolvedValue({ status: "idle", lastMessage: '{"ok":true}' }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    vi.stubEnv("PASEO_AGENT_ID", "");
    vi.stubEnv("PASEO_WORKSPACE_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(connectToDaemon).mockReset();
  });

  it.each([
    { structured: false, thinking: undefined, expected: "high" },
    { structured: true, thinking: undefined, expected: "high" },
    { structured: false, thinking: " low ", expected: "low" },
    { structured: true, thinking: " low ", expected: "low" },
  ])(
    "passes resolved workspace and effort to creation (structured=$structured, thinking=$thinking)",
    async ({ structured, thinking, expected }) => {
      const client = createClient();
      vi.mocked(connectToDaemon).mockResolvedValue(
        client as unknown as Awaited<ReturnType<typeof connectToDaemon>>,
      );

      const result = await runRunCommand(
        "do something",
        {
          daemonTarget,
          provider: "custom/chosen-model",
          workspace: "workspace-2",
          cwd: "/workspace/requested",
          thinking,
          wait: structured,
          outputSchema: structured ? JSON.stringify(outputSchema) : undefined,
        },
        {} as never,
      );

      expect(connectToDaemon).toHaveBeenCalledExactlyOnceWith({ target: daemonTarget });
      expect(client.fetchWorkspaces).toHaveBeenCalledExactlyOnceWith({
        filter: { query: "workspace-2" },
        page: { limit: 200 },
      });
      if (thinking === undefined) {
        expect(client.listProviderModels).toHaveBeenCalledExactlyOnceWith("custom", {
          cwd: "/workspace/resolved",
        });
      } else {
        expect(client.listProviderModels).not.toHaveBeenCalled();
      }
      expect(client.createAgent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          provider: "custom",
          model: "chosen-model",
          cwd: "/workspace/resolved",
          workspaceId: "workspace-2",
          thinkingOptionId: expected,
        }),
      );
      if (structured) {
        expect(client.createAgent).toHaveBeenCalledWith(expect.objectContaining({ outputSchema }));
        expect(client.waitForFinish).toHaveBeenCalledExactlyOnceWith("created-agent", 0);
        expect(result.schema.serialize?.(result.data)).toEqual({ ok: true });
      } else {
        expect(client.createAgent).toHaveBeenCalledWith(
          expect.objectContaining({ initialPrompt: "do something" }),
        );
        expect(client.waitForFinish).not.toHaveBeenCalled();
      }
      expect(result.data.agentId).toBe("created-agent");
      expect(client.close).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it.each([false, true])(
    "catalog failure prevents creation and closes the client (structured=%s)",
    async (structured) => {
      const client = createClient();
      client.listProviderModels.mockResolvedValue({ error: "Catalog unavailable" });
      vi.mocked(connectToDaemon).mockResolvedValue(
        client as unknown as Awaited<ReturnType<typeof connectToDaemon>>,
      );

      await expect(
        runRunCommand(
          "do something",
          {
            daemonTarget,
            provider: "custom/chosen-model",
            workspace: "workspace-2",
            cwd: "/workspace/requested",
            wait: structured,
            outputSchema: structured ? JSON.stringify(outputSchema) : undefined,
          },
          {} as never,
        ),
      ).rejects.toMatchObject({ code: "PROVIDER_ERROR", message: "Catalog unavailable" });

      expect(connectToDaemon).toHaveBeenCalledExactlyOnceWith({ target: daemonTarget });
      expect(client.listProviderModels).toHaveBeenCalledExactlyOnceWith("custom", {
        cwd: "/workspace/resolved",
      });
      expect(client.createAgent).not.toHaveBeenCalled();
      expect(client.waitForFinish).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledExactlyOnceWith();
    },
  );
});
