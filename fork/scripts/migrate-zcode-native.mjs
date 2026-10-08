import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

function planInstructionChanges(agents, block) {
  const destinations = [
    ...new Set(agents.map((path) => (existsSync(path) ? realpathSync(path) : resolve(path)))),
  ];
  return destinations.map((path) => {
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (text.includes("<!-- paseo-daemon-policy:") && !text.includes(block)) {
      throw new Error("Existing policy block differs; reconcile it before migration");
    }
    const merged = text.includes(block)
      ? text
      : `${text}${text.endsWith("\n") || !text ? "" : "\n"}\n${block}\n`;
    if (Buffer.byteLength(merged) > 100 * 1024)
      throw new Error("Instruction file exceeds native 100KiB loading limit");
    return { path, text, merged };
  });
}

function configureNativeProvider(config, pluginPath, runtime, node) {
  const provider = config.agents?.providers?.zcode ?? {};
  delete provider.extends;
  delete provider.command;
  // ACP replacement models have raw IDs and can advertise unsupported thinking.
  // The native catalog owns model identities and options; the backup retains it.
  delete provider.models;
  provider.enabled = true;
  provider.env = {
    ...provider.env,
    PASEO_ZCODE_RUNTIME: realpathSync(runtime),
    PASEO_ZCODE_NODE: realpathSync(node),
  };
  config.agents ??= {};
  config.agents.providers ??= {};
  config.agents.providers.zcode = provider;
  config.pluginsEnabled = true;
  config.plugins ??= {};
  config.plugins["zcode-provider"] = { source: "directory", path: pluginPath, enabled: true };
  // Retain the old source as a disabled rollback reference; no source is removed.
  if (config.plugins["paseo-plugin-zcode"]) config.plugins["paseo-plugin-zcode"].enabled = false;
  config.daemon.appendSystemPromptExcludedProviders = [
    ...new Set([...(config.daemon.appendSystemPromptExcludedProviders ?? []), "zcode"]),
  ];
}

function migrateNativeProfiles(config, modelProvider) {
  for (const profile of config.daemon?.agentProfiles ?? []) {
    if (profile.provider !== "zcode") continue;
    if (profile.model && !profile.model.startsWith("[")) {
      if (!modelProvider)
        throw new Error("Use --model-provider from the verified native catalog for ZCode profiles");
      profile.model = JSON.stringify([modelProvider, profile.model, null]);
    }
    if (profile.thinkingOptionId === "auto") delete profile.thinkingOptionId;
    if (profile.thinkingOptionId && !["low", "high", "max"].includes(profile.thinkingOptionId))
      throw new Error(
        "ZCode profile thinking option is unsupported by the verified native catalog",
      );
    if (profile.modeId && !["build", "edit", "yolo", "plan"].includes(profile.modeId))
      throw new Error("ZCode profile mode is unsupported by the verified native catalog");
  }
}

// Produce a candidate config; the operator owns live reload after native validation.
export function prepareMigration({
  source,
  output,
  agents,
  plugin,
  runtime,
  node,
  backup,
  modelProvider,
}) {
  const sourcePath = realpathSync(source);
  const outputPath = resolve(output);
  if (
    outputPath === sourcePath ||
    (existsSync(outputPath) && realpathSync(outputPath) === sourcePath)
  ) {
    throw new Error("Write a candidate config separately from the live config");
  }
  if (existsSync(outputPath) || existsSync(backup))
    throw new Error("Use fresh output and backup destinations");
  const config = JSON.parse(readFileSync(sourcePath, "utf8"));
  migrateNativeProfiles(config, modelProvider);
  const policy = config.daemon?.appendSystemPrompt;
  if (typeof policy !== "string" || !policy.trim())
    throw new Error("Expected a nonempty daemon policy");
  if (!agents.length) throw new Error("At least one AGENTS.md destination is required");
  const pluginPath = realpathSync(plugin);
  const manifest = JSON.parse(readFileSync(resolve(pluginPath, "paseo-plugin.json"), "utf8"));
  if (manifest.id !== "zcode-provider") throw new Error("Expected native zcode-provider manifest");
  for (const path of [runtime, node])
    if (!existsSync(path)) throw new Error("Native runtime paths must exist");
  const hash = createHash("sha256").update(policy).digest("hex");
  const marker = `<!-- paseo-daemon-policy:${hash} -->`;
  const end = "<!-- /paseo-daemon-policy -->";
  const block = `${marker}\n\n## Agent operating policy\n\n${policy}\n\n${end}`;
  const globalAgents = resolve(process.env.HOME, ".zcode", "AGENTS.md");
  if (!agents.map((path) => resolve(path)).includes(globalAgents))
    throw new Error("Include the native global ~/.zcode/AGENTS.md policy destination");
  const changes = planInstructionChanges(agents, block);
  const destinations = changes.map(({ path }) => path);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  // Backups can contain credentials; never log config or policy contents.
  writeFileSync(resolve(backup, "config.json"), readFileSync(sourcePath), { mode: 0o600 });
  for (const [index, change] of changes.entries()) {
    writeFileSync(resolve(backup, `instructions-${index}.md`), change.text, { mode: 0o600 });
    mkdirSync(dirname(change.path), { recursive: true });
    const temp = `${change.path}.paseo-policy-${process.pid}`;
    writeFileSync(temp, change.merged, {
      mode: existsSync(change.path) ? statSync(change.path).mode & 0o777 : 0o600,
      flag: "wx",
    });
    renameSync(temp, change.path);
  }
  for (const change of changes)
    if (!readFileSync(change.path, "utf8").includes(block))
      throw new Error("Policy materialization failed");
  configureNativeProvider(config, pluginPath, runtime, node);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(
    resolve(backup, "manifest.json"),
    `${JSON.stringify({ source: sourcePath, destinations, policySha256: hash, output: outputPath }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { policySha256: hash, destinations, output: outputPath, backup: resolve(backup) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      output: { type: "string" },
      agents: { type: "string", multiple: true },
      plugin: { type: "string" },
      runtime: { type: "string" },
      node: { type: "string" },
      backup: { type: "string" },
      "model-provider": { type: "string" },
    },
  });
  for (const key of ["source", "output", "plugin", "runtime", "node", "backup"])
    if (!values[key]) throw new Error(`Missing --${key}`);
  console.log(
    JSON.stringify(
      prepareMigration({
        ...values,
        modelProvider: values["model-provider"],
        agents: values.agents ?? [],
      }),
      null,
      2,
    ),
  );
}
