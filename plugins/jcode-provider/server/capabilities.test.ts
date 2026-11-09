import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import { describe, expect, it } from "vitest";
import { jcodeCapabilities } from "./capabilities.js";

type InitializeInfo = Parameters<NonNullable<AcpTransformer["initialize"]>>[0];
type AttachmentInfo = Parameters<NonNullable<AcpTransformer["attach"]>>[0];

const agentCapabilities = {
  _meta: {
    jcode: {
      interfaceVersion: 1,
      profile: "standard",
      extensions: ["shared_control", "peer_turns"],
      sessionMcpServers: false,
    },
  },
};

const response = {
  sessionId: "native-session",
  _meta: {
    jcode: {
      clientInstanceId: "attachment-1",
      sharedControl: {
        observe: true,
        detach: true,
        implicitSteering: true,
        stopObservedTurn: true,
      },
    },
  },
};

function initialize(value: InitializeInfo["agentCapabilities"]) {
  return jcodeCapabilities.initialize?.({ agentCapabilities: value });
}

function attach(value: AttachmentInfo["response"], capabilities = agentCapabilities) {
  return jcodeCapabilities.attach?.(
    { response: value },
    { sessionId: "session-1", agentCapabilities: capabilities },
  );
}

describe("jcodeCapabilities", () => {
  it("reads versioned adapter support and effective attachment support", () => {
    expect(initialize(agentCapabilities)).toEqual({
      echoesUserMessages: false,
      steering: true,
      sendSessionMcpServers: false,
    });
    // The contract deliberately carries no interfaceVersion on the attachment.
    expect(attach(response)).toEqual({ steering: true, stopObservedTurns: true });
  });

  it("ignores unknown keys and extension names", () => {
    expect(
      initialize({
        future: true,
        _meta: {
          future: {},
          jcode: {
            ...agentCapabilities._meta.jcode,
            future: [],
            extensions: ["future_extension", "shared_control"],
          },
        },
      }),
    ).toEqual({ echoesUserMessages: false, steering: true, sendSessionMcpServers: false });
    expect(
      attach({
        _meta: {
          jcode: {
            future: true,
            sharedControl: { implicitSteering: true, stopObservedTurn: true, future: {} },
          },
        },
      }),
    ).toEqual({ steering: true, stopObservedTurns: true });
  });

  it("requires true capability flags and leaves supported MCP handling alone", () => {
    expect(
      initialize({
        _meta: { jcode: { interfaceVersion: 1, extensions: [], sessionMcpServers: true } },
      }),
    ).toEqual({ echoesUserMessages: false, steering: false });
    expect(initialize({ _meta: { jcode: { interfaceVersion: 1 } } })).toEqual({
      echoesUserMessages: false,
      steering: false,
    });
    expect(
      attach({
        _meta: { jcode: { sharedControl: { implicitSteering: false, stopObservedTurn: false } } },
      }),
    ).toEqual({ steering: false, stopObservedTurns: false });
    expect(attach({ _meta: { jcode: {} } })).toEqual({
      steering: false,
      stopObservedTurns: false,
    });
  });

  it("does not retain initialize state between attachments", () => {
    expect(initialize(agentCapabilities)).not.toBeNull();
    expect(
      jcodeCapabilities.attach?.({ response }, { sessionId: "old-binary-session" }),
    ).toBeNull();
    expect(attach(response)).toEqual({ steering: true, stopObservedTurns: true });
  });

  const malformedCapabilities: InitializeInfo["agentCapabilities"][] = [
    null,
    [],
    "jcode",
    {},
    { _meta: null },
    { _meta: { jcode: null } },
    { _meta: { jcode: {} } },
    { _meta: { jcode: { interfaceVersion: 2 } } },
    { _meta: { jcode: { interfaceVersion: "1" } } },
    { _meta: { jcode: { interfaceVersion: 1, extensions: "shared_control" } } },
    { _meta: { jcode: { interfaceVersion: 1, extensions: [1] } } },
    { _meta: { jcode: { interfaceVersion: 1, sessionMcpServers: "false" } } },
  ];

  it.each(malformedCapabilities)("ignores absent or malformed initialize metadata: %j", (value) => {
    expect(initialize(value)).toBeNull();
    expect(
      jcodeCapabilities.attach?.(
        { response },
        { sessionId: "session-1", agentCapabilities: value },
      ),
    ).toBeNull();
  });

  const malformedAttachments: AttachmentInfo["response"][] = [
    null,
    [],
    {},
    { _meta: null },
    { _meta: { jcode: [] } },
    { _meta: { jcode: { sharedControl: null } } },
    { _meta: { jcode: { sharedControl: { implicitSteering: "true" } } } },
    { _meta: { jcode: { sharedControl: { stopObservedTurn: 1 } } } },
  ];

  it.each(malformedAttachments)("ignores malformed attachment metadata: %j", (value) => {
    expect(attach(value)).toBeNull();
  });
});
