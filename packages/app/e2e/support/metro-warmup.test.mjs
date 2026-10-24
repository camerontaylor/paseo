import { describe, expect, it, vi } from "vitest";
import { resolveMetroWarmupTimeoutMs, warmMetro } from "./metro-warmup.mjs";

describe("Metro warmup", () => {
  it("uses a bounded override and preserves the existing default", () => {
    expect(resolveMetroWarmupTimeoutMs(undefined)).toBe(120_000);
    expect(resolveMetroWarmupTimeoutMs("600000")).toBe(600_000);
    for (const value of ["0", "-1", "1.5", "Infinity", "600001", "abc"]) {
      expect(() => resolveMetroWarmupTimeoutMs(value)).toThrow();
    }
  });

  it("drains same-origin script chunks without buffering the whole bundle", async () => {
    let bytesRead = 0;
    const script = {
      ok: true,
      status: 200,
      arrayBuffer: () => {
        throw new Error("whole bundle buffered");
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          bytesRead += 2;
          controller.enqueue(new Uint8Array([3, 4, 5]));
          bytesRead += 3;
          controller.close();
        },
      }),
    };
    const fetchImpl = vi.fn(async (url) => {
      if (new URL(url).pathname === "/") {
        return new Response(
          '<script src="/bundle?private=secret"></script><script src="https://elsewhere.test/skip"></script>',
        );
      }
      return script;
    });
    await warmMetro(12345, { timeoutMs: 1000, fetchImpl });
    expect(bytesRead).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports only pathname, elapsed time and consumed bytes on a stalled stream", async () => {
    const fetchImpl = async (url, { signal }) => {
      if (new URL(url).pathname === "/") {
        return new Response('<script src="/bundle?private=secret"></script>');
      }
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
          },
        }),
      };
    };
    await expect(warmMetro(12345, { timeoutMs: 20, fetchImpl })).rejects.toThrow(
      /Metro warmup timed out for \/bundle after \d+ms \(3 bytes received; limit 20ms\)/,
    );
    try {
      await warmMetro(12345, { timeoutMs: 20, fetchImpl });
    } catch (error) {
      expect(error.message).not.toContain("secret");
    }
  });
});
