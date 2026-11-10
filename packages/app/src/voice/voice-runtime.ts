import { Buffer } from "buffer";
import type { AgentStreamEventPayload, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import type { DaemonServerInfo } from "@/stores/session-store";
import { createInputReceiptCue } from "@/voice/input-receipt-cue";
import {
  createVoiceFailureTracker,
  voiceFailureFromRecognitionIssue,
  type VoiceFailureKind,
} from "@/voice/voice-failure";
import { createVoiceFailureCue, createVoiceReconnectedCue } from "@/voice/voice-failure-cue";
import type { AudioEngine, AudioPlaybackSource } from "@/audio";
import {
  THINKING_TONE_NATIVE_PCM_BASE64,
  THINKING_TONE_NATIVE_PCM_DURATION_MS,
} from "@/utils/thinking-tone.native-pcm";

const PCM_MIME_TYPE = "audio/pcm;rate=16000;bits=16";
const KEEP_AWAKE_TAG = "paseo:voice";
const THINKING_TONE_REPEAT_GAP_MS = 350;
/**
 * A reply is spoken as one TTS segment per sentence, and the daemon starts the next segment
 * only once the current one has finished playing, so a reply in progress is punctuated by short
 * silences. The cue is for a wait the user cannot otherwise explain, so it starts only once the
 * silence has outlasted those gaps.
 */
const THINKING_TONE_MIN_SILENCE_MS = 1500;
// TTS emits bounded text segments. Recover locally before the daemon's 120s
// acknowledgement deadline, even if a platform player never settles play().
const PLAYBACK_TIMEOUT_MS = 90_000;
// Before voice stops over a failure, give its spoken cue this long to finish. A player that
// never settles, such as one blocked by a phone call, must not hold the stop.
const FAILURE_CUE_BEFORE_STOP_MAX_MS = 4_000;
const DISPLAY_VOLUME_PUBLISH_INTERVAL_MS = 120;
const DISPLAY_VOLUME_CHANGE_EPSILON = 0.02;
const DISPLAY_VOLUME_ATTACK = 0.35;
const DISPLAY_VOLUME_RELEASE = 0.18;

type TurnEventType = Extract<
  AgentStreamEventPayload["type"],
  "turn_started" | "turn_completed" | "turn_failed" | "turn_canceled"
>;

export type VoiceRuntimePhase =
  | "disabled"
  | "starting"
  | "listening"
  | "submitting"
  | "waiting"
  | "playing"
  | "stopping";

export type VoiceInputStatus = "queued" | "sent" | "removed" | "unknown";

export interface VoiceRuntimeSnapshot {
  phase: VoiceRuntimePhase;
  isVoiceMode: boolean;
  isVoiceSwitching: boolean;
  isMuted: boolean;
  /** The input problem to show in the voice panel; also spoken when it begins. */
  failure: VoiceFailureKind | null;
  /** Delivery state of the most recent spoken follow-up, from daemon receipts. */
  lastInputStatus: VoiceInputStatus | null;
  activeServerId: string | null;
  activeAgentId: string | null;
}

export interface VoiceRuntimeTelemetrySnapshot {
  volume: number;
  isSpeaking: boolean;
  segmentDuration: number;
}

/** Identifies the voice attachment a voice message belongs to. */
export interface VoiceTransport {
  attachmentId: string;
  generation: string;
}

export interface VoiceSessionAdapter {
  serverId: string;
  setVoiceMode(
    enabled: boolean,
    agentId?: string,
    input?: { attachmentId?: string; generation?: string },
  ): Promise<{ attachmentId?: string; generation?: string }>;
  sendVoiceAudioChunk(
    audioData: string,
    mimeType: string,
    transport?: VoiceTransport,
  ): Promise<void>;
  audioPlayed(chunkId: string, error?: string, transport?: VoiceTransport): Promise<void>;
  readVoiceInputReceipts(input: {
    agentId: string;
    attachmentId: string;
    generation: string;
    after?: string;
    limit?: number;
  }): Promise<
    Pick<
      Extract<SessionOutboundMessage, { type: "voice.input.receipts.read.response" }>["payload"],
      "items" | "nextCursor"
    >
  >;
  abortRequest(transport?: VoiceTransport): Promise<void>;
  setAssistantAudioPlaying(isPlaying: boolean): void;
}

export interface VoiceRuntimeDeps {
  engine: AudioEngine;
  getServerInfo(serverId: string): DaemonServerInfo | null;
  activateKeepAwake(tag: string): Promise<void>;
  deactivateKeepAwake(tag: string): Promise<void>;
}

interface RuntimeSessionState {
  adapter: VoiceSessionAdapter;
  connected: boolean;
}

interface ContinuousVoiceUploader {
  reset(): void;
  pushPcmChunk(chunk: Uint8Array): void;
}

interface RuntimeState {
  snapshot: VoiceRuntimeSnapshot;
  telemetry: VoiceRuntimeTelemetrySnapshot;
  turnInProgress: boolean;
  serverSpeechDetected: boolean;
  transportReady: boolean;
  generation: number;
  /** Logical attachment across reconnects; the transport generation changes each reclaim. */
  attachmentId: string | null;
  transportGeneration: string | null;
  segmentDurationTimer: ReturnType<typeof setInterval> | null;
  lastDisplayVolumePublishMs: number;
  serverSpeechStartedAt: number | null;
}

type AudioOutputPayload = Extract<SessionOutboundMessage, { type: "audio_output" }>["payload"];

interface StreamingPlaybackChunk {
  id: string;
  chunkIndex: number;
  source: { arrayBuffer(): Promise<ArrayBuffer>; size: number; type: string };
}

interface StreamingPlaybackGroup {
  groupId: string;
  isVoiceMode: boolean;
  shouldPlay: boolean;
  chunks: Map<number, StreamingPlaybackChunk>;
  nextChunkToPlay: number;
  finalChunkIndex: number | null;
  started: boolean;
  ackedChunkIds: Set<string>;
}

interface RuntimePlaybackState {
  groups: Map<string, StreamingPlaybackGroup>;
  orderedGroupIds: string[];
  activeGroupId: string | null;
  processing: boolean;
  generation: number;
}

interface CueState {
  controller: AbortController | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

const INITIAL_SNAPSHOT: VoiceRuntimeSnapshot = {
  phase: "disabled",
  isVoiceMode: false,
  isVoiceSwitching: false,
  isMuted: false,
  failure: null,
  lastInputStatus: null,
  activeServerId: null,
  activeAgentId: null,
};

const INITIAL_TELEMETRY: VoiceRuntimeTelemetrySnapshot = {
  volume: 0,
  isSpeaking: false,
  segmentDuration: 0,
};

let nextVoiceRuntimeInstanceId = 1;

function snapshotsEqual(left: VoiceRuntimeSnapshot, right: VoiceRuntimeSnapshot): boolean {
  return (
    left.phase === right.phase &&
    left.isVoiceMode === right.isVoiceMode &&
    left.isVoiceSwitching === right.isVoiceSwitching &&
    left.isMuted === right.isMuted &&
    left.failure === right.failure &&
    left.lastInputStatus === right.lastInputStatus &&
    left.activeServerId === right.activeServerId &&
    left.activeAgentId === right.activeAgentId
  );
}

function telemetryEqual(
  left: VoiceRuntimeTelemetrySnapshot,
  right: VoiceRuntimeTelemetrySnapshot,
): boolean {
  return (
    left.volume === right.volume &&
    left.isSpeaking === right.isSpeaking &&
    left.segmentDuration === right.segmentDuration
  );
}

export interface VoiceRuntime {
  subscribe(listener: () => void): () => void;
  getSnapshot(): VoiceRuntimeSnapshot;
  subscribeTelemetry(listener: () => void): () => void;
  getTelemetrySnapshot(): VoiceRuntimeTelemetrySnapshot;
  registerSession(adapter: VoiceSessionAdapter): () => void;
  updateSessionConnection(serverId: string, connected: boolean): void;
  handleCapturePcm(chunk: Uint8Array): void;
  handleCaptureVolume(level: number): void;
  handleAudioOutput(serverId: string, payload: AudioOutputPayload): void;
  startVoice(serverId: string, agentId: string): Promise<void>;
  stopVoice(): Promise<void>;
  destroy(): Promise<void>;
  toggleMute(): void;
  isVoiceModeForAgent(serverId: string, agentId: string): boolean;
  shouldPlayVoiceAudio(serverId: string): boolean;
  onAssistantAudioStarted(serverId: string): void;
  onAssistantAudioFinished(serverId: string): void;
  onTranscriptionResult(
    serverId: string,
    text: string,
    payload?: {
      attachmentId?: string;
      generation?: string;
      queued?: boolean;
      messageId?: string;
    },
  ): void;
  /** True when a voice message belongs to the current attachment incarnation. */
  acceptsVoiceTransport(
    serverId: string,
    payload: { attachmentId?: string; generation?: string },
  ): boolean;
  /** A queue snapshot changed on the host; re-read this attachment's receipts. */
  onQueueChanged(serverId: string, agentId: string): void;
  onServerSpeechStateChanged(serverId: string, isSpeaking: boolean): void;
  onInputError(serverId: string, error: string): void;
  onRecognitionIssue(serverId: string, issue: string): void;
  /** The device stopped delivering microphone audio. Announces it, then stops voice. */
  handleMicrophoneLost(): Promise<void>;
  onTurnEvent(serverId: string, agentId: string, eventType: TurnEventType): void;
}

export function createVoiceRuntime(deps: VoiceRuntimeDeps): VoiceRuntime {
  const instanceId = nextVoiceRuntimeInstanceId++;
  const listeners = new Set<() => void>();
  const telemetryListeners = new Set<() => void>();
  const sessions = new Map<string, RuntimeSessionState>();
  const state: RuntimeState = {
    snapshot: INITIAL_SNAPSHOT,
    telemetry: INITIAL_TELEMETRY,
    turnInProgress: false,
    serverSpeechDetected: false,
    transportReady: false,
    generation: 0,
    attachmentId: null,
    transportGeneration: null,
    segmentDurationTimer: null,
    lastDisplayVolumePublishMs: 0,
    serverSpeechStartedAt: null,
  };
  const playback: RuntimePlaybackState = {
    groups: new Map(),
    orderedGroupIds: [],
    activeGroupId: null,
    processing: false,
    generation: 0,
  };
  const cue: CueState = {
    controller: null,
    timeout: null,
  };
  const failures = createVoiceFailureTracker();
  const inputStatuses = new Map<string, VoiceInputStatus>();
  let receiptReadTail: Promise<void> = Promise.resolve();
  let voiceLifecycleTail: Promise<unknown> = Promise.resolve();
  const cuePcm16 = Uint8Array.from(Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64"));
  const cueSource = {
    size: cuePcm16.byteLength,
    type: "audio/pcm;rate=16000;bits=16",
    async arrayBuffer() {
      return cuePcm16.buffer.slice(cuePcm16.byteOffset, cuePcm16.byteOffset + cuePcm16.byteLength);
    },
  };
  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function emitTelemetry(): void {
    for (const listener of telemetryListeners) {
      listener();
    }
  }

  function patchSnapshot(
    patch:
      | Partial<VoiceRuntimeSnapshot>
      | ((previous: VoiceRuntimeSnapshot) => VoiceRuntimeSnapshot),
  ): void {
    const next =
      typeof patch === "function" ? patch(state.snapshot) : { ...state.snapshot, ...patch };
    if (snapshotsEqual(next, state.snapshot)) {
      return;
    }
    state.snapshot = next;
    emit();
  }

  function patchTelemetry(
    patch:
      | Partial<VoiceRuntimeTelemetrySnapshot>
      | ((previous: VoiceRuntimeTelemetrySnapshot) => VoiceRuntimeTelemetrySnapshot),
  ): void {
    const next =
      typeof patch === "function" ? patch(state.telemetry) : { ...state.telemetry, ...patch };
    if (telemetryEqual(next, state.telemetry)) {
      return;
    }
    state.telemetry = next;
    emitTelemetry();
  }

  function getActiveSession(): RuntimeSessionState | null {
    if (!state.snapshot.activeServerId) {
      return null;
    }
    return sessions.get(state.snapshot.activeServerId) ?? null;
  }

  function decodeAudioChunk(base64: string): Uint8Array {
    return Buffer.from(base64, "base64");
  }

  function toPlaybackSource(
    bytes: Uint8Array,
    format: string,
  ): { arrayBuffer(): Promise<ArrayBuffer>; size: number; type: string } {
    let mimeType: string;
    if (format === "pcm") mimeType = "audio/pcm;rate=24000;bits=16";
    else if (format === "mp3") mimeType = "audio/mpeg";
    else mimeType = `audio/${format}`;

    return {
      size: bytes.byteLength,
      type: mimeType,
      async arrayBuffer() {
        return Uint8Array.from(bytes).buffer;
      },
    };
  }

  function resetPlaybackState(): void {
    playback.generation += 1;
    playback.groups.clear();
    playback.orderedGroupIds = [];
    playback.activeGroupId = null;
    playback.processing = false;
  }

  function activateNextPlaybackGroup(): void {
    while (playback.orderedGroupIds.length > 0) {
      const groupId = playback.orderedGroupIds[0];
      if (playback.groups.has(groupId)) {
        playback.activeGroupId = groupId;
        return;
      }
      playback.orderedGroupIds.shift();
    }
    playback.activeGroupId = null;
  }

  function retireFinishedGroup(
    group: { groupId: string; started: boolean; isVoiceMode: boolean },
    serverId: string,
  ): void {
    playback.groups.delete(group.groupId);
    if (playback.orderedGroupIds[0] === group.groupId) {
      playback.orderedGroupIds.shift();
    } else {
      playback.orderedGroupIds = playback.orderedGroupIds.filter(
        (value) => value !== group.groupId,
      );
    }
    if (group.started && group.isVoiceMode) {
      api.onAssistantAudioFinished(serverId);
    }
  }

  async function acknowledgeChunk(chunkId: string, error?: string): Promise<void> {
    const activeSession = getActiveSession();
    if (!activeSession) {
      return;
    }
    const transport = voiceTransport();
    if (transport) await activeSession.adapter.audioPlayed(chunkId, error, transport);
    else if (error === undefined) await activeSession.adapter.audioPlayed(chunkId);
    else await activeSession.adapter.audioPlayed(chunkId, error);
  }

  async function processPlaybackQueue(serverId: string): Promise<void> {
    if (playback.processing) {
      return;
    }

    playback.processing = true;
    const generation = playback.generation;
    try {
      while (playback.activeGroupId) {
        if (generation !== playback.generation) {
          return;
        }

        const group = playback.groups.get(playback.activeGroupId);
        if (!group) {
          activateNextPlaybackGroup();
          continue;
        }

        const nextChunk = group.chunks.get(group.nextChunkToPlay);
        if (!nextChunk) {
          const groupIsFinished =
            group.finalChunkIndex !== null && group.nextChunkToPlay > group.finalChunkIndex;
          if (!groupIsFinished) {
            return;
          }
          retireFinishedGroup(group, serverId);
          activateNextPlaybackGroup();
          continue;
        }

        group.chunks.delete(group.nextChunkToPlay);

        if (group.shouldPlay && !group.started && group.isVoiceMode) {
          group.started = true;
          api.onAssistantAudioStarted(serverId);
        }

        let playbackError: string | undefined;
        let playbackTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          if (group.shouldPlay) {
            const timeout = new Promise<never>((_resolve, reject) => {
              playbackTimeout = setTimeout(() => {
                reject(new Error("Audio playback timed out"));
              }, PLAYBACK_TIMEOUT_MS);
            });
            await Promise.race([deps.engine.play(nextChunk.source), timeout]);
          }
        } catch (error) {
          if (generation !== playback.generation) {
            return;
          }
          console.error(`[VoiceRuntime] play error chunk=${group.nextChunkToPlay}:`, error);
          playbackError = error instanceof Error ? error.message : String(error);
          deps.engine.stop();
          deps.engine.clearQueue();
        } finally {
          clearTimeout(playbackTimeout);
        }

        if (generation !== playback.generation) {
          return;
        }

        if (!group.ackedChunkIds.has(nextChunk.id)) {
          group.ackedChunkIds.add(nextChunk.id);
          void acknowledgeChunk(nextChunk.id, playbackError).catch((error) => {
            console.warn("[VoiceRuntime] Failed to confirm audio playback:", error);
          });
        }

        group.nextChunkToPlay += 1;
      }
    } finally {
      if (generation === playback.generation) {
        playback.processing = false;
      }
    }
  }

  function clearSegmentDurationTimer(): void {
    if (state.segmentDurationTimer) {
      clearInterval(state.segmentDurationTimer);
      state.segmentDurationTimer = null;
    }
  }

  function reconcileSegmentDurationTimer(): void {
    if (!state.serverSpeechDetected) {
      clearSegmentDurationTimer();
      patchTelemetry((prev) => ({ ...prev, segmentDuration: 0 }));
      return;
    }

    if (state.segmentDurationTimer) {
      return;
    }

    state.segmentDurationTimer = setInterval(() => {
      const startedAt = state.serverSpeechStartedAt;
      patchTelemetry((prev) => ({
        ...prev,
        segmentDuration: startedAt ? Date.now() - startedAt : 0,
      }));
    }, 100);
  }

  function canPlayCue(): boolean {
    return (
      state.snapshot.isVoiceMode &&
      state.snapshot.phase === "waiting" &&
      !state.telemetry.isSpeaking
    );
  }

  function stopCue(): void {
    cue.controller?.abort();
    cue.controller = null;
    if (cue.timeout) {
      clearTimeout(cue.timeout);
      cue.timeout = null;
    }
  }

  function resetCaptureTelemetry(): void {
    clearSegmentDurationTimer();
    state.serverSpeechStartedAt = null;
    patchTelemetry({ ...INITIAL_TELEMETRY });
  }

  function reconcileCue(): void {
    if (!canPlayCue()) {
      stopCue();
      return;
    }
    if (cue.controller) {
      return;
    }
    const controller = new AbortController();
    cue.controller = controller;

    const playNext = () => {
      if (controller.signal.aborted) {
        return;
      }
      void deps.engine
        .play(cueSource, controller.signal)
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }
          console.warn(`[VoiceRuntime#${instanceId}] Cue playback failed:`, error);
        })
        .finally(() => {
          if (controller.signal.aborted) {
            return;
          }
          cue.timeout = setTimeout(
            playNext,
            THINKING_TONE_NATIVE_PCM_DURATION_MS + THINKING_TONE_REPEAT_GAP_MS,
          );
        });
    };

    cue.timeout = setTimeout(playNext, THINKING_TONE_MIN_SILENCE_MS);
  }

  function playLocalCue(source: AudioPlaybackSource, label: string): Promise<void> {
    return deps.engine.play(source).then(
      () => undefined,
      (error) => {
        console.warn(`[VoiceRuntime#${instanceId}] ${label} cue failed:`, error);
      },
    );
  }

  /** Shows the failure, and speaks it when it starts a new episode. */
  function reportFailure(kind: VoiceFailureKind): Promise<void> {
    const announce = failures.report(kind);
    patchSnapshot({ failure: failures.current() });
    if (!announce) {
      return Promise.resolve();
    }
    // The thinking tone would otherwise suggest the agent is still working on what was said.
    stopCue();
    return playLocalCue(createVoiceFailureCue(kind), "Failure");
  }

  function clearFailures(kinds: readonly VoiceFailureKind[]): VoiceFailureKind[] {
    const recovered = failures.clear(kinds);
    patchSnapshot({ failure: failures.current() });
    return recovered;
  }

  async function reportFailureBeforeStopping(kind: VoiceFailureKind): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      reportFailure(kind),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, FAILURE_CUE_BEFORE_STOP_MAX_MS);
      }),
    ]);
    clearTimeout(timeout);
  }

  const uploader: ContinuousVoiceUploader = {
    reset() {},
    pushPcmChunk(chunk) {
      const activeSession = getActiveSession();
      if (
        !activeSession ||
        !state.transportReady ||
        !state.snapshot.isVoiceMode ||
        chunk.byteLength === 0
      ) {
        return;
      }

      const base64 = Buffer.from(chunk).toString("base64");

      const transport = voiceTransport();
      const upload = transport
        ? activeSession.adapter.sendVoiceAudioChunk(base64, PCM_MIME_TYPE, transport)
        : activeSession.adapter.sendVoiceAudioChunk(base64, PCM_MIME_TYPE);
      void upload.catch((error) => {
        console.error(`[VoiceRuntime#${instanceId}] Failed to send audio chunk:`, error);
      });
    },
  };

  function disableVoice(
    adapter: VoiceSessionAdapter,
    transport?: { attachmentId: string; generation: string },
  ): Promise<unknown> {
    return transport
      ? adapter.setVoiceMode(false, undefined, transport)
      : adapter.setVoiceMode(false);
  }

  function voiceTransport(): VoiceTransport | undefined {
    return state.attachmentId && state.transportGeneration
      ? { attachmentId: state.attachmentId, generation: state.transportGeneration }
      : undefined;
  }

  function resetToDisabledState(): void {
    failures.reset();
    inputStatuses.clear();
    state.transportReady = false;
    state.attachmentId = null;
    state.transportGeneration = null;
    state.turnInProgress = false;
    state.serverSpeechDetected = false;
    state.lastDisplayVolumePublishMs = 0;
    uploader.reset();
    resetCaptureTelemetry();
    patchSnapshot({ ...INITIAL_SNAPSHOT });
  }

  function applyInputStatus(messageId: string, status: VoiceInputStatus, playCue: boolean): void {
    const previous = inputStatuses.get(messageId);
    if (
      previous === "sent" ||
      previous === "removed" ||
      (previous === "unknown" && status === "queued")
    )
      return;
    if (previous === status) return;
    inputStatuses.set(messageId, status);
    patchSnapshot({ lastInputStatus: status });
    if (playCue && (status === "queued" || status === "sent")) {
      void playLocalCue(
        createInputReceiptCue(status),
        status === "queued" ? "Queued" : "Sent to agent",
      );
    }
  }

  function reconcileInputReceipts(playCue: boolean): void {
    receiptReadTail = receiptReadTail
      .catch(() => undefined)
      .then(async () => {
        const active = getActiveSession();
        const agentId = state.snapshot.activeAgentId;
        const attachmentId = state.attachmentId;
        const generation = state.transportGeneration;
        if (!active || !agentId || !attachmentId || !generation || !state.transportReady) return;
        let after: string | undefined;
        do {
          const page = await active.adapter.readVoiceInputReceipts({
            agentId,
            attachmentId,
            generation,
            ...(after ? { after } : {}),
            limit: 100,
          });
          if (generation !== state.transportGeneration || attachmentId !== state.attachmentId)
            return;
          for (const item of page.items) {
            applyInputStatus(
              item.messageId,
              item.state === "submitted" ? "sent" : item.state,
              playCue,
            );
          }
          after = page.nextCursor ?? undefined;
        } while (after);
        return undefined;
      })
      .catch((error) => {
        console.warn(`[VoiceRuntime#${instanceId}] Could not reconcile voice receipts:`, error);
      });
  }

  function publishDisplayVolume(level: number, nowMs: number): void {
    const previousVolume = state.telemetry.volume;
    const smoothing = level >= previousVolume ? DISPLAY_VOLUME_ATTACK : DISPLAY_VOLUME_RELEASE;
    const nextVolume = Math.max(
      0,
      Math.min(1, previousVolume + (level - previousVolume) * smoothing),
    );
    const enoughTimeElapsed =
      nowMs - state.lastDisplayVolumePublishMs >= DISPLAY_VOLUME_PUBLISH_INTERVAL_MS;
    const enoughChange = Math.abs(nextVolume - previousVolume) >= DISPLAY_VOLUME_CHANGE_EPSILON;

    if (!enoughTimeElapsed && !enoughChange) {
      return;
    }

    state.lastDisplayVolumePublishMs = nowMs;
    patchTelemetry((prev) => ({
      ...prev,
      volume: Number(nextVolume.toFixed(3)),
    }));
  }

  async function performLocalStop(): Promise<void> {
    stopCue();
    uploader.reset();
    resetPlaybackState();
    deps.engine.stop();
    deps.engine.clearQueue();
    await deps.engine.stopCapture().catch(() => undefined);
    await deps.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    getActiveSession()?.adapter.setAssistantAudioPlaying(false);
    resetToDisabledState();
  }

  // The reconnect transition keeps its generation checks and failure cleanup together.
  // oxlint-disable-next-line complexity
  async function resyncVoiceMode(serverId: string): Promise<void> {
    if (
      !state.snapshot.isVoiceMode ||
      state.snapshot.activeServerId !== serverId ||
      !state.snapshot.activeAgentId
    ) {
      return;
    }

    const activeSession = getActiveSession();
    if (!activeSession || !activeSession.connected) {
      return;
    }

    const generation = state.generation;
    patchSnapshot((prev) => ({ ...prev, isVoiceSwitching: true }));
    try {
      await deps.engine.initialize();
      if (generation !== state.generation) return;
      const options = state.attachmentId ? { attachmentId: state.attachmentId } : undefined;
      const response = options
        ? await activeSession.adapter.setVoiceMode(true, state.snapshot.activeAgentId, options)
        : await activeSession.adapter.setVoiceMode(true, state.snapshot.activeAgentId);
      if (generation !== state.generation) {
        if (response.attachmentId && response.generation)
          await activeSession.adapter.setVoiceMode(false, undefined, {
            attachmentId: response.attachmentId,
            generation: response.generation,
          });
        return;
      }
      if (
        state.attachmentId &&
        (response.attachmentId !== state.attachmentId || !response.generation)
      )
        throw new Error("Host did not acknowledge this voice attachment");
      state.transportReady = true;
      state.transportGeneration = response.generation ?? null;
      reconcileInputReceipts(false);
      // The host re-created its recognizer, so every earlier failure is stale.
      const recovered = clearFailures([
        "host-disconnected",
        "recognition-unavailable",
        "recognition-failed",
        "recognition-stalled",
        "nothing-recognized",
      ]);
      if (recovered.includes("host-disconnected")) {
        void playLocalCue(createVoiceReconnectedCue(), "Reconnected");
      }
    } catch (error) {
      if (generation !== state.generation) return;
      console.warn(`[VoiceRuntime#${instanceId}] Voice reconnect failed:`, error);
      void reportFailure("host-disconnected");
    } finally {
      if (generation === state.generation) {
        patchSnapshot((prev) => ({ ...prev, isVoiceSwitching: false }));
      }
    }
  }

  const api: VoiceRuntime = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return state.snapshot;
    },

    subscribeTelemetry(listener) {
      telemetryListeners.add(listener);
      return () => {
        telemetryListeners.delete(listener);
      };
    },

    getTelemetrySnapshot() {
      return state.telemetry;
    },

    registerSession(adapter) {
      sessions.set(adapter.serverId, {
        adapter,
        connected: true,
      });

      return () => {
        const activeServerId = state.snapshot.activeServerId;
        sessions.delete(adapter.serverId);
        if (activeServerId === adapter.serverId) {
          void performLocalStop();
        }
      };
    },

    updateSessionConnection(serverId, connected) {
      const session = sessions.get(serverId);
      if (!session) {
        return;
      }
      session.connected = connected;
      if (state.snapshot.activeServerId !== serverId) {
        return;
      }
      if (!connected) {
        state.transportReady = false;
        state.transportGeneration = null;
        if (!state.snapshot.isVoiceMode) return;
        state.generation += 1;
        state.turnInProgress = false;
        state.serverSpeechDetected = false;
        resetCaptureTelemetry();
        resetPlaybackState();
        stopCue();
        deps.engine.stop();
        deps.engine.clearQueue();
        session.adapter.setAssistantAudioPlaying(false);
        void reportFailure("host-disconnected");
        return;
      }
      void resyncVoiceMode(serverId);
    },

    handleCapturePcm(chunk) {
      if (!state.snapshot.isVoiceMode || state.snapshot.isMuted) {
        return;
      }
      uploader.pushPcmChunk(chunk);
    },

    handleCaptureVolume(level) {
      const nowMs = Date.now();
      const displayLevel = state.snapshot.isMuted ? 0 : level;
      publishDisplayVolume(displayLevel, nowMs);
      if (!state.snapshot.isVoiceMode || state.snapshot.isMuted) {
        patchTelemetry((prev) => ({
          ...prev,
          isSpeaking: false,
          segmentDuration: 0,
        }));
        return;
      }

      patchTelemetry((prev) => ({
        ...prev,
        isSpeaking: state.serverSpeechDetected,
      }));
      reconcileSegmentDurationTimer();
      reconcileCue();
    },

    handleAudioOutput(serverId, payload) {
      if (
        serverId !== state.snapshot.activeServerId ||
        !state.snapshot.isVoiceMode ||
        !payload.isVoiceMode
      ) {
        return;
      }
      if (!api.acceptsVoiceTransport(serverId, payload)) return;

      const groupId = payload.groupId ?? payload.id;
      const chunkIndex = payload.chunkIndex ?? 0;
      const decoded = decodeAudioChunk(payload.audio);

      let group = playback.groups.get(groupId);
      if (!group) {
        group = {
          groupId,
          isVoiceMode: payload.isVoiceMode,
          shouldPlay: api.shouldPlayVoiceAudio(serverId),
          chunks: new Map(),
          nextChunkToPlay: 0,
          finalChunkIndex: null,
          started: false,
          ackedChunkIds: new Set(),
        };
        playback.groups.set(groupId, group);
        playback.orderedGroupIds.push(groupId);
        if (!playback.activeGroupId) {
          playback.activeGroupId = groupId;
        }
      }

      group.chunks.set(chunkIndex, {
        id: payload.id,
        chunkIndex,
        source: toPlaybackSource(decoded, payload.format),
      });
      if (payload.isLastChunk) {
        group.finalChunkIndex = chunkIndex;
      }

      void processPlaybackQueue(serverId);
    },

    // Capture admission, generation checks, and rollback are one transition.
    // oxlint-disable-next-line complexity
    async startVoice(serverId, agentId) {
      const requestedGeneration = ++state.generation;
      const operation = voiceLifecycleTail
        .catch(() => undefined)
        // Capture admission and rollback must remain in the same serialized transition.
        // oxlint-disable-next-line complexity
        .then(async () => {
          if (requestedGeneration !== state.generation) return undefined;
          const session = sessions.get(serverId);
          if (!session) {
            throw new Error(`Voice runtime is not ready for host ${serverId}`);
          }
          if (!session.connected) {
            throw new Error(`Host ${serverId} is not connected`);
          }

          const serverInfo = deps.getServerInfo(serverId);
          const unavailableMessage = resolveVoiceUnavailableMessage({
            serverInfo,
            mode: "voice",
          });
          if (unavailableMessage) {
            throw new Error(unavailableMessage);
          }

          const previousTransport = voiceTransport();
          const previousServerId = state.snapshot.activeServerId;
          const previousAgentId = state.snapshot.activeAgentId;
          const generation = requestedGeneration;
          let enabledCurrentVoiceMode = false;
          state.generation = generation;
          inputStatuses.clear();
          state.attachmentId =
            serverInfo?.features?.durableVoiceInputV1 === true ? crypto.randomUUID() : null;
          state.transportGeneration = null;
          state.transportReady = false;
          patchSnapshot((prev) => ({
            ...prev,
            isVoiceSwitching: true,
            phase: "starting",
            activeServerId: serverId,
            activeAgentId: agentId,
          }));

          try {
            if (
              state.snapshot.isVoiceMode &&
              previousServerId &&
              (previousServerId !== serverId || previousAgentId !== agentId)
            ) {
              const previousSession = sessions.get(previousServerId);
              if (previousSession) {
                previousSession.adapter.setAssistantAudioPlaying(false);
                await disableVoice(previousSession.adapter, previousTransport);
              }
            }

            await deps.activateKeepAwake(KEEP_AWAKE_TAG).catch((error) => {
              console.warn("[VoiceRuntime] Failed to activate keep-awake:", error);
            });

            await deps.engine.initialize();
            if (generation !== state.generation) return undefined;
            let response: { attachmentId?: string; generation?: string };
            try {
              response = state.attachmentId
                ? await session.adapter.setVoiceMode(true, agentId, {
                    attachmentId: state.attachmentId,
                  })
                : await session.adapter.setVoiceMode(true, agentId);
            } catch (error) {
              // The host starts its recognizer while enabling voice mode, so a rejection with the
              // host still connected means recognition could not start there.
              await reportFailureBeforeStopping(
                session.connected ? "recognition-unavailable" : "host-disconnected",
              );
              throw error;
            }
            enabledCurrentVoiceMode = true;
            state.transportGeneration = response.generation ?? null;
            if (generation !== state.generation) {
              await disableVoice(session.adapter, voiceTransport());
              return undefined;
            }
            if (
              state.attachmentId &&
              (response.attachmentId !== state.attachmentId || !response.generation)
            )
              throw new Error("Host did not acknowledge this voice attachment");
            await deps.engine.startCapture();
            if (state.generation !== generation) {
              return undefined;
            }

            state.transportReady = true;
            state.turnInProgress = false;
            uploader.reset();
            resetCaptureTelemetry();
            reconcileInputReceipts(false);
            patchSnapshot((prev) => ({
              ...prev,
              isVoiceMode: true,
              isVoiceSwitching: false,
              phase: "listening",
              isMuted: deps.engine.isMuted(),
              failure: null,
            }));
          } catch (error) {
            if (enabledCurrentVoiceMode) {
              await disableVoice(session.adapter, voiceTransport()).catch(() => undefined);
            }
            await performLocalStop();
            throw error;
          }
          return undefined;
        });
      voiceLifecycleTail = operation;
      return operation as Promise<void>;
    },

    async stopVoice() {
      const requestedGeneration = ++state.generation;
      const stopCurrentVoice = async () => {
        const activeSession = getActiveSession();
        const generation = requestedGeneration;
        patchSnapshot((prev) => ({
          ...prev,
          isVoiceSwitching: true,
          phase: "stopping",
        }));

        try {
          stopCue();
          uploader.reset();
          state.transportReady = false;
          resetPlaybackState();
          deps.engine.stop();
          deps.engine.clearQueue();
          activeSession?.adapter.setAssistantAudioPlaying(false);
          if (activeSession) {
            await disableVoice(activeSession.adapter, voiceTransport());
          }
        } finally {
          await deps.engine.stopCapture().catch(() => undefined);
          await deps.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
          if (state.generation === generation) {
            resetToDisabledState();
          }
        }
        return undefined;
      };
      const operation = voiceLifecycleTail.catch(() => undefined).then(stopCurrentVoice);
      voiceLifecycleTail = operation;
      return operation as Promise<void>;
    },

    async destroy() {
      await this.stopVoice().catch(() => undefined);
      await deps.engine.destroy();
      listeners.clear();
      telemetryListeners.clear();
      sessions.clear();
    },

    toggleMute() {
      const nextMuted = deps.engine.toggleMute();
      if (nextMuted) {
        uploader.reset();
        resetCaptureTelemetry();
        patchSnapshot((prev) => ({
          ...prev,
          isMuted: true,
        }));
        reconcileCue();
        return;
      }

      patchSnapshot((prev) => ({ ...prev, isMuted: false }));
    },

    isVoiceModeForAgent(serverId, agentId) {
      return (
        state.snapshot.isVoiceMode &&
        state.snapshot.activeServerId === serverId &&
        state.snapshot.activeAgentId === agentId
      );
    },

    shouldPlayVoiceAudio(serverId) {
      return (
        state.snapshot.isVoiceMode &&
        state.snapshot.activeServerId === serverId &&
        state.snapshot.phase !== "stopping" &&
        state.snapshot.phase !== "disabled"
      );
    },

    onAssistantAudioStarted(serverId) {
      if (!state.snapshot.isVoiceMode || state.snapshot.activeServerId !== serverId) {
        return;
      }
      stopCue();
      getActiveSession()?.adapter.setAssistantAudioPlaying(true);
      patchSnapshot((prev) => ({ ...prev, phase: "playing" }));
    },

    onAssistantAudioFinished(serverId) {
      if (state.snapshot.activeServerId !== serverId) {
        return;
      }

      getActiveSession()?.adapter.setAssistantAudioPlaying(false);
      if (!state.snapshot.isVoiceMode) {
        return;
      }

      if (state.turnInProgress) {
        patchSnapshot((prev) => ({ ...prev, phase: "waiting" }));
        reconcileCue();
        return;
      }

      patchSnapshot((prev) => ({ ...prev, phase: "listening" }));
      reconcileCue();
    },

    acceptsVoiceTransport(serverId, payload) {
      if (serverId !== state.snapshot.activeServerId) return false;
      if (!state.attachmentId) return true;
      return (
        !!state.transportGeneration &&
        payload.generation === state.transportGeneration &&
        payload.attachmentId === state.attachmentId
      );
    },

    onTranscriptionResult(serverId, text, payload) {
      if (
        serverId !== state.snapshot.activeServerId ||
        !state.snapshot.isVoiceMode ||
        !api.acceptsVoiceTransport(serverId, payload ?? {})
      ) {
        return;
      }
      if (state.transportGeneration && text.trim() && payload?.queued !== true) return;

      if (payload?.messageId && payload.queued) {
        applyInputStatus(payload.messageId, "queued", true);
      }

      if (text.trim()) {
        // Recognition works again, so the next miss or stall is a new episode.
        clearFailures(["nothing-recognized", "recognition-stalled", "recognition-failed"]);
        if (state.attachmentId) {
          // Admission is durable; the queue snapshot drives the follow-up's phase.
          state.turnInProgress = false;
          patchSnapshot((prev) => ({ ...prev, phase: "listening" }));
          stopCue();
          return;
        }
        state.turnInProgress = true;
        patchSnapshot((prev) => ({ ...prev, phase: "waiting" }));
        reconcileCue();
        return;
      }

      state.turnInProgress = false;
      patchSnapshot((prev) => ({ ...prev, phase: "listening" }));
      stopCue();
    },

    onQueueChanged(serverId, agentId) {
      if (state.snapshot.activeServerId === serverId && state.snapshot.activeAgentId === agentId) {
        reconcileInputReceipts(true);
      }
    },

    onServerSpeechStateChanged(serverId, isSpeaking) {
      if (serverId !== state.snapshot.activeServerId || !state.snapshot.isVoiceMode) {
        return;
      }

      state.serverSpeechDetected = isSpeaking;
      state.serverSpeechStartedAt = isSpeaking ? (state.serverSpeechStartedAt ?? Date.now()) : null;
      if (isSpeaking) {
        const shouldInterruptPlayback =
          state.snapshot.phase === "playing" || playback.groups.size > 0;
        resetPlaybackState();
        stopCue();
        if (shouldInterruptPlayback) {
          deps.engine.stop();
          deps.engine.clearQueue();
        }
        getActiveSession()?.adapter.setAssistantAudioPlaying(false);
      }
      patchTelemetry((prev) => ({
        ...prev,
        isSpeaking,
      }));
      reconcileSegmentDurationTimer();
      reconcileCue();
    },

    onInputError(serverId, error) {
      if (serverId !== state.snapshot.activeServerId || !state.snapshot.isVoiceMode) return;
      console.warn(`[VoiceRuntime#${instanceId}] Host input error: ${error}`);
      state.transportReady = false;
      void reportFailure("recognition-failed");
    },

    onRecognitionIssue(serverId, issue) {
      if (serverId !== state.snapshot.activeServerId || !state.snapshot.isVoiceMode) return;
      const kind = voiceFailureFromRecognitionIssue(issue);
      // Muted capture uploads nothing; a miss while muted is not news.
      if (!kind || (kind === "nothing-recognized" && state.snapshot.isMuted)) return;
      void reportFailure(kind);
    },

    async handleMicrophoneLost() {
      if (!state.snapshot.isVoiceMode) return;
      await reportFailureBeforeStopping("microphone-lost");
      await api.stopVoice();
    },

    onTurnEvent(serverId, agentId, eventType) {
      if (
        !state.snapshot.isVoiceMode ||
        state.snapshot.activeServerId !== serverId ||
        state.snapshot.activeAgentId !== agentId
      ) {
        return;
      }

      if (eventType === "turn_started") {
        reconcileInputReceipts(true);
        state.turnInProgress = true;
        if (state.snapshot.phase !== "playing") {
          patchSnapshot((prev) => ({ ...prev, phase: "waiting" }));
          reconcileCue();
        }
        return;
      }

      state.turnInProgress = false;
      if (state.snapshot.phase !== "playing") {
        patchSnapshot((prev) => ({ ...prev, phase: "listening" }));
      }
      stopCue();
    },
  };

  return api;
}
