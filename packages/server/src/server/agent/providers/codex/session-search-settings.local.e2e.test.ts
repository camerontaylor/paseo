import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAppServerAgentClient } from "../codex-app-server-agent.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(
  config: Record<string, unknown>,
  options: {
    models?: unknown[];
    holdConfig?: boolean;
    inheritOpenAiApiKey?: boolean;
    env?: Record<string, string>;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "paseo-search-settings-"));
  dirs.push(dir);
  const script = path.join(dir, "app-server.cjs");
  const requestsFile = path.join(dir, "requests.jsonl");
  // Real subprocess consuming the published app-server JSON-RPC contract; never a
  // thread or provider inference. No source assertions or patched production APIs.
  await writeFile(
    script,
    `
    const fs = require('node:fs');
    const readline = require('node:readline');
    if (process.argv.includes('--version')) {
      process.stdout.write('codex 0.144.4\\n');
      process.exit(0);
    }
    fs.writeFileSync(process.env.PASEO_FIXTURE_REQUESTS+'.pid', String(process.pid));
    fs.writeFileSync(process.env.PASEO_FIXTURE_REQUESTS+'.env', JSON.stringify({
      inheritedKeyUnchanged: process.env.OPENAI_API_KEY === 'ambient-unrelated-key'
    }));
    const config = JSON.parse(process.env.PASEO_FIXTURE_CONFIG);
    const models = JSON.parse(process.env.PASEO_FIXTURE_MODELS);
    readline.createInterface({input:process.stdin}).on('line', line => {
      const request = JSON.parse(line);
      fs.appendFileSync(process.env.PASEO_FIXTURE_REQUESTS, JSON.stringify(request)+'\\n');
      if (request.id === undefined) return;
      if (request.method === 'config/read' && process.env.PASEO_FIXTURE_HOLD === 'yes') return;
      let result;
      if (request.method === 'initialize') result = {userAgent:'fixture'};
      else if (request.method === 'config/read') result = {config};
      else if (request.method === 'model/list') result = {data:models};
      else { process.stdout.write(JSON.stringify({id:request.id,error:{code:-32601,message:'Unexpected request'}})+'\\n'); return; }
      process.stdout.write(JSON.stringify({id:request.id,result})+'\\n');
    });
  `,
  );
  const client = new CodexAppServerAgentClient(createTestLogger(), {
    command: { mode: "replace", argv: [process.execPath, script] },
    env: {
      CODEX_HOME: dir,
      OPENAI_BASE_URL: "",
      ...(options.inheritOpenAiApiKey ? {} : { OPENAI_API_KEY: "" }),
      CODEX_API_KEY: "",
      PASEO_FIXTURE_CONFIG: JSON.stringify(config),
      PASEO_FIXTURE_MODELS: JSON.stringify(options.models ?? []),
      PASEO_FIXTURE_REQUESTS: requestsFile,
      PASEO_FIXTURE_HOLD: options.holdConfig ? "yes" : "no",
      ...options.env,
    },
  });
  return {
    client,
    dir,
    pid: async () => Number(await readFile(requestsFile + ".pid", "utf8")),
    environment: async () =>
      JSON.parse(await readFile(requestsFile + ".env", "utf8")) as {
        inheritedKeyUnchanged: boolean;
      },
    requests: async () =>
      (await readFile(requestsFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method: string }),
  };
}

describe("routing-only effective Codex settings", () => {
  test("an unrelated inherited OpenAI key does not block ChatGPT matching or alter normal provider environment", async () => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-unrelated-key");
    const f = await fixture(
      { model: "gpt-host-default", model_reasoning_effort: "high", model_provider: "openai" },
      { inheritOpenAiApiKey: true },
    );
    expect(await f.client.getSessionSearchSettings()).toEqual({
      model: "gpt-host-default",
      effort: "high",
      codexHome: f.dir,
    });
    expect((await f.requests()).map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "config/read",
    ]);
    expect(await f.environment()).toEqual({ inheritedKeyUnchanged: true });
    expect(
      (await f.client.fetchCatalog({ scope: "workspace", cwd: f.dir, force: false })).models,
    ).toEqual([]);
    expect(await f.environment()).toEqual({ inheritedKeyUnchanged: true });
    expect(process.env.OPENAI_API_KEY).toBe("ambient-unrelated-key");
  });
  test.each<{ env: Record<string, string> }>([
    { env: { OPENAI_API_KEY: "explicit-provider-key" } },
    { env: { CODEX_API_KEY: "explicit-codex-key" } },
    { env: { OPENAI_BASE_URL: "https://custom.invalid/v1" } },
  ])(
    "explicit provider/authentication/endpoint overrides remain unsupported: $env",
    async ({ env }) => {
      const f = await fixture({ model: "gpt-host-default" }, { env });
      await expect(f.client.getSessionSearchSettings()).rejects.toThrow(
        "GPT matching requires the existing Codex ChatGPT provider",
      );
      await expect(f.pid()).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  test("reads the configured GPT default without discovering instructions, changing config, or creating a thread", async () => {
    const f = await fixture({
      model: "gpt-host-default",
      model_reasoning_effort: "high",
      model_provider: "openai",
      cli_auth_credentials_store: "file",
      developer_instructions: "MUST NOT ENTER THE MATCHER",
      mcp_servers: { ignored: { command: "must-not-launch" } },
      hooks: { ignored: "must-not-run" },
    });
    expect(await f.client.getSessionSearchSettings()).toEqual({
      model: "gpt-host-default",
      effort: "high",
      codexHome: f.dir,
    });
    expect((await f.requests()).map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "config/read",
    ]);
  });
  test("uses the runtime's declared default only when saved model/effort are absent", async () => {
    const f = await fixture(
      { model_provider: "openai" },
      {
        models: [
          { id: "gpt-unrelated" },
          {
            id: "gpt-account-default",
            isDefault: true,
            defaultReasoningEffort: "medium",
          },
        ],
      },
    );
    expect(await f.client.getSessionSearchSettings()).toEqual({
      model: "gpt-account-default",
      effort: "medium",
      codexHome: f.dir,
    });
    expect((await f.requests()).map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "config/read",
      "model/list",
    ]);
  });
  test("does not replace a configured model absent from its catalog", async () => {
    const f = await fixture(
      { model: "gpt-saved-only" },
      {
        models: [{ id: "gpt-other", isDefault: true, defaultReasoningEffort: "low" }],
      },
    );
    expect((await f.client.getSessionSearchSettings()).model).toBe("gpt-saved-only");
  });
  test.each([
    { model_provider: "custom" },
    {
      model_provider: "openai",
      model_providers: { openai: { base_url: "https://custom.invalid" } },
    },
    { model_provider: "openai", cli_auth_credentials_store: "keyring" },
    { model: "claude-custom", model_reasoning_effort: "high" },
  ])("fails clearly without model/provider fallback for unsupported config %j", async (config) => {
    const f = await fixture(config);
    await expect(f.client.getSessionSearchSettings()).rejects.toThrow(/GPT matching|Codex has no/);
    expect(
      (await f.requests()).some(
        (request) => request.method.startsWith("thread/") || request.method.startsWith("turn/"),
      ),
    ).toBe(false);
  });
  test("cancels a blocked config read and disposes its subprocess", async () => {
    const f = await fixture({}, { holdConfig: true });
    const controller = new AbortController();
    const pending = f.client.getSessionSearchSettings(controller.signal);
    const rejection = expect(pending).rejects.toThrow();
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        if ((await f.requests()).some((request) => request.method === "config/read")) break;
      } catch {
        /* not created yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort(new Error("superseded"));
    await rejection;
    const pid = await f.pid();
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await f.requests()).some((request) => request.method.startsWith("thread/"))).toBe(
      false,
    );
  });
});
