# Jcode provider plugin

Status: Proposed (2026-11-04). Fork plugin (`plugins/jcode-provider/`).

Run jcode in Paseo as a plugin ACP provider. It replaces the config-defined
`extends: "acp"` entry and maps jcode's peer-turn notifications to the core
`turn` vendor update. With it, a Paseo agent and jcode TUI windows can share
one live jcode session, and both show every turn.

Depends on:

- Core hook: `specs/acp-transformer-turn-lifecycle.md` (changes A–C).
- jcode: `docs/ACP_SHARED_SESSIONS.md` (`_jcode/turn` peer lifecycle,
  `session/list`, adapter routing fix).

## Current setup

`~/.paseo/config.json` → `agents.providers.jcode` uses `extends: "acp"` with a
command override (`jcode --tool-profile full acp`), an env block holding
provider keys, and a curated `models` list. That path runs through the server's
generic `providers/acp-agent.ts`, not the plugin ACP connection. It has no
transformer seam and won't receive the core hook.

## Plugin layout

Follow `plugins/hoplite-provider` and `plugin-examples/provider-acp-transformer`:

```
plugins/jcode-provider/
  paseo-plugin.json        { "id": "jcode-provider", "requirements": { "paseo": ">=<version with hook>" } }
  index.server.ts          registerProvider(runAcpProvider({...}))
  icon.svg
  server/peer-turns.ts     AcpTransformer for _jcode/turn
  server/peer-turns.test.ts
  README.md
```

`index.server.ts`:

```ts
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
```

- Keep the provider id `jcode`, so existing agents and persisted sessions keep
  their provider.
- The default command is `jcode acp`. The daemon resolves overrides from config
  (`ProviderRegistration.command`, `ProviderLaunch`), so the current
  `--tool-profile full` argument and env keys stay in `config.json`, not in the
  plugin.
- Use the standard ACP profile. The plugin doesn't need
  `--profile extended`: `_jcode/turn` is sent in every profile, and the
  `_jcode/server_event` firehose would only add load.

## Transformer: `server/peer-turns.ts`

```ts
const turnSchema = z.object({
  sessionId: z.string(),
  turnId: z.string().min(1),
  state: z.enum(["started", "completed", "failed", "canceled"]),
  origin: z.object({ kind: z.string(), clientInstanceId: z.string().optional() }).optional(),
  error: z.object({ message: z.string() }).optional(),
});

export const jcodePeerTurns: AcpTransformer = {
  notification({ method, params }, context) {
    if (method !== "_jcode/turn") return null;
    const parsed = turnSchema.safeParse(params);
    if (!parsed.success) return null;
    const { turnId, state, error } = parsed.data;
    return { type: "turn", turnId, state, ...(error ? { error } : {}) };
  },
};
```

Rules:

- **Map lifecycle only.** Turn content (user message, assistant text, tools)
  arrives as standard `session/update`. Core change C shows the peer's user
  message, so the plugin emits **no** timeline items. Emitting them as well
  would duplicate messages.
- Filter by session with the native `sessionId` field only when the shim's
  context exposes the native id. Otherwise rely on the ACP connection being
  per-session (one native session per boundary session), which it is today.
- Treat malformed payloads as not handled (`null`), as the docs require.

## Attaching to a TUI session (user flow)

1. In jcode, the TUI session is running (or persisted).
2. In Paseo, import a session for provider `jcode`. With jcode `session/list`,
   the shim advertises `session.list` automatically (`connection.ts:83`) and the
   session appears with its cwd and title.
3. Paseo calls `session/load`. jcode attaches the adapter's daemon connection to
   the **live** session without taking it over, and replays history.
4. Prompts from either side now appear in both. Turns started in the TUI show
   as background runs in Paseo, with the user message, the streamed output,
   then idle.
5. Pressing stop in Paseo during a TUI-started turn interrupts that turn. jcode
   cancel affects the whole session (jcode spec D4), and the TUI shows its
   normal interrupted notice.

## Config migration

- In `agents.providers.jcode`, remove `"extends": "acp"` and keep the `command`
  and `env` overrides.
- **Verify:** how the daemon resolves a config entry whose id matches a plugin
  provider. Does it apply `command`/`env`/`models` as overrides, and does a
  leftover `extends` take precedence over the plugin? Note the result in the
  README.
- **Models:** the plugin's catalog comes from ACP discovery (jcode's
  `configOptions` model selector). Check whether the config `models` list still
  curates or overrides it for plugin providers. If not, add a `discover`
  transformer that filters to an allow-list passed through env, or accept
  jcode's full list.
- Keep secrets in `config.json` env (or move them to jcode's own credential
  store), never in the plugin directory.

## Acceptance criteria

Run against a real jcode built with the jcode spec phases 1–4 and Paseo with the
core hook:

1. A Paseo agent on `jcode` starts a new session, prompts, and works as it does
   today (regression check).
2. Session import lists jcode sessions for the workspace cwd.
3. With the TUI and Paseo on the same session:
   - a TUI prompt appears in Paseo as a user message, then streams, then the
     run ends, and the agent shows running, then idle;
   - a Paseo prompt appears in the TUI.
4. A Paseo prompt sent during a TUI turn waits, then runs after it. The
   timeline order is: TUI prompt, TUI output, Paseo prompt, Paseo output.
5. Stop in Paseo during a TUI turn cancels it in both clients.
6. Against a jcode without `turn_lifecycle` (older daemon): the plugin behaves
   like today's provider, with no misattributed output and no peer mirroring.
7. Closing the TUI doesn't affect the Paseo agent, and closing Paseo doesn't
   affect the TUI. The daemon keeps the session alive while any client is
   attached.

## Tests

- `server/peer-turns.test.ts`:
  - each state maps to the right `turn` update;
  - unrelated methods return `null`;
  - malformed params return `null`;
  - `error` is passed through.
- An end-to-end smoke test following the plugin docs ("test against the real
  agent"): a scripted run with a second raw daemon client prompting. The
  jcode-side probe at `/tmp/jcode-multiclient/probe.py` on atlas is a starting
  point.

## Open questions

1. Plugin-only or upstream? The transformer is jcode-specific and belongs in
   the fork. If jcode later publishes its own Paseo plugin, this one moves
   there.
2. Should Paseo indicate where a background run came from (for example "from
   jcode TUI")? `_jcode/turn.origin` carries it; see the core spec's open
   question 1.
