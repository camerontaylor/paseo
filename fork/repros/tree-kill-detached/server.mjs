// Fake `jcode serve`: one shared backend for every fake-acp adapter.
// Started by the first adapter with setsid (spawn detached), so it leads its
// own session but keeps that adapter as its PPID, exactly like jcode.
import fs from "node:fs";
import net from "node:net";
const dir = process.env.FAKE_JCODE_DIR;
const log = (m) =>
  fs.appendFileSync(
    `${dir}/server.log`,
    `${new Date().toISOString()} [server ${process.pid}] ${m}\n`,
  );
process.on("SIGTERM", () => {
  log("Server received SIGTERM");
  process.exit(143);
});
fs.rmSync(`${dir}/serve.sock`, { force: true });
net
  .createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const req = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const secs = Number(/sleep=(\d+)/.exec(req.text)?.[1] ?? 1);
        log(`turn ${req.id} from client ${req.client}: working ${secs}s`);
        setTimeout(
          () =>
            socket.write(
              JSON.stringify({ id: req.id, reply: `done after ${secs}s (server ${process.pid})` }) +
                "\n",
            ),
          secs * 1000,
        );
      }
    });
    socket.on("error", () => {});
  })
  .listen(`${dir}/serve.sock`, () => {
    fs.writeFileSync(`${dir}/server.pid`, String(process.pid));
    log(`listening ppid=${process.ppid}`);
  });
