import { el } from "../../util/dom.js";
import { SongType } from "../../domain/protocol.js";
import type { MediaState } from "../../domain/protocol.js";
import { icon } from "../icons.js";

export interface SongSelectorOptions {
  onSelect: (song: string) => void;
}

const OPTIONS: { song: string; label: string }[] = [
  { song: SongType.SLOW, label: "잔잔한 음악" },
  { song: SongType.FAST, label: "통성기도 음악" },
];

// Radio-style list: exactly one option is selected, and the selected row is
// unmistakable (filled radio + tint + accent border).
export class SongSelector {
  readonly el: HTMLElement;
  private readonly buttons: Map<string, HTMLButtonElement> = new Map();

  constructor(options: SongSelectorOptions) {
    const items = OPTIONS.map(({ song, label }) => {
      const button = el("button", { class: "option", type: "button", role: "radio" }, [
        el("span", { class: "option__dot" }),
        el("span", { class: "option__label", textContent: label }),
        icon("music", 18),
      ]);
      button.addEventListener("click", () => options.onSelect(song));
      this.buttons.set(song, button);
      return button;
    });
    this.el = el("div", { class: "options", role: "radiogroup" }, items);
  }

  update(state: MediaState): void {
    this.buttons.forEach((button, song) => {
      const selected = song === state.currentSong;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.disabled = state.audioLock;
    });
  }
}
