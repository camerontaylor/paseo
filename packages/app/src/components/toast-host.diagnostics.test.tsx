/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setClientDiagnosticSink } from "@/diagnostics/client-errors/record";
import { useToastHost } from "./toast-host";

let uninstallSink: (() => void) | null = null;
afterEach(() => uninstallSink?.());

describe("toast diagnostics", () => {
  it("records every error and warning toast the person sees, and nothing else", () => {
    const recorded: Array<{ source: string; severity?: string; message: unknown }> = [];
    uninstallSink = setClientDiagnosticSink((input) => recorded.push(input));
    const { result } = renderHook(() => useToastHost());
    act(() => result.current.api.error("Private prompt: secret task"));
    act(() => result.current.api.show("Private message body", { variant: "warning" }));
    act(() => result.current.api.show("Copied", { variant: "success" }));
    expect(recorded).toEqual([
      expect.objectContaining({
        source: "toast",
        severity: "error",
        message: "Error shown",
      }),
      expect.objectContaining({
        source: "toast",
        severity: "warning",
        message: "Warning shown",
      }),
    ]);
  });
});
