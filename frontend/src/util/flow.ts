import type { FlowStatus } from "../protocol.js";

/**
 * Whether a run has the deck.
 *
 * Note(yoochan.kim): the same condition the device applies — sounding music, not
 * merely holding the gate. A flow holding the gate keeps the panel out; the deck
 * is still free, and the device takes writes to it.
 */
export function flowOwnsDeck(flow: FlowStatus): boolean {
  return flow.phase === "playing";
}
