import type { FlowStatus } from "../protocol.js";

/**
 * Whether a run holds the gate, and with it the deck.
 *
 * Note(yoochan.kim): the same condition the device applies — it refuses every deck
 * write with flowActive from the moment the gate engages. An accepted flow that
 * has not started yet still leaves the deck to whoever is at the panel.
 */
export function flowOwnsDeck(flow: FlowStatus): boolean {
  return flow.phase === "playing" || flow.phase === "holding";
}
