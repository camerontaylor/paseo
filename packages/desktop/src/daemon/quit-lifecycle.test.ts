import { describe, expect, it } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import {
  createQuitLifecycle,
  registerExternalQuitSignals,
  shouldStopDesktopManagedDaemonOnQuit,
  stopDesktopManagedDaemonOnQuitIfNeeded,
} from "./quit-lifecycle";

const SETTINGS_STOP_ON_QUIT = DEFAULT_DESKTOP_SETTINGS;
const SETTINGS_KEEP_RUNNING = {
  ...DEFAULT_DESKTOP_SETTINGS,
  daemon: {
    ...DEFAULT_DESKTOP_SETTINGS.daemon,
    keepRunningAfterQuit: true,
  },
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForQuitLifecycle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("quit-lifecycle", () => {
  it("turns external termination signals into one Electron quit", () => {
    const listeners = new Map<NodeJS.Signals, () => void>();
    const quits: string[] = [];

    const quitSignal = registerExternalQuitSignals({
      signals: {
        on: (signal, listener) => {
          listeners.set(signal, listener);
        },
      },
      quit: () => quits.push("quit"),
    });

    expect(Array.from(listeners.keys())).toEqual(["SIGHUP", "SIGINT", "SIGTERM"]);
    listeners.get("SIGTERM")?.();
    listeners.get("SIGHUP")?.();
    expect(quits).toEqual(["quit"]);
    expect(quitSignal.aborted).toBe(true);
  });

  it("dismisses a pending confirmation and follows the stop preference on an OS signal", async () => {
    const listeners = new Map<NodeJS.Signals, () => void>();
    const events: string[] = [];
    const confirmationOpened = deferred<void>();
    let quitLifecycle: ReturnType<typeof createQuitLifecycle>;
    const quitSignal = registerExternalQuitSignals({
      signals: {
        on: (signal, listener) => listeners.set(signal, listener),
      },
      quit: () => {
        events.push("signal-quit");
        quitLifecycle.handleBeforeQuit({
          preventDefault: () => events.push("prevent-repeated-quit"),
        });
      },
    });
    quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => events.push(`exit:${code}`) },
      closeTransportSessions: () => events.push("close-transports"),
      stopDesktopManagedDaemonIfNeeded: () =>
        stopDesktopManagedDaemonOnQuitIfNeeded({
          settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
          isDesktopManagedDaemonRunning: () => true,
          quitSignal,
          confirmStopDaemon: (_stopByDefault, signal) =>
            new Promise((resolve) => {
              events.push("confirmation-open");
              confirmationOpened.resolve();
              signal.addEventListener(
                "abort",
                () => {
                  events.push("confirmation-dismissed");
                  resolve(false);
                },
                { once: true },
              );
            }),
          stopDaemon: async () => events.push("stop-daemon"),
          showShutdownFeedback: () => events.push("shutdown-feedback"),
        }),
      installAppUpdateOnQuit: async () => {
        events.push("check-update");
        return false;
      },
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => events.push("stop-error"),
      onUpdateError: () => events.push("update-error"),
    });

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => events.push("prevent-initial-quit"),
    });
    await confirmationOpened.promise;
    listeners.get("SIGTERM")?.();
    await waitForQuitLifecycle();

    expect(events).toEqual([
      "close-transports",
      "prevent-initial-quit",
      "confirmation-open",
      "confirmation-dismissed",
      "signal-quit",
      "close-transports",
      "prevent-repeated-quit",
      "shutdown-feedback",
      "stop-daemon",
      "check-update",
      "exit:0",
    ]);
  });

  it("stops by default and only keeps running when keepRunningAfterQuit is enabled", () => {
    expect(shouldStopDesktopManagedDaemonOnQuit(SETTINGS_STOP_ON_QUIT)).toBe(true);
    expect(shouldStopDesktopManagedDaemonOnQuit(SETTINGS_KEEP_RUNNING)).toBe(false);
  });

  it("keeps the daemon running without confirmation when keep-running is on", async () => {
    const events: string[] = [];

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_KEEP_RUNNING },
      quitSignal: new AbortController().signal,
      isDesktopManagedDaemonRunning: () => {
        events.push("inspect");
        return true;
      },
      confirmStopDaemon: async () => {
        events.push("confirm");
        return true;
      },
      stopDaemon: async () => {
        events.push("stop");
      },
      showShutdownFeedback: () => {
        events.push("feedback");
      },
    });

    expect(stopped).toBe(false);
    expect(events).toEqual(["inspect"]);
  });

  it("does not stop a manually started daemon on quit", async () => {
    const events: string[] = [];

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
      quitSignal: new AbortController().signal,
      isDesktopManagedDaemonRunning: () => false,
      confirmStopDaemon: async () => true,
      stopDaemon: async () => {
        events.push("stop");
      },
      showShutdownFeedback: () => {
        events.push("feedback");
      },
    });

    expect(stopped).toBe(false);
    expect(events).toEqual([]);
  });

  it("keeps the daemon running when the shutdown confirmation is canceled", async () => {
    const events: string[] = [];

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
      quitSignal: new AbortController().signal,
      isDesktopManagedDaemonRunning: () => true,
      confirmStopDaemon: async (stopByDefault) => {
        events.push(`confirm:${stopByDefault}`);
        return false;
      },
      stopDaemon: async () => {
        events.push("stop");
      },
      showShutdownFeedback: () => {
        events.push("feedback");
      },
    });

    expect(stopped).toBe(false);
    expect(events).toEqual(["confirm:true"]);
  });

  it("continues an ordinary quit after the shutdown confirmation is canceled", async () => {
    const events: string[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => events.push(`exit:${code}`) },
      closeTransportSessions: () => events.push("close-transports"),
      stopDesktopManagedDaemonIfNeeded: async () => {
        const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
          settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
          quitSignal: new AbortController().signal,
          isDesktopManagedDaemonRunning: () => true,
          confirmStopDaemon: async () => {
            events.push("confirm-canceled");
            return false;
          },
          stopDaemon: async () => events.push("stop-daemon"),
          showShutdownFeedback: () => events.push("shutdown-feedback"),
        });
        return stopped;
      },
      installAppUpdateOnQuit: async () => false,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => events.push("stop-error"),
      onUpdateError: () => events.push("update-error"),
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => events.push("prevent-default") });
    await waitForQuitLifecycle();

    expect(events).toEqual(["close-transports", "prevent-default", "confirm-canceled", "exit:0"]);
  });

  it("shows feedback then stops a desktop-managed daemon", async () => {
    const events: string[] = [];

    const stopped = await stopDesktopManagedDaemonOnQuitIfNeeded({
      settingsStore: { get: async () => SETTINGS_STOP_ON_QUIT },
      quitSignal: new AbortController().signal,
      isDesktopManagedDaemonRunning: () => true,
      confirmStopDaemon: async (stopByDefault) => {
        events.push(`confirm:${stopByDefault}`);
        return true;
      },
      stopDaemon: async () => {
        events.push("stop");
      },
      showShutdownFeedback: () => {
        events.push("feedback");
      },
    });

    expect(stopped).toBe(true);
    expect(events).toEqual(["confirm:true", "feedback", "stop"]);
  });

  it("revalidates updates after daemon shutdown before exiting", async () => {
    const stopDecision = deferred<boolean>();
    const updateDecision = deferred<boolean>();
    const events: string[] = [];

    const quitLifecycle = createQuitLifecycle({
      app: {
        exit: (code) => {
          events.push(`exit:${code}`);
        },
      },
      closeTransportSessions: () => {
        events.push("close-transports");
      },
      stopDesktopManagedDaemonIfNeeded: () => stopDecision.promise,
      installAppUpdateOnQuit: () => updateDecision.promise,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => {
        events.push("stop-error");
      },
      onUpdateError: () => {
        events.push("update-error");
      },
    });

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => {
        events.push("prevent-default");
      },
    });

    expect(events).toEqual(["close-transports", "prevent-default"]);

    events.push("daemon-stopped");
    stopDecision.resolve(false);
    await waitForQuitLifecycle();

    expect(events).toEqual(["close-transports", "prevent-default", "daemon-stopped"]);

    events.push("update-checked");
    updateDecision.resolve(false);
    await waitForQuitLifecycle();

    expect(events).toEqual([
      "close-transports",
      "prevent-default",
      "daemon-stopped",
      "update-checked",
      "exit:0",
    ]);

    quitLifecycle.handleBeforeQuit({
      preventDefault: () => {
        events.push("second-prevent-default");
      },
    });

    expect(events.at(-1)).toBe("close-transports");
    expect(events).not.toContain("second-prevent-default");
  });

  it("lets the updater own process exit when a validated update is installing", async () => {
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      stopDesktopManagedDaemonIfNeeded: async () => false,
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => {},
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    quitLifecycle.handleBeforeQuitForUpdate();
    await waitForQuitLifecycle();

    expect(exits).toEqual([]);
  });

  it("does not stop the daemon when an updater starts the quit directly", () => {
    const events: string[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => events.push(`exit:${code}`) },
      closeTransportSessions: () => events.push("close-transports"),
      stopDesktopManagedDaemonIfNeeded: async () => {
        events.push("stop-daemon");
        return false;
      },
      installAppUpdateOnQuit: async () => {
        events.push("check-update");
        return false;
      },
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => {},
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuitForUpdate();
    quitLifecycle.handleBeforeQuit({ preventDefault: () => events.push("prevent-default") });

    expect(events).toEqual(["close-transports"]);
  });

  it("recognizes a repeated quit as updater handoff", async () => {
    const exits: number[] = [];
    let preventedQuitCount = 0;
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      stopDesktopManagedDaemonIfNeeded: async () => false,
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => {},
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => preventedQuitCount++ });
    await waitForQuitLifecycle();
    quitLifecycle.handleBeforeQuit({ preventDefault: () => preventedQuitCount++ });
    await waitForQuitLifecycle();

    expect(preventedQuitCount).toBe(1);
    expect(exits).toEqual([]);
  });

  it("exits when the updater does not take ownership before its deadline", async () => {
    const revalidationDeadline = new AbortController();
    const handoffDeadline = new AbortController();
    let deadlineCount = 0;
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      stopDesktopManagedDaemonIfNeeded: async () => false,
      installAppUpdateOnQuit: async () => true,
      createUpdateDeadlineSignal: () =>
        deadlineCount++ === 0 ? revalidationDeadline.signal : handoffDeadline.signal,
      onStopError: () => {},
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    handoffDeadline.abort();
    await waitForQuitLifecycle();

    expect(exits).toEqual([0]);
  });

  it("does not intercept a quit started by a manual update", () => {
    const events: string[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => events.push(`exit:${code}`) },
      closeTransportSessions: () => events.push("close-transports"),
      stopDesktopManagedDaemonIfNeeded: async () => {
        events.push("stop-daemon");
        return false;
      },
      installAppUpdateOnQuit: async () => {
        events.push("revalidate-update");
        return false;
      },
      createUpdateDeadlineSignal: () => new AbortController().signal,
      onStopError: () => events.push("stop-error"),
      onUpdateError: () => events.push("update-error"),
    });

    quitLifecycle.handleBeforeQuitForUpdate();
    quitLifecycle.handleBeforeQuit({
      preventDefault: () => events.push("prevent-default"),
    });

    expect(events).toEqual(["close-transports"]);
  });

  it("exits when update revalidation reaches its deadline", async () => {
    const deadline = new AbortController();
    const updateDecision = deferred<boolean>();
    const exits: number[] = [];
    const quitLifecycle = createQuitLifecycle({
      app: { exit: (code) => exits.push(code) },
      closeTransportSessions: () => {},
      stopDesktopManagedDaemonIfNeeded: async () => false,
      installAppUpdateOnQuit: () => updateDecision.promise,
      createUpdateDeadlineSignal: () => deadline.signal,
      onStopError: () => {},
      onUpdateError: () => {},
    });

    quitLifecycle.handleBeforeQuit({ preventDefault: () => {} });
    await waitForQuitLifecycle();
    deadline.abort();
    await waitForQuitLifecycle();

    expect(exits).toEqual([0]);

    updateDecision.resolve(true);
    await waitForQuitLifecycle();
    expect(exits).toEqual([0]);
  });
});
