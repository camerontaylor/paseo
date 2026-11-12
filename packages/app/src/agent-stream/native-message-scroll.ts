import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";

export function createNativeMessageScroller(input: {
  getRows: () => readonly StreamItem[];
  detach: () => void;
  scrollToIndex: (index: number) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frame: number) => void;
}) {
  let frame: number | null = null;
  const dispose = () => {
    if (frame !== null) input.cancelFrame(frame);
    frame = null;
  };
  return {
    dispose,
    scrollToMessage(messageId: string) {
      dispose();
      const matches = (item: StreamItem) =>
        item.id === messageId || getStreamItemMessageId(item) === messageId;
      if (!input.getRows().some(matches)) return;
      input.detach();
      // The native end pin must unmount before the imperative jump reaches the scroll view.
      frame = input.requestFrame(() => {
        frame = null;
        const index = input.getRows().findIndex(matches);
        if (index >= 0) input.scrollToIndex(index);
      });
    },
  };
}
