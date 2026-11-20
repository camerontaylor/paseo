/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/resources/en";

// Native styling and live microphone telemetry are outside this rendered UI test.
vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: { create: (factory: (theme: typeof darkTheme) => unknown) => factory(darkTheme) },
    withUnistyles: (component: unknown) => component,
    useUnistyles: () => ({ theme: darkTheme }),
  };
});
vi.mock("@/contexts/voice-context", () => ({
  useVoiceTelemetry: () => ({ volume: 0, isSpeaking: false }),
}));
vi.mock("./volume-meter", () => ({ VolumeMeter: () => null }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
import { RealtimeVoiceOverlay } from "./realtime-voice-overlay";

describe("voice microphone controls", () => {
  let root: Root;
  let container: HTMLDivElement;
  const i18n = createInstance();
  const onToggleMute = vi.fn();
  const onStop = vi.fn();
  const onCancelAgent = vi.fn();
  const baseProps: React.ComponentProps<typeof RealtimeVoiceOverlay> = {
    isMuted: true,
    isSwitching: false,
    failure: null,
    lastInputStatus: null,
    onToggleMute,
    onStop,
  };

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    if (!i18n.isInitialized) {
      await i18n.init({ lng: "en", resources: { en: { translation: en } } });
    }
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    onToggleMute.mockClear();
    onStop.mockClear();
    onCancelAgent.mockClear();
  });

  async function render(props: Partial<typeof baseProps> = {}) {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RealtimeVoiceOverlay {...baseProps} {...props} />
        </I18nextProvider>,
      );
    });
  }

  it("says it is not listening and why when input stops reaching the agent", async () => {
    await render({ isMuted: false, failure: "host-disconnected" });
    expect(container.textContent).toContain("Not listening");
    expect(container.textContent).not.toContain("Microphone on");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Host disconnected. Microphone input is paused until it reconnects.",
    );
    await render({ isMuted: false, failure: "recognition-stalled" });
    expect(container.textContent).toContain("Not listening");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Speech recognition stopped responding. Stop and restart voice.",
    );
  });

  it("keeps listening status for a single missed utterance", async () => {
    await render({ isMuted: false, failure: "nothing-recognized" });
    expect(container.textContent).toContain("Microphone on");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Didn't catch that. Say it again.",
    );
  });

  it("shows delivery status beside the controls", async () => {
    await render({ isMuted: false, lastInputStatus: "queued" });
    expect(container.textContent).toContain("Speech queued for agent");
    await render({ isMuted: false, lastInputStatus: "sent" });
    expect(container.textContent).toContain("Speech sent to agent");
    await render({ isMuted: false, lastInputStatus: "unknown" });
    expect(container.textContent).toContain("Speech delivery uncertain");
  });

  it("keeps Interrupt agent separate from Stop voice", async () => {
    await render({ isMuted: false, isAgentRunning: true, onCancelAgent });
    const interrupt = container.querySelector<HTMLElement>('[aria-label="Interrupt agent"]')!;
    const stop = container.querySelector<HTMLElement>('[aria-label="Stop realtime voice"]')!;
    await act(async () => stop.click());
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCancelAgent).not.toHaveBeenCalled();
    await act(async () => interrupt.click());
    expect(onCancelAgent).toHaveBeenCalledOnce();
  });

  it("hides Interrupt agent while the agent is idle", async () => {
    await render({ isMuted: false, isAgentRunning: false, onCancelAgent });
    expect(container.querySelector('[aria-label="Interrupt agent"]')).toBeNull();
    expect(container.querySelector('[aria-label="Stop realtime voice"]')).not.toBeNull();
  });
});
