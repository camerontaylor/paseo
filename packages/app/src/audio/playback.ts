/** One queue for voice and plugin audio, including cancellation while loading. */
export function createPlaybackQueue<Source>(
  start: (source: Source, signal: AbortSignal) => Promise<number>,
  onIdle: () => void = () => {},
) {
  interface Item {
    source: Source;
    controller: AbortController;
    resolve: (duration: number) => void;
    reject: (error: unknown) => void;
    release: () => void;
  }
  const pending: Item[] = [];
  let active: Item | null = null;
  let destroyed = false;

  async function drain() {
    if (active) return;
    const item = pending.shift();
    if (!item) {
      onIdle();
      return;
    }
    active = item;
    try {
      if (item.controller.signal.aborted) throw new Error("Playback stopped");
      // Decoding can outlive cancellation. Release this owner immediately;
      // the engine checks the same signal before starting prepared audio.
      let cancelPlayback: () => void = () => {};
      const canceled = new Promise<never>((_resolve, reject) => {
        cancelPlayback = () => reject(new Error("Playback stopped"));
        item.controller.signal.addEventListener("abort", cancelPlayback, { once: true });
      });
      try {
        item.resolve(await Promise.race([start(item.source, item.controller.signal), canceled]));
      } finally {
        item.controller.signal.removeEventListener("abort", cancelPlayback);
      }
    } catch (error) {
      item.reject(error);
    } finally {
      item.release();
      active = null;
      void drain();
    }
  }

  const stopped = () => new Error("Playback stopped");
  return {
    play(source: Source, signal?: AbortSignal): Promise<number> {
      if (destroyed) return Promise.reject(new Error("Audio engine destroyed"));
      if (signal?.aborted) return Promise.reject(new Error("Playback stopped"));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const cancel = () => {
          controller.abort();
          const index = pending.indexOf(item);
          if (index !== -1) {
            pending.splice(index, 1);
            item.release();
            reject(new Error("Playback stopped"));
          }
        };
        const item: Item = {
          source,
          controller,
          resolve,
          reject,
          release: () => signal?.removeEventListener("abort", cancel),
        };
        signal?.addEventListener("abort", cancel, { once: true });
        pending.push(item);
        void drain();
      });
    },
    stop() {
      active?.controller.abort();
    },
    clearQueue() {
      for (const item of pending.splice(0)) {
        item.release();
        item.reject(stopped());
      }
    },
    isPlaying: () => active !== null,
    destroy() {
      destroyed = true;
      this.clearQueue();
      this.stop();
    },
  };
}
