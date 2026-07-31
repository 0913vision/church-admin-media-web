import { el } from "../../util/dom.js";
import type { Song, State } from "../../protocol.js";
import { icon } from "../icons.js";

export interface SongSelectorOptions {
  onSelect: (songId: string) => void;
}

/**
 * Radio-style list: exactly one option is selected, and the selected row is
 * unmistakable (filled radio + tint + accent border).
 *
 * The options come from the server's catalogue rather than from a list held
 * here, so renaming a song — or adding one — needs no change to this file.
 */
export class SongSelector {
  readonly el: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(private readonly options: SongSelectorOptions) {
    this.el = el("div", { class: "options", role: "radiogroup" });
  }

  /** Rebuilds the list from the catalogue the server sent with the handshake. */
  setCatalogue(songs: Song[]): void {
    this.buttons.clear();
    this.el.replaceChildren(
      ...songs.map((song) => {
        const button = el("button", { class: "option", type: "button", role: "radio" }, [
          el("span", { class: "option__dot" }),
          el("span", { class: "option__label", textContent: song.title }),
          icon("music", 18),
        ]);
        button.addEventListener("click", () => this.options.onSelect(song.id));
        this.buttons.set(song.id, button);
        return button;
      }),
    );
  }

  update(state: State): void {
    this.buttons.forEach((button, songId) => {
      const selected = songId === state.song;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.disabled = state.audioLock;
    });
  }
}
