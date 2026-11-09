import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Settings } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "provider",
    title: "Provider",
    icon: "Settings",
    Component: Settings,
  });
  return () => {};
}
