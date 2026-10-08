import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { evaluateBundle } from "./bundle-evaluator.js";

it("resolves both SDK names to the same host modules without loading author dependencies", () => {
  expect(() =>
    evaluateBundle(`(function(require) {
    for (const entry of ["", "/server", "/server/provider", "/server/acp", "/server/usage"]) {
      if (require("@getpaseo/plugin" + entry) !== require("@camerontaylor/paseo-plugin" + entry)) {
        throw new Error("SDK identity mismatch: " + entry);
      }
    }
    const server = require("@camerontaylor/paseo-plugin/server");
    for (const name of ["spawnProcess", "execCommand", "terminateProcess"]) {
      if (typeof server[name] !== "function") throw new Error("Missing server SDK helper: " + name);
    }
    const shared = require("@camerontaylor/paseo-plugin");
    const { z } = require("zod");
    const rpc = shared.defineRpc({ name: "identity", input: z.object({}), output: z.string() });
    if (!(rpc.input instanceof z.ZodObject)) throw new Error("Zod identity mismatch");
    return { default() { return () => {}; } };
  })`),
  ).not.toThrow();
});

it.each(["@getpaseo/plugin", "@camerontaylor/paseo-plugin"])(
  "rejects private and unknown %s modules even in prebuilt bundles",
  (name) => {
    expect(() => evaluateBundle(`(function(require) { require("${name}/client/host"); })`)).toThrow(
      "private to the app host",
    );
    expect(() => evaluateBundle(`(function(require) { require("${name}/unknown"); })`)).toThrow(
      "not available in plugin server code",
    );
  },
);

it("keeps React out of the plugin host's runtime dependency graph", async () => {
  await expect(
    build({
      entryPoints: [
        fileURLToPath(new URL("./plugin-process.ts", import.meta.url)),
        "@getpaseo/plugin",
        "@getpaseo/plugin/server",
        "@getpaseo/plugin/server/provider",
        "@getpaseo/plugin/server/acp",
      ],
      outdir: "unused",
      conditions: ["source"],
      bundle: true,
      platform: "node",
      format: "esm",
      // Node evaluates re-exports even when the host only imports one helper.
      treeShaking: false,
      write: false,
      logLevel: "silent",
      plugins: [
        {
          name: "no-react",
          setup(context) {
            context.onResolve(
              { filter: /^(react|react-dom|react-native|use-sync-external-store)(\/|$)/ },
              ({ path, importer }) => ({
                errors: [{ text: `React dependency ${path} imported by ${importer}` }],
              }),
            );
          },
        },
      ],
    }),
  ).resolves.toMatchObject({ errors: [] });
});

it("exposes CLI probes through the plugin host's server SDK", async () => {
  const setup = evaluateBundle(`(require) => ({ default: async () => {
    const { execCommand } = require("@getpaseo/plugin/server");
    const { stdout } = await execCommand(${JSON.stringify(process.execPath)}, ["-e", "process.stdout.write('plugin CLI ready')"]);
    if (stdout !== "plugin CLI ready") throw new Error("CLI output was lost");
  } })`);
  // This contribution uses no server context APIs; it exercises the host's real SDK binding.
  await expect(setup(undefined as never)).resolves.toBeUndefined();
});
