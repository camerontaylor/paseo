# Native ZCode SDK validation

Branch: `fix/zcode-sdk`, based on `cbd1210c7d15fbdaac02cab8375cdcf2dd6bd234`.
No push, merge, release, live configuration change, or live daemon restart.

## Scope

- `packages/plugin/src/sdk-specifiers.ts` and its root export own the accepted SDK identities.
- `packages/server/src/server/plugins/{compiler,plugin-sdk-specifiers,bundle-evaluator}.ts`
  and `packages/app/src/plugins/evaluate.ts` resolve canonical and fork imports to host modules.
- `plugin-examples/sdk-identity/` exercises Settings components, a shared Zod RPC, provider
  registration, and client loading without an author-installed runtime SDK.
- `fork/scripts/release-fork.mjs` regenerates existing Brotli/gzip variants when it rewrites browser assets.
- Provider registration, subprocess metadata, and the core adapter carry
  `supportsSystemPrompt`. The [native limitation and separate plugin patch](zcode-system-prompt.md)
  preserve the owner policy without substituting a conversation message.

## Automated evidence

Use Node 24 directly on Pluto to bypass the untrusted checkout's mise shim:

```bash
export PATH=/home/ctaylor/.local/share/mise/installs/node/24.21.0/bin:$PATH
```

| Working directory | Command | Result |
| --- | --- | --- |
| Repository root | `npx vitest run fork/scripts/release-fork.test.mjs --bail=1` | 21 passed |
| Repository root | `npx vitest run packages/server/src/server/plugins/compiler.test.ts --bail=1` | 80 passed |
| `packages/app` | `npx vitest run src/plugins/evaluate.test.ts --bail=1` | 49 passed |
| Repository root | `npx vitest run packages/plugin/src/boundaries.test.ts --bail=1` | 54 passed |
| Repository root | `npx vitest run packages/server/src/server/plugins/plugin-process.test.ts --bail=1` | 4 passed |
| `packages/server` | `npx vitest run src/server/plugins/runtime.posix.test.ts --bail=1` | 44 passed |
| `packages/server` | `npx vitest run src/server/agent/plugin-provider.test.ts --bail=1` | 40 passed |

The 292 tests cover import boundaries, host dependency identity, subprocess registration and
RPC validation, client Settings loading, packaged SDK identities, and prompt create/resume refusal.
The initial runtime attempt used the root Vitest configuration's five-second timeout; the normal
server configuration passed. No full test suite ran.

These repository-root commands passed:

```bash
npm run build:server-deps
npm run build --workspace=@getpaseo/server
npm run build --workspace=@getpaseo/cli
npm run typecheck
npm run lint
npm run format
git diff --check
```

Raw secret-free command output is retained on Pluto at
`/home/ctaylor/.local/state/zcode-provider-test/sdk-validation-logs/`.
CodeRabbit could not authenticate (`environment_unsupported`); it produced no code review.
The diff was reviewed directly.

## Packaged browser evidence

`npm run build:daemon-web-ui` passed. Test staging copied the seven rebuilt workspace
outputs and applied `rewriteDistSpecifiers` and `rewritePackageJsonDoc` from
`fork/scripts/release-fork.mjs` with `forkScope: "@camerontaylor"`. The copied packaged
fork reported `0.11.0-beta.3.fork.1`; no package was published.

On Makemake, the isolated daemon used `sdk-ui-home` and port `17679`, ordinary Node
24.21.0, and `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000`.
It loaded the unmodified upstream plugin at
`fc66078de555a75745a8bf161812addbb2c3a073` with its canonical imports.

At 1440×1000 and 390×844, Settings > Plugins > ZCode Diagnostics rendered the
Settings components and reported Supported, Server 3.14.0, and Agent 0.16.9.
`Run host check` returned Passed and `Check again` completed at both widths.
Browser errors were empty; standard React Native/Expo warnings remained.
Native provider availability was true. This home deliberately had no credentials;
model discovery reported `AUTH_REQUIRED`, and no real-model response is claimed.

After removing that test installation, the same isolated daemon loaded the existing
`plugin-for-fork` copy under `zcode-fork-alias`. Its fork SDK imports also
rendered the Diagnostics screen and returned Passed from the host check at both widths.

The final pass retained generated `.br`/`.gz` assets. Actual Chrome requests received
HTTP 200 with `Content-Encoding: br`; canonical plugin host checks passed again at both widths.
`compressed-browser-network.json` retains filtered response headers; the raw HAR was deleted.
The final screenshots are `compressed-host-check-wide.png` and `compressed-host-check-narrow.png`.

Screenshots, diagnostics, and runner scripts remain on Makemake and are copied to Pluto at
`/home/ctaylor/.local/state/zcode-provider-test/sdk-ui-evidence/`.
The narrow browser viewport is layout evidence, not a native iOS or Android test.
Electron, macOS, Windows, iOS, and Android were not exercised in this pass.

The earlier native stdio and real-model results remain on Makemake in
`/home/ctaylor/.local/state/zcode-provider-test/results.json`. They were not rerun or claimed as
new results; this change leaves the native transport and cold-resume settings workaround intact.
