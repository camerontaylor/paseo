import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAcpProvider, type AcpStream, type AcpStreamMessage } from "@getpaseo/plugin/server/acp";
import type {
  ProviderEvent,
  ProviderInput,
  ProviderConnection,
  ProviderPrompt,
} from "@getpaseo/plugin/server/provider";
import { jcodeCapabilities } from "./capabilities.js";
import { jcodePeerTurns } from "./peer-turns.js";

// Contract: jcode docs/ACP_FORK_INTERFACE.md, clauses C-CORPUS-P01-I3,
// C-CORRELATION-P01-I3/I4, C-CONFIG-*, C-SKILL-1. The executable corpus is
// tests/fixtures/acp of camerontaylor/jcode at the commit recorded in
// fixtures/acp/provenance.json. Paseo replays the recorded agent messages into
// the real ACP provider client and asserts the consumer's own outgoing
// requests and resulting ProviderEvent state. This is not a JSON shape check.
const VENDORED_FIXTURE_DIR = fileURLToPath(new URL("./fixtures/acp/", import.meta.url));
const FIXTURE_DIR = process.env.JCODE_ACP_FIXTURE_DIR ?? VENDORED_FIXTURE_DIR;
const SOURCE_REPOSITORY = "camerontaylor/jcode";
const SOURCE_COMMIT = "5fa1db619a52084128be56a15a024b3e831325a1";
const EXPECTED_FIXTURES = [
  "01-create-list-load-v1.jsonl",
  "02-shared-observe-steer-v1.jsonl",
  "03-stop-then-prompt-v1.jsonl",
  "04-detach-v1.jsonl",
  "05-close-owner-aware-v1.jsonl",
  "07-config-commands-v1.jsonl",
  "08-negotiation-legacy-v1.jsonl",
  "09-elicitation-form-v1.jsonl",
  "09-midturn-attach-v1.jsonl",
  "10-reverse-steer-v1.jsonl",
  "11-import-repeated-user-replay-v1.jsonl",
  "12-skill-selection-clear-v1.jsonl",
] as const;
const ALL_PROVIDER_CAPABILITIES = [
  "prompt.message",
  "prompt.command",
  "prompt.image",
  "prompt.steer",
  "session.configure",
  "session.detach",
  "session.list",
  "session.persistence",
  "session.shared_turns",
  "permission",
] as const;

type FixtureName = (typeof EXPECTED_FIXTURES)[number];

interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}
interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
interface RpcResult {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
}
interface RpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}
type RpcMessage = RpcRequest | RpcNotification | RpcResult | RpcError;

interface Recorded {
  seq: number;
  dir: "c2a" | "a2c";
  msg: RpcMessage;
}

function isRequest(message: RpcMessage): message is RpcRequest {
  return "method" in message && "id" in message;
}
function isNotification(message: RpcMessage): message is RpcNotification {
  return "method" in message && !("id" in message);
}
function isResponse(message: RpcMessage): message is RpcResult | RpcError {
  return !("method" in message) && "id" in message;
}

function isRecordedRequest(record: Recorded): record is Recorded & { msg: RpcRequest } {
  return record.dir === "c2a" && isRequest(record.msg);
}
function isAgentRequest(record: Recorded): record is Recorded & { msg: RpcRequest } {
  return record.dir === "a2c" && isRequest(record.msg);
}
function isResponseTo(record: Recorded, request: RpcRequest): boolean {
  return isResponse(record.msg) && record.msg.id === request.id;
}

function fixtureNames(directory: string): string[] {
  // Deliberately no skip-on-missing: an absent corpus is a failed acceptance,
  // not a skipped one. readdirSync throws ENOENT for a missing directory.
  const entries = readdirSync(directory);
  return entries.filter((name) => name.endsWith(".jsonl")).sort();
}

function readFixture(name: string, directory = FIXTURE_DIR): Recorded[] {
  const file = path.join(directory, name);
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Recorded);
}

function responseTo(records: Recorded[], request: RpcRequest): Recorded | undefined {
  return records.find((record) => isResponseTo(record, request));
}

function requestById(records: Recorded[], id: string | number | null): Recorded | undefined {
  return records.find((record) => isRecordedRequest(record) && record.msg.id === id);
}

interface Connection {
  initializeRequest: Recorded & { msg: RpcRequest };
  initializeResponse: Recorded;
  records: Recorded[];
}

/** The corpus may concatenate several clients; every c2a initialize starts one connection. */
function splitConnections(records: Recorded[]): Connection[] {
  const groups: Recorded[][] = [];
  let current: Recorded[] | null = null;
  for (const record of records) {
    if (record.dir === "c2a" && isRequest(record.msg) && record.msg.method === "initialize") {
      current = [];
      groups.push(current);
    }
    if (current) current.push(record);
  }
  return groups.map((group) => {
    const initializeRequest = group[0] as Recorded & { msg: RpcRequest };
    const initializeResponse = responseTo(group, initializeRequest.msg);
    if (!initializeResponse) throw new Error("Recorded initialize has no response");
    return { initializeRequest, initializeResponse, records: group.slice(1) };
  });
}

type Disposition = "required" | "forbidden" | "local";

interface ClientExchange {
  method: string;
  request: RpcRequest | RpcNotification;
  response: RpcResult | RpcError | null;
  before: AgentAction[];
  after: AgentAction[];
  disposition: Disposition;
  /** Why a recorded client call is not part of the consumer contract. */
  reason?: string;
}

interface AgentAction {
  kind: "notification" | "request";
  message: RpcMessage;
  /** Recorded client response to an agent request; compared as a class, not copied. */
  clientResponse?: RpcMessage;
}

interface OpenAnchor {
  method: "session/new" | "session/load" | "session/resume";
  nativeSessionId: string;
  request: RpcRequest;
  response: RpcResult;
  records: Recorded[];
  history: "replay" | "skip";
  effectiveDetach: boolean;
}

interface ListAnchor {
  method: "session/list";
  request: RpcRequest;
  response: RpcResult;
  records: Recorded[];
}

interface SessionPlan {
  connection: Connection;
  anchor: OpenAnchor;
  exchanges: ClientExchange[];
  forbidden: ClientExchange[];
}

interface ListPlan {
  connection: Connection;
  anchor: ListAnchor;
  exchanges: ClientExchange[];
}

function requestSessionId(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const sessionId = (params as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}

function responseSessionId(response: RpcResult | RpcError | null): string | null {
  if (!response || !("result" in response) || !response.result) return null;
  const result = response.result as { sessionId?: unknown };
  return typeof result.sessionId === "string" ? result.sessionId : null;
}

function sharedControlOf(response: RpcResult): {
  detach: boolean;
  implicitSteering: boolean;
  stopObservedTurn: boolean;
} {
  const result = (response.result ?? {}) as {
    _meta?: { jcode?: { sharedControl?: Record<string, unknown> } };
  };
  const control = result._meta?.jcode?.sharedControl ?? {};
  return {
    detach: control.detach === true,
    implicitSteering: control.implicitSteering === true,
    stopObservedTurn: control.stopObservedTurn === true,
  };
}

function isOpenMethod(method: string): method is OpenAnchor["method"] {
  return method === "session/new" || method === "session/load" || method === "session/resume";
}

function methodsEquivalent(actual: string, expected: string): boolean {
  return actual === expected || (actual === "session/load" && expected === "session/resume");
}

// oxlint-disable-next-line complexity -- structural parser for concatenated recordings
function connectionAnchors(connection: Connection): {
  opens: OpenAnchor[];
  lists: ListAnchor[];
} {
  const opens: OpenAnchor[] = [];
  const lists: ListAnchor[] = [];
  for (const [index, record] of connection.records.entries()) {
    if (!isRecordedRequest(record)) continue;
    const method = record.msg.method;
    if (!isOpenMethod(method) && method !== "session/list") continue;
    const response = responseTo(connection.records, record.msg);
    if (!response || !isResponse(response.msg) || !("result" in response.msg)) {
      throw new Error(`Recorded ${method} has no successful response`);
    }
    if (method === "session/list") {
      lists.push({
        method,
        request: record.msg,
        response: response.msg,
        records: [record, response],
      });
      continue;
    }
    const nativeSessionId = responseSessionId(response.msg) ?? requestSessionId(record.msg.params);
    if (!nativeSessionId) throw new Error(`Recorded ${method} has no native session id`);
    opens.push({
      method,
      nativeSessionId,
      request: record.msg,
      response: response.msg as RpcResult,
      records: [record, response],
      history: method === "session/load" ? "replay" : "skip",
      effectiveDetach: sharedControlOf(response.msg as RpcResult).detach,
    });
    void index;
  }
  // Assign every remaining record to the latest anchor that precedes it for the
  // same native session. Connection-level probes (unknown extension methods,
  // malformed detach) fall through to the active session anchor.
  const anchors = [...opens, ...lists] as Array<OpenAnchor | ListAnchor>;
  const sorted = [...anchors].sort((a, b) => a.records[0]!.seq - b.records[0]!.seq);
  for (const record of connection.records) {
    if (record.dir === "c2a" && isRequest(record.msg) && record.msg.method === "initialize") {
      continue;
    }
    if (anchors.some((anchor) => anchor.records.includes(record))) continue;
    const sessionId =
      requestSessionId((record.msg as { params?: unknown }).params) ??
      (isAgentRequest(record) ? requestSessionId(record.msg.params) : null);
    let target: OpenAnchor | ListAnchor | undefined;
    if (sessionId) {
      for (const anchor of sorted) {
        if (anchor.records[0]!.seq >= record.seq) continue;
        const candidateSession =
          "nativeSessionId" in anchor ? anchor.nativeSessionId : responseSessionId(anchor.response);
        if (candidateSession === sessionId) target = anchor;
      }
    }
    if (!target) {
      if (isResponse(record.msg)) {
        const request = requestById(connection.records, record.msg.id);
        if (request && isRequest(request.msg)) {
          target = sorted.find((anchor) =>
            anchor.records.some(
              (candidate) => isRecordedRequest(candidate) && candidate.msg.id === request.msg.id,
            ),
          );
        }
      }
    }
    if (!target) {
      for (const anchor of sorted) {
        if (anchor.records[0]!.seq < record.seq) target = anchor;
      }
    }
    if (!target) continue;
    target.records.push(record);
  }
  for (const anchor of sorted) anchor.records.sort((a, b) => a.seq - b.seq);
  return { opens, lists };
}

/**
 * The recorded client calls that Paseo deliberately never makes. The corpus is
 * shared with jcode's own conformance client; a line here is not a consumer
 * obligation, and a consumer that made it would be inventing a surface.
 */
function recordedClientDisposition(input: {
  request: { method: string; params?: unknown };
  opens: OpenAnchor[];
  duplicateIndex: number;
}): { disposition: Disposition; reason?: string } {
  const { request, opens, duplicateIndex } = input;
  const method = request.method;
  if (method === "_jcode/future") {
    return {
      disposition: "forbidden",
      reason: "no consumer extension surface exists for this key",
    };
  }
  if (method === "session/set_model" || method === "session/set_reasoning_effort") {
    return {
      disposition: "forbidden",
      reason: "the consumer uses the canonical config options (C-CONFIG-P02)",
    };
  }
  if (method === "_jcode/detach") {
    if (typeof (request.params as { sessionId?: unknown } | undefined)?.sessionId !== "string") {
      return { disposition: "forbidden", reason: "malformed detach is not a consumer request" };
    }
    const sessionId = requestSessionId(request.params);
    const open = opens.find((candidate) => candidate.nativeSessionId === sessionId);
    if (!open?.effectiveDetach) {
      return {
        disposition: "forbidden",
        reason: "effective sharedControl.detach is false",
      };
    }
    if (duplicateIndex > 0) {
      return { disposition: "local", reason: "the consumer detach is idempotent locally" };
    }
    return { disposition: "required" };
  }
  if (method === "session/close" && duplicateIndex > 0) {
    return { disposition: "local", reason: "the consumer close is idempotent locally" };
  }
  return { disposition: "required" };
}

// oxlint-disable-next-line complexity -- structural parser for interleaved exchanges
function buildExchanges(
  records: Recorded[],
  opens: OpenAnchor[],
): { exchanges: ClientExchange[]; forbidden: ClientExchange[] } {
  const exchanges: ClientExchange[] = [];
  const forbidden: ClientExchange[] = [];
  const duplicateCounts = new Map<string, number>();
  const outstanding: ClientExchange[] = [];
  const agentRequests = new Map<string | number | null, AgentAction>();
  let lastClosed: ClientExchange | null = null;

  const attach = (action: AgentAction): void => {
    const target = outstanding[0] ?? lastClosed;
    if (!target) throw new Error("Recorded agent message has no owning client exchange");
    if (target.response) target.after.push(action);
    else target.before.push(action);
  };

  for (const record of records) {
    const message = record.msg;
    if (record.dir === "c2a" && (isRequest(message) || isNotification(message))) {
      if (message.method === "initialize") continue;
      const duplicateIndex = duplicateCounts.get(message.method) ?? 0;
      duplicateCounts.set(message.method, duplicateIndex + 1);
      const disposition = recordedClientDisposition({
        request: message,
        opens,
        duplicateIndex,
      });
      const exchange: ClientExchange = {
        method: message.method,
        request: message,
        response: null,
        before: [],
        after: [],
        disposition: disposition.disposition,
        ...(disposition.reason ? { reason: disposition.reason } : {}),
      };
      if (exchange.disposition === "forbidden") {
        forbidden.push(exchange);
        continue;
      }
      exchanges.push(exchange);
      if (isRequest(message) && message.method !== "session/cancel") outstanding.push(exchange);
      continue;
    }
    if (record.dir === "a2c" && isNotification(message)) {
      attach({ kind: "notification", message });
      continue;
    }
    if (record.dir === "a2c" && isRequest(message)) {
      const action: AgentAction = { kind: "request", message };
      attach(action);
      agentRequests.set(message.id, action);
      continue;
    }
    if (record.dir === "c2a" && isResponse(message)) {
      const action = agentRequests.get(message.id);
      if (action) action.clientResponse = message;
      continue;
    }
    if (record.dir === "a2c" && isResponse(message)) {
      const index = outstanding.findIndex(
        (exchange) => "id" in exchange.request && exchange.request.id === message.id,
      );
      if (index === -1) continue;
      const [exchange] = outstanding.splice(index, 1);
      exchange.response = message as RpcResult | RpcError;
      lastClosed = exchange;
    }
  }

  // A prompt response followed by the next prompt's streamed output: the wire
  // recorded the successor request before the predecessor response because the
  // conformance client does not queue. Paseo does queue, so deliver the
  // successor's output only when the successor prompt is sent, keeping output
  // attribution intact.
  for (const [index, exchange] of exchanges.entries()) {
    if (exchange.method !== "session/prompt" || exchange.after.length === 0) continue;
    const next = exchanges[index + 1];
    if (!next || next.method !== "session/prompt") continue;
    const role = correlationRole(next.response);
    if (role === "steer") continue;
    next.before.unshift(...exchange.after);
    exchange.after = [];
  }

  return { exchanges, forbidden };
}

function correlationRole(response: RpcResult | RpcError | null): string | null {
  if (!response || !("result" in response)) return null;
  const meta = (response.result as { _meta?: { jcode?: { role?: unknown } } })?._meta?.jcode;
  return typeof meta?.role === "string" ? meta.role : null;
}

interface Fixture {
  name: FixtureName;
  records: Recorded[];
  connections: Connection[];
}

function loadFixture(name: FixtureName): Fixture {
  const records = readFixture(name);
  return { name, records, connections: splitConnections(records) };
}

interface AgentScript {
  initializeResponse: RpcResult;
  exchanges: ClientExchange[];
  forbidden: ClientExchange[];
  label: string;
}

class ReplayAgent {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly unexpected: Array<{ method: string; params: unknown }> = [];
  readonly handled = new Set<ClientExchange>();
  readonly received = new Map<ClientExchange, { method: string; params: unknown }>();
  readonly agentRequests: RpcRequest[] = [];
  readonly agentResponses: RpcMessage[] = [];
  readonly held = new Map<
    string,
    Array<{ occurrence: number; promise: Promise<void>; release(): void }>
  >();
  private readonly requestCounts = new Map<string, number>();
  private controller: ReadableStreamDefaultController<AcpStreamMessage> | null = null;
  private closed = false;
  private permissive = false;
  private readonly pendingAgentRequests = new Map<
    string | number | null,
    { resolve: (message: RpcMessage) => void }
  >();

  constructor(private readonly script: AgentScript) {}

  connector(): AcpStream {
    const readable = new ReadableStream<AcpStreamMessage>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
      },
    });
    const writable = new WritableStream<AcpStreamMessage>({
      write: (message) => {
        this.receive(message);
      },
    });
    return { readable, writable };
  }

  setPermissive(): void {
    this.permissive = true;
    for (const holds of this.held.values()) {
      for (const hold of holds) hold.release();
    }
    this.held.clear();
  }

  /**
   * Hold the response of the nth request of a method, so a test can reproduce
   * in-flight concurrency such as detach during a prompt or stop before a
   * cancelled prompt resolves.
   */
  hold(method: string, occurrence = 1): { release(): void } {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = {
      occurrence,
      promise,
      release: () => {
        release();
      },
    };
    const holds = this.held.get(method) ?? [];
    holds.push(hold);
    this.held.set(method, holds);
    return {
      release: () => {
        const current = this.held.get(method);
        if (current)
          this.held.set(
            method,
            current.filter((entry) => entry !== hold),
          );
        hold.release();
      },
    };
  }

  async waitForHandled(method: string, count = 1, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const handled = [...this.handled].filter((exchange) => exchange.method === method).length;
      if (handled >= count) return;
      await sleep(5);
    }
    throw new Error(
      `Timed out waiting for ${count} handled ${method}; handled=${[...this.handled].map((exchange) => exchange.method).join(",")}`,
    );
  }

  private receive(message: AcpStreamMessage): void {
    if ("method" in message) {
      void this.handleRequest(message);
      return;
    }
    if ("id" in message) this.agentResponses.push(message as RpcMessage);
    const pending = this.pendingAgentRequests.get(message.id);
    if (pending) {
      this.pendingAgentRequests.delete(message.id);
      pending.resolve(message as RpcMessage);
    }
  }

  private async handleRequest(
    request: AcpStreamMessage & { method: string; id?: string | number | null },
  ): Promise<void> {
    this.requests.push({ method: request.method, params: request.params });
    if (request.method === "initialize") {
      if (request.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: request.id,
          result: this.script.initializeResponse.result,
        });
      }
      return;
    }
    const exchange = this.script.exchanges.find(
      (candidate) =>
        !this.handled.has(candidate) && methodsEquivalent(request.method, candidate.method),
    );
    if (!exchange) {
      if (this.permissive && request.method === "session/close" && request.id !== undefined) {
        this.send({ jsonrpc: "2.0", id: request.id, result: {} });
        return;
      }
      this.unexpected.push({ method: request.method, params: request.params });
      if (request.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `No recorded response for ${request.method}` },
        });
      }
      return;
    }
    this.handled.add(exchange);
    this.received.set(exchange, { method: request.method, params: request.params });
    const occurrence = (this.requestCounts.get(request.method) ?? 0) + 1;
    this.requestCounts.set(request.method, occurrence);
    const holds = this.held.get(request.method);
    const hold = holds?.find((entry) => entry.occurrence === occurrence);
    if (hold)
      this.held.set(
        request.method,
        holds!.filter((entry) => entry !== hold),
      );
    if (hold) await hold.promise;
    for (const action of exchange.before) {
      if (action.kind === "notification") {
        this.send(action.message as AcpStreamMessage);
        continue;
      }
      const agentRequest = action.message as RpcRequest;
      this.agentRequests.push(agentRequest);
      const response = new Promise<RpcMessage>((resolve) => {
        this.pendingAgentRequests.set(agentRequest.id, { resolve });
      });
      this.send(agentRequest as AcpStreamMessage);
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Client did not answer agent request ${String(agentRequest.id)}`)),
          3_000,
        );
      });
      action.clientResponse = await Promise.race([response, timeout]);
    }
    if (exchange.response && request.id !== undefined) {
      if ("error" in exchange.response && exchange.response.error !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: request.id,
          error: exchange.response.error,
        });
      } else {
        this.send({
          jsonrpc: "2.0",
          id: request.id,
          result: exchange.response.result,
        });
      }
    }
    for (const action of exchange.after) {
      if (action.kind === "notification") this.send(action.message as AcpStreamMessage);
    }
  }

  private send(message: AcpStreamMessage): void {
    if (this.closed || !this.controller) return;
    try {
      this.controller.enqueue(message);
    } catch {
      this.closed = true;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReplayHarness {
  connection: ProviderConnection;
  events: ProviderEvent[];
  agents: ReplayAgent[];
  probe: ReplayAgent;
  use(script: AgentScript): void;
  probeScript: AgentScript;
  finish(): Promise<void>;
}

async function createHarness(fixture: Fixture): Promise<ReplayHarness> {
  const first = fixture.connections[0];
  if (!first) throw new Error(`${fixture.name} has no connection`);
  const probeScript = agentScriptFor(first, [], [], "probe");
  const probe = new ReplayAgent(probeScript);
  let probeReturned = false;
  let nextScript: AgentScript | null = null;
  const agents: ReplayAgent[] = [];

  const registration = runAcpProvider({
    id: "jcode-corpus",
    label: "Jcode corpus",
    connector: () => {
      if (!probeReturned) {
        probeReturned = true;
        return probe.connector();
      }
      if (!nextScript) throw new Error("No replay script was assigned to the next connection");
      const agent = new ReplayAgent(nextScript);
      agents.push(agent);
      return agent.connector();
    },
    acpOptions: { vendorTurnsAreNeverForeground: true },
    // Production order, as contributed by plugins/jcode-provider/index.server.ts.
    transformers: [jcodePeerTurns, jcodeCapabilities],
  });
  const connection = await registration.connect({
    versions: [1],
    capabilities: [...ALL_PROVIDER_CAPABILITIES],
  });
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => events.push(event));
  return {
    connection,
    events,
    agents,
    probe,
    probeScript,
    use(script: AgentScript) {
      nextScript = script;
    },
    async finish() {
      for (const current of agents) current.setPermissive();
      await connection.close();
    },
  };
}

function agentScriptFor(
  connection: Connection,
  exchanges: ClientExchange[],
  forbidden: ClientExchange[],
  label: string,
): AgentScript {
  if (!isResponse(connection.initializeResponse.msg)) {
    throw new Error("initialize response is not a response");
  }
  return {
    initializeResponse: connection.initializeResponse.msg as RpcResult,
    exchanges,
    forbidden,
    label,
  };
}

function sessionPlanFor(connection: Connection, anchor: OpenAnchor): SessionPlan {
  const { opens } = connectionAnchors(connection);
  const built = buildExchanges(anchor.records, opens);
  return { connection, anchor, exchanges: built.exchanges, forbidden: built.forbidden };
}

function listPlanFor(connection: Connection, anchor: ListAnchor): ListPlan {
  const { opens } = connectionAnchors(connection);
  const built = buildExchanges(anchor.records, opens);
  return { connection, anchor, exchanges: built.exchanges };
}

async function openSession(
  harness: ReplayHarness,
  plan: SessionPlan,
  sessionId: string,
  options: { history?: "replay" | "skip"; title?: string } = {},
): Promise<void> {
  const script = agentScriptFor(plan.connection, plan.exchanges, plan.forbidden, sessionId);
  harness.use(script);
  const persistence =
    plan.anchor.method === "session/new"
      ? undefined
      : { version: 1, data: { sessionId: plan.anchor.nativeSessionId } };
  const input: ProviderInput = {
    type: "session.open",
    requestId: `open-${sessionId}`,
    sessionId,
    config: {
      cwd: String((plan.anchor.request.params as { cwd?: string }).cwd ?? "/repo"),
      env: {},
      mcpServers: {},
      settings: {},
      persist: plan.anchor.method !== "session/new",
      ...(options.title ? { title: options.title } : {}),
    },
    ...(persistence ? { persistence } : {}),
    history: options.history ?? plan.anchor.history,
  };
  await harness.connection.send(input);
  // ProviderConnection.send schedules dispatch and returns; the boundary is
  // open only once the agent's response has been applied.
  await waitForEvent(
    harness.events,
    (event) => event.type === "session.ready" && event.sessionId === sessionId,
    `session.ready ${sessionId}`,
  );
}

async function listSessions(
  harness: ReplayHarness,
  plan: ListPlan,
  requestId: string,
): Promise<void> {
  const script = agentScriptFor(plan.connection, plan.exchanges, [], requestId);
  harness.use(script);
  await harness.connection.send({
    type: "sessions",
    requestId,
    cwd: String((plan.anchor.request.params as { cwd?: string }).cwd ?? "/repo"),
  });
  await waitForEvent(
    harness.events,
    (event) => event.type === "sessions" && event.requestId === requestId,
    `sessions ${requestId}`,
  );
}

function promptInput(
  sessionId: string,
  clientMessageId: string,
  prompt: ProviderPrompt,
): ProviderInput {
  return { type: "session.prompt", sessionId, prompt: { clientMessageId, ...prompt } };
}

async function waitForEvent(
  events: ProviderEvent[],
  predicate: (event: ProviderEvent) => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<ProviderEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await sleep(5);
  }
  throw new Error(
    `Timed out waiting for ${label}. Recent events: ${JSON.stringify(events.slice(-15))}`,
  );
}

async function waitForCount(
  events: ProviderEvent[],
  predicate: (event: ProviderEvent) => boolean,
  count: number,
  label: string,
): Promise<ProviderEvent[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const found = events.filter(predicate);
    if (found.length >= count) return found;
    await sleep(5);
  }
  throw new Error(
    `Timed out waiting for ${count} ${label}. Recent events: ${JSON.stringify(events.slice(-15))}`,
  );
}

function eventsOf<Type extends ProviderEvent["type"]>(
  events: ProviderEvent[],
  type: Type,
): Array<Extract<ProviderEvent, { type: Type }>> {
  return events.filter(
    (event): event is Extract<ProviderEvent, { type: Type }> => event.type === type,
  );
}

function assistantText(events: ProviderEvent[]): string[] {
  return eventsOf(events, "timeline.item")
    .map((event) => event.item)
    .filter(
      (item): item is Extract<typeof item, { type: "assistant_message" }> =>
        item.type === "assistant_message",
    )
    .map((item) => item.text);
}

function userText(events: ProviderEvent[]): string[] {
  return eventsOf(events, "timeline.item")
    .map((event) => event.item)
    .filter(
      (item): item is Extract<typeof item, { type: "user_message" }> =>
        item.type === "user_message",
    )
    .map((item) => item.text);
}

function terminalTurns(
  events: ProviderEvent[],
): Array<Extract<ProviderEvent, { type: "session.turn" }>> {
  return eventsOf(events, "session.turn").filter((event) => event.state !== "started");
}

function assertNoFailures(events: ProviderEvent[]): void {
  expect(eventsOf(events, "request.failed")).toEqual([]);
  expect(eventsOf(events, "session.runtime_failed")).toEqual([]);
  expect(
    eventsOf(events, "session.prompt_result").filter((event) => event.result.type === "failed"),
  ).toEqual([]);
}

/** The corpus carries no usage records; the consumer must not invent usage. */
function assertNoInventedUsage(events: ProviderEvent[]): void {
  expect(eventsOf(events, "session.usage")).toEqual([]);
}

function assertOneTerminalPerTurn(events: ProviderEvent[]): void {
  const terminals = new Map<string, number>();
  for (const event of terminalTurns(events)) {
    terminals.set(event.turnId, (terminals.get(event.turnId) ?? 0) + 1);
  }
  for (const [turnId, count] of terminals) {
    expect(count, `terminal count for ${turnId}`).toBe(1);
  }
  const starts = new Map<string, number>();
  for (const event of eventsOf(events, "session.turn")) {
    if (event.state !== "started") continue;
    starts.set(event.turnId, (starts.get(event.turnId) ?? 0) + 1);
  }
  for (const [turnId, count] of starts) {
    expect(count, `start count for ${turnId}`).toBe(1);
  }
}

interface NormalizeContext {
  fixture: FixtureName;
}

function normalizeParams(method: string, params: unknown, context: NormalizeContext): unknown {
  if (method === "initialize") return "<consumer-handshake>";
  const copy = structuredClone(params) as Record<string, unknown> | undefined;
  if (!copy) return {};
  const meta = copy._meta as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object") {
    // Consumer-owned attachment metadata is not part of the wire contract.
    delete meta._paseo;
    // Fixture 08 deliberately sends unknown prompt metadata that the legacy
    // daemon ignores; the consumer must not copy it back.
    if (context.fixture === "08-negotiation-legacy-v1.jsonl") delete meta.future;
    if (Object.keys(meta).length === 0) delete copy._meta;
  }
  if ("mcpServers" in copy) {
    const servers = copy.mcpServers;
    if (servers === null || (Array.isArray(servers) && servers.length === 0)) {
      delete copy.mcpServers;
    }
  }
  return copy;
}

function assertRecordedRequest(
  actual: { method: string; params: unknown },
  expected: ClientExchange,
  context: NormalizeContext,
): void {
  expect(
    methodsEquivalent(actual.method, expected.method),
    `outgoing method ${actual.method} matches ${expected.method}`,
  ).toBe(true);
  expect(normalizeParams(actual.method, actual.params, context)).toEqual(
    normalizeParams(expected.method, expected.request.params, context),
  );
}

function assertNoForbiddenRequests(agents: ReplayAgent[]): void {
  const requests = agents.flatMap((agent) => agent.requests);
  const methods = requests.map((request) => request.method);
  expect(methods).not.toContain("_jcode/future");
  expect(methods).not.toContain("session/set_model");
  expect(methods).not.toContain("session/set_reasoning_effort");
}

function requestsOf(agents: ReplayAgent[], method: string) {
  return agents.flatMap((agent) => agent.requests).filter((request) => request.method === method);
}

function promptTexts(agents: ReplayAgent[]): string[] {
  return requestsOf(agents, "session/prompt").map((request) => {
    const prompt = rawParams(request).prompt as Array<{ text?: string }>;
    return prompt.map((part) => part.text ?? "").join("");
  });
}

function assertAllRequiredHandled(agents: ReplayAgent[]): void {
  const allRequired = agents.flatMap((agent) =>
    agent.script.exchanges.filter((exchange) => exchange.disposition === "required"),
  );
  const allHandled = agents.flatMap((agent) => [...agent.handled]);
  expect(allHandled).toHaveLength(allRequired.length);
  expect(agents.flatMap((agent) => agent.unexpected)).toEqual([]);
}

function assertRequestsMatchCorpus(agents: ReplayAgent[], fixture: FixtureName): void {
  const context = { fixture };
  for (const agent of agents) {
    for (const [exchange, request] of agent.received) {
      assertRecordedRequest(request, exchange, context);
    }
  }
}

// ---------------------------------------------------------------------------
// Corpus identity
// ---------------------------------------------------------------------------

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("jcode ACP v1 corpus", () => {
  it("vendors the exact 12-file snapshot with a source commit and file hashes", () => {
    const names = fixtureNames(FIXTURE_DIR);
    expect(names).toEqual([...EXPECTED_FIXTURES]);
    expect(names).not.toContain("06-delivery-v1.jsonl");

    const provenancePath = path.join(VENDORED_FIXTURE_DIR, "provenance.json");
    expect(statSync(provenancePath).isFile()).toBe(true);
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as {
      sourceRepository: string;
      sourceCommit: string;
      files: Record<string, string>;
    };
    expect(provenance.sourceRepository).toBe(SOURCE_REPOSITORY);
    expect(provenance.sourceCommit).toBe(SOURCE_COMMIT);
    for (const name of names) {
      expect(provenance.files[name], `provenance entry for ${name}`).toBeTruthy();
      expect(sha256(path.join(VENDORED_FIXTURE_DIR, name)), `sha256 for ${name}`).toBe(
        provenance.files[name],
      );
    }
    expect(sha256(path.join(VENDORED_FIXTURE_DIR, "README.md"))).toBe(
      provenance.files["README.md"],
    );
  });

  it("fails instead of skipping when the corpus directory is absent", () => {
    expect(() => fixtureNames(path.join(FIXTURE_DIR, "absent-corpus"))).toThrow();
    expect(() =>
      readFixture("01-create-list-load-v1.jsonl", path.join(FIXTURE_DIR, "absent")),
    ).toThrow();
  });

  it("rejects a corpus with an unexpected file set", () => {
    // The assertion above pins the exact names. A copy that silently drops a
    // scenario or adds an unreferenced recording fails here, not in CI logs.
    expect(fixtureNames(FIXTURE_DIR)).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// 01 create, list, load
// ---------------------------------------------------------------------------

describe("01 create-list-load", () => {
  it("creates three sessions, interrupts before a prompt, lists and replays a load", async () => {
    const fixture = loadFixture("01-create-list-load-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const { opens, lists } = connectionAnchors(connection);
      const crocodileId = "session_crocodile_1794121479442_1c5fed109387852d";
      const findOpen = (method: OpenAnchor["method"], nativeSessionId: string) => {
        const found = opens.find(
          (open) => open.method === method && open.nativeSessionId === nativeSessionId,
        );
        if (!found) throw new Error(`Missing recorded ${method} for ${nativeSessionId}`);
        return found;
      };
      const crocodile = findOpen("session/new", crocodileId);
      const crocodileLoad = findOpen("session/load", crocodileId);
      const cricket = findOpen("session/new", "session_cricket_1794121479477_4fa92f58561e452d");
      const dog = findOpen("session/new", "session_dog_1794121479488_558993723dd87d2a");
      // The fixtures concatenate three session/new results on one recorded
      // connection; Paseo models each boundary session on its own ACP runtime.
      // Keep the recording's open order.
      await openSession(harness, sessionPlanFor(connection, crocodile), "b-crocodile");
      await openSession(harness, sessionPlanFor(connection, cricket), "b-cricket");
      await openSession(harness, sessionPlanFor(connection, dog), "b-dog");

      const openedSessions = eventsOf(harness.events, "session.opened");
      const recordedCwd = "/home/ctaylor/.paseo/worktrees/0wvdg91s/acp-p3-corr-detach";
      expect(openedSessions).toHaveLength(3);
      expect(
        openedSessions.map((event) => [
          event.sessionId,
          (event.persistence?.data as { sessionId?: string } | undefined)?.sessionId,
          event.cwd,
        ]),
      ).toEqual([
        ["b-crocodile", crocodile.nativeSessionId, recordedCwd],
        ["b-cricket", "session_cricket_1794121479477_4fa92f58561e452d", recordedCwd],
        ["b-dog", "session_dog_1794121479488_558993723dd87d2a", recordedCwd],
      ]);

      const crocodileOpen = await waitForEvent(
        harness.events,
        (event) => event.type === "session.opened" && event.sessionId === "b-crocodile",
        "crocodile opened",
      );
      expect(crocodileOpen.type === "session.opened" && crocodileOpen.capabilities).toContain(
        "session.detach",
      );

      // Recorded cancel before the prompt: an interrupt with no active turn.
      await harness.connection.send({
        type: "session.interrupt",
        requestId: "stop-crocodile",
        sessionId: "b-crocodile",
      });
      await harness.agents[0]!.waitForHandled("session/cancel");
      expect(requestsOf(harness.agents, "session/cancel")).toHaveLength(1);

      await harness.connection.send(
        promptInput("b-crocodile", "m-crocodile", {
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "fixture-question" }] },
        }),
      );
      await waitForCount(
        harness.events,
        (event) =>
          event.type === "session.prompt_result" && event.clientMessageId === "m-crocodile",
        1,
        "crocodile prompt result",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-crocodile",
        "crocodile turn completed",
      );
      expect(assistantText(harness.events)).toContain("fixture-answer");

      const list = lists[0]!;
      await listSessions(harness, listPlanFor(connection, list), "list-1");
      const listed = await waitForEvent(
        harness.events,
        (event) => event.type === "sessions" && event.requestId === "list-1",
        "sessions",
      );
      const sessions = listed.type === "sessions" ? listed.sessions : [];
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        cwd: "/home/ctaylor/.paseo/worktrees/0wvdg91s/acp-p3-corr-detach",
        title: "fixture-question",
        updatedAt: "2026-11-08T07:04:39Z",
        persistence: {
          version: 1,
          data: { sessionId: "session_crocodile_1794121479442_1c5fed109387852d" },
        },
      });

      const load = sessionPlanFor(connection, crocodileLoad);
      // The load anchor is a second consumer boundary session over the same
      // native session. Replay the recorded history before session.ready.
      await openSession(harness, load, "b-crocodile-load", { history: "replay" });
      const loadedItems = eventsOf(harness.events, "timeline.item").filter(
        (event) => event.sessionId === "b-crocodile-load",
      );
      expect(
        loadedItems.map((event) => [event.item.type, "text" in event.item ? event.item.text : ""]),
      ).toEqual([
        ["user_message", "fixture-question"],
        ["assistant_message", "fixture-answer"],
      ]);
      const ready = harness.events.find(
        (event) => event.type === "session.ready" && event.sessionId === "b-crocodile-load",
      );
      expect(ready).toBeTruthy();
      expect(harness.events.indexOf(loadedItems[1]!)).toBeLessThan(harness.events.indexOf(ready!));
      expect(eventsOf(harness.events, "session.opened")).toHaveLength(4);
      expect(
        assistantText(harness.events).filter((text) => text === "fixture-answer"),
      ).toHaveLength(2);
      expect(userText(harness.events).filter((text) => text === "fixture-question")).toHaveLength(
        2,
      );
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual(["acp:m-crocodile"]);

      assertNoFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertOneTerminalPerTurn(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

function assertRecordedFinalRequests(harness: ReplayHarness, fixture: FixtureName): void {
  assertRequestsMatchCorpus(harness.agents, fixture);
  assertAllRequiredHandled(harness.agents);
  assertNoForbiddenRequests(harness.agents);
}

function assertNegotiationV1(agents: ReplayAgent[]): void {
  const initializes = agents
    .flatMap((agent) => agent.requests)
    .filter((request) => request.method === "initialize");
  expect(initializes.length).toBeGreaterThan(0);
  for (const initialize of initializes) {
    expect(initialize.params).toMatchObject({ protocolVersion: 1 });
  }
}

function assertNoUnexpectedFailures(events: ProviderEvent[]): void {
  expect(eventsOf(events, "request.failed")).toEqual([]);
  expect(eventsOf(events, "session.runtime_failed")).toEqual([]);
  expect(
    eventsOf(events, "session.prompt_result").filter((event) => event.result.type === "failed"),
  ).toEqual([]);
}

function commandsOf(events: ProviderEvent[], sessionId: string) {
  const event = eventsOf(events, "session.commands").find(
    (candidate) => candidate.sessionId === sessionId,
  );
  if (!event) throw new Error(`No commands event for ${sessionId}`);
  return event.commands;
}

function lastConfig(events: ProviderEvent[], sessionId: string) {
  const configs = eventsOf(events, "session.config").filter(
    (event) => event.sessionId === sessionId,
  );
  const config = configs.at(-1);
  if (!config) throw new Error(`No config event for ${sessionId}`);
  return config.config;
}

function rawParams(request: { params: unknown }): Record<string, unknown> {
  return request.params as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 02 shared observe and steer
// ---------------------------------------------------------------------------

describe("02 shared observe-steer", () => {
  it("adopts a peer turn, steers it, and publishes one terminal and no duplicate output", async () => {
    const fixture = loadFixture("02-shared-observe-steer-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      expect(session.method).toBe("session/resume");
      await openSession(harness, sessionPlanFor(connection, session), "b-ram");

      const started = await waitForEvent(
        harness.events,
        (event) => event.type === "session.turn" && event.state === "started",
        "peer turn started",
      );
      const remoteTurnId = "404ef723-a596-4bda-adbc-a3e222a82444:1";
      const localTurnId = `acp-vendor:${remoteTurnId}`;
      expect(started.type === "session.turn" && started.turnId).toBe(localTurnId);
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "timeline.item" &&
          event.item.type === "assistant_message" &&
          event.item.text === "answer-0",
        "peer answer chunk",
      );
      expect(userText(harness.events)).toContain("first");

      await harness.connection.send(
        promptInput("b-ram", "m-steer", {
          delivery: "steer",
          input: { type: "message", content: [{ type: "text", text: "steer" }] },
        }),
      );
      const steerResult = await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-steer",
        "steer prompt result",
      );
      expect(steerResult.type === "session.prompt_result" && steerResult.result).toEqual({
        type: "steer",
        turnId: localTurnId,
      });
      await harness.agents[0]!.waitForHandled("session/prompt");
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === localTurnId,
        "peer turn completed",
      );
      await sleep(30);

      expect(userText(harness.events).filter((text) => text === "first")).toHaveLength(1);
      expect(userText(harness.events).filter((text) => text === "steer")).toHaveLength(1);
      for (const text of ["answer-0", "answer-1"]) {
        expect(assistantText(harness.events).filter((entry) => entry === text)).toHaveLength(1);
      }
      expect(assistantText(harness.events)).toEqual(["answer-0", "answer-1"]);
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual([localTurnId]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertNegotiationV1(harness.agents);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 03 stop then prompt
// ---------------------------------------------------------------------------

describe("03 stop-then-prompt", () => {
  it("cancels the pressed turn and lets the immediate successor finish normally", async () => {
    const fixture = loadFixture("03-stop-then-prompt-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      expect(session.method).toBe("session/new");
      await openSession(harness, sessionPlanFor(connection, session), "b-ram");
      const agent = harness.agents[0]!;

      const prompt = async (id: string, text: string) => {
        await harness.connection.send(
          promptInput("b-ram", id, {
            delivery: "auto",
            input: { type: "message", content: [{ type: "text", text }] },
          }),
        );
        await waitForEvent(
          harness.events,
          (event) => event.type === "session.prompt_result" && event.clientMessageId === id,
          `prompt result ${id}`,
        );
      };

      await prompt("m-first", "first");
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-first",
        "first turn completed",
      );
      await prompt("m-survive", "survive observer close");
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-survive",
        "second turn completed",
      );

      // The corpus cancels while the third prompt is in flight and records the
      // successor request before the cancelled response. Paseo queues the
      // successor until the cancellation resolves, so hold the cancelled
      // response until the Stop has reached the agent.
      const cancelled = agent.hold("session/prompt", 3);
      await prompt("m-cancel", "cancel me");
      await agent.waitForHandled("session/prompt", 3);
      await harness.connection.send({
        type: "session.interrupt",
        requestId: "stop-cancel",
        sessionId: "b-ram",
      });
      await agent.waitForHandled("session/cancel");
      expect(requestsOf(harness.agents, "session/cancel")).toHaveLength(1);
      cancelled.release();
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "canceled" &&
          event.turnId === "acp:m-cancel",
        "cancelled turn terminal",
      );
      await prompt("m-successor", "successor");
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-successor",
        "successor turn completed",
      );
      await sleep(30);

      expect(promptTexts(harness.agents)).toEqual([
        "first",
        "survive observer close",
        "cancel me",
        "successor",
      ]);
      const cancelTerminal = terminalTurns(harness.events).filter(
        (event) => event.turnId === "acp:m-cancel",
      );
      expect(cancelTerminal).toHaveLength(1);
      expect(cancelTerminal[0]!.state).toBe("canceled");
      expect(
        terminalTurns(harness.events).filter(
          (event) => event.turnId === "acp:m-successor" && event.state === "completed",
        ),
      ).toHaveLength(1);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 04 detach
// ---------------------------------------------------------------------------

describe("04 detach", () => {
  it("detaches with work in flight, withdraws only this attachment, and never closes the owner session", async () => {
    const fixture = loadFixture("04-detach-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-hamster");
      const agent = harness.agents[0]!;
      const promptHold = agent.hold("session/prompt");
      const detachHold = agent.hold("_jcode/detach");

      const promptDone = harness.connection.send(
        promptInput("b-hamster", "m-continue", {
          delivery: "auto",
          input: {
            type: "message",
            content: [{ type: "text", text: "continue after departure" }],
          },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-continue",
        "prompt admitted before detach",
      );
      await agent.waitForHandled("session/prompt");
      // Detach is in flight while this attachment's prompt is still running.
      const detachDone = harness.connection.send({
        type: "session.detach",
        requestId: "detach-1",
        sessionId: "b-hamster",
      });
      await agent.waitForHandled("_jcode/detach");
      promptHold.release();
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "canceled" &&
          event.turnId === "acp:m-continue",
        "detached prompt cancelled",
      );
      detachHold.release();
      await detachDone;
      await promptDone;
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "detach-1",
        "detach completed",
      );

      // A second detach is idempotent locally and must not reach the wire.
      await harness.connection.send({
        type: "session.detach",
        requestId: "detach-2",
        sessionId: "b-hamster",
      });
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "detach-2",
        "repeated detach completed",
      );

      const detaches = requestsOf(harness.agents, "_jcode/detach");
      expect(detaches).toHaveLength(1);
      expect(rawParams(detaches[0]!)).toEqual({
        sessionId: "session_hamster_1794121479869_fb8220ce067353a3",
      });
      expect(requestsOf(harness.agents, "session/close")).toEqual([]);
      expect(eventsOf(harness.events, "session.closed")).toEqual([]);
      const cancelled = terminalTurns(harness.events).filter(
        (event) => event.turnId === "acp:m-continue",
      );
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]!.state).toBe("canceled");
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual(["acp:m-continue"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 05 close owner-aware
// ---------------------------------------------------------------------------

describe("05 close-owner-aware", () => {
  it("closes the observer attachment without failing the owner turn and stays idempotent", async () => {
    const fixture = loadFixture("05-close-owner-aware-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      expect(session.method).toBe("session/resume");
      await openSession(harness, sessionPlanFor(connection, session), "b-lobster");

      await waitForCount(
        harness.events,
        (event) => event.type === "session.turn" && event.state === "started",
        2,
        "two peer turns started",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "canceled" &&
          event.turnId === "acp-vendor:5ca2a9ed-2a10-4cea-b2ca-e488f8f6aa74:1",
        "owner turn canceled",
      );

      await harness.connection.send({
        type: "session.close",
        requestId: "close-1",
        sessionId: "b-lobster",
      });
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "close-1",
        "close completed",
      );
      const closed = await waitForEvent(
        harness.events,
        (event) => event.type === "session.closed" && event.sessionId === "b-lobster",
        "session closed",
      );
      expect(closed.type === "session.closed" && closed.error).toBeUndefined();

      await harness.connection.send({
        type: "session.close",
        requestId: "close-2",
        sessionId: "b-lobster",
      });
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "close-2",
        "repeated close completed",
      );
      await sleep(30);

      expect(requestsOf(harness.agents, "session/close")).toHaveLength(1);
      expect(requestsOf(harness.agents, "_jcode/detach")).toEqual([]);
      expect(requestsOf(harness.agents, "session/close")[0]!.params).toEqual({
        sessionId: "session_lobster_1794126181430_12249b8ef6242c50",
      });
      const states = terminalTurns(harness.events).map((event) => event.state);
      expect(states).toEqual(["canceled", "canceled"]);
      expect(states).not.toContain("failed");
      expect(userText(harness.events).filter((text) => text === "owner close")).toHaveLength(1);
      expect(userText(harness.events).filter((text) => text === "observer close")).toHaveLength(1);
      expect(assistantText(harness.events)).toEqual(["answer-0", "answer-1"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 07 config and commands
// ---------------------------------------------------------------------------

describe("07 config-commands", () => {
  it("uses canonical config options, classifies skills, and treats a selection command as no turn", async () => {
    const fixture = loadFixture("07-config-commands-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-jaguar");

      const initial = await waitForEvent(
        harness.events,
        (event) => event.type === "session.commands" && event.sessionId === "b-jaguar",
        "initial commands",
      );
      expect(initial.type === "session.commands" && initial.commands).toHaveLength(6);
      const commands = commandsOf(harness.events, "b-jaguar");
      expect(commands.map((command) => command.name)).toEqual([
        "model",
        "models",
        "effort",
        "compact",
        "subagent",
        "optimization",
      ]);
      expect(commands.find((command) => command.name === "optimization")?.kind).toBe("skill");
      expect(commands.find((command) => command.name === "model")?.kind).toBeUndefined();

      await harness.connection.send({
        type: "session.configure",
        requestId: "config-model",
        sessionId: "b-jaguar",
        changes: { model: "mock-future-catalog" },
      });
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "config-model",
        "model configured",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.config" &&
          event.sessionId === "b-jaguar" &&
          event.config.model === "mock-future-catalog",
        "model config state",
      );

      await harness.connection.send({
        type: "session.configure",
        requestId: "config-thinking",
        sessionId: "b-jaguar",
        changes: { thinkingOption: "high" },
      });
      await waitForEvent(
        harness.events,
        (event) => event.type === "request.completed" && event.requestId === "config-thinking",
        "thinking configured",
      );
      expect(lastConfig(harness.events, "b-jaguar").thinkingOption).toBe("high");
      expect(lastConfig(harness.events, "b-jaguar").models.map((model) => model.id)).toEqual([
        "mock-initial",
        "mock-future-catalog",
      ]);
      expect(
        lastConfig(harness.events, "b-jaguar").thinkingOptions.map((option) => option.id),
      ).toEqual(["low", "medium", "high"]);

      const configRequests = requestsOf(harness.agents, "session/set_config_option");
      expect(configRequests.map((request) => rawParams(request))).toEqual([
        {
          sessionId: "session_jaguar_1794126273784_38322e1870c4845f",
          configId: "model",
          value: "mock-future-catalog",
        },
        {
          sessionId: "session_jaguar_1794126273784_38322e1870c4845f",
          configId: "reasoning_effort",
          value: "high",
        },
      ]);
      expect(requestsOf(harness.agents, "session/set_model")).toEqual([]);
      expect(requestsOf(harness.agents, "session/set_reasoning_effort")).toEqual([]);

      await harness.connection.send(
        promptInput("b-jaguar", "m-model-command", {
          delivery: "auto",
          input: { type: "command", name: "model", arguments: "" },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.prompt_result" && event.clientMessageId === "m-model-command",
        "command prompt result",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-model-command",
        "command turn completed",
      );
      const promptRequest = requestsOf(harness.agents, "session/prompt")[0]!;
      expect(rawParams(promptRequest).prompt).toEqual([{ type: "text", text: "/model" }]);
      expect(rawParams(promptRequest)._meta).toBeUndefined();
      expect(assistantText(harness.events)).toEqual(["Current model: `mock-future-catalog`"]);
      // role "none" means no shared turn ran; only the local command bracket exists.
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual(["acp:m-model-command"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 08 negotiation and legacy refusal
// ---------------------------------------------------------------------------

describe("08 negotiation-legacy", () => {
  it("negotiates v1, honors refused shared control, ignores unknown metadata, and never sends unsupported actions", async () => {
    const fixture = loadFixture("08-negotiation-legacy-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      expect(session.effectiveDetach).toBe(false);
      await openSession(harness, sessionPlanFor(connection, session), "b-legacy");
      const opened = await waitForEvent(
        harness.events,
        (event) => event.type === "session.opened" && event.sessionId === "b-legacy",
        "legacy session opened",
      );
      const capabilities = opened.type === "session.opened" ? opened.capabilities : [];
      expect(capabilities).not.toContain("session.detach");
      expect(capabilities).not.toContain("prompt.steer");
      expect(capabilities).toContain("session.shared_turns");

      const prompt = async (id: string) => {
        await harness.connection.send(
          promptInput("b-legacy", id, {
            delivery: "auto",
            input: { type: "message", content: [{ type: "text", text: "legacy prompt" }] },
          }),
        );
        await waitForEvent(
          harness.events,
          (event) => event.type === "session.prompt_result" && event.clientMessageId === id,
          `legacy prompt result ${id}`,
        );
        await waitForEvent(
          harness.events,
          (event) =>
            event.type === "session.turn" &&
            event.state === "completed" &&
            event.turnId === `acp:${id}`,
          `legacy turn ${id}`,
        );
      };
      await prompt("m-legacy-1");
      await prompt("m-legacy-2");

      const prompts = requestsOf(harness.agents, "session/prompt");
      expect(prompts).toHaveLength(2);
      // The corpus records unknown prompt metadata on the second prompt; the
      // legacy daemon ignores it and the consumer must not invent or echo it.
      for (const request of prompts) expect(rawParams(request)._meta).toBeUndefined();

      // Unsupported actions are rejected locally, before any wire call, so a
      // legacy daemon's negative reply is never provoked by a differently
      // meaning request.
      await expect(
        harness.connection.send({
          type: "session.detach",
          requestId: "detach-unsupported",
          sessionId: "b-legacy",
        }),
      ).rejects.toThrow(/session\.detach/);
      await expect(
        harness.connection.send(
          promptInput("b-legacy", "m-steer-unsupported", {
            delivery: "steer",
            input: { type: "message", content: [{ type: "text", text: "steer" }] },
          }),
        ),
      ).rejects.toThrow(/prompt\.steer/);
      await sleep(30);

      expect(requestsOf(harness.agents, "session/prompt")).toHaveLength(2);
      expect(requestsOf(harness.agents, "_jcode/detach")).toEqual([]);
      expect(requestsOf(harness.agents, "session/close")).toEqual([]);
      expect(requestsOf(harness.agents, "_jcode/future")).toEqual([]);
      expect(assistantText(harness.events)).toEqual(["legacy answer", "legacy answer"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertNegotiationV1(harness.agents);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 09 elicitation form
// ---------------------------------------------------------------------------

describe("09 elicitation-form", () => {
  it("answers an unsupported client request without fabricating consent and finishes the turn", async () => {
    const fixture = loadFixture("09-elicitation-form-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-calf");
      await harness.connection.send(
        promptInput("b-calf", "m-form", {
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "Ask a form" }] },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-form",
        "form prompt result",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-form",
        "form turn completed",
      );
      const agent = harness.agents[0]!;
      expect(agent.agentRequests.map((request) => request.method)).toEqual([
        "elicitation/create",
        "elicitation/create",
      ]);
      expect(agent.agentResponses).toHaveLength(2);
      for (const response of agent.agentResponses) {
        // Paseo does not advertise form elicitation, so it must not answer
        // with the corpus client's scripted accept payload.
        expect("error" in response).toBe(true);
        expect(response).not.toMatchObject({ result: { action: "accept" } });
      }
      expect(assistantText(harness.events)).toContain("form-finished");
      const toolItems = eventsOf(harness.events, "timeline.item")
        .map((event) => event.item)
        .filter((item) => item.type === "tool_call" && item.callId === "form-call");
      expect(toolItems.length).toBeGreaterThan(1);
      const tool = toolItems.at(-1);
      expect(tool).toMatchObject({ status: "completed", name: "applet" });
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual(["acp:m-form"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 09 mid-turn attach
// ---------------------------------------------------------------------------

describe("09 midturn-attach", () => {
  it("observes one peer bracket that opens before the attach response and closes once", async () => {
    const fixture = loadFixture("09-midturn-attach-v1.jsonl");
    expect(fixture.connections).toHaveLength(2);
    expect(connectionAnchors(fixture.connections[1]!).opens).toHaveLength(0);
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-bear");
      const remoteTurnId = "b4384842-938d-45a1-9fc5-c3c35b78ecad:1";
      const localTurnId = `acp-vendor:${remoteTurnId}`;
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === localTurnId,
        "mid-turn vendor bracket completed",
      );
      const starts = eventsOf(harness.events, "session.turn").filter(
        (event) => event.turnId === localTurnId && event.state === "started",
      );
      expect(starts).toHaveLength(1);
      expect(
        terminalTurns(harness.events).filter((event) => event.turnId === localTurnId),
      ).toHaveLength(1);
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual([localTurnId]);
      expect(eventsOf(harness.events, "timeline.item")).toEqual([]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 10 reverse steer
// ---------------------------------------------------------------------------

describe("10 reverse-steer", () => {
  it("shows a peer-inserted user chunk before its affected output without duplicating the own turn", async () => {
    const fixture = loadFixture("10-reverse-steer-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-hatchling");
      await harness.connection.send(
        promptInput("b-hatchling", "m-own", {
          delivery: "auto",
          input: { type: "message", content: [{ type: "text", text: "own-question" }] },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-own",
        "own prompt result",
      );
      await waitForEvent(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          event.turnId === "acp:m-own",
        "own turn completed",
      );

      const orderedUser = userText(harness.events);
      expect(orderedUser).toEqual(["own-question", "reverse-steer-marker"]);
      expect(orderedUser.filter((text) => text === "own-question")).toHaveLength(1);
      expect(orderedUser.filter((text) => text === "reverse-steer-marker")).toHaveLength(1);
      expect(assistantText(harness.events)).toEqual(["before-steer", "after-steer"]);

      const timelineTexts = eventsOf(harness.events, "timeline.item").map((event) => event.item);
      const reverseIndex = timelineTexts.findIndex(
        (item) => item.type === "user_message" && item.text === "reverse-steer-marker",
      );
      const afterIndex = timelineTexts.findIndex(
        (item) => item.type === "assistant_message" && item.text === "after-steer",
      );
      expect(reverseIndex).toBeGreaterThan(-1);
      expect(afterIndex).toBeGreaterThan(reverseIndex);
      // The peer chunk carries the :steer: message identity; the consumer keeps
      // it as a distinct item instead of appending it to its own user message.
      const reverseItem = timelineTexts[reverseIndex];
      expect(reverseItem && "messageId" in reverseItem ? reverseItem.messageId : undefined).toBe(
        "session_hatchling_1794177670964_b673e0a80aa0c8b5:own:11841415372706152450:steer:0",
      );
      expect([
        ...new Set(eventsOf(harness.events, "session.turn").map((event) => event.turnId)),
      ]).toEqual(["acp:m-own"]);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 11 repeated load replay
// ---------------------------------------------------------------------------

describe("11 import-repeated-user-replay", () => {
  it("replays equal stored user rows twice with stable order and distinct message identities", async () => {
    const fixture = loadFixture("11-import-repeated-user-replay-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const opens = connectionAnchors(connection).opens;
      expect(opens).toHaveLength(2);
      expect(opens.every((open) => open.method === "session/load")).toBe(true);
      const nativeSessionId = opens[0]!.nativeSessionId;
      expect(opens[1]!.nativeSessionId).toBe(nativeSessionId);

      await openSession(harness, sessionPlanFor(connection, opens[0]!), "b-humpback-1", {
        history: "replay",
      });
      await openSession(harness, sessionPlanFor(connection, opens[1]!), "b-humpback-2", {
        history: "replay",
      });

      const itemsFor = (sessionId: string) =>
        eventsOf(harness.events, "timeline.item").filter((event) => event.sessionId === sessionId);
      const first = itemsFor("b-humpback-1");
      expect(
        first.map((event) => [event.item.type, "text" in event.item ? event.item.text : ""]),
      ).toEqual([
        ["user_message", "first-user-marker"],
        ["assistant_message", "answer"],
        ["user_message", "first-user-marker"],
        ["assistant_message", "answer"],
      ]);
      const firstIds = first.map((event) => event.item.id);
      expect(new Set(firstIds).size).toBe(4);
      expect(firstIds[0]).not.toBe(firstIds[2]);

      const second = itemsFor("b-humpback-2");
      expect(
        second.map((event) => [event.item.type, "text" in event.item ? event.item.text : ""]),
      ).toEqual([
        ["user_message", "first-user-marker"],
        ["assistant_message", "answer"],
        ["user_message", "first-user-marker"],
        ["assistant_message", "answer"],
      ]);
      expect(new Set(second.map((event) => event.item.id)).size).toBe(4);
      expect(commandsOf(harness.events, "b-humpback-2")).toHaveLength(6);

      const loads = requestsOf(harness.agents, "session/load");
      expect(loads).toHaveLength(2);
      for (const load of loads) {
        expect(rawParams(load)).toMatchObject({ sessionId: nativeSessionId });
      }
      const opened = eventsOf(harness.events, "session.opened");
      expect(opened.map((event) => [event.sessionId, event.restoration])).toEqual([
        ["b-humpback-1", "core"],
        ["b-humpback-2", "core"],
      ]);
      expect(opened.map((event) => event.persistence?.data)).toEqual([
        { sessionId: nativeSessionId },
        { sessionId: nativeSessionId },
      ]);
      expect(eventsOf(harness.events, "session.turn")).toEqual([]);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});

// ---------------------------------------------------------------------------
// 12 skill selection and clear
// ---------------------------------------------------------------------------

describe("12 skill-selection-clear", () => {
  it("sends explicit, omitted and null skill metadata in the recorded wire shapes", async () => {
    const fixture = loadFixture("12-skill-selection-clear-v1.jsonl");
    const harness = await createHarness(fixture);
    try {
      const connection = fixture.connections[0]!;
      const session = connectionAnchors(connection).opens[0]!;
      await openSession(harness, sessionPlanFor(connection, session), "b-frog");

      await harness.connection.send(
        promptInput("b-frog", "m-explicit", {
          delivery: "auto",
          skill: "interrogate",
          input: { type: "message", content: [{ type: "text", text: "" }] },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-explicit",
        "explicit skill result",
      );

      const commands = await waitForEvent(
        harness.events,
        (event) => event.type === "session.commands" && event.sessionId === "b-frog",
        "skill commands",
      );
      const classified = commands.type === "session.commands" ? commands.commands : [];
      expect(classified.find((command) => command.name === "interrogate")?.kind).toBe("skill");
      expect(classified.find((command) => command.name === "model")?.kind).toBeUndefined();

      await harness.connection.send(
        promptInput("b-frog", "m-textual", {
          delivery: "auto",
          input: { type: "command", name: "interrogate", arguments: "" },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-textual",
        "textual skill result",
      );

      await harness.connection.send(
        promptInput("b-frog", "m-clear", {
          delivery: "auto",
          skill: null,
          input: { type: "message", content: [{ type: "text", text: "" }] },
        }),
      );
      await waitForEvent(
        harness.events,
        (event) => event.type === "session.prompt_result" && event.clientMessageId === "m-clear",
        "clear skill result",
      );
      await waitForCount(
        harness.events,
        (event) =>
          event.type === "session.turn" &&
          event.state === "completed" &&
          (event.turnId === "acp:m-explicit" ||
            event.turnId === "acp:m-textual" ||
            event.turnId === "acp:m-clear"),
        3,
        "skill prompt terminals",
      );

      const prompts = requestsOf(harness.agents, "session/prompt");
      expect(prompts).toHaveLength(3);
      expect(rawParams(prompts[0]!)._meta).toEqual({ jcode: { skill: "interrogate" } });
      expect(rawParams(prompts[0]!).prompt).toEqual([{ type: "text", text: "" }]);
      expect(rawParams(prompts[1]!)._meta).toBeUndefined();
      expect(rawParams(prompts[1]!).prompt).toEqual([{ type: "text", text: "/interrogate" }]);
      expect(rawParams(prompts[2]!)._meta).toEqual({ jcode: { skill: null } });
      expect(rawParams(prompts[2]!).prompt).toEqual([]);

      const assistant = assistantText(harness.events);
      expect(assistant).toHaveLength(2);
      expect(assistant[0]).toMatch(/^Activated skill: interrogate/);
      expect(assistant[1]).toMatch(/^Activated skill: interrogate/);
      // Clearing is selection-only: no activation notice and no model output.
      const clearItems = eventsOf(harness.events, "timeline.item").filter(
        (event) => event.sessionId === "b-frog" && event.item.type === "assistant_message",
      );
      expect(clearItems).toHaveLength(2);
      expect(assistantText(harness.events).some((text) => text.includes("clear"))).toBe(false);
      expect(
        eventsOf(harness.events, "session.turn").every((event) => event.turnId.startsWith("acp:")),
      ).toBe(true);
      assertOneTerminalPerTurn(harness.events);
      assertNoUnexpectedFailures(harness.events);
      assertNoInventedUsage(harness.events);
      assertRecordedFinalRequests(harness, fixture.name);
    } finally {
      await harness.finish();
    }
  });
});
