import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import xterm, { type Terminal } from "@xterm/headless";

export interface HeadlessTerminalOptions {
  rows: number;
  cols: number;
  scrollback?: number;
}

/**
 * A headless xterm that measures text the way Paseo clients render it.
 *
 * Grapheme-cluster widths give every emoji cluster (VS16, skin-tone, flags,
 * ZWJ sequences) one two-column cell, matching color-emoji fonts. Clients
 * replay this buffer's ANSI with the same table, so cells and the cursor line
 * up after reconnect. See docs/terminal-rendering.md.
 */
export function createHeadlessTerminal(options: HeadlessTerminalOptions): Terminal {
  const terminal = new xterm.Terminal({ ...options, allowProposedApi: true });
  terminal.loadAddon(new UnicodeGraphemesAddon());
  return terminal;
}

/**
 * Drain xterm's queued writes into the parsed buffer.
 *
 * `write()` queues the data and parses it on a timer, so a process that
 * writes and exits in the same tick leaves its final output unparsed. Disposing
 * drops that queue, and the replay then serializes an empty buffer forever.
 * `_writeBuffer.flushSync` is xterm's own drain path (it is what `resize`
 * calls); the headless build exposes no public equivalent.
 */
export function flushHeadlessTerminal(terminal: Terminal): void {
  const core = (
    terminal as unknown as {
      _core: { _writeBuffer: { flushSync(): void } };
    }
  )._core;
  core._writeBuffer.flushSync();
}
