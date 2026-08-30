# Upstream candidates

Changes we could write that are compatible with upstream's code and philosophy.

Compatibility is the criterion, **not** whether upstream accepts them. We write
each as a clean topic branch off `upstream/main`, carry it in the grab basket
either way, and offer it. If it lands we delete the manifest line; if it doesn't
we keep it in the middle band and pay the rebase cost. Acceptance is upstream's
call and a bad bet to plan around — [upstream-research-2026-08-22.md](upstream-research-2026-08-22.md)
§3.1 has the numbers: 465 open community PRs, 11 with a maintainer comment.

Anything needing a product decision belongs in
[local-fork-candidates.md](local-fork-candidates.md) instead.

## The bar

From `CONTRIBUTING.md` and `docs/product.md`, plus the rejection reasons observed
across 74 closed community PRs (research §5):

**Qualifies**

- **Bug-shaped, with an existing issue.** _"Feature requests opened as issues will
  get closed automatically."_ No issue and not a bug means it is not this file.
- **One focused change.** Bundling unrelated changes is a stated rejection reason.
- **At the right layer.** Two verbatim closures: _"the client is the wrong place
  for this"_, and _"no Claude specific knowledge must leak out of the claude
  provider / manifests."_
- **Protocol-safe.** New fields optional, capability gated on
  `server_info.features.*`, any shim tagged `COMPAT(name)`. See
  `docs/protocol-compatibility.md`.
- **Provable.** Automated tests, QA evidence, per-platform screenshots for UI, and
  an explicit statement of which platforms went untested. QA is named as the
  bottleneck, so evidence is the contribution.

**Disqualifies**

- Redirects a feature or the design — _"takes a feature or the design in a
  direction I don't want."_
- Vendors or adapts third-party code: _"i do not want to adapt any third party
  code to paseo, because i will be inheriting decisions and maintenance debt."_
- Belongs in a plugin. Themes were explicitly routed to plugin contributions
  rather than core.
- Reads as fully AI-generated. Paste raw evidence and repro steps, never an
  agent's diagnosis — the maintainer is on record that agent analyses are
  _"99% wrong and draw causation from nearby logs"_ (#3217).

## Candidates

Verified open on 2026-08-23. Re-check before starting: `gh issue view <n> -R getpaseo/paseo`.

| Issue     | What                                                                                                                   | Layer                  | Size | Why it qualifies                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#3513** | Desktop app gives its daemon no locale, corrupting CJK in every terminal it spawns                                     | desktop → daemon spawn | XS   | Pure defect, one env var at one spawn site, no design surface. Untriaged, 0 comments.                                                                                                                 |
| **#678**  | Services reverse proxy shows the `.localhost` URL to a remote client                                                   | server                 | S    | **Maintainer already agreed**: _"The current UI showing the `.localhost` proxy URL while connected remotely is misleading; I'll fix that too."_ Open 113 days since. Blessed direction, unowned work. |
| **#3416** | `paseo daemon pair` reports "did not provide a pairing offer" for every client-side failure, discarding the real cause | cli                    | XS   | Error-reporting defect. Strictly additive diagnostics, no behaviour change.                                                                                                                           |
| **#1349** | Android prompts fire notifications on Desktop instead of Android                                                       | server push routing    | M    | **79 days, zero replies.** Labelled `bug`/`p2`. Needs routing evidence first — see below.                                                                                                             |
| **#3514** | A WebSocket that dies without a close frame goes unnoticed ~50s; nothing probes on resume or network change            | client/server          | M    | Defect with a clear mechanism. Touches reconnect, so needs care and real QA.                                                                                                                          |
| **#3625** | No way to paste into the terminal on iPad — the paste button is phone-only                                             | app                    | S    | Form-factor gate bug. `useIsCompactFormFactor()` exists for exactly this (`CLAUDE.md`).                                                                                                               |
| **#3019** | Cannot disable desktop notifications                                                                                   | desktop                | S    | `p3`. Small settings gap; check it doesn't collide with a notifications redesign first.                                                                                                               |
| **#1937** | Daemon leaves orphaned `claude` children — ~25 processes, up to 1d5h, ~240 MB each                                     | server lifecycle       | M–L  | `p1`, but **stuck on `needs-more-info` for 46 days**. The valuable contribution here is the evidence, not the patch.                                                                                  |
| **#2470** | Forge PR poller has no global API budget — ~9,340 GraphQL points/hour at 144 targets                                   | server                 | M    | `p1`, open, 2 comments. Burning a user's whole GitHub quota is squarely a defect. Watch the boundary with #2474, which was closed as a feature.                                                       |

### Where to start

**#3513 and #3416 are the two to do first.** Both are extra-small, both are pure
defects with no design surface, and both are untriaged with zero comments — so
there is no competing work and no direction to guess at. They are also good
calibration: they tell us what a PR from us actually costs end to end, including
the QA evidence, before we spend that on something larger.

**#678 is the highest-value low-risk one**, because the maintainer has already
stated the fix he wants and then not had time to do it. That removes the single
biggest risk in this file — building something in a direction he does not want.

### #1937 deserves a different shape

Do not open with a patch. It is `p1` and has sat on `needs-more-info` since
2026-07-08, which means diagnosis is the blocker, not implementation. And
`CONTRIBUTING.md` is explicit that an agent's diagnosis is unwelcome while raw
evidence is wanted.

So the first contribution is an issue comment carrying: process tree snapshots
over time, the daemon log lines around agent completion, which provider and
which exit path, and whether the children are reaped on daemon restart. Only
after that is the reaping fix worth writing — and by then the maintainer may
have written it.

## Working them

1. Branch from `upstream/main`, never local `main` — local `main` carries `fork/`,
   which would land in the diff. See [README.md](README.md).
2. One change per branch. If a fix needs a refactor, that is two branches.
3. Add the branch to `~/.paseo-fork/manifest.txt` in the **middle** band, oldest
   first, so it is in our daily build while it waits.
4. Gate is `npm run typecheck` and `npm run lint`. Add real tests too — "no tests"
   is a stated rejection reason.
5. Open the PR with the linked issue, the problem statement, QA evidence, and the
   platforms you did and did not test.
6. When it lands, delete the manifest line. Only the lines below it re-resolve.
