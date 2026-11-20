# Stream rollback — backup/export and restore procedure (TM-01 removal group)

Applies when disabling the Stream port (`intake/tmad-stream-flow`) on a host whose agent records
may contain Stream data. P2 proved the mechanics on copied data (`/tmp/tmad-port/rollback-home`,
logs `p2-rollback-{1-write,2-export,3-strip,4-restore}.log`); this is the operator procedure for a
real host. **Never point any of this at a live `~/.paseo` without the user's explicit OK.**

## What beta.3 storage does to Stream data

`STORED_AGENT_SCHEMA` in `packages/server/src/server/agent/agent-storage.ts` is a plain `z.object`.
When Stream is absent, parse **silently strips** `companionEntries` and `artifacts`, and the next
ordinary record rewrite persists the stripped form. This is expected beta.3 behavior — do not "fix"
it with a generic-storage change (plan P2.4).

- `companionEntries`: Stream pins, questions, Q&A, outcomes (bounded per TM-01: ≤100 manual,
  ≤50 captured moments).
- `artifacts`: artifact feed metadata (bounded ≤200/agent).

## Before disabling (while Stream is still running)

Per agent record file under `$PASEO_HOME/agents/**/<agent-id>.json`:

1. **Back up** the whole agents dir: `cp -a $PASEO_HOME/agents $PASEO_HOME/agents.backup-<date>`.
2. **Export** the Stream fields per agent ID into one JSON file:

   ```jsonc
   // stream-export.json — { "<agent-id>": { "companionEntries": [...], "artifacts": [...] } }
   // Only agents that actually carry Stream fields get an entry.
   ```

   The P2 demo script does both steps (fs.cp backup + export):
   `/tmp/tmad-port/logs/p2-rollback-demo.ts.txt` — phase `export`. Adapt the two constants at the
   top (`AGENTS_DIR`, `EXPORT_PATH`) to the host and run it with the repo's tsx on a tree that has
   Stream enabled.

3. Verify `stream-export.json` parses and covers every agent you expect (count keys vs agents with
   Stream data).

## Disable Stream

Remove/comment the `intake/tmad-stream-flow` line (and TM-01B if it ever exists) from the manifest
and rebuild/restart per the normal desvio process. Expect the stripping above: any agent record the
disabled daemon rewrites loses `companionEntries`/`artifacts` but keeps every non-Stream field.
A user removing Stream permanently can skip the export and intentionally discard the data.

## After re-enabling: restore only Stream fields

For each exported agent ID, load the **current** record and merge **only** `companionEntries` and
`artifacts` onto it, then save. Rules the demo proves (phase `restore`):

- **Never replace the whole record.** Newer non-Stream metadata written while Stream was disabled
  (title, labels, config, status, timestamps) must survive. Demo: a title rename from the disabled
  window survived the restore.
- **Skip deleted agents** (`get(id)` returns null → skip with a note; do not resurrect).
- **Do not restore if the current record already has newer Stream fields.** Restore is meant to run
  right after re-enabling, before the user creates new Stream data. If in doubt, ask; the backup
  from step 1 remains the fallback.
- After the merge, the record must round-trip `parseStoredAgentRecord` (the demo asserts this).

The demo script's phase `restore` implements the merge; phase `write` shows the record shape used.

## Verification after restore

1. `parseStoredAgentRecord` accepts every restored record (no schema drift).
2. The feed shows the restored pins/Q&A/artifacts for a re-enabled agent.
3. Non-Stream fields compare equal to the pre-restore current record.

## Limits

- The export is a point-in-time snapshot: Stream data written after the export and before disabling
  is not in it. Export immediately before disabling.
- The restore is not a three-way merge: if Stream data changed both in the export and on the record
  since, last write (the export) wins for the Stream fields. Hence rule 3 above.
- Both scripts assume the on-disk layout `$PASEO_HOME/agents/**/<agent-id>.json` (beta.3
  `AgentStorage.buildRecordPath`).
