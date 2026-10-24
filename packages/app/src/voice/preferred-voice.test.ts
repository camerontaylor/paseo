import { describe, expect, it, vi } from "vitest";
import { startDraftVoiceOnce, startPreferredVoice } from "./preferred-voice";

describe("preferred voice provider", () => {
  it("starts the configured GPT provider once", async () => {
    const startVoice = vi.fn().mockResolvedValue(undefined);
    await expect(
      startPreferredVoice({
        startVoice,
        serverId: "host",
        agentId: "agent",
        preferRealtimeGpt: true,
      }),
    ).resolves.toBe("openai-realtime");
    expect(startVoice).toHaveBeenCalledExactlyOnceWith("host", "agent", "openai-realtime");
  });

  it("surfaces a GPT start failure without switching providers", async () => {
    const startVoice = vi.fn().mockRejectedValue(new Error("Credential is not configured"));
    await expect(
      startPreferredVoice({
        startVoice,
        serverId: "host",
        agentId: "agent",
        preferRealtimeGpt: true,
      }),
    ).rejects.toThrow("Credential is not configured");
    expect(startVoice).toHaveBeenCalledTimes(1);
  });

  it("uses Paseo voice when GPT is not preferred", async () => {
    const startVoice = vi.fn().mockResolvedValue(undefined);
    await expect(
      startPreferredVoice({
        startVoice,
        serverId: "host",
        agentId: "agent",
        preferRealtimeGpt: false,
      }),
    ).resolves.toBe("paseo");
    expect(startVoice).toHaveBeenCalledExactlyOnceWith("host", "agent", "paseo");
  });
});

describe("empty draft voice start", () => {
  it("shares one pending create/start operation across rapid taps and screen unmount", async () => {
    let acknowledge!: () => void;
    const start = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );
    const first = startDraftVoiceOnce("host:draft-1", start);
    const second = startDraftVoiceOnce("host:draft-1", start);
    await Promise.resolve();
    expect(start).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    acknowledge();
    await first;
  });

  it("allows a retry after failed creation", async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValue(undefined);
    await expect(startDraftVoiceOnce("host:draft-2", start)).rejects.toThrow("create failed");
    await Promise.resolve();
    await expect(startDraftVoiceOnce("host:draft-2", start)).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(2);
  });
});
