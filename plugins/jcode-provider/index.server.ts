import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defineRpc } from "@getpaseo/plugin";
import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import { z } from "zod";
import { jcodeCapabilities } from "./server/capabilities.js";
import { jcodePeerTurns } from "./server/peer-turns.js";

const detach = defineRpc({
  name: "detach_session",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({}),
});

export default function contribute(server: PluginServerContext) {
  server.registerProvider(
    runAcpProvider({
      id: "jcode",
      label: "Jcode",
      description: "jcode harness over ACP, shareable with jcode TUI sessions",
      icon: "icon.svg",
      command: ["jcode", "acp"],
      acpOptions: {
        // jcode reports a vendor turn only for a turn another client started; a Paseo prompt is
        // never announced as one. So a vendor `started` while Paseo's prompt is active is a real
        // peer turn, and its user message must be shown. Without this the shim drops that turn
        // and attributes the peer's output to Paseo's reply.
        vendorTurnsAreNeverForeground: true,
      },
      transformers: [jcodePeerTurns, jcodeCapabilities],
    }),
  );
  server.handle(detach, async ({ agentId }, { paseo }) => {
    await paseo.agents.ref(agentId).detachProviderSession();
    return {};
  });
  return () => {};
}
