import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

// Intel macOS has no managed installer. Settings RPCs and provider status use
// the plugin subprocess environment, rather than the per-agent launch env.
export function prepareNativeEntry({ plugin, runtime, node }) {
  const root = realpathSync(plugin);
  const runtimePath = realpathSync(runtime);
  const nodePath = realpathSync(node);
  for (const [file, expected] of [
    ["agent/zcode.cjs", "93e4555343aacdef7dfc24ca87572eb3a939ae2f1acf52d77d4bfdead9da6d22"],
    [
      "server/remote/zcode-server.cjs",
      "f5b1d561277062ea1158074ca9240f020aa9d274aa32eebd01bcb838a0910187",
    ],
  ]) {
    if (
      createHash("sha256")
        .update(readFileSync(resolve(runtimePath, file)))
        .digest("hex") !== expected
    ) {
      throw new Error("Native runtime differs from verified 3.14.3 build");
    }
  }
  const metadata = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (metadata.name !== "paseo-plugin-zcode-provider" || metadata.version !== "0.2.0") {
    throw new Error("Expected pinned native ZCode plugin 0.2.0");
  }
  const entry = resolve(root, "index.server.ts");
  const moved = resolve(root, "server/paseo-upstream-entry.ts");
  const wrapper = `import type { PluginServerContext } from "@getpaseo/plugin/server";\nimport contribute from "./server/paseo-upstream-entry";\n\nexport default function nativeHost(server: PluginServerContext) {\n  process.env.PASEO_ZCODE_RUNTIME ??= ${JSON.stringify(runtimePath)};\n  process.env.PASEO_ZCODE_NODE ??= ${JSON.stringify(nodePath)};\n  return contribute(server);\n}\n`;
  if (existsSync(moved)) {
    if (readFileSync(entry, "utf8") !== wrapper)
      throw new Error("Existing native entry differs; reconcile it first");
    return;
  }
  const original = readFileSync(entry, "utf8");
  if (
    createHash("sha256").update(original).digest("hex") !==
    "a50222a40c4601cec2bf68769a7b2c08318f8eedc93dab7fbfaee266e71de86f"
  ) {
    throw new Error("Native upstream entry differs from pinned commit");
  }
  if (!original.includes("server.registerProvider(createZCodeProvider())"))
    throw new Error("Unrecognized upstream entry");
  const relocated = original
    .replaceAll('"./server/', '"./')
    .replaceAll('"./shared/', '"../shared/');
  writeFileSync(moved, relocated, { flag: "wx" });
  writeFileSync(
    resolve(root, ".paseo-native-entry.json"),
    `${JSON.stringify(
      {
        sourceCommit: "ca87c2b023338420f9e50f0a3a62dad2e28ed16f",
        originalEntrySha256: createHash("sha256").update(original).digest("hex"),
        runtimeArchiveSha256: "a2af414592362d226f92c105d91211e5c4f138cf985b0c86da0eb9163cb9aee7",
        runtime: runtimePath,
        node: nodePath,
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  writeFileSync(entry, wrapper);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: { plugin: { type: "string" }, runtime: { type: "string" }, node: { type: "string" } },
  });
  for (const key of ["plugin", "runtime", "node"])
    if (!values[key]) throw new Error(`Missing --${key}`);
  prepareNativeEntry(values);
  console.log("Prepared native ZCode entry with host-wide runtime defaults");
}
