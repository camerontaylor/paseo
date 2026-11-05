# Jcode provider plugin

Runs jcode as the `jcode` Paseo provider over ACP, and lets a Paseo agent and a jcode TUI window
share one live jcode session. The plugin's transformer maps jcode's `_jcode/turn` peer-turn
notification to Paseo's `turn` vendor update (`specs/acp-transformer-turn-lifecycle.md`), so a turn
started in the TUI shows in Paseo as a running, then finished, run.

This is a built-in plugin in this fork. It requires Paseo `>=0.15.0`, the first release with the
transformer `turn` update.

## Files

- `index.server.ts` registers `runAcpProvider({ id: "jcode", command: ["jcode", "acp"] })` with
  `server/peer-turns.ts` as its only transformer.
- `server/peer-turns.ts` validates `_jcode/turn` with Zod and returns `{ type: "turn", turnId, state }`,
  passing `error` through. Turn content is not translated: the user message and output arrive as
  ordinary `session/update` notifications, and emitting them again would duplicate the peer's
  messages.
- `server/peer-turns.test.ts` covers the mapping and runs the transformer through a scripted ACP
  stream.

The provider id stays `jcode`, so agents and persisted sessions keep their provider. The default
command is `jcode acp`; the daemon applies the config override, so `--tool-profile full` and env
keys stay in `config.json`. A payload `sessionId` is jcode's native session id, which the ACP
context does not expose; the connection already serves one boundary session, so the transformer does
not filter by session.

## Config migration

The provider used to be a config-defined `extends: "acp"` entry. With this plugin the entry stays,
minus one field: a leftover `extends` takes precedence over the plugin, so it must be deleted.

### What the daemon does with an entry whose id matches a plugin provider

All three of `command`, `env`, and `models` apply as overrides.

- `command` and `env`: `packages/server/src/server/agent/provider-registry.ts:745` merges the
  entry's runtime settings into the plugin registration, and
  `packages/server/src/server/agent/plugin-provider.ts:160` resolves the launch from them. The
  config `command` array becomes a `replace` command (`provider-registry.ts:253`), so it replaces
  `jcode acp` entirely; there is no `append` form in the config schema. Env is overlaid on the
  daemon's environment (`packages/server/src/server/agent/provider-launch-config.ts:250`).
- `models`: `provider-registry.ts:749` sets `profileModels` from the entry with
  `profileModelsAreAdditive: false`, and `mergeModels` (`provider-registry.ts:380`) then returns
  that list in place of the ACP-discovered catalog. So a curated `models` list still curates; if
  you delete it, jcode's own `configOptions` model selector provides the catalog.

A leftover `extends` does take precedence, by skipping the plugin instead of merging with it.
`packages/server/src/server/agent/provider-registry.ts:939` logs `Plugin provider shadowed by
configured provider` and continues past registration. `addDerivedProviders` then builds `jcode`
from `extends: "acp"` (`provider-registry.ts:814`) around the server's generic ACP client
(`provider-registry.ts:865`): today's path, which has no transformer seam and receives no turn
lifecycle. `docs/plugins.md:129` documents the same rule for `muse-provider`.

### Before

```json
{
  "agents": {
    "providers": {
      "jcode": {
        "extends": "acp",
        "label": "Jcode",
        "command": ["jcode", "--tool-profile", "full", "acp"],
        "env": { "ANTHROPIC_API_KEY": "<secret>", "OPENAI_API_KEY": "<secret>" },
        "models": [{ "id": "<model-id>", "label": "<model-label>" }]
      }
    }
  }
}
```

### After

```json
{
  "agents": {
    "providers": {
      "jcode": {
        "label": "Jcode",
        "command": ["jcode", "--tool-profile", "full", "acp"],
        "env": { "ANTHROPIC_API_KEY": "<secret>", "OPENAI_API_KEY": "<secret>" },
        "models": [{ "id": "<model-id>", "label": "<model-label>" }]
      }
    }
  }
}
```

Delete `extends`; keep everything else. Keep provider keys in `config.json` `env`, never in this
directory.

## Attaching to a TUI session

1. Start or resume the session in jcode.
2. Import a session for provider `jcode` in Paseo. jcode advertises `session/list`, so sessions
   appear with their cwd and title.
3. Paseo calls `session/load`; jcode attaches the adapter to the live session without taking it
   over and replays history.
4. Prompts from either client appear in both. A turn started in the TUI shows as a background run
   in Paseo, with the peer's user message, the streamed output, then idle.
5. Stop in Paseo during a TUI turn interrupts that turn in both clients.

## Tests

```bash
npx vitest run plugins/jcode-provider/server/peer-turns.test.ts
```

The end-to-end criteria in `specs/jcode-provider-plugin.md` need a jcode build with shared sessions
(`docs/ACP_SHARED_SESSIONS.md` in the jcode repo) and are not covered here.
