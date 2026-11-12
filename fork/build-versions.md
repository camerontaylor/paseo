# Fork build versions

Build the same assembled `mine` commit on every host. Desvio chooses the sources;
`fork/scripts/build-version.mjs` chooses the version. Do not build platform artifacts
from `custom` and expect them to identify the assembled release.

The shared version is `<base>-fork.<UTC commit date YYMMDD-HHMM>.g<12-character SHA>`.
A beta base uses `.fork.` after its existing prerelease. The date comes from the
commit, so time zones and build start times cannot give one source different names.
The SHA distinguishes commits made in the same minute.

```bash
node fork/scripts/build-version.mjs --print
npm run build:desktop                         # Mac or Linux desktop
APP_VARIANT=development npm run build:apk:arm64 # Existing fork Android package identity
node fork/scripts/release-fork.mjs --dry-run  # Linux daemon npm artifacts
```

The desktop and APK entry points stamp root and workspace manifests before building
and restore their exact original contents when the command exits. npm release staging
uses the same stamp, including the app manifest inlined into the daemon web UI.
The CLI, daemon, About screen, desktop metadata, npm packages and Android versionName
therefore identify the same source. The AppImage filename stays stable for the updater;
its internal version still carries the full build name.

Android versionCode and iOS build numbers keep their upstream numeric ordering.
iOS's marketing version must remain numeric; its About screen shows the full stamp.
This does not give repeated fork builds distinct app-store upload numbers.

`PASEO_PACKAGE_VERSION` can explicitly reuse a version from the same upstream base.
Use it for a coordinated build or an old release retry; use the identical value on all
builders. `release-fork.mjs --fork-number N|auto` remains an explicit legacy retry path,
but new CI releases derive the shared version from their checked-out commit.
Do not set `FORK_NUMBER` for a new release.

## Desvio task setup

Keep Paseo naming out of generic `desvio.conf`. On each packaging host, make
`~/.paseo-fork/package.sh` delegate to the checked-out source:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec bash "${DESVIO_WORKTREE:?}/fork/scripts/package-desktop.sh" "$@"
```

The tracked task retains the existing Mac signing and updater checks. Linux desktop
packaging uses `npm run build:desktop -- --linux --dir`; npm daemon packaging uses the
release script above. Neither command installs or restarts a daemon.

For an unstamped direct Gradle invocation, wrap prebuild and Gradle in the same stamped
command. Prefer `build:apk:arm64`, which does this and includes the version in its filename.
Keep native prebuild inside the wrapper so Android versionName and the Metro bundle agree.
