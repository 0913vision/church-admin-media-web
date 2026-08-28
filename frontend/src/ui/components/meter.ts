import { BLANK, el } from "../../util/dom.js";
import type { ConsoleInput } from "../../protocol.js";
import { holdToFire } from "./hold.js";

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
  // Silence is red on the meter too, so the row says it twice over and needs no
  // separate lamp to carry the same one fact.
  if (read.kind === "read" && !read.on) bar.classList.add("is-muted");
  return bar;
}

/**
 * The level, and beside it the one thing that changes what the level means.
 *
 * Note(yoochan.kim): a muted channel is still at a level; it is simply not being
 * heard. So the two are read together, and only the state worth acting on is
 * written — an input that sounds is the ordinary case and says nothing.
 */
export function levelText(input: ConsoleInput): HTMLElement {
  const read = input.state;
  if (read.kind !== "read") return el("span", { class: "chrow__db", textContent: BLANK });
  // Note(yoochan.kim): the reading itself turns red when the input is muted, so the
  // state needs no lamp of its own — the number and the meter are already the
  // two things being looked at.
  return el("span", { class: `chrow__db${read.on ? "" : " is-muted"}` }, [
    el("span", { textContent: `${read.db.toFixed(1)} dB` }),
    ...(read.on ? [] : [el("span", { class: "chrow__muted", textContent: "(음소거)" })]),
  ]);
}

/**
 * The one press that puts sound into a room, so it is red while the input is
 * silent and inert once it is not.
 */
export function unmuteButton(input: ConsoleInput, reachable: boolean, onEnable: () => void): HTMLButtonElement {
  const on = input.state.kind === "read" && input.state.on;
  const button = el("button", {
    class: `pick pick--mute${on ? "" : " btn--stop"}`,
    type: "button",
    // Note(yoochan.kim): once the input is sounding there is nothing to ask for, so
    // the key stops asking. It keeps its place and its width — the row must not
    // reflow when the desk answers — and holding it re-sends the level anyway,
    // for a fader someone has moved by hand.
    textContent: on ? BLANK : "음소거 해제",
  }) as HTMLButtonElement;
  button.disabled = !reachable;
  if (on) {
    button.title = `${input.nominalDb.toFixed(1)} dB로 다시 보내려면 길게 누르세요`;
    holdToFire(button, onEnable);
  } else {
    button.addEventListener("click", onEnable);
  }
  return button;
}
