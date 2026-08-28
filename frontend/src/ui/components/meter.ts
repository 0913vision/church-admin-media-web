import { BLANK, el } from "../../util/dom.js";
import type { ConsoleInput } from "../../protocol.js";

/**
 * The stretch of the desk's range worth drawing. Its faders run to -90 dB, but
 * everything below -60 is silence at a different depth, and spending most of a
 * meter on it leaves nothing for the range anyone actually mixes in.
 */
const FLOOR_DB = -60;
const CEIL_DB = 10;

function percent(db: number): number {
  return Math.min(100, Math.max(0, ((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)) * 100));
}

/** One input's level, with a mark where the level is meant to be. */
export function meter(input: ConsoleInput): HTMLElement {
  const read = input.state;
  const bar = el("span", { class: "chrow__bar" }, [
    el("i", { style: `width:${read.kind === "read" ? percent(read.db) : 0}%` }),
    // The mark stands whether or not the desk is answering: it says where this
    // input belongs, which is a fact about the building, not about the moment.
    el("u", { class: "chrow__mark", style: `left:${percent(input.nominalDb)}%` }),
  ]);
  if (read.kind === "read" && Math.abs(read.db - input.nominalDb) > 0.05) bar.classList.add("is-off");
  return bar;
}

/** What the desk reports, in the unit the desk itself shows. */
export function levelText(input: ConsoleInput): string {
  return input.state.kind === "read" ? `${input.state.db.toFixed(1)} dB` : BLANK;
}
