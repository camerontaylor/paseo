# Jcode provider plugin

Runs jcode as the `jcode` Paseo provider over ACP, and lets a Paseo agent and a jcode TUI window
share one live jcode session. The plugin's transformer maps jcode's `_jcode/turn` peer-turn
notification to Paseo's `turn` vendor update (`specs/acp-transformer-turn-lifecycle.md`), so a turn
started in the TUI shows in Paseo as a running, then finished, run.

This is a built-in plugin in this fork. The transformer `turn` update it relies on is fork-only
(camerontaylor/paseo#6) and is in no upstream release, so the plugin ships only with fork builds.
The `>=0.15.0` requirement in `paseo-plugin.json` only keeps older daemons from loading it.

## Files

- `index.server.ts` registers `runAcpProvider({ id: "jcode", command: ["jcode", "acp"] })` with
  `server/peer-turns.ts` as its only transformer.
- `server/peer-turns.ts` validates `_jcode/turn` with Zod and returns `{ type: "turn", turnId, state }`,
  passing `error` through when it has a `message`. A malformed `error` is left off rather than
  dropping the notification, because a dropped terminal leaves the turn open and blocks later
  prompts. Turn content is not translated: the user message and output arrive as
  ordinary `session/update` notifications, and emitting them again would duplicate the peer's
  messages.
- `server/peer-turns.test.ts` covers the mapping and runs the transformer through a scripted ACP
  stream.

The provider id stays `jcode`, so config keyed on it keeps working. The default command is
`jcode acp`; the daemon applies the config override, so `--tool-profile full` and env
keys stay in `config.json`. A payload `sessionId` is jcode's native session id, which the ACP
context does not expose; the connection already serves one boundary session, so the transformer does
not filter by session.

## Config migration

The provider used to be a config-defined `extends: "acp"` entry. Delete `extends` and keep the rest
of the entry: an entry with `extends` shadows the plugin with a custom provider that has no turn
lifecycle (see [built-in provider plugins](../../docs/plugins.md), the `muse-provider` paragraph).
Without `extends`, the entry overrides the plugin's defaults:

- `command` replaces `jcode acp` entirely, and `env` is overlaid on the daemon's environment.
- `models` replaces the catalog jcode reports. Delete it to use jcode's own model selector.

Agents created under the old `extends: "acp"` entry do not resume after the migration: their saved
handle is the generic ACP client's, which the plugin provider cannot decode. The jcode sessions
themselves are untouched. Bring each one back with Import (step 2 under
[Attaching to a TUI session](#attaching-to-a-tui-session)).

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

Keep provider keys in `config.json` `env`, never in this directory.

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
(`docs/ACP_SHARED_SESSIONS.md` in the jcode repo), a jcode TUI and a Paseo daemon from this
branch, so they are checked by hand rather than in CI. The QA section of camerontaylor/paseo#7
records the manual run.
