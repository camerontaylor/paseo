/**
 * Removes the project the mobile side-conversation fixture seeded, then deletes its temp repo.
 * Takes the JSON that `seed-side-conversation-fixture.mjs` printed, on argv or stdin.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const port = process.env.PASEO_MOBILE_E2E_DAEMON_PORT ?? "6768";

const raw = process.argv[2] ?? readFileSync(0, "utf8");
const fixture = JSON.parse(raw);

const { DaemonClient } = await import(
  pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href
);
const appVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/app/package.json"), "utf8"),
).version;

const client = new DaemonClient({
  url: `ws://127.0.0.1:${port}/ws`,
  clientId: `mobile-teardown-${randomUUID()}`,
  clientType: "cli",
  appVersion,
  webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
});
await client.connect();
await client.removeProject(fixture.projectId).catch(() => undefined);
await client.close().catch(() => undefined);
await rm(fixture.repoPath, { recursive: true, force: true }).catch(() => undefined);
