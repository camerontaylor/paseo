import { afterEach, expect, test, vi } from "vitest";
import { createAudioEngine } from "./audio-engine.web";

vi.mock("@/desktop/host", () => ({ isElectronRuntime: () => false }));
afterEach(() => vi.unstubAllGlobals());

test("microphone track loss interrupts capture, and an old track cannot interrupt its replacement", async () => {
  const callbacks: Array<() => void> = [];
  const streams = [0, 1].map(() => {
    const track = {
      stop: vi.fn(),
      addEventListener: (_event: string, callback: () => void) => callbacks.push(callback),
    };
    return { getAudioTracks: () => [track], getTracks: () => [track] };
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } });
  class CaptureContext {
    state = "running";
    destination = {};
    createMediaStreamSource = node;
    createScriptProcessor = node;
    createGain = node;
    close = vi.fn().mockResolvedValue(undefined);
  }
  vi.stubGlobal("window", { AudioContext: CaptureContext, isSecureContext: true });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValueOnce(streams[0]).mockResolvedValueOnce(streams[1]),
    },
  });
  const onInterruption = vi.fn();
  const engine = createAudioEngine({
    onCaptureData: vi.fn(),
    onVolumeLevel: vi.fn(),
    onInterruption,
  });
  await engine.startCapture();
  callbacks[0]();
  expect(onInterruption).toHaveBeenCalledOnce();
  await engine.stopCapture();
  await engine.startCapture();
  callbacks[0]();
  expect(onInterruption).toHaveBeenCalledOnce();
  callbacks[1]();
  expect(onInterruption).toHaveBeenCalledTimes(2);
  await engine.destroy();
});

test("stopping browser audio preparation cannot play a stale clip or complete its replacement", async () => {
  const played: Array<{ start: ReturnType<typeof vi.fn>; end: () => void }> = [];
  class PlaybackContext {
    state = "running";
    destination = {};
    close = vi.fn().mockResolvedValue(undefined);
    createBuffer(_channels: number, length: number, rate: number) {
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const clip = { start: vi.fn(), end: () => {} };
      played.push(clip);
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: clip.start,
        stop: vi.fn(),
        addEventListener: (_event: string, callback: () => void) => {
          clip.end = callback;
        },
      };
    }
  }
  vi.stubGlobal("window", { AudioContext: PlaybackContext });
  const engine = createAudioEngine({ onCaptureData: vi.fn(), onVolumeLevel: vi.fn() });
  let finish!: (buffer: ArrayBuffer) => void;
  const preparation = vi.fn(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  );
  const canceled = engine
    .play({ type: "audio/pcm;rate=16000", size: 32000, arrayBuffer: preparation })
    .catch((error: Error) => error.message);
  await vi.waitFor(() => expect(preparation).toHaveBeenCalledOnce());
  engine.stop();
  engine.clearQueue();
  expect(await canceled).toBe("Playback stopped");
  const completed = vi.fn();
  const next = engine
    .play({
      type: "audio/pcm;rate=16000",
      size: 32000,
      arrayBuffer: async () => new ArrayBuffer(32000),
    })
    .then(completed);
  await vi.waitFor(() => expect(played).toHaveLength(1));
  finish(new ArrayBuffer(64000));
  await Promise.resolve();
  await Promise.resolve();
  expect(played).toHaveLength(1);
  expect(completed).not.toHaveBeenCalled();
  played[0].end();
  await next;
  expect(completed).toHaveBeenCalledWith(1);
  await engine.destroy();
});
