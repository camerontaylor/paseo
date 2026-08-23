# Upstream research — getpaseo/paseo

Snapshot date: **2026-08-22**. Base commit at time of writing: `8905ad416`.

Point-in-time research into the upstream project, its community forks, and its
pull requests: what has been built, what people are building around it, and
where the friction is. Upstream moves fast — treat every number here as a
reading, not a fact.

**Why this lives in `fork/`.** Upstream has no `fork/` directory, so nothing here
can land in a rebase conflict. That is the single most repeated lesson from the
fork survey below: `yooztech` invented a `packages/app/src/fork/` namespace for
exactly this reason, and the most common commit message across the whole fork
corpus is some variant of *"restore X dropped during upstream merge"*. Keep
fork-local material out of upstream's paths.

## Scope

| Source | Coverage |
|---|---|
| Forks | 1,546 enumerated, 678 compared against upstream, ~45 with real divergence |
| Open PRs | 490 |
| Merged PRs + releases | 1,119 merged, 100 releases |
| Issues | 467 open, 983 closed |

Upstream at snapshot: 14,584 stars, 1,544 forks, created 2025-10-13.

### Two methodology notes

**Renaming a fork is a weak signal.** Of ~50 renamed or redescribed forks, only 9
had any code. `paseo_niubi`, `corral`, `norcontrol`, `faseo`, `AgentUI` and
dozens more are 0 commits ahead — aspirational rename, no code. The filter that
works is `pushed_at` well after `created_at`.

**Six forks show 40–2,954 commits "ahead" with zero fork work.** Every ahead
commit is authored by the upstream maintainer; they captured a lineage later
rewritten out of `main`. Affected: `jasonkneen`, `Mu-L`, `vorojar`, `caoer`,
`rowankid`, `DevZonayed/nexalance-skill-getpaseo-paseo`. Always check commit
authorship before concluding a fork diverged.

**Cheap triage command** — one call gives ahead/behind, changed files and every
commit message, without cloning:

```sh
gh api "repos/getpaseo/paseo/compare/main...OWNER:REPO:BRANCH" \
  --jq '{ahead: .ahead_by, behind: .behind_by,
          files: [.files[].filename],
          commits: [.commits[] | {a: .commit.author.name, m: .commit.message}]}'
```

---

## 1. What upstream has built

The project began 2025-10-13 as **`voice-dev-mcp`** — a voice-first agent
orchestrator on OpenAI's Realtime API, migrated to LiveKit, renamed to Paseo on
2025-11-15. The voice-first origin explains why speech surfaces sit where they do.

| Period | Landed |
|---|---|
| Oct–Dec 2025 | Agent lifecycle, registry, multi-daemon, sub-agents, git diff viewer, worktrees |
| Jan 2026 | CLI from zero (#4, +11k/108 files), relay transport, QR pairing, file explorer |
| Feb 2026 | E2E encryption for the relay (#5), Electron desktop, `@`-file autocomplete |
| Mar 2026 | **projects → workspaces → tabs**, split panes, terminal tabs, service proxy |
| Apr 2026 | **SQLite persistence + first-class terminals** (#230, +38,332/326 files); **ACP base provider, hardcoded provider unions removed** (#170) |
| May 2026 | Consolidation, e2e/test infrastructure, rewind-from-any-message (#1154) |
| Jun 2026 | i18n migration (#1282, 199 files), multi-host sidebar merge (#1538), browser tools (#1359) |
| Jul 2026 | Pluggable forge abstraction — GitLab/Gitea/Forgejo/Codeberg (#1913, +20,966, external); OMP provider (#2067); Hub (#2035) |
| Aug 2026 | Mobile terminal rewrite (#1607), agent profiles (#3208), `@getpaseo/client` SDK (#3141), **plugins** (#3222), **active-turn steering** (#3394, #3580) |

Today: 6 first-class providers plus an ACP catalog, 5 forges, 9 locales, 4 platforms.

### Who builds it

- 1,119 merged PRs across **150 distinct authors**.
- `boudra` authored **786 of them (70%)** and **89% of all 5,072 commits**.
- **96 of the 150 authors have exactly one merged PR.** Only four non-core
  contributors have ≥10: `cleiter` (28), `mcowger` (22), `nikuscs` (11),
  `colonelpanic8` (10).
- Outside contribution started Feb 2026 and stabilized around **~30%/month**.
- External work is not trivial: the forge abstraction (#1913, +20,966) and the
  OMP provider (#2067, +12,984) are the 3rd and 7th largest merged PRs.

### The fix:feat inflection

Conventional commits on `main`: **1,211 `fix` vs 491 `feat` — 2.47:1 overall.**
By month:

| Month | feat | fix | ratio |
|---|---|---|---|
| 2026-01 | 64 | 40 | 0.6 |
| 2026-03 | 86 | 155 | 1.8 |
| **2026-04** | 87 | **360** | **4.1** |
| 2026-05 | 33 | 141 | 4.3 |
| 2026-07 | 31 | 143 | 4.6 |
| 2026-08 | 50 | 167 | 3.3 |

April 2026 is when #230 landed the SQLite/workspace/terminal rewrite. The ratio
quadrupled and **never returned**. Release notes agree: 142 "Fixed" bullets
against 80 "Added" across recent releases.

The recurring fixes name the debt precisely, and they are all *lifecycle-boundary*
bugs — sleep, reconnect, archive, exit:

- terminal sessions lost after host sleep or worker stalls (#3235, #3263)
- workspace file watching stalls the daemon (#2858); hang on archive (#3107)
- timeline ordering after reconnect (#2718, +13,781 — 5th-largest PR in the repo,
  spent entirely on keeping message history stable across resume)
- worktree correctness (#3224, #3233, #3311)

Worst fix:feat by package: `server` 1.8:1, `app` 1.6:1, `desktop` 1.7:1. Healthy:
`cli` 0.7:1, `protocol` 0.5:1, `client` 0.4:1.

### Current effort (last ~8 weeks)

528 merged PRs / 959 commits. Package touch rate: app 55%, server 36%, docs 33%,
protocol 14%, desktop 12%, client 10%, cli 8%. Themes: **plugins** (shipped
2026-08-14ish), **Hub** (now its own scope tag, guided setup #3651), the explorer
as a persistent tab host (#3287 → #3605), **steering** (send into a running turn
rather than interrupting), and compact-form-factor mobile polish.

---

## 2. What the community built that upstream hasn't

This is the more useful half — it maps the shape of the gap.

| Capability | Built independently by |
|---|---|
| **Task board / kanban** | **6 forks**: `hubtool/hubcode`, `haikostudio/Haiko-devtool`, `AngusFu`, `sumaliqinghua/HumanBoss`, `mcrowder65`, `jtalborough` |
| **Multi-user auth / accounts** | **4 forks**: `affil-ai` (`packages/auth-gateway`, Google OAuth + Better Auth + SQLite), `PowerDi/paseo-dashboard` (`packages/dashboard`, passkeys, invitations, tenant isolation), `haikostudio` (Caddy + systemd + own auth server), `figuernd` (relay pairing enrollment + revocation) |
| **Remote / SSH hosts & fleets** | 3 forks — `jingwangsg` (remote-daemon proxy with terminal-ID rewriting, download-token bridging), `hahahuy` (machines RPC + Tailscale + `install.sh`), `sakurayun` (SSH host manager, keychain, known-hosts, forwards) — plus 2 open PRs (#2396, #3115) |
| **Editor integration** | `hinneslung` (shipping on the VS Code Marketplace, upstream links it), `HamiltonHuaji` (relay-backed second attempt) |
| **Composer prompt history** | **4 competing open PRs**: #671, #2248, #2996, #3507 |
| **Providers** | ~64 open PRs + 10 forks: Droid, Cursor, DeepSeek V4, Grok, Kimi, Yeet Code, CLIProxyAPI, Codex-compatible endpoint profiles |
| **Chat / email / Slack surfaces** | `affil-ai`'s `packages/chat` — explicitly an "office of CTO" agent, not a coding agent |
| **Cost & completion awareness** | `alnimra` ("quota windows, not dollars"), `JrDw0` (per-turn tokens + generation speed), `JLarky` (idle chime, send ding) |
| **Knowledge bases + MCP OAuth polyfill** | `AngusFu` — for MCP servers that block dynamic client registration (Atlassian, Figma) |

### Forks worth watching

| Fork | Ahead/behind | What it is |
|---|---|---|
| `haikostudio/Haiko-devtool` | 702 / 508 | French-language kanban + deploy console; own self-host auth stack |
| `AngusFu/paseo` | 687 / 795 | Knowledge bases, FastMCP CLI with OAuth polyfill, kanban |
| `sakurayun/paseo-reclaude` | 478 / 449 | Most-starred (20★). Chinese distribution, ReClaude billing, Grok, SSH, 40 own releases |
| `colonelpanic8/paseo` (`assembled`) | 418 / **3** | **A PR grab basket.** See §4 |
| `team-harness/paseo` | 174 / **3** | Daily upstream resync; chat sharing, prompt library, own APK/TestFlight pipeline |
| `hinneslung/paseo` (`vscode-extension`) | 157 / 175 | VS Code extension, shipping product, releases 0.1.2 → 0.4.0 |
| `walter-erquinigo/paseito` | 23 / 175 | Best fork-maintenance automation in the corpus. See §4 |
| `citizenll/xCodexMobile` | 19 / 1740 | Keeps *only* the mobile connector; an explicit AGPL disclosure boundary for a closed desktop product |

---

## 3. Pain points, ranked by cross-source corroboration

Weighted by how many independent sources (issues / PRs / forks) show the same thing.

### 3.1 The maintainer is the bottleneck — structurally, not from lack of capacity

All three sources agree.

- 490 open PRs, **465 community, 242 distinct authors — `boudra` has commented on 11.**
- 67 have zero comments of any kind. One label in use across all 490.
- Yet median merge latency *when he engages* is **1.3 days** (p90 7.5). Bimodal:
  picked up and merged in a day, or never touched.

`CONTRIBUTING.md` states the cause plainly: *"product, design, architecture, and
workflow decisions are currently all made by the maintainer"* and *"QA is the main
bottleneck of Paseo's product development."* Review parallelizes; product
judgment held by one person does not. The most common closure reason on community
PRs is **"superseded by my own PR."**

Forks confirm it independently — see §4.

**Two low-cost fixes visible in the data:**

1. **Auto-approve fork CI.** Five PRs (#1826, #2657, #2483, #2301, #1679) sit at
   `action_required` with zero jobs, while `CONTRIBUTING.md` lists failing checks
   as grounds for rejection. Contributors are told to pass checks they cannot trigger.
2. **A one-line direction verdict on duplicate clusters** (prompt history, Mermaid,
   SSH) would free four to six competing implementations at a cost of three sentences.

### 3.2 Agent lifecycle reliability

Strongest reproduction evidence in the tracker.

- **#3217** — one send creates six agents. *"Thirty six milliseconds between the
  first create and the last, so this is not me pressing send several times."*
  Four independent repros across Linux, Windows, macOS, three releases.
- **#3273** — a follow-up message kills running background subagents. Three repros.
  *"Every `replaceAgentRun` failure maps 1:1 onto killed Claude Code subagents, to
  the millisecond."*
- **#1937** (`p1`, 44 days on `needs-more-info`) — orphaned `claude` processes,
  ~240 MB each: *"~25 orphaned claude processes … alive for up to 1 day 5 hours."*
- **#3061** — a daemon restart mid-turn aborts the provider turn; from an
  orchestrator's view the agent looks finished-but-silent.

### 3.3 The app breaks the more you use it

A hard 8 MB socket bound plus a relay message cap make heavy use the failure trigger.

- **#2610** — a 96 MB / 45,700-line transcript *"can never fit under the 8 MB
  bound."* The agent is permanently unopenable; restart does not help.
- **#2300** (`p1`) — 4 GB V8 heap OOM, at least three occurrences, two users.
  *"The available reproduction takes one to two days."*
- **#2221** — one oversized frame closes the shared transport and **every** session
  on that daemon stops loading until a force-quit.
- **#2474** — 243 workspaces / 190 worktrees / **124 GB in a week**, never reclaimed,
  also burning the forge-poll quota. Filed as a bug with hard numbers; reclassified
  as a feature request and closed.

E2EE base64 inflates payloads 4/3 *before* the relay cap applies, which is why
image-heavy sessions (#2220) trip it first.

### 3.4 Auth is the #1 first-contact failure

- **#3023** (pinned tracking) — Claude OAuth regression on headless/programmatic
  launches, all three OSes. Credentials get truncated: *"a healthy 509-byte
  `.credentials.json` became a 368-byte file … `expiresAt`, `refreshTokenExpiresAt`,
  and `scopes` disappeared, followed by a forced login."*
- **#176** — **open 141 days**, the oldest unfixed issue. API-key mode dead-ends:
  *"Paseo doesn't recognize /login as a command."*
- **#3325** (`p1`) — no recovery path: no account attribution, no credential
  re-check, `/login` unavailable in-app.
- **#2780** — multi-account switching, the strongest "this blocks me" language in
  the tracker: *"the only way out is to open a new session on the other provider
  and lose the conversation context, which defeats the purpose of the multi-profile
  setup described in the docs."*

### 3.5 Distribution is broken for anyone who isn't upstream

**Fork-only signal — invisible in issues and PRs.**

- Android APK CI without EAS rebuilt from scratch by **seven** forks. `sakurayun`
  burned 4 commits fighting runner OOM; `staoran` 8 (swap, memory caps, Gradle
  cache keys); `team-harness`, `citizenll`, `lzm04521`, `JrDw0`, `yooztech` too.
- macOS code signing appears in five forks. `amitbtcai` has two separate
  *"support unsigned"* commits; `MinLeeV5` ships *"install ad-hoc macOS updates directly"*.
- `jtalborough` spent 14 consecutive commits on iPhone OTA delivery.
- `lululau/paseo`'s 31 commits are *entirely* CI plumbing to produce a desktop build.

### 3.6 One daemon = one machine = one user

All three assumptions get broken by someone.

- **#1695** — *"Project settings says: 'We don't have an editable copy of this
  project on any connected host'"*, confirmed by a headless-remote user and a
  same-host user. #3223, #2509 are the same shape.
- **Team use is essentially absent from issues** (one discussion, one comment) but
  is the single most-built fork capability. The people who need it fork rather than
  file. Four independent auth gateways is a stronger demand signal than any thread
  in the tracker, and none of it touched the tracker.

### 3.7 Extension seams exist for one case, not the general one

- Adding a provider still edits three `packages/protocol/` files (`cleverunicornz`).
- `UnbrokenHunter` had to add *"let custom ACP profiles opt into a built-in adapter"*
  because config-only providers can't reuse built-in behavior.
- `providers.claude.command` swaps the binary but not auth or quota — so `sakurayun`
  reverse-engineered a private cookie API and hand-added a `features.reclaudeUsage`
  capability bit.
- The Electron bridge isn't a neutral host contract — so `hinneslung` impersonated
  `window.paseoDesktop` and added a fifth platform gate.
- The universal workaround, quoted in three PRs: *"the only way to set that up is
  hand-editing `config.json`."* One upstream agent ships a `gjc setup paseo`
  command whose entire job is writing Paseo's config file for the user (#3471).

Both real forks in the top-star tier understood upstream's conventions well enough
to extend them correctly, and still had to patch core files rather than register
from outside.

### 3.8 CJK / IME is systematically broken

- **#2193** — *"a PTY that emits `中文` is captured as `中 文`, with a literal ASCII
  space between the two characters. The emitted bytes contain no space."* Fix PR
  #2319 open and unmerged since July.
- #3513 (daemon spawns terminals with no locale), #3511 (IME candidate window
  misplaced), #3560 (Android Korean IME), plus five separate CJK IME composition
  fixes in v0.5.0-beta.1 alone (#3517, #2811, #3462, #3343, #3391).
- **Four separate Chinese-localization forks all died** because they hard-coded
  strings into 108+ `.tsx` files instead of using i18n. A string-replacement that
  size cannot survive a rebase.

### 3.9 Notifications fail in every direction

- **#1349** — *"I do receive the corresponding notifications, but they seem to
  appear on my Desktop device rather than on Android."* **77 days, zero replies.**
- **#1841** — no sound, because Electron notifications hard-set `silent: true`.
  The reporter shipped an external notifier as a workaround. **Fixed upstream by
  #2582, merged 2026-08-08** (verified 2026-08-22).
- **#3019** — can't disable desktop notifications at all.
- **#1495** — silent total failure on Android without Google Play Services.
- **#2622** (`p1`) — iOS backgrounding for 1–2 minutes can lose the completion push.

### 3.10 Rebase cost is what actually kills forks

The most repeated commit across the entire fork corpus is *"restore X dropped
during upstream merge"* — verbatim in `iamriajul` (chat outline navigation),
`fav-devs` (session handlers), `sakurayun` (×4: deps, build scripts), `so2liu`,
`litnimax`. `sakurayun`'s final week before going quiet is entirely merge-damage
repair.

Mitigations forks invented, worth stealing:

- `walter-erquinigo/paseito` — `automation/feature-registry.json`: every fork
  feature has an `id`, `intent`, machine-checkable `invariants`, and a `contracts`
  array of vitest commands. Plus a written evidence policy: *"An upstream
  implementation replaces a local feature only when … a separate read-only reviewer
  can locate the same evidence. Use `blocked` rather than guessing."*
- `yooztech` — a `packages/app/src/fork/` namespace to keep fork code out of
  conflict range.
- `UnbrokenHunter` — `docs/fork-workflow.md`: `main` mirrors upstream 1:1, no
  custom code; `custom` is the development branch.
- `lzm04521` — a CI guard that fails the build if upstream's README overwrites the fork's.
- `so2liu` — a customization audit that tracks which local changes were upstreamed.

### 3.11 Issue-tracker reading hazard

The usual "rank by reactions" heuristic **does not work here**. The most-reacted
open issue has 9 reactions; the median has 0 reactions and 0 comments. Two causes:
the maintainer ships a high fraction of what's asked (~15 of the top 20 most-reacted
requests are already COMPLETED), so demand converts to code before it accumulates
+1s; and aggressive consolidation merges duplicate energy into single threads.

**Rank by cluster volume and independent cross-platform repro count instead.**
#3217 has 0 reactions and 9 comments containing four separate reproductions — the
most serious open bug in the repo, and a reaction sort buries it.

Related: two mass closures (74 on 2026-07-30, 31 on 2026-08-09) redirected the
most-reacted asks to Discussions, which has 109 threads and near-zero engagement.
The pain re-files itself — #1628 → #3629, the queued-message trio → #3464.

### 3.12 Licensing transition — active hazard

**Issue #2982: AGPL-3.0 → Apache-2.0**, opened 2026-08-07, deadline **2026-08-21**
(the day before this snapshot), 100+ comments, still open at snapshot time.

- *"Pull requests from contributors who have not consented will remain blocked
  until they provide consent."*
- *"If a contributor has not responded by the deadline, I will remove or
  independently rewrite their remaining contributions before relicensing."*

I read every non-boilerplate comment: **zero dissent** — it is a consent drive, not
a controversy. But it has two consequences for us:

1. It is currently the fastest route to a maintainer reply, which distorts the PR
   response data above.
2. **It changes how long we carry a PR.** A PR whose author has not consented
   cannot merge upstream until they do, so it is a long-haul carry rather than
   something that lands soon. The rewrite threat applies only to code *already
   merged* upstream, so a contributor with no merged PRs has nothing at risk —
   verify that before treating non-consent as a hazard. Checked 2026-08-22:
   `kingsleydon` (#1826), `dkribeiro` (#2664) and `Ctrl-Creeper` (#3474) have
   each commented nowhere on #2982 and have zero merged PRs upstream.

---

## 4. Our PR grab basket

Three forks independently concluded that upstream's merge queue is the bottleneck
and built tooling to route around it:

- **`colonelpanic8/paseo`**, branch `assembled` — a tool literally called
  `fork-assembler`. Every commit reads `fork-assembler: merge <thing>`. It carries
  **44 numbered upstream PRs** (#2517, #2520, #2521, #2532, #2553, #2628, #2629,
  #2650, #2657, #2658, #2659, #2660, #2730, #2772, #2784, #2785, #2820, #2843,
  #2845, #2849, #2872, #2873, #2875, #2883, #2884, #2885, #2898, #2900, #2927,
  #2954, #2956, #2957, #3006, #3087, #3475, #3506, #3662) plus its own unlanded
  features, and stays **3 commits behind upstream**.
- **`sakurayun/paseo-reclaude`** — 25 cherry-picked unmerged upstream PRs.
- **`finelly977`** — a different set (#3315, #3235, #3243, #3107, #3059, #2306, #3227).
- **`fav-devs`** — `7f71b8a "scripts for merging upstream pull requests in
  PowerShell and Bash"`.

### Use desvio

**<https://github.com/cleiter/desvio>** — Apache-2.0, bash, macOS + Linux. Created
2026-08-14, 50 commits, actively developed. Written by **Christoph Leiter**
(`cleiter`), Paseo's top non-core contributor: 28 merged PRs, ~20 open, ~10 closed.
It came out of maintaining their own Paseo build carrying their own rejected and
pending PRs — the README's example output shows real Paseo PR numbers (#3206,
#2504, #3034, #2084, all theirs).

> *Paseo is Spanish for a walk. A desvío is the detour you take on the way.*

It ships **`examples/paseo/`** — a complete working config: preflight against a
running daemon, `npm ci` gated on the lockfile, an Expo router-types seed,
typecheck + lint as the gate, plus `start.sh`, `desktop.sh`, `package.sh`,
`install.sh`.

**How it works.** Every run: fetch upstream, recreate a disposable integration
branch from the base, merge each manifest branch in order, install, build, verify,
print what you got. The build tree is a `git worktree` of your checkout, not a
clone. Your topic branches are never written to.

**Why merge rather than cherry-pick** — worth internalizing, it is the core design
argument: *"A merge resolves once against a whole topic. Cherry-pick replays a
branch commit by commit, so a branch that builds on itself conflicts with itself
and you answer the same question once per commit."* This is how `git.git` builds
its `seen` branch.

**Conflicts.** First occurrence goes to Claude Code (no shell tool, writes confined
to the worktree, every local branch OID snapshotted before and verified after);
after that `rerere` replays it forever. Delete/modify conflicts — which rerere
structurally *cannot* record and which would otherwise recur on every build forever
— are classified from `git ls-files -u` and answered with a one-bit read-only
question, cached on path + class + blob OIDs.

**The gate is the point.** From the README, and this is exactly our #3.1 risk:

> Upstream started validating persisted settings against a strict schema. A branch
> added a new setting. Neither edit touched the other's lines, so the merge was
> clean — and the app then discarded every user preference on load, silently, with
> the symptom appearing as "the theme dropdown does nothing". Nothing in the merge
> could have caught it. A typecheck caught it one line later, in a different file.

**Scaffolded on this machine 2026-08-22** at `~/.paseo-fork`, building against the
`upstream` remote (`getpaseo/paseo`) — `origin` is our own fork and carries no PR
refs.

**Outcome: green on 2026-08-22**, carrying five daemon-side fixes — #2664, #3474,
#2237, #2319, #2785 — on `upstream/main@3029b5991`. 78 files, +4467/-176, gate
(typecheck + lint) passed. Four candidates are parked with reasons inline in the
manifest: #280 and #1813 need code ports, not merges; #1826 and #1834 merge but
need nine companion fixes between them.

Note what green means: static checks only. Nothing was executed — no unit tests,
no e2e, no manual QA. The build sits on the unreleased dev tip plus five unmerged
PRs, so it is *less* tested than the current beta release, not more. Use it to
pull a specific fix you need, not as a daily driver.

**Four environment fixes were needed on Linux**, all recorded at their site:

| Fix | Why |
|---|---|
| `DESVIO_REMOTE="upstream"` | A GitHub fork does not mirror the parent's `refs/pull/*`, so no manifest line resolved against `origin`. |
| `/proc/$pid/cwd` in `desvio_preflight` | `lsof` is absent on Arch, so the guard against building under a live daemon silently no-opped. |
| `.omc/` in `.git/info/exclude` | The local skill-distiller writes there on every `claude` run, tripping desvio's resolver fingerprint (which hashes `ls-files --others --exclude-standard`). |
| `desvio_install` rewritten on `sha256sum` | desvio's `stamp_digest` shells out to `shasum`, absent on Arch. The empty digest read as a cache hit, skipping `npm ci` forever on a tree with no `node_modules`. A fail-open cache. |

The last two are portability bugs in desvio worth reporting to `cleiter` — the
README claims Linux support, and CI presumably passes only because its runners
have Perl's `shasum`.

**Setup:**

```sh
git clone https://github.com/cleiter/desvio.git ~/src/desvio
ln -s ~/src/desvio/bin/desvio ~/.local/bin/desvio

cp -R ~/src/desvio/examples/paseo ~/.paseo-fork
cd ~/.paseo-fork
$EDITOR desvio.conf     # DESVIO_REPO -> /home/ctaylor/repos/paseo
$EDITOR manifest.txt
desvio build
```

Keep the build directory **outside** this checkout — it holds the build tree, state
and manifest, none of which belongs in a repo we also send PRs from.

**Manifest ordering rule** — the front is frozen, the back moves. Merges resolve
against everything already merged, so moving a line re-resolves everything below it
and discards their recorded resolutions. Append; do not insert.

- **Front** — branches that will never land upstream. Permanent, so pay the conflict
  cost once at the bottom where nothing disturbs them.
- **Middle** — open PRs, oldest first. When one lands, delete its line.
- **Back** — whatever we started yesterday.

A manifest line can name a PR ref directly, with no fork remote to add:

```
origin/pull/3206/head       # PR #3206
```

### Intake rule

Decided 2026-08-22 after #280 failed to merge. **Carry fixes and additive
features; refuse second answers.**

- **Carry** — PRs that fix something we hit (#2664, #3474, #2237, #2319) and
  features that add a capability upstream has no answer for at all (#1826 queued
  messages, #2785 multi-account). These merge cheaply and carry indefinitely,
  because nothing upstream contests the same ground.
- **Refuse** — a PR offering a *second answer to a question upstream already
  answered differently*, regardless of diff size. #280 is the worked example:
  upstream ships Cursor over ACP, the PR ships it over the headless CLI, and both
  claim the `cursor` key in `PROVIDER_CLIENT_FACTORIES`. No amount of merge skill
  reconciles that — it needs a product verdict upstream has withheld for 131 days,
  and the PR's client still implements the removed `listModels`/`listModes` API
  rather than the required `fetchCatalog`.

The general point: a grab basket absorbs *merge* cost indefinitely — that is
mechanical, delegable, and `rerere` amortizes it to zero. It cannot absorb a
*decision*. Diff size is the wrong intake filter; contested ground is the right one.

### Candidate manifest lines

Bug fixes with strong evidence, ordered oldest-first per the middle-band rule.
**Verify current state before adding — several may have landed or closed since.**

| PR | What | Evidence |
|---|---|---|
| #2319 | CJK / Hangul terminal corruption | Fixes #2193, reproduced on 0.3.1 |
| #1826 | Persist queued messages on the daemon | +5,642/45 files, capability-gated, 3 tagged `COMPAT()` sites, rebased 4× |
| #2237 | Materialize Codex `toolSurface` screenshots | +177, small; also relieves the relay cap (#2610/#2220) |
| #2664 | Byte-bound projected timeline pages | Third party ported the diff 1:1 onto 0.2.5 across an 11-workspace deployment and confirmed it |
| #3474 | Don't treat a 403 as stale auth | Stops rewriting `.credentials.json` every ~5 min |
| #1834 | Provider-native session fork | +2,084/36 files, capability-gated, 18 CI checks green |
| #280 | Cursor provider via headless CLI | 8 reactions, most-reacted open PR, 131 days |
| #2785 | Multi-account support | +3,722, `needs-maintainer-qa` |
| #1813 | Image diff viewer | Maintainer wants a scoped-down version — carry the full one |

Note #467 (battery drain from hidden terminal renderers, issue #468) was **closed
unmerged** — desvio handles that case fine, it is exactly the "rejected upstream"
front-of-manifest category.

### Before adding any third-party branch

1. Check the author's relicensing consent in **#2982** (see §3.12).
2. Check whether it already landed — desvio marks a contributing-nothing line `○`
   and says *why*, distinguishing "already upstream" (delete the line) from "nothing
   was ever committed to this branch" (keep it, look for uncommitted work).
3. Set `desvio_verify` to typecheck **and** lint, per `CLAUDE.md`'s standing rule.
   Never run the full test suite in the gate — it will freeze the machine.

### Sharp edges to know up front

- A stale rerere resolution can be wrong and replays silently as green;
  `desvio build --forget <branch>` is the fix.
- A stale deletion decision has no markers and nothing textual catches it — the
  gate is the only guard, and `--assemble-only` skips the gate.
- A clean merge is not a correct merge. See the settings-schema story above.
- The resolver needs `claude` on PATH and uses our account.

---

## 5. Open questions

- Does upstream intend the plugin system (#3222) to become the general host-surface
  seam? If so, several fork divergences (#3.7) collapse. The PR body is explicit
  that plugins are trusted code in the React tree with no sandboxing claim.
- What is Hub's relationship to the relay? #2035 says the daemon owns a durable
  outbound WebSocket and explicitly does *not* use the relay. Worth tracking — the
  website's Cloud page was replaced by "Paseo Hub".
- Did #2982 close on 2026-08-21, and were non-consenting contributions removed or
  rewritten? Directly affects grab-basket safety.

## 6. Refresh

Re-run the sweep periodically; upstream merges ~30 community PRs a week. Cheapest
signals to recheck:

```sh
gh pr list -R getpaseo/paseo --state open --limit 200 \
  --json number,title,author,createdAt,comments
gh issue list -R getpaseo/paseo --state open --limit 200 \
  --json number,title,comments,labels,reactionGroups
gh api --paginate "repos/getpaseo/paseo/forks?sort=stargazers&per_page=100" \
  --jq '.[] | select(.pushed_at > .created_at) | [.full_name, .stargazers_count, .pushed_at] | @tsv'
```
