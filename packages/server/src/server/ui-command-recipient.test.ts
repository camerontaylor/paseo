import { expect, test } from "vitest";
import { isTrustedUiCommandRecipient } from "./websocket-server.js";

const ownerRecipient = {
  lifecycle: "reconnectable",
  principalId: "owner",
  expectedPrincipalId: "owner",
  uiCommands: true,
  isOriginSocket: false,
};

test("UI command delivery requires the same principal and explicit capability", () => {
  expect(isTrustedUiCommandRecipient(ownerRecipient)).toBe(true);
  expect(isTrustedUiCommandRecipient({ ...ownerRecipient, principalId: "workspace-reader" })).toBe(
    false,
  );
  expect(isTrustedUiCommandRecipient({ ...ownerRecipient, uiCommands: false })).toBe(false);
  expect(isTrustedUiCommandRecipient({ ...ownerRecipient, uiCommands: undefined })).toBe(false);
  expect(isTrustedUiCommandRecipient({ ...ownerRecipient, isOriginSocket: true })).toBe(false);
  expect(isTrustedUiCommandRecipient({ ...ownerRecipient, lifecycle: "ephemeral-plugin" })).toBe(
    false,
  );
});
