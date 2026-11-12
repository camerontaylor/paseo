import { describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import { createNativeMessageScroller } from "./native-message-scroll";

const message = (id: string) => ({ kind: "user_message", id }) as StreamItem;

function harness(initialRows: StreamItem[]) {
  let rows = initialRows;
  let nextFrame = 0;
  const frames = new Map<number, () => void>();
  const order: string[] = [];
  const detach = vi.fn(() => order.push("detach"));
  const scrollToIndex = vi.fn((index: number) => order.push(`scroll:${index}`));
  const scroller = createNativeMessageScroller({
    getRows: () => rows,
    detach,
    scrollToIndex,
    requestFrame: (callback) => {
      const frame = ++nextFrame;
      frames.set(frame, callback);
      return frame;
    },
    cancelFrame: (frame) => { frames.delete(frame); },
  });
  return {
    ...scroller, detach, scrollToIndex, order,
    setRows: (next: StreamItem[]) => { rows = next; },
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    },
  };
}

describe("native message scrolling", () => {
  it.each([["history", 0], ["live", 2], ["source", 1]] as const)(
    "addresses %s in forward combined list order",
    (id, index) => {
      const h = harness([
        message("history"),
        { kind: "plugin", id: "replacement", sourceId: "source" } as StreamItem,
        message("live"),
      ]);
      h.scrollToMessage(id);
      expect(h.order).toEqual(["detach"]);
      h.flush();
      expect(h.order).toEqual(["detach", `scroll:${index}`]);
    },
  );

  it("resolves the latest row index after the pin release commits", () => {
    const h = harness([message("first"), message("target")]);
    h.scrollToMessage("target");
    h.setRows([message("older"), message("first"), message("target")]);
    h.flush();
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("cancels an earlier search jump when another match is selected", () => {
    const h = harness([message("first"), message("second")]);
    h.scrollToMessage("first");
    h.scrollToMessage("second");
    h.flush();
    expect(h.scrollToIndex).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("ignores missing or removed rows", () => {
    const h = harness([message("target")]);
    h.scrollToMessage("missing");
    expect(h.detach).not.toHaveBeenCalled();
    h.scrollToMessage("target");
    h.setRows([]);
    h.flush();
    expect(h.scrollToIndex).not.toHaveBeenCalled();
  });

  it("cancels a pending jump when the viewport is disposed", () => {
    const h = harness([message("target")]);
    h.scrollToMessage("target");
    h.dispose();
    h.flush();
    expect(h.scrollToIndex).not.toHaveBeenCalled();
  });
});
