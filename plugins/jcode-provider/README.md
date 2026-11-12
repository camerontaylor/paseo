# Jcode provider plugin

Runs jcode as the `jcode` Paseo provider over ACP, and lets a Paseo agent and a jcode TUI window
share one live jcode session. Turns started in the TUI appear in Paseo with the peer's messages,
streamed output and running state.

This is a built-in plugin in this fork. The transformer `turn` update it relies on is fork-only
(camerontaylor/paseo#6) and is in no upstream release, so the plugin ships only with fork builds.
The `>=0.15.0` requirement in `paseo-plugin.json` only keeps older daemons from loading it.

## Contract and compatibility

This integration targets ACP v1 with jcode extensions from the
[jcode interface contract at `a047a0c`](https://github.com/camerontaylor/jcode/blob/a047a0c07b1870043db9b655967d64866cd647ed/docs/ACP_FORK_INTERFACE.md).
Peer-turn observation works with older jcode binaries. Steering and session MCP policy depend on
versioned initialize metadata; steering and Stop permissions also depend on effective attachment
support. A fresh attachment rediscovers that support. The [v1 echo contract](https://github.com/camerontaylor/jcode/blob/39fb7620589835d0c7f1a47653ab74f594b56eaa/docs/ACP_FORK_INTERFACE.md#v1-steering-and-peer-lifecycle)
keeps submitted text local and sends user updates only to other attachments, so live peer text
is preserved even when it equals a pending local prompt or steer.

The provider id stays `jcode`, so config keyed on it keeps working. The default command is
`jcode acp`; the daemon applies the config override, so `--tool-profile full` and env
keys stay in `config.json`.

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
5. When jcode advertises implicit steering, sending during a running turn steers it. Otherwise,
   Paseo refuses a send during a peer turn; it does not cancel the peer's work to make room.
6. Stop interrupts the shared turn when this attachment can stop observed turns. If jcode reports
   that it cannot, Paseo shows a notice. Older binaries retain their existing Stop behavior.

Closing the attachment sends `session/close` without a preceding cancel. jcode's owner-aware close
can still stop work started by this attachment. To leave the shared session without stopping
inserted work, use the explicit provider detach (`PaseoAgentHandle.detachProviderSession()`, the
`agent.provider.detach.request` daemon RPC, or the plugin's `detach_session` RPC). It sends
`_jcode/detach` when the attachment advertises `sharedControl.detach`; it never replaces
`session/close`.

When jcode declares session-supplied MCP servers unsupported, Paseo omits them and shows a notice
naming the configured servers. Configure those servers in jcode itself.

With `turn_correlation`, successful prompt responses name the shared `turnId` and `role`.
Paseo settles one terminal and one usage report per shared execution, so a steer response never
duplicates the origin's completion. Without the extension the legacy turn behavior is unchanged.

With `skill_selection`, an explicit skill name is sent as `_meta.jcode.skill`; `null` clears the
sticky selection and an omitted field leaves it alone. The submitted text is unchanged: an
explicit `null` or name sends the original slash command so a clear can still run a builtin, while
only an inferred skill command becomes bare arguments. Skill-classified commands and
`send_agent_message_request.skill` both reach that path. A busy steer rejects before insertion
rather than dropping the selection. ACP v2 is out of scope.

## Tests

```bash
nice -n 10 npx vitest run plugins/jcode-provider/server/capabilities.test.ts plugins/jcode-provider/server/peer-turns.test.ts plugins/jcode-provider/server/corpus-replay.test.ts --bail=1
```

`corpus-replay.test.ts` drives the vendored snapshot of jcode's
`tests/fixtures/acp` corpus through the real ACP connector, not only through JSON assertions. Set
`JCODE_ACP_FIXTURE_DIR` to replay a newer corpus.

The end-to-end criteria in `specs/jcode-provider-plugin.md` need a jcode build with shared sessions
(`docs/ACP_SHARED_SESSIONS.md` in the jcode repo), a jcode TUI and a Paseo daemon from this
branch, so they are checked by hand rather than in CI. Historical baseline: all 7 passed on
2026-11-05 against an isolated jcode daemon built from `ct/acp-shared-sessions` and Paseo
`0.15.0-beta.1`; the run is recorded in the QA section of camerontaylor/paseo#7.
