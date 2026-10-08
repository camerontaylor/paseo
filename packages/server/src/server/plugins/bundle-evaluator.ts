import { createRequire } from "node:module";
import * as pluginSharedRuntime from "@getpaseo/plugin";
import { pluginSdkEntry } from "@getpaseo/plugin";
import * as pluginProviderRuntime from "@getpaseo/plugin/server/provider";
import * as pluginAcpRuntime from "@getpaseo/plugin/server/acp";
import * as pluginUsageRuntime from "@getpaseo/plugin/server/usage";
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import * as zod from "zod";
import { isPluginClientOnlySdkSpecifier } from "./plugin-sdk-specifiers.js";

const nodeRequire = createRequire(import.meta.url);

function runtimeRequire(name: string): unknown {
  const sdkEntry = pluginSdkEntry(name);
  if (isPluginClientOnlySdkSpecifier(name)) {
    throw new Error(`${name} is available only in plugin client code`);
  }
  if (sdkEntry === "") return pluginSharedRuntime;
  if (sdkEntry === "/server") return {};
  if (sdkEntry === "/server/provider") return pluginProviderRuntime;
  if (sdkEntry === "/server/acp") return pluginAcpRuntime;
  if (sdkEntry === "/server/usage") return pluginUsageRuntime;
  if (name === "zod") return zod;
  if (sdkEntry === "/client/host") throw new Error(`${name} is private to the app host`);
  if (sdkEntry !== null) throw new Error(`${name} is not available in plugin server code`);
  return nodeRequire(name);
}

export function evaluateBundle(bundle: string): PluginServerContribution {
  const evaluate: (source: string) => unknown = globalThis.eval;
  const factory = evaluate(bundle);
  if (typeof factory !== "function") throw new Error("Plugin server bundle is not executable");
  const exports = factory(runtimeRequire);
  const setup =
    exports !== null && typeof exports === "object" ? Reflect.get(exports, "default") : undefined;
  if (typeof setup !== "function") {
    throw new Error("Plugin server bundle must default export a function");
  }
  return setup as PluginServerContribution;
}
