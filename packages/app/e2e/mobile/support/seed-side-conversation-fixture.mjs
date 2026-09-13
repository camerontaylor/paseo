/**
 * Seeds the parent agent the side-conversations mobile flow drives, then prints the ids the
 * `.ad` script needs as JSON.
 *
 * The mobile runner cannot seed through the UI the way the browser spec does, so the fixture is
 * built out of band against the same daemon the device talks to. `mockSideQuestions` is what makes
 * the mock provider expose `askSideQuestion` at all — without it the daemon answers `unavailable`
 * and the flow proves nothing. See `mock-load-test-agent.ts`.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const port = process.env.PASEO_MOBILE_E2E_DAEMON_PORT ?? "6768";

if (port === "6767") {
  throw new Error("Refusing to seed against the developer daemon on 6767.");
}

const { DaemonClient } = await import(
  pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href
);

const appVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/app/package.json"), "utf8"),
).version;

const repoPath = await mkdtemp(path.join(await realpath("/tmp"), "paseo-mobile-sc-"));
execSync("git init -b main", { cwd: repoPath, stdio: "ignore" });
execSync('git config user.email "e2e@paseo.test"', { cwd: repoPath, stdio: "ignore" });
execSync('git config user.name "Paseo E2E"', { cwd: repoPath, stdio: "ignore" });
execSync("git config commit.gpgsign false", { cwd: repoPath, stdio: "ignore" });
await writeFile(path.join(repoPath, "README.md"), "# Mobile side-conversation fixture\n");
execSync("git add -A", { cwd: repoPath, stdio: "ignore" });
execSync('git commit -m "init"', { cwd: repoPath, stdio: "ignore" });

const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  clientId: `mobile-seed-${randomUUID()}`,
  clientType: "cli",
  appVersion,
  webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
});
await client.connect();

const created = await client.createWorkspace({
  source: { kind: "directory", path: repoPath },
  title: "side-conversations-mobile",
});
if (!created.workspace) {
  throw new Error(created.error ?? `Failed to create workspace at ${repoPath}`);
}

const agent = await client.createAgent({
  provider: "mock",
  cwd: repoPath,
  workspaceId: created.workspace.id,
  title: "Side conversation parent",
  modeId: "load-test",
  model: "e2e-fast-stream",
  featureValues: { mockSideQuestions: true },
});

process.stdout.write(
  `${JSON.stringify({
    repoPath,
    projectId: created.workspace.projectId,
    workspaceId: created.workspace.id,
    agentId: agent.id,
    agentTabId: `agent_${agent.id}`,
  })}\n`,
);
await client.close();
