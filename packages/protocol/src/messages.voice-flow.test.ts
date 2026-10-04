import { describe, expect, it } from "vitest";

import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages";

describe("voice attachment and failure wire contract", () => {
  it("continues accepting legacy voice frames without attachment fields", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "voice_audio_chunk",
        audio: "AA==",
        format: "pcm",
        isLast: false,
      }),
    ).toEqual({ type: "voice_audio_chunk", audio: "AA==", format: "pcm", isLast: false });
    expect(SessionInboundMessageSchema.parse({ type: "abort_request" })).toEqual({
      type: "abort_request",
    });
    expect(SessionInboundMessageSchema.parse({ type: "audio_played", id: "clip" })).toEqual({
      type: "audio_played",
      id: "clip",
    });
    expect(SessionInboundMessageSchema.parse({ type: "set_voice_mode", enabled: true })).toEqual({
      type: "set_voice_mode",
      enabled: true,
    });
  });

  it("accepts attachment identity and transport generations on voice frames", () => {
    const chunk = {
      type: "voice_audio_chunk",
      audio: "AA==",
      format: "pcm",
      isLast: false,
      attachmentId: "attachment",
      generation: "g2",
    };
    expect(SessionInboundMessageSchema.parse(chunk)).toEqual(chunk);
    expect(
      SessionInboundMessageSchema.parse({
        type: "audio_played",
        id: "clip",
        error: "Audio playback timed out",
        attachmentId: "attachment",
        generation: "g2",
      }),
    ).toEqual({
      type: "audio_played",
      id: "clip",
      error: "Audio playback timed out",
      attachmentId: "attachment",
      generation: "g2",
    });
  });

  it("registers the voice receipt read RPC on the session unions", () => {
    const request = {
      type: "voice.input.receipts.read.request",
      requestId: "r",
      agentId: "agent-1",
      attachmentId: "attachment",
      generation: "g2",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  it("keeps recognition issues a plain string so later hosts can extend them", () => {
    const issue = {
      type: "voice_input_state",
      payload: { isSpeaking: false, recognitionIssue: "timed_out" },
    };
    expect(SessionOutboundMessageSchema.parse(issue)).toEqual(issue);
    // A value a later host adds must not make an older client reject the message.
    expect(
      SessionOutboundMessageSchema.parse({
        type: "voice_input_state",
        payload: { isSpeaking: false, recognitionIssue: "a_later_issue" },
      }).payload.recognitionIssue,
    ).toBe("a_later_issue");
  });

  it("advertises the voice concurrent input feature as optional", () => {
    const status = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "daemon-1",
      features: { voiceConcurrentInput: true },
    });
    expect(status.features?.voiceConcurrentInput).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "daemon-1",
        features: {},
      }).features?.voiceConcurrentInput,
    ).toBeUndefined();
  });
});
