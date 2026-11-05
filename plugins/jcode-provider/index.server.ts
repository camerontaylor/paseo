import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import { jcodePeerTurns } from "./server/peer-turns.js";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(
    runAcpProvider({
      id: "jcode",
      label: "Jcode",
      description: "jcode harness over ACP, shareable with jcode TUI sessions",
      icon: "icon.svg",
      command: ["jcode", "acp"],
      transformers: [jcodePeerTurns],
    }),
  );
  return () => {};
}
