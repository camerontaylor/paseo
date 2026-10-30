// Fake `jcode acp`: an ACP adapter that forwards each prompt to the shared
// fake server, spawning it (detached) if nobody has yet.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
const sdk = await import(process.env.FAKE_ACP_SDK);
const { AgentSideConnection, ndJsonStream, RequestError } = sdk;
const dir = process.env.FAKE_JCODE_DIR;
const sock = `${dir}/serve.sock`;
const log = (m) =>
  fs.appendFileSync(
    `${dir}/adapter.log`,
    `${new Date().toISOString()} [acp ${process.pid}] ${m}\n`,
  );
process.on("SIGTERM", () => {
  log("adapter received SIGTERM, exiting");
  process.exit(0);
});

function connectOnce() {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}
async function connectServer() {
  try {
    return await connectOnce();
  } catch {}
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  log(`spawned shared server ${child.pid}`);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      return await connectOnce();
    } catch {}
  }
  throw new Error("server did not start");
}

// Like jcode, the shared server is reached on demand: the first prompt from
// any adapter starts it, which makes that adapter its parent.
let server = null;
let closed = false;
const pending = new Map();
async function ensureServer() {
  if (server) return server;
  server = await connectServer();
  let buf = "";
  server.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      pending.get(msg.id)?.resolve(msg.reply);
      pending.delete(msg.id);
    }
  });
  server.on("close", () => {
    closed = true;
    log("shared server connection closed");
    for (const p of pending.values())
      p.reject(RequestError.internalError(undefined, "Fake jcode daemon disconnected"));
    pending.clear();
  });
  log("connected to shared server");
  return server;
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
// The connection drives itself from stdin; constructing it is the whole point.
// oxlint-disable-next-line eslint/no-new
new AgentSideConnection(
  (conn) => ({
    async initialize() {
      return { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] };
    },
    async authenticate() {
      return {};
    },
    async newSession() {
      return {
        sessionId: randomUUID(),
        models: { currentModelId: "fake", availableModels: [{ modelId: "fake", name: "Fake" }] },
      };
    },
    async unstable_setSessionModel() {
      return {};
    },
    async setSessionConfigOption() {
      return {};
    },
    async setSessionMode() {
      return {};
    },
    async cancel() {},
    async prompt(params) {
      const text = params.prompt.map((b) => b.text ?? "").join(" ");
      await ensureServer();
      if (closed) throw RequestError.internalError(undefined, "Fake jcode daemon disconnected");
      const id = randomUUID();
      const reply = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        server.write(JSON.stringify({ id, text, client: process.pid }) + "\n");
      });
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } },
      });
      return { stopReason: "end_turn" };
    },
  }),
  ndJsonStream(input, output),
);
