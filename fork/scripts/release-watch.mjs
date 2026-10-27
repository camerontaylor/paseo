import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const CHECKOUT = "/Volumes/offload/neptune/repos/paseo";
const HOUR = 3600000;

function validTag(tag) {
  // Upstream release tags omit semver build metadata; keep filenames in that vocabulary.
  if (
    typeof tag !== "string" ||
    !/^v?\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(tag) ||
    !semver.valid(tag)
  ) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return tag;
}

export function parseState(source) {
  const state = JSON.parse(source);
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !Object.hasOwn(state, "handled") ||
    !Object.hasOwn(state, "inFlight") ||
    !Array.isArray(state.failed)
  )
    throw new Error("Invalid watcher state");
  if (state.handled !== null) validTag(state.handled);
  state.failed.forEach(validTag);
  if (state.inFlight !== null) {
    const f = state.inFlight;
    if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error("Invalid in-flight state");
    validTag(f.tag);
    if (
      (f.agentId !== null && (typeof f.agentId !== "string" || !f.agentId)) ||
      !Number.isFinite(Date.parse(f.startedAt)) ||
      typeof f.staleNotified !== "boolean"
    ) {
      throw new Error("Invalid in-flight state");
    }
  }
  return state;
}

export function newestRelease(releases) {
  if (!Array.isArray(releases)) throw new Error("Invalid GitHub releases response");
  // Publication order can differ from semver order (e.g. an older maintenance release).
  return releases.map((r) => validTag(r.tagName)).sort(semver.rcompare)[0] ?? null;
}

export function cycleOutcome(result, tag) {
  if (!result.endsWith("\n")) return null;
  const lines = result.trimEnd().split(/\r?\n/);
  const prefix = `RELEASE-CYCLE: `;
  const cycle = lines.find(
    (line) => line.startsWith(`${prefix}OK ${tag} `) || line.startsWith(`${prefix}FAILED ${tag} `),
  );
  if (!cycle) return null; // Partial writes are pending, never proof of completion.
  if (cycle.startsWith(`${prefix}FAILED `)) return "failed";
  if (/ stopped-at=(build|canary)$/.test(cycle)) return "handled";
  const final = lines.at(-1);
  if (/^RESULT: OK(?:\s|$)/.test(final)) return "handled";
  if (/^RESULT: FAILED(?:\s|$)/.test(final)) return "failed";
  return null;
}

function collectCycle(state, ports, save, notify) {
  if (!state.inFlight) return true;
  const flight = state.inFlight;
  const result = ports.readResult(flight.tag);
  let outcome = result === null ? null : cycleOutcome(result, flight.tag);
  if (result === null && flight.agentId !== null) {
    const status = ports.inspect(flight.agentId);
    if (["idle", "error", "closed", "archived"].includes(status)) {
      outcome = "failed";
      notify(`Cycle ${flight.tag} finished with no result file (${status})`);
    } else if (!["running", "initializing"].includes(status)) {
      throw new Error(`Unrecognized agent status: ${status}`);
    }
  }
  if (outcome) {
    if (outcome === "handled" && (!state.handled || semver.gt(flight.tag, state.handled)))
      state.handled = flight.tag;
    if (outcome === "failed" && !state.failed.includes(flight.tag)) state.failed.push(flight.tag);
    state.inFlight = null;
    save();
    ports.log(`Collected ${flight.tag}: ${outcome}`);
  } else {
    if (ports.now() - Date.parse(flight.startedAt) > 8 * HOUR && !flight.staleNotified) {
      notify(`Cycle ${flight.tag} has been in flight over 8 hours; inspect before intervening`);
      flight.staleNotified = true;
      save();
    }
    ports.log(`Waiting for cycle ${flight.tag}`);
    return false;
  }
  return true;
}

function eligibleRelease(tag, state, base) {
  return (
    tag &&
    semver.gt(tag, base) &&
    (!state.handled || semver.gt(tag, state.handled)) &&
    !state.failed.includes(tag)
  );
}

// Ports keep the policy tests independent of GitHub, the daemon and launchd.
export function tick(state, ports, { base, level, dryRun = false, retry = null }) {
  validTag(base);
  if (!["build", "canary", "fleet"].includes(level))
    throw new Error(`Invalid RELEASE_WATCH_LEVEL: ${level}`);
  const save = () => {
    if (!dryRun) ports.save(state);
  };
  const notify = (message) => {
    ports.log(message);
    if (!dryRun) ports.notify(message);
  };
  if (retry) {
    validTag(retry);
    if (state.inFlight?.tag === retry) throw new Error("Cannot retry an in-flight cycle");
    if (!dryRun) ports.clearResult(retry);
    state.failed = state.failed.filter((tag) => tag !== retry);
    save();
    ports.log(`Retry cleared for ${retry}; next tick selects the newest published release`);
    return;
  }
  if (!collectCycle(state, ports, save, notify)) return;
  const tag = newestRelease(ports.releases());
  if (!eligibleRelease(tag, state, base)) {
    ports.log(`Nothing to do (published=${tag}, base=${base}, handled=${state.handled})`);
    return;
  }
  const failure = ports.preflight();
  if (failure) {
    notify(`Preflight failed for ${tag}: ${failure}`);
    return;
  }
  const brief = ports.brief().replaceAll("{{TAG}}", tag).replaceAll("{{LEVEL}}", level);
  if (/\{\{(?:TAG|LEVEL)\}\}/.test(brief) || !brief.trim())
    throw new Error("Invalid committed release brief");
  ports.log(`${dryRun ? "Would dispatch" : "Dispatching"} ${tag} at level ${level}`);
  if (dryRun) {
    ports.log(brief);
    return;
  }
  // Reserve before calling the daemon. An ambiguous CLI timeout must not start a second cycle.
  ports.clearResult(tag);
  state.inFlight = {
    tag,
    agentId: null,
    startedAt: new Date(ports.now()).toISOString(),
    staleNotified: false,
  };
  save();
  const agentId = ports.dispatch(tag, brief);
  if (typeof agentId !== "string" || !agentId)
    throw new Error("Dispatch did not return an agentId; reservation retained for manual recovery");
  state.inFlight.agentId = agentId;
  save();
  notify(`Release cycle ${tag} dispatched (${level}, agent ${agentId})`);
}

function command(binary, args, { allowFailure = false } = {}) {
  const env = { ...process.env };
  // Scheduled work belongs to the production daemon, not a caller's agent or dev home.
  for (const key of ["PASEO_AGENT_ID", "PASEO_WORKSPACE_ID", "PASEO_HOME", "PASEO_HOST"])
    delete env[key];
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    cwd: CHECKOUT,
    env,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || (!allowFailure && result.status !== 0))
    throw new Error(`${binary} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}

function processStart(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function lockOwnerAlive(lock) {
  let pid;
  try {
    pid = Number(readFileSync(path.join(lock, "pid"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") return false;
  }
  // A live PID may belong to an unrelated process after the original tick crashed.
  // Older locks and unavailable ps retain the conservative live-owner behavior.
  const identity = path.join(lock, "started");
  if (!existsSync(identity)) return true;
  const actual = processStart(pid);
  return actual === null || actual === readFileSync(identity, "utf8");
}

function lockIsStale(lock, now) {
  try {
    return now - statSync(lock).mtimeMs >= HOUR && !lockOwnerAlive(lock);
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

export function acquireLock(lock, now) {
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Serialize stale takeovers so an old contender cannot remove a new tick's lock.
    if (!lockIsStale(lock, now)) return false;
    const reclaim = `${lock}.reclaim`;
    if (!acquireLock(reclaim, now)) return false;
    try {
      if (!lockIsStale(lock, now)) return false;
      rmSync(lock, { recursive: true });
      try {
        mkdirSync(lock, { mode: 0o700 });
      } catch (e) {
        if (e.code === "EEXIST") return false;
        throw e;
      }
    } finally {
      rmSync(reclaim, { recursive: true, force: true });
    }
  }
  const started = processStart(process.pid);
  if (started !== null) writeFileSync(path.join(lock, "started"), started, { mode: 0o600 });
  writeFileSync(path.join(lock, "pid"), String(process.pid), { mode: 0o600 });
  return true;
}

export function main(args = process.argv.slice(2)) {
  const dryRun = args.includes("--dry-run");
  const retryIndex = args.indexOf("--retry");
  const retry = retryIndex < 0 ? null : validTag(args[retryIndex + 1]);
  if (
    args.some(
      (arg, i) =>
        arg !== "--dry-run" && arg !== "--retry" && (retryIndex < 0 || i !== retryIndex + 1),
    )
  )
    throw new Error("Usage: release-watch.sh [--dry-run] [--retry <tag>]");
  const dir = path.join(homedir(), ".paseo-fork/state");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, "release-watch.lock");
  if (!acquireLock(lock, Date.now())) {
    console.log("Watcher lock held; skipping");
    return;
  }
  const stateFile = path.join(dir, "release-watch.json");
  const resultFile = (tag) => path.join(dir, `release-cycle-${validTag(tag)}.result`);
  const notify = (message) => {
    try {
      command("/usr/bin/curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "15",
        "-H",
        "Title: Paseo release cycle",
        "--data-binary",
        message,
        process.env.RELEASE_WATCH_NTFY_URL,
      ]);
    } catch (e) {
      console.error(`Notification failed: ${e.message}`);
    }
  };
  try {
    const state = existsSync(stateFile)
      ? parseState(readFileSync(stateFile, "utf8"))
      : { handled: null, inFlight: null, failed: [] };
    tick(
      state,
      {
        now: Date.now,
        log: console.log,
        notify,
        save: (next) => {
          const temp = `${stateFile}.${process.pid}.tmp`;
          writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
          renameSync(temp, stateFile);
        },
        readResult: (tag) =>
          existsSync(resultFile(tag)) ? readFileSync(resultFile(tag), "utf8") : null,
        clearResult: (tag) => rmSync(resultFile(tag), { force: true }),
        inspect: (id) => JSON.parse(command("paseo", ["inspect", id, "--json"]).stdout).Status,
        releases: () =>
          JSON.parse(
            command("gh", [
              "release",
              "list",
              "--repo",
              "getpaseo/paseo",
              "--exclude-drafts",
              "--limit",
              "5",
              "--json",
              "tagName,isPrerelease",
            ]).stdout,
          ),
        brief: () =>
          command("git", ["-C", CHECKOUT, "show", "custom:fork/briefs/release-cycle.md"]).stdout,
        preflight: () => {
          if (command("git", ["-C", CHECKOUT, "status", "--short"]).stdout.trim())
            return "shared checkout has uncommitted changes";
          const row = command("/bin/df", ["-Pk", "/Volumes/offload"])
            .stdout.trim()
            .split("\n")
            .at(-1)
            .trim()
            .split(/\s+/);
          const available = Number(row[3]);
          if (!Number.isFinite(available) || available < 30 * 1024 * 1024)
            return "less than 30 GB free on /Volumes/offload";
          const job = command(
            "/bin/launchctl",
            ["print", `gui/${process.getuid()}/local.paseo-deploy-once`],
            { allowFailure: true },
          );
          if (job.status === 0) return "local.paseo-deploy-once is loaded";
          if (!/could not find service/i.test(job.stderr))
            throw new Error(`Unable to inspect deploy job: ${job.stderr.trim()}`);
          return null;
        },
        dispatch: (tag, brief) =>
          JSON.parse(
            command("paseo", [
              "run",
              "--provider",
              "codex/gpt-6.1-sol",
              "--thinking",
              "high",
              "--mode",
              "full-access",
              "--background",
              "--json",
              "--label",
              `release-cycle=${tag}`,
              "--cwd",
              CHECKOUT,
              "--title",
              `Release cycle ${tag}`,
              brief,
            ]).stdout,
          ).agentId,
      },
      { base: process.env.DESVIO_BASE, level: process.env.RELEASE_WATCH_LEVEL, dryRun, retry },
    );
  } catch (e) {
    if (!dryRun) notify(`Release watcher failed: ${e.message}`);
    throw e;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
