import { randomUUID } from "node:crypto";

import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type {
  AgentPromptInput,
  AgentSessionConfig,
  SteerActiveTurnOptions,
  SteerResult,
} from "../agent-sdk-types.js";
import {
  ACPAgentSession,
  type ACPAgentSessionOptions,
  type ACPStopCorrelation,
  type ACPStopRecord,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

/**
 * Fork-only GJC provider.
 *
 * GJC 0.15.5 runs turns the client did not start, so two things differ from a
 * plain ACP session:
 *
 * 1. Ownerless activity has to be mirrored into Paseo with an explicit turn id,
 *    because `gjcPhase` carries no turn id and `AgentManager` would otherwise
 *    attribute the mirror's delayed terminal to whichever turn it knows about.
 * 2. Stopping that ownerless turn cannot use ACP `session/cancel` proof alone:
 *    the cancellation that reaches GJC is the `_gjc/sdk/control` terminal
 *    `turn.abort`, so the stop gate needs a validated abort result plus a
 *    post-stop authoritative idle, in either order.
 *
 * Foreground turns stay on the generic boundary and ACP `session/cancel`. The
 * control extension is ownerless-only.
 */

type GjcAbortScope = "turn" | "owned";

const GJC_ABORT_SCOPE_ENV_VAR = "GJC_ACP_ABORT_SCOPE";
const GJC_CONTROL_METHOD = "_gjc/sdk/control";
const GJC_ABORT_OPERATION = "turn.abort";
const GJC_STEER_OPERATION = "turn.steer";
const GJC_PHASE_META_KEY = "gjcPhase";
const GJC_MIRROR_TURN_ID_PREFIX = "gjc-autonomous-";

/** Phase edge that marks ownerless activity; also the only invalidator of an eligible idle. */
const GJC_WORKING_PHASE = "working";
/** Phase edge that marks a settled session. */
const GJC_IDLE_PHASE = "idle";

/** Resolves `GJC_ACP_ABORT_SCOPE` once per session. An unknown value refuses to start. */
export function resolveGjcAbortScope(rawValue: string | undefined): GjcAbortScope {
  if (rawValue === undefined || rawValue === "") {
    return "turn";
  }
  if (rawValue === "turn") {
    return "turn";
  }
  if (rawValue === "owned") {
    return "owned";
  }
  throw new Error(
    `Invalid ${GJC_ABORT_SCOPE_ENV_VAR} value "${rawValue}": expected "turn" or "owned". ` +
      "Refusing to start with ambiguous cancellation semantics.",
  );
}

/**
 * What one `turn.abort` response proved. `safe` is a terminal-safe stop for the
 * requested scope; `conditional` is the `no_active_turn` no-effect result, which
 * is only ever a second fact; `reject` leaves the stop installed.
 */
type GjcAbortVerdict =
  | { kind: "safe"; disposition: string }
  | { kind: "conditional"; disposition: string }
  | { kind: "reject"; disposition: string; reason: string };

interface GjcAbortResult {
  /** Control attempt revision that produced this result. */
  readonly revision: number;
  readonly verdict: GjcAbortVerdict;
}

/** The explicit id Paseo minted for one episode of provider-owned activity. */
interface GjcMirrorTurn {
  readonly turnId: string;
  /** Phase revision of the working edge that opened the mirror. */
  readonly openedPhaseRevision: number;
}

/**
 * One ownerless stop plus the two facts that may release it. The stop record
 * itself is the base boundary's; everything here is GJC proof keyed to it.
 */
interface GjcOwnerlessStop {
  readonly stop: ACPStopRecord;
  /** Phase revision captured at install; idles at or before it are not eligible. */
  readonly installedPhaseRevision: number;
  /** 1-based control attempt counter. Drives the idempotency key. */
  attemptRevision: number;
  /** Phase revision of the eligible post-stop idle, or null. A later working edge clears it. */
  idlePhaseRevision: number | null;
  /** Newest abort result, or null. Never cleared by a later idle. */
  result: GjcAbortResult | null;
  released: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGjcAbortFactSatisfied(verdict: GjcAbortVerdict): boolean {
  return verdict.kind === "safe" || verdict.kind === "conditional";
}

/**
 * GJC 0.15.5 `terminalAbort` validation, matched to the shapes in
 * `session-runtime.ts`. A failed control call arrives here too, as a resolved
 * `{ok:false,error}` payload, and is a verdict like any other. Extra fields
 * (documented `replay` metadata) are ignored.
 */
export function validateGjcTerminalAbortResult(
  result: unknown,
  scope: GjcAbortScope,
): GjcAbortVerdict {
  if (!isRecord(result)) {
    return {
      kind: "reject",
      disposition: "malformed",
      reason: "terminal abort result is not an object",
    };
  }
  if (result.ok !== true) {
    return {
      kind: "reject",
      disposition: "ok_false",
      reason: "terminal abort result did not report ok:true",
    };
  }
  if (result.selection !== scope) {
    return {
      kind: "reject",
      disposition: "selection_mismatch",
      reason: `terminal abort selection did not match the configured scope "${scope}"`,
    };
  }

  if (result.turn === "stopped") {
    // The two terminal-safe shapes, one per scope. Anything else — including an
    // owned result whose ownedWork is "uncertain" — stays stopping.
    const safe =
      scope === "turn"
        ? result.ownedWork === "left_running" &&
          result.automaticDelivery === "enabled" &&
          result.resumeOnOwnedCompletion === true
        : result.ownedWork === "stopped" &&
          result.automaticDelivery === "none" &&
          result.resumeOnOwnedCompletion === false;
    return safe
      ? { kind: "safe", disposition: scope === "turn" ? "stopped_left_running" : "stopped_stopped" }
      : {
          kind: "reject",
          disposition: "stopped_shape_mismatch",
          reason: `terminal abort stopped result does not match the configured scope "${scope}"`,
        };
  }

  if (result.turn === "no_active_turn") {
    return result.terminal === "terminal_no_effect"
      ? { kind: "conditional", disposition: "no_active_turn" }
      : {
          kind: "reject",
          disposition: "no_active_turn_shape_mismatch",
          reason: "no_active_turn result without terminal_no_effect",
        };
  }

  if (result.turn === "uncertain" || result.turn === "no_effect" || result.turn === "no_store") {
    return {
      kind: "reject",
      disposition: result.turn,
      reason: `terminal abort reported turn "${result.turn}"`,
    };
  }

  return {
    kind: "reject",
    disposition: "unknown_turn_disposition",
    reason: "terminal abort reported an unknown turn disposition",
  };
}

function readGjcPhase(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== "session_info_update") {
    return null;
  }
  const meta = update._meta;
  if (!isRecord(meta)) {
    return null;
  }
  const phase = meta[GJC_PHASE_META_KEY];
  return typeof phase === "string" && phase.length > 0 ? phase : null;
}

/** Steering carries text only; anything else is refused without a control call. */
function flattenGjcSteerText(prompt: AgentPromptInput): string | null {
  if (typeof prompt === "string") {
    return prompt;
  }
  if (prompt.length === 1 && prompt[0]?.type === "text") {
    return prompt[0].text;
  }
  return null;
}

export interface GjcACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
  waitForInitialCommands?: boolean;
  initialCommandsWaitTimeoutMs?: number;
  diagnosticPhaseTimeoutMs?: number;
}

/**
 * The provider's configured env reaches this client as its runtime settings
 * (`GenericACPAgentClient` stores `env` there and spawns with it), while the
 * session's `launchEnv` carries only the per-create launch context. Both feed
 * the child process; only the merge feeds the scope resolver. A per-create
 * value wins, matching the overlay order in `createProviderEnvSpec`.
 */
function mergeGjcProviderEnv(
  providerEnv: Record<string, string> | undefined,
  launchEnv: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!providerEnv) {
    return launchEnv;
  }
  if (!launchEnv) {
    return providerEnv;
  }
  return { ...providerEnv, ...launchEnv };
}

/**
 * Registry entry point for a custom ACP provider with `providerId:"gjc"`.
 * Everything launch- and catalog-related stays in the generic client; only the
 * session is substituted.
 */
export class GjcACPAgentClient extends GenericACPAgentClient {
  protected override createAgentSession(
    config: AgentSessionConfig,
    options: ACPAgentSessionOptions,
  ): ACPAgentSession {
    return new GjcACPAgentSession(config, {
      ...options,
      launchEnv: mergeGjcProviderEnv(this.runtimeSettings?.env, options.launchEnv),
    });
  }
}

export class GjcACPAgentSession extends ACPAgentSession {
  private readonly abortScope: GjcAbortScope;
  /** Mirrors the base `closed` flag, which is not visible to subclasses. */
  private ownClosed = false;
  /** True inside the resume/replay window, where GJC publishes no phase edges. */
  private replayingPhaseEdges = false;
  private currentPhase: string | null = null;
  private phaseRevision = 0;
  private mirror: GjcMirrorTurn | null = null;
  private ownerlessStop: GjcOwnerlessStop | null = null;

  constructor(config: AgentSessionConfig, options: ACPAgentSessionOptions) {
    super(config, options);
    // Resolved once, before any control call can exist. A typo refuses to start
    // rather than silently changing what Stop means.
    this.abortScope = resolveGjcAbortScope(this.getLaunchEnv(GJC_ABORT_SCOPE_ENV_VAR));
  }

  get configuredAbortScope(): GjcAbortScope {
    return this.abortScope;
  }

  override async sessionUpdate(params: SessionNotification): Promise<void> {
    this.observeGjcPhase(params);
    await super.sessionUpdate(params);
  }

  /**
   * History replay is the one window where a phase edge must not move mirror or
   * admission state: a resumed session replays a past transcript, and an
   * autonomous turn from that transcript is not running now. GJC 0.15.5 emits
   * no `gjcPhase` during replay, so this is containment rather than a live path.
   */
  override async initializeResumedSession(): Promise<void> {
    this.replayingPhaseEdges = true;
    try {
      await super.initializeResumedSession();
    } finally {
      this.replayingPhaseEdges = false;
    }
  }

  override async interrupt(): Promise<void> {
    if (this.ownClosed) {
      return;
    }

    // A foreground turn keeps the generic boundary and ACP session/cancel.
    if (this.getForegroundTurnId() !== null) {
      await super.interrupt();
      return;
    }

    const mirror = this.mirror;
    if (!mirror) {
      await super.interrupt();
      return;
    }

    const existing = this.ownerlessStop;
    if (
      existing &&
      existing.stop.stoppedTurnId === mirror.turnId &&
      this.getCurrentStop() === existing.stop
    ) {
      // Repeated Stop: same stop identity and stopped turn, a fresh attempt
      // revision, and the staged successor invalidated through its own token.
      this.invalidateStagedSuccessor(existing.stop, "interrupt");
      this.issueTerminalAbort(existing);
      return;
    }

    // Deliberately deferred: a GJC-raised permission pending when this ownerless
    // stop runs is not resolved here (the base sweep mutates private state and
    // the public reply API would fabricate a user-facing response); close()
    // settles it. The deny router has no gap of the same shape: it resolves the
    // permission it was asked about before it routes, and the stop's release
    // never consults pending permissions.
    this.installOwnerlessStopAndAbort(mirror.turnId, "interrupt");
  }

  /**
   * The deny half of the §7 stop-kind router. The guards mirror `interrupt()`:
   * a foreground turn keeps the generic boundary, an open ownerless mirror gets
   * the ownerless stop (reusing it when the denial lands on an already-stopped
   * mirror), and no stop-able turn falls through to the base router, which
   * suppresses the cancellation write with the deny correlation attached.
   */
  protected override async stopTurnOnPermissionDenial(
    correlation: ACPStopCorrelation,
  ): Promise<void> {
    if (this.ownClosed) {
      return;
    }

    // A foreground turn keeps the generic boundary and ACP session/cancel.
    if (this.getForegroundTurnId() !== null) {
      await super.stopTurnOnPermissionDenial(correlation);
      return;
    }

    const mirror = this.mirror;
    if (!mirror) {
      await super.stopTurnOnPermissionDenial(correlation);
      return;
    }

    const existing = this.ownerlessStop;
    if (
      existing &&
      existing.stop.stoppedTurnId === mirror.turnId &&
      this.getCurrentStop() === existing.stop
    ) {
      // Repeated Stop: same stop identity and stopped turn, a fresh attempt
      // revision, and the staged successor invalidated through its own token.
      this.invalidateStagedSuccessor(existing.stop, "permission-denied");
      this.issueTerminalAbort(existing);
      return;
    }

    this.installOwnerlessStopAndAbort(mirror.turnId, "permission-denied");
  }

  /**
   * The one ownerless stop operation, shared by `interrupt()` and the deny
   * router: invalidates a displaced stop's staged successor, installs the
   * provider-owned boundary synchronously, and issues the terminal abort
   * without awaiting its response (issue-and-return).
   */
  private installOwnerlessStopAndAbort(stoppedTurnId: string, reason: string): void {
    // A stop this one displaces may still hold a staged successor with a live
    // deadline. Invalidate it here so its waiter is rejected by the stop that
    // replaces it rather than stranded until the admission timeout.
    const displaced = this.getCurrentStop();
    if (displaced) {
      this.invalidateStagedSuccessor(displaced, "superseded");
    }

    // Installed synchronously, before the first control write it is followed by.
    const stop = this.installStop({
      kind: "provider-owned",
      stoppedTurnId,
      reason,
    });
    const state: GjcOwnerlessStop = {
      stop,
      installedPhaseRevision: this.phaseRevision,
      attemptRevision: 0,
      idlePhaseRevision: null,
      result: null,
      released: false,
    };
    this.ownerlessStop = state;
    this.issueTerminalAbort(state);
  }

  override async close(): Promise<void> {
    // Before any await: no late phase edge, control result, or terminal may
    // touch mirror or admission state after close begins.
    this.ownClosed = true;
    this.mirror = null;
    this.ownerlessStop = null;
    this.currentPhase = null;
    await super.close();
  }

  async steerActiveTurn(
    prompt: AgentPromptInput,
    options: SteerActiveTurnOptions,
  ): Promise<SteerResult> {
    const text = flattenGjcSteerText(prompt);
    if (text === null) {
      return { status: "unavailable" };
    }
    const connection = this.getAcpConnection();
    const sessionId = this.getAcpSessionId();
    if (!connection || !sessionId) {
      return { status: "unavailable" };
    }
    // Ownership stays with the manager's check; this only refuses to steer a
    // turn the session does not currently consider active.
    const activeTurnId = this.getForegroundTurnId() ?? this.mirror?.turnId ?? null;
    if (options.expectedTurnId !== activeTurnId) {
      return { status: "unavailable" };
    }

    try {
      const payload = await connection.extMethod(GJC_CONTROL_METHOD, {
        sessionId,
        operation: GJC_STEER_OPERATION,
        input: { text, clientRef: randomUUID() },
      });
      if (!isRecord(payload) || payload.ok === false || payload.accepted !== true) {
        return { status: "unavailable" };
      }
      return { status: "accepted" };
    } catch {
      return { status: "unavailable" };
    }
  }

  protected override isProviderStopGateSatisfied(stop: ACPStopRecord): boolean {
    return this.unresolvedGjcStopFacts(stop).length === 0;
  }

  protected override describeProviderStopGate(stop: ACPStopRecord): string[] {
    return this.unresolvedGjcStopFacts(stop);
  }
  /**
   * One death path proof: the ownerless abort attempt still awaiting its
   * response can never be answered by a dead transport, so it is settled as a
   * reject through the ordinary result path. Newest-wins keeps a late reply
   * for the same attempt from overwriting the death verdict.
   */
  protected override recordProviderStopDeath(stop: ACPStopRecord, reason: string): void {
    const state = this.ownerlessStop;
    if (!state || state.stop !== stop || state.attemptRevision === 0) {
      return;
    }
    if (state.result && state.result.revision >= state.attemptRevision) {
      // The newest attempt already settled with a real verdict.
      return;
    }
    this.recordAbortResult(state, {
      revision: state.attemptRevision,
      verdict: {
        kind: "reject",
        disposition: "transport_death",
        reason: `terminal abort response never arrived; observed death (${reason})`,
      },
    });
  }

  /**
   * Two facts, either order: a validated terminal-safe abort result and a
   * current eligible post-stop idle. `conditional` never counts alone. Named so
   * the admission deadline can log which one is missing.
   */
  private unresolvedGjcStopFacts(stop: ACPStopRecord): string[] {
    const state = this.ownerlessStop;
    if (!state || state.stop !== stop) {
      // Not this session's ownerless stop: the generic gate is the whole story.
      return super.isProviderStopGateSatisfied(stop) ? [] : ["provider_gate"];
    }
    const unresolved: string[] = [];
    const result = state.result;
    if (!(result !== null && isGjcAbortFactSatisfied(result.verdict))) {
      // A recorded reject names itself, so a deadline reports why the fact is
      // closed instead of a bare fact name.
      unresolved.push(
        result && result.verdict.kind === "reject"
          ? `gjc.abort_result (${result.verdict.disposition}: ${result.verdict.reason})`
          : "gjc.abort_result",
      );
    }
    if (state.idlePhaseRevision === null) {
      unresolved.push("gjc.idle");
    }
    return unresolved;
  }

  /**
   * The session identity half of the base triple, through the read-only
   * accessors a subclass gets. There is no connection-revision accessor, and
   * `finishTurn` re-checks the full triple before delivering, so a stop
   * captured on a replaced connection still cannot release a terminal here.
   */
  private gjcStopIdentityMatches(stop: ACPStopRecord): boolean {
    return this.getAcpConnection() === stop.connection && this.getAcpSessionId() === stop.sessionId;
  }

  private observeGjcPhase(params: SessionNotification): void {
    const phase = readGjcPhase(params.update);
    if (!phase || this.ownClosed || this.replayingPhaseEdges) {
      return;
    }
    if (params.sessionId !== this.getAcpSessionId()) {
      return;
    }
    // Duplicate same-phase updates stay edge-idempotent; only a change moves
    // the revision, so eligibility is anchored to real transitions.
    if (this.currentPhase === phase) {
      return;
    }
    this.currentPhase = phase;
    this.phaseRevision += 1;

    const mirrorTurnId = this.mirror?.turnId;
    const stopId = this.ownerlessStop?.stop.stopId;
    this.logger.info(
      {
        sessionId: params.sessionId,
        phase,
        phaseRevision: this.phaseRevision,
        ...(mirrorTurnId ? { mirrorTurnId } : {}),
        ...(stopId ? { stopId } : {}),
      },
      "provider.gjc.phase_edge",
    );

    if (phase === GJC_WORKING_PHASE) {
      this.handleWorkingEdge();
      return;
    }
    if (phase === GJC_IDLE_PHASE) {
      this.handleIdleEdge();
    }
  }

  private handleWorkingEdge(): void {
    const state = this.ownerlessStop;
    if (state && !state.released && state.idlePhaseRevision !== null) {
      // Owned work GJC left running resumed: the idle observation is stale and
      // the stop needs a newer one.
      state.idlePhaseRevision = null;
      this.logger.info({ stopId: state.stop.stopId }, "provider.gjc.idle_invalidated");
    }

    // No competing mirror while a foreground turn owns the slot.
    if (this.getForegroundTurnId() !== null || this.mirror) {
      return;
    }
    const turnId = `${GJC_MIRROR_TURN_ID_PREFIX}${randomUUID()}`;
    this.mirror = { turnId, openedPhaseRevision: this.phaseRevision };
    this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
  }

  private handleIdleEdge(): void {
    const state = this.ownerlessStop;
    if (state && !state.released && state.idlePhaseRevision === null) {
      state.idlePhaseRevision = this.phaseRevision;
      this.maybeReleaseOwnerlessStop(state);
    }
    this.closeMirrorNaturally();
  }

  /**
   * Natural ownerless completion closes the mirror on the ordinary working→idle
   * edge, unless the mirror's own stop boundary is what owns its terminal.
   */
  private closeMirrorNaturally(): void {
    const mirror = this.mirror;
    if (!mirror) {
      return;
    }
    const state = this.ownerlessStop;
    if (state && !state.released && state.stop.stoppedTurnId === mirror.turnId) {
      return;
    }
    this.mirror = null;
    this.pushEvent({ type: "turn_completed", provider: this.provider, turnId: mirror.turnId });
  }

  /**
   * Issue-and-return: the synchronous prefix (identity check, attempt
   * revision, idempotency key, attempt log) runs before this returns, and the
   * control request is dispatched without awaiting its response. gjc's own
   * abort budget and the admission deadline are both 10 s while the manager
   * waits only 2 s around `interrupt()`, so awaiting the response reports
   * every healthy slow abort as a refused Stop. Both settlements attach here
   * and record through `recordAbortResult`, which keeps newest-wins,
   * validation, and release on one path: a resolution records its validated
   * verdict; a rejection records `transport_rejected` and is logged. A late
   * rejection is a recorded fact, not a user-visible failure — interrupt()
   * has already returned — so it is never rethrown and never terminalizes the
   * mirror turn.
   */
  private issueTerminalAbort(state: GjcOwnerlessStop): void {
    const stop = state.stop;
    if (!this.gjcStopIdentityMatches(stop)) {
      throw new Error(
        `${this.provider} cannot abort a stopped turn on a replaced session or connection`,
      );
    }

    const revision = state.attemptRevision + 1;
    state.attemptRevision = revision;
    const idempotencyKey = `${stop.stopId}:${revision}`;
    this.logger.info(
      { stopId: stop.stopId, revision, scope: this.abortScope, sessionId: stop.sessionId },
      "provider.gjc.abort_attempt",
    );

    void stop.connection
      .extMethod(GJC_CONTROL_METHOD, {
        sessionId: stop.sessionId,
        operation: GJC_ABORT_OPERATION,
        input: { mode: "terminal", scope: this.abortScope, idempotencyKey },
      })
      .then((payload) => {
        this.recordAbortResult(state, {
          revision,
          verdict: validateGjcTerminalAbortResult(payload, this.abortScope),
        });
        return;
      })
      .catch((error: unknown) => {
        // A rejected write is recorded like a rejected cancel write: the stop
        // stays closed and only a newer successful attempt can satisfy the
        // result fact. No caller sees the rejection — interrupt() has already
        // returned — so it is logged instead of thrown.
        this.recordAbortResult(state, {
          revision,
          verdict: {
            kind: "reject",
            disposition: "transport_rejected",
            reason: "control request rejected",
          },
        });
        this.logger.warn(
          {
            stopId: stop.stopId,
            sessionId: stop.sessionId,
            turnId: stop.stoppedTurnId,
            revision,
            scope: this.abortScope,
            err: error,
          },
          "provider.gjc.abort_transport_rejected",
        );
      });
  }

  private recordAbortResult(state: GjcOwnerlessStop, result: GjcAbortResult): void {
    // Newest attempt wins; a late reply for a superseded attempt — or for the
    // attempt a death verdict already settled — never overwrites the recorded
    // result.
    if (state.result && state.result.revision >= result.revision) {
      return;
    }
    state.result = result;
    this.logger.info(
      {
        stopId: state.stop.stopId,
        revision: result.revision,
        scope: this.abortScope,
        disposition: result.verdict.disposition,
        verdict: result.verdict.kind,
        ...(result.verdict.kind === "reject" ? { reason: result.verdict.reason } : {}),
      },
      "provider.gjc.abort_result",
    );
    this.maybeReleaseOwnerlessStop(state);
  }

  private maybeReleaseOwnerlessStop(state: GjcOwnerlessStop): void {
    if (state.released) {
      return;
    }
    const result = state.result;
    if (!result || !isGjcAbortFactSatisfied(result.verdict) || state.idlePhaseRevision === null) {
      return;
    }
    const stop = state.stop;
    if (this.getCurrentStop() !== stop || this.getAdmissionState() !== "stopping") {
      return;
    }
    if (!this.gjcStopIdentityMatches(stop)) {
      return;
    }

    // Both facts are present: one terminal, with the mirror's explicit id,
    // delivered through the base boundary so terminal proof, exactly-once
    // delivery, and successor admission all happen there. The validated
    // disposition picks the kind (terminal-reason precedence): a safe stop
    // genuinely stopped the turn → turn_canceled, even when the eligible idle
    // arrived first; no_active_turn + terminal_no_effect stopped nothing, so
    // that idle is the mirror's natural completion edge → turn_completed.
    this.finishTurn(
      stop.stoppedTurnId,
      result.verdict.kind === "conditional"
        ? {
            type: "turn_completed",
            provider: this.provider,
            turnId: stop.stoppedTurnId,
          }
        : {
            type: "turn_canceled",
            provider: this.provider,
            reason: "Interrupted",
            turnId: stop.stoppedTurnId,
          },
    );
    if (!stop.terminalObserved) {
      // Close or an identity change landed first; the stop stays installed and
      // a later attempt may try again.
      return;
    }
    state.released = true;
    this.mirror = null;
    this.logger.info(
      {
        stopId: stop.stopId,
        turnId: stop.stoppedTurnId,
        resultRevision: result.revision,
        resultDisposition: result.verdict.disposition,
        idlePhaseRevision: state.idlePhaseRevision,
      },
      "provider.gjc.ownerless_stop_released",
    );
  }
}
