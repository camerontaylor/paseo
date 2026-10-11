import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import type { MessagePayload } from "@/composer/types";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";

export type SendBehavior = ActiveTurnBehavior | "queue";

export function resolveActiveSendBehavior(
  sendBehavior: SendBehavior,
  hasPendingPermission: boolean,
): SendBehavior {
  return sendBehavior === "queue" && hasPendingPermission ? "interrupt" : sendBehavior;
}

interface ComposerSurfaceState {
  opacity: 0 | 1;
  pointerEvents: "auto" | "none";
}

export interface ComposerSurfacePresentation {
  input: ComposerSurfaceState;
  overlay: ComposerSurfaceState;
}

const INPUT_PRESENTATION: ComposerSurfacePresentation = {
  input: { opacity: 1, pointerEvents: "auto" },
  overlay: { opacity: 0, pointerEvents: "none" },
};

const OVERLAY_PRESENTATION: ComposerSurfacePresentation = {
  input: { opacity: 0, pointerEvents: "none" },
  overlay: { opacity: 1, pointerEvents: "auto" },
};

export function resolveComposerSurfacePresentation(
  showOverlay: boolean,
): ComposerSurfacePresentation {
  return showOverlay ? OVERLAY_PRESENTATION : INPUT_PRESENTATION;
}

interface StopRealtimeVoiceContext {
  voice: { stopVoice: () => Promise<unknown> } | null | undefined;
  isRealtimeVoiceForCurrentAgent: boolean;
}

interface SendActionContext {
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void | Promise<void>) | undefined;
  handleSendMessage: () => void;
  handleQueueMessage: () => void;
}

interface DictationTranscriptContext {
  value: string;
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void | Promise<void>) | undefined;
  onSubmit: (payload: MessagePayload) => void;
  replaceText: (text: string) => void;
  /** The live input text, so a clear never drops text typed during the queue. */
  getLiveText?: () => string;
  /** Surfaces a queue failure once; the transcript stays in the input. */
  onQueueError?: (message: string) => void;
  attachments: MessagePayload["attachments"];
  cwd: string;
  autoSend: boolean;
}

export function applyDictationTranscript(text: string, ctx: DictationTranscriptContext): void {
  if (!text) return;
  const shouldPad = ctx.value.length > 0 && !/\s$/.test(ctx.value);
  const nextValue = `${ctx.value}${shouldPad ? " " : ""}${text}`;

  if (!ctx.autoSend) {
    ctx.replaceText(nextValue);
    return;
  }

  ctx.replaceText(nextValue);

  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    void queueInputMessage(
      { text: nextValue, attachments: ctx.attachments, cwd: ctx.cwd },
      ctx.onQueue,
    )
      .then(() => {
        if (ctx.getLiveText?.() === nextValue) ctx.replaceText("");
        return undefined;
      })
      .catch((error: unknown) => {
        // The transcript stays in the input; the failure surfaces through the
        // composer's error display.
        ctx.onQueueError?.(
          error instanceof Error && error.message
            ? error.message
            : i18n.t("composer.errors.queuedPersistFailed"),
        );
      });
    return;
  }

  ctx.onSubmit({
    text: nextValue,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
}

interface MessageInputKeyboardActions {
  focusInput: () => void;
  isDictationRecording: () => boolean;
  markTranscriptForSend: () => void;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictation: () => void | Promise<void>;
  toggleRealtimeVoice: () => void;
  isRealtimeVoiceActive: boolean;
  toggleRealtimeVoiceMute: () => void;
}

export function computeCanStartDictation(input: {
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  disabled: boolean;
  dictationUnavailableMessage: string | null | undefined;
}): boolean {
  const socketConnected = input.client?.isConnected ?? false;
  const readyForDictation = input.isReadyForDictation ?? socketConnected;
  return (
    socketConnected && readyForDictation && !input.disabled && !input.dictationUnavailableMessage
  );
}

export function runDefaultSendAction(ctx: SendActionContext): void {
  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
    return;
  }
  ctx.handleSendMessage();
}

export function runAlternateSendAction(ctx: SendActionContext): void {
  if (ctx.defaultSendBehavior === "queue") {
    ctx.handleSendMessage();
    return;
  }
  if (ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
  }
}

export function runMessageInputKeyboardAction(
  action: MessageInputKeyboardActionKind,
  actions: MessageInputKeyboardActions,
): boolean {
  if (action === "focus") {
    actions.focusInput();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (actions.isDictationRecording()) {
      actions.markTranscriptForSend();
      void actions.confirmDictation();
      return true;
    }
    return false;
  }
  if (action === "voice-toggle") {
    actions.toggleRealtimeVoice();
    return true;
  }
  if (action === "voice-mute-toggle") {
    if (actions.isRealtimeVoiceActive) {
      actions.toggleRealtimeVoiceMute();
    }
    return true;
  }
  if (action === "dictation-cancel") {
    if (actions.isDictationRecording()) {
      void actions.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (actions.isDictationRecording()) {
      actions.markTranscriptForSend();
      void actions.confirmDictation();
    } else {
      void actions.startDictation();
    }
    return true;
  }
  return false;
}

export async function stopRealtimeVoice(ctx: StopRealtimeVoiceContext): Promise<void> {
  if (!ctx.voice || !ctx.isRealtimeVoiceForCurrentAgent) return;

  // Stop voice detaches the microphone and playback only. The agent, its pending
  // permissions, and its children keep running; interruption is the overlay's
  // explicit Interrupt agent control.
  await ctx.voice.stopVoice();
}

/** Awaits the queue callback so callers can clear only after durable acceptance. */
export async function queueInputMessage(
  payload: MessagePayload,
  onQueue: (payload: MessagePayload) => void | Promise<void>,
): Promise<void> {
  await onQueue(payload);
}
