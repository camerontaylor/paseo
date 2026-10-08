import type { PluginServerContext } from "@getpaseo/plugin/server";
import { provider } from "./server/provider";
import { statusRpc } from "./shared/status";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(provider);
  server.handle(statusRpc, () => ({ provider: provider.id }));
  return () => {};
}
