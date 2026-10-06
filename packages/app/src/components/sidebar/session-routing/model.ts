import type { SessionSearchResult } from "@getpaseo/protocol/messages";

export interface Recipient extends SessionSearchResult {
  serverId: string;
  projectViewKey: string;
  hostLabel: string;
}

export type RoutingPhase =
  | { status: "idle" }
  | { status: "handoff" }
  | { status: "matching"; requestId: string; mode: "find" | "send"; text: string }
  | {
      status: "results";
      requestId: string;
      mode: "find" | "send";
      recipients: Recipient[];
      notice: string;
    }
  | {
      status: "sending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
    }
  | {
      status: "pending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
      error: string;
    }
  | { status: "acknowledged"; recipient: Recipient; queued: boolean; warning?: string }
  | { status: "error"; message: string };

export interface NewConversationWorkspace {
  serverId: string;
  workspaceId: string;
  projectViewKey: string;
  projectName: string;
  name: string;
}

export interface RoutingState {
  mode: "find" | "send";
  sendDraft: string;
  draftReady: boolean;
  draftVersion: number;
  draftUpdatedAt: number;
  scope: string | null;
  recipient: Recipient | null;
  deliveryMode: "queue" | "steer" | "interrupt";
  newConversation: boolean;
  newWorkspace: NewConversationWorkspace | null;
  picker: boolean;
  pickerQuery: string;
  phase: RoutingPhase;
}

export const initialRoutingState: RoutingState = {
  mode: "find",
  sendDraft: "",
  draftReady: false,
  draftVersion: 0,
  draftUpdatedAt: 0,
  scope: null,
  recipient: null,
  deliveryMode: "queue",
  newConversation: false,
  newWorkspace: null,
  picker: false,
  pickerQuery: "",
  phase: { status: "idle" },
};

export type RoutingAction =
  | { type: "syncDraft"; text: string; version: number; updatedAt?: number }
  | {
      type: "restoreDraft";
      text: string;
      version: number;
      updatedAt?: number;
      pending?: Extract<RoutingAction, { type: "restorePending" }>;
    }
  | { type: "invalidateFind" }
  | { type: "cancelMatch"; requestId: string }
  | { type: "hosts"; serverIds: readonly string[] }
  | {
      type: "restorePending";
      recipient: Recipient;
      text: string;
      itemId: string;
      draftVersion: number;
      draftUpdatedAt?: number;
    }
  | { type: "mode"; mode: RoutingState["mode"] }
  | { type: "draft"; text: string; version: number; updatedAt?: number }
  | { type: "scope"; scope: string | null }
  | { type: "recipient"; recipient: Recipient | null }
  | { type: "deliveryMode"; mode: RoutingState["deliveryMode"] }
  | { type: "newConversation"; workspace: NewConversationWorkspace | null }
  | { type: "newWorkspace"; workspace: NewConversationWorkspace }
  | { type: "picker"; open: boolean }
  | { type: "pickerQuery"; text: string }
  | { type: "receiptWarning"; message: string }
  | { type: "phase"; phase: RoutingPhase }
  | { type: "matched"; requestId: string; recipients: Recipient[]; notice: string }
  | { type: "acknowledged"; itemId: string; queued: boolean };

export function recipientInScope(
  recipient: Pick<Recipient, "projectViewKey">,
  scope: string | null,
): boolean {
  return scope === null || recipient.projectViewKey === scope;
}

export function automaticRecipient(recipients: readonly Recipient[]): Recipient | null {
  const [first, second] = recipients;
  if (!first || first.confidence < 0.9) return null;
  if (second && (second.confidence >= 0.7 || first.confidence - second.confidence < 0.2))
    return null;
  return first;
}

export function routingReducer(state: RoutingState, action: RoutingAction): RoutingState {
  switch (action.type) {
    case "syncDraft":
      return {
        ...state,
        ...routingDraftFields(action),
      };
    case "restoreDraft":
      return restoreRoutingDraft(state, action);
    case "hosts":
      return updateRoutingHosts(state, action.serverIds);
    case "invalidateFind":
      return invalidateFind(state);
    case "cancelMatch":
      return cancelRoutingMatch(state, action.requestId);
    case "restorePending":
      return {
        ...state,
        mode: "send",
        recipient: action.recipient,
        phase: {
          status: "pending",
          recipient: action.recipient,
          text: action.text,
          itemId: action.itemId,
          draftVersion: action.draftVersion,
          draftUpdatedAt: action.draftUpdatedAt,
          error: "",
        },
      };
    case "mode":
      return { ...state, mode: action.mode, phase: { status: "idle" }, picker: false };
    case "draft":
      return {
        ...state,
        ...routingDraftFields(action),
        phase: { status: "idle" },
      };
    case "scope":
      return updateRoutingScope(state, action.scope);
    case "deliveryMode":
      return { ...state, deliveryMode: action.mode, phase: { status: "idle" } };
    case "newConversation":
      return {
        ...state,
        mode: "send",
        newConversation: true,
        newWorkspace: action.workspace,
        recipient: null,
        picker: false,
        phase: { status: "idle" },
      };
    case "newWorkspace":
      return { ...state, newWorkspace: action.workspace, phase: { status: "idle" } };
    case "recipient":
      return {
        ...state,
        recipient: action.recipient,
        newConversation: false,
        mode: "send",
        picker: false,
        phase: { status: "idle" },
      };
    case "picker":
      return { ...state, picker: action.open };
    case "pickerQuery":
      return { ...state, pickerQuery: action.text };
    case "receiptWarning":
      return applyReceiptWarning(state, action.message);
    case "phase":
      return { ...state, phase: action.phase };
    case "matched":
      return applyRoutingMatches(state, action);
    case "acknowledged":
      return acknowledgeRoutingState(state, action);
  }
}

function cancelRoutingMatch(state: RoutingState, requestId: string): RoutingState {
  return (state.phase.status === "matching" || state.phase.status === "results") &&
    state.phase.requestId === requestId
    ? { ...state, phase: { status: "idle" } }
    : state;
}

function acknowledgeRoutingState(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "acknowledged" }>,
): RoutingState {
  const phase = state.phase;
  if ((phase.status !== "sending" && phase.status !== "pending") || phase.itemId !== action.itemId)
    return state;
  const sendDraft =
    state.draftVersion === phase.draftVersion &&
    state.draftUpdatedAt === (phase.draftUpdatedAt ?? 0)
      ? ""
      : state.sendDraft;
  return {
    ...state,
    sendDraft,
    phase: { status: "acknowledged", recipient: phase.recipient, queued: action.queued },
  };
}

function invalidateFind(state: RoutingState): RoutingState {
  const phase = state.phase;
  if ((phase.status === "results" || phase.status === "matching") && phase.mode === "find")
    return { ...state, phase: { status: "idle" } };
  return state;
}

function routingDraftFields(
  action: Extract<RoutingAction, { type: "draft" | "syncDraft" | "restoreDraft" }>,
) {
  return {
    sendDraft: action.text,
    draftVersion: action.version,
    draftUpdatedAt: action.updatedAt ?? 0,
  };
}

function restoreRoutingDraft(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "restoreDraft" }>,
): RoutingState {
  const restored = { ...state, ...routingDraftFields(action), draftReady: true };
  return action.pending ? routingReducer(restored, action.pending) : restored;
}
function updateRoutingHosts(state: RoutingState, serverIds: readonly string[]): RoutingState {
  return {
    ...state,
    recipient:
      state.recipient && serverIds.includes(state.recipient.serverId) ? state.recipient : null,
    newWorkspace:
      state.newWorkspace && serverIds.includes(state.newWorkspace.serverId)
        ? state.newWorkspace
        : null,
  };
}

function updateRoutingScope(state: RoutingState, scope: string | null): RoutingState {
  const recipient =
    state.recipient && recipientInScope(state.recipient, scope) ? state.recipient : null;
  return {
    ...state,
    scope: scope,
    recipient,
    newWorkspace:
      state.newWorkspace && recipientInScope(state.newWorkspace, scope) ? state.newWorkspace : null,
    picker: false,
    phase: { status: "idle" },
  };
}

function applyRoutingMatches(
  state: RoutingState,
  action: Extract<RoutingAction, { type: "matched" }>,
): RoutingState {
  if (state.phase.status !== "matching" || state.phase.requestId !== action.requestId) return state;
  const recipients = action.recipients.filter((recipient) =>
    recipientInScope(recipient, state.scope),
  );
  return {
    ...state,
    phase: {
      status: "results",
      requestId: action.requestId,
      mode: state.phase.mode,
      recipients,
      notice: action.notice,
    },
  };
}

function applyReceiptWarning(state: RoutingState, warning: string): RoutingState {
  return state.phase.status === "acknowledged"
    ? { ...state, phase: { ...state.phase, warning } }
    : state;
}
