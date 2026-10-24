import type { VoiceRuntime } from "@/voice/voice-runtime";

/** The host capability includes credential availability; an explicit failed opt-in stays failed. */
export async function startPreferredVoice(input: {
  startVoice: VoiceRuntime["startVoice"];
  serverId: string;
  agentId: string;
  preferRealtimeGpt: boolean;
}): Promise<"openai-realtime" | "paseo"> {
  const provider = input.preferRealtimeGpt ? "openai-realtime" : "paseo";
  await input.startVoice(input.serverId, input.agentId, provider);
  return provider;
}

const pendingDraftVoiceStarts = new Map<string, Promise<void>>();

/** The operation outlives a draft screen unmount and shares one create ACK across rapid taps. */
export function startDraftVoiceOnce(key: string, start: () => Promise<void>): Promise<void> {
  const pending = pendingDraftVoiceStarts.get(key);
  if (pending) return pending;
  const operation = Promise.resolve().then(start);
  pendingDraftVoiceStarts.set(key, operation);
  void operation.finally(() => pendingDraftVoiceStarts.delete(key)).catch(() => undefined);
  return operation;
}
