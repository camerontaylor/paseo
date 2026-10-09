import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { acquireLock, cycleOutcome, newestRelease, parseState, tick } from "./release-watch.mjs";

const NOW = Date.parse("2026-10-08T12:00:00Z");
function fixture(overrides = {}) {
  const events = [];
  const state = { handled: null, inFlight: null, failed: [] };
  const ports = {
    now: () => NOW,
    log: (message) => events.push(["log", message]),
    notify: (message) => events.push(["notify", message]),
    save: (value) => events.push(["save", structuredClone(value)]),
    releases: () => [{ tagName: "v0.11.0-beta.10", isPrerelease: true }],
    preflight: () => null,
    brief: () => "Release {{TAG}} at {{LEVEL}}",
    dispatch: (tag, brief) => {
      events.push(["dispatch", tag, brief]);
      return "agent-1";
    },
    readResult: () => null,
    clearResult: (tag) => events.push(["clearResult", tag]),
    inspect: () => "running",
    ...overrides,
  };
  return {
    state,
    ports,
    events,
    run: (options = {}) => tick(state, ports, { base: "v0.10.0", level: "canary", ...options }),
  };
}
function inFlight(f, hours = 1) {
  f.state.inFlight = {
    tag: "v0.11.0-beta.9",
    agentId: "old-agent",
    startedAt: new Date(NOW - hours * 3600000).toISOString(),
    staleNotified: false,
  };
}

test("stable supersedes its betas and beta.10 supersedes beta.9", () => {
  assert.equal(newestRelease([{ tagName: "v0.11.0-beta.3" }, { tagName: "v0.11.0" }]), "v0.11.0");
  assert.equal(
    newestRelease([{ tagName: "v0.11.0-beta.9" }, { tagName: "v0.11.0-beta.10" }]),
    "v0.11.0-beta.10",
  );
});

test("dispatch reserves state first and renders the committed brief", () => {
  const f = fixture();
  f.run();
  assert.deepEqual(
    f.events.filter(([event]) => ["save", "dispatch"].includes(event)),
    [
      [
        "save",
        {
          handled: null,
          inFlight: {
            tag: "v0.11.0-beta.10",
            agentId: null,
            startedAt: new Date(NOW).toISOString(),
            staleNotified: false,
          },
          failed: [],
        },
      ],
      ["dispatch", "v0.11.0-beta.10", "Release v0.11.0-beta.10 at canary"],
      ["save", f.state],
    ],
  );
});

test("finished agent without a result fails once and permits the next release", () => {
  const f = fixture({ inspect: () => "idle" });
  inFlight(f);
  f.run();
  assert.deepEqual(f.state.failed, ["v0.11.0-beta.9"]);
  assert.equal(f.state.inFlight.tag, "v0.11.0-beta.10");
  assert.equal(f.events.filter(([event]) => event === "notify").length, 2);
});

test("orchestrator OK keeps waiting for Neptune even after agent finishes", () => {
  const f = fixture({
    readResult: () => "RELEASE-CYCLE: OK v0.11.0-beta.9 stamp sha\n",
    inspect: () => {
      throw new Error("must not inspect worker handoff");
    },
  });
  inFlight(f);
  f.run();
  assert.equal(f.state.inFlight.tag, "v0.11.0-beta.9");
  assert.deepEqual(f.events, [["log", "Waiting for cycle v0.11.0-beta.9"]]);
});

test.each(["OK", "FAILED"])(
  "Neptune final %s is collected before selecting the next release",
  (outcome) => {
    const f = fixture({
      readResult: () =>
        `RELEASE-CYCLE: OK v0.11.0-beta.9 stamp sha\nRESULT: ${outcome} verification\n`,
    });
    inFlight(f);
    f.run();
    assert.equal(f.state.handled, outcome === "OK" ? "v0.11.0-beta.9" : null);
    assert.deepEqual(f.state.failed, outcome === "FAILED" ? ["v0.11.0-beta.9"] : []);
    assert.equal(f.state.inFlight.tag, "v0.11.0-beta.10");
  },
);

test.each(["build", "canary"])("stopped-at=%s is sufficient to finish", (level) => {
  assert.equal(
    cycleOutcome(`RELEASE-CYCLE: OK v0.11.0 stamp sha stopped-at=${level}\n`, "v0.11.0"),
    "handled",
  );
});

test("failure, unrelated tag, partial final write and nonterminal RESULT are distinguished", () => {
  assert.equal(cycleOutcome("RELEASE-CYCLE: FAILED v0.11.0 sync bad gate\n", "v0.11.0"), "failed");
  assert.equal(
    cycleOutcome("RELEASE-CYCLE: OK v0.11.1 stamp sha\nRESULT: OK verified\n", "v0.11.0"),
    null,
  );
  assert.equal(cycleOutcome("RELEASE-CYCLE: OK v0.11.0 stamp sha\nRESULT: FA", "v0.11.0"), null);
  assert.equal(
    cycleOutcome(
      "RELEASE-CYCLE: OK v0.11.0 stamp sha\nRESULT: OK verified\nmore output",
      "v0.11.0",
    ),
    null,
  );
});

test("stale notification is sent only once", () => {
  const f = fixture();
  inFlight(f, 9);
  f.run();
  f.run();
  assert.equal(f.state.inFlight.staleNotified, true);
  assert.equal(f.events.filter(([event]) => event === "notify").length, 1);
});

test("failed tags and both version floors prevent dispatch", () => {
  for (const floor of ["failed", "handled", "base"]) {
    const f = fixture();
    if (floor === "failed") f.state.failed.push("v0.11.0-beta.10");
    if (floor === "handled") f.state.handled = "v0.11.0";
    f.run(floor === "base" ? { base: "v0.11.0" } : {});
    assert.equal(
      f.events.some(([event]) => event === "dispatch"),
      false,
    );
  }
});

test("retry clears failure and the previous result without dispatching", () => {
  const f = fixture();
  f.state.failed = ["v0.11.0-beta.10"];
  f.run({ retry: "v0.11.0-beta.10" });
  assert.deepEqual(f.state.failed, []);
  assert.equal(f.events[0][0], "clearResult");
  assert.equal(
    f.events.some(([event]) => event === "dispatch"),
    false,
  );
});

test("preflight failure notifies and leaves state alone", () => {
  const f = fixture({ preflight: () => "dirty checkout" });
  f.run();
  assert.equal(f.state.inFlight, null);
  assert.equal(f.events.filter(([event]) => event === "notify").length, 1);
});

test("dry-run prints the dispatch and brief without saving, notifying or dispatching", () => {
  const f = fixture();
  f.run({ dryRun: true });
  assert.deepEqual(f.events, [
    ["log", "Would dispatch v0.11.0-beta.10 at level canary"],
    ["log", "Release v0.11.0-beta.10 at canary"],
  ]);
});

test("ambiguous dispatch and inspect errors preserve the in-flight reservation", () => {
  const f = fixture({
    dispatch: () => {
      throw new Error("timeout");
    },
  });
  assert.throws(() => f.run(), /timeout/);
  assert.equal(f.state.inFlight.agentId, null);
  f.run();
  assert.equal(f.events.filter(([event]) => event === "save").length, 1);
  const g = fixture({
    inspect: () => {
      throw new Error("daemon unavailable");
    },
  });
  inFlight(g);
  assert.throws(() => g.run(), /daemon unavailable/);
  assert.deepEqual(g.state.failed, []);
  assert.equal(g.state.inFlight.agentId, "old-agent");
});

test("invalid state and path-like tags fail closed", () => {
  for (const state of ["[]", '{"failed":[]}', '{"handled":null,"failed":[]}'])
    assert.throws(() => parseState(state), /Invalid watcher state/);
  assert.throws(
    () => parseState('{"handled":null,"failed":[],"inFlight":false}'),
    /Invalid in-flight state/,
  );
  assert.throws(() => newestRelease([{ tagName: "../../bad" }]), /Invalid release tag/);
  assert.throws(
    () =>
      parseState(
        '{"handled":null,"failed":[],"inFlight":{"tag":"v0.11.0","agentId":"a","startedAt":"bad","staleNotified":false}}',
      ),
    /Invalid in-flight/,
  );
});

test("dry-run selects beta.3 after beta.1 while leaving the live state untouched", () => {
  const f = fixture({
    releases: () => [{ tagName: "v0.11.0-beta.2" }, { tagName: "v0.11.0-beta.3" }],
  });
  f.state.handled = "v0.11.0-beta.1";
  f.run({ base: "v0.11.0-beta.1", level: "build", dryRun: true });
  assert.deepEqual(f.events, [
    ["log", "Would dispatch v0.11.0-beta.3 at level build"],
    ["log", "Release v0.11.0-beta.3 at build"],
  ]);
  assert.equal(f.state.handled, "v0.11.0-beta.1");
});

test("file-backed result collection handles a canned cycle and persists state", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-watch-"));
  try {
    const stateFile = path.join(dir, "state.json");
    const resultFile = path.join(dir, "result");
    const f = fixture({
      readResult: () => readFileSync(resultFile, "utf8"),
      save: (state) => writeFileSync(stateFile, JSON.stringify(state)),
      releases: () => [{ tagName: "v0.11.0-beta.9" }],
    });
    inFlight(f);
    writeFileSync(stateFile, JSON.stringify(f.state));
    writeFileSync(resultFile, "RELEASE-CYCLE: OK v0.11.0-beta.9 stamp sha\nRESULT: OK verified\n");
    tick(parseState(readFileSync(stateFile, "utf8")), f.ports, { base: "v0.10.0", level: "fleet" });
    assert.deepEqual(parseState(readFileSync(stateFile, "utf8")), {
      handled: "v0.11.0-beta.9",
      inFlight: null,
      failed: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lock excludes concurrent ticks and reclaims an abandoned tick after an hour", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "release-watch-lock-"));
  const lock = path.join(dir, "lock");
  try {
    assert.equal(acquireLock(lock, NOW), true);
    assert.equal(acquireLock(lock, NOW), false);
    const old = new Date(NOW - 2 * 3600000);
    utimesSync(lock, old, old);
    assert.equal(acquireLock(lock, NOW), false); // Live owner never loses its lock.
    writeFileSync(path.join(lock, "started"), "previous process with reused PID");
    utimesSync(lock, old, old);
    assert.equal(acquireLock(lock, NOW), true);
    // PID 1 can be visible to ps while kill(0) is denied for another user's process.
    writeFileSync(path.join(lock, "pid"), "1");
    writeFileSync(path.join(lock, "started"), "previous process with reused PID");
    utimesSync(lock, old, old);
    assert.equal(acquireLock(lock, NOW), true);
    rmSync(path.join(lock, "pid"));
    utimesSync(lock, old, old);
    // A crash during an earlier reclaim must not permanently block new ticks.
    mkdirSync(`${lock}.reclaim`);
    utimesSync(`${lock}.reclaim`, old, old);
    assert.equal(acquireLock(lock, NOW), true);
    assert.equal(readFileSync(path.join(lock, "pid"), "utf8"), String(process.pid));
    assert.equal(acquireLock(lock, NOW), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run collection and retry never persist or delete live files", () => {
  const f = fixture({ readResult: () => "RELEASE-CYCLE: FAILED v0.11.0-beta.9 sync conflict\n" });
  inFlight(f);
  f.run({ dryRun: true });
  f.run({ dryRun: true, retry: "v0.11.0-beta.9" });
  assert.equal(
    f.events.every(([event]) => event === "log"),
    true,
  );
});

test("stable release dispatches when both floors are its last beta", () => {
  const f = fixture({ releases: () => [{ tagName: "v0.11.0-beta.3" }, { tagName: "v0.11.0" }] });
  f.state.handled = "v0.11.0-beta.3";
  f.run({ base: "v0.11.0-beta.3" });
  assert.equal(f.state.inFlight.tag, "v0.11.0");
});
