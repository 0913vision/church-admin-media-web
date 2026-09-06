import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import type { State, Track } from "../../protocol.js";

export interface LibraryPanelOptions {
  /** A song the panel itself offers: selected, not started. */
  onSelectSong: (songId: string) => void;
  /** A library track: put on the deck and played. Needs the gate. */
  onPlayTrack: (trackId: string) => void;
  onLoop: (loop: boolean) => void;
  onUnlockWhenDone: (on: boolean) => void;
}

function minutes(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, "0")}초`;
}

/**
 * Everything the server can play, in one list.
 *
 * Note(yoochan.kim): one place to choose. The deck used to carry its own two songs
 * underneath it while the library sat beside it, so picking a song meant deciding
 * which of two lists to look in first.
 */
export class LibraryPanel {
  readonly el = el("div", { class: "lib" });

  private tracks: Track[] = [];
  private deckSongs = new Set<string>();
  private state: State | null = null;

  constructor(private readonly options: LibraryPanelOptions) {}

  setTracks(tracks: Track[], deckSongIds: string[]): void {
    this.tracks = tracks;
    this.deckSongs = new Set(deckSongIds);
    this.render();
  }

  setState(state: State): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const state = this.state;
    const held = state?.adminLock === true;
    const playingTrack = state?.deck.source === "track" ? state.deck.id : "";

    const panel = this.tracks.filter((track) => this.deckSongs.has(track.id));
    const gated = this.tracks.filter((track) => !this.deckSongs.has(track.id));

    this.el.replaceChildren(
      el("div", { class: "lib__h" }, [el("b", { textContent: "라이브러리" })]),
      el("div", { class: "lib__rows" }, panel.map((track) => {
        const on = state?.deck.source === "song" && state.song === track.id;
        const row = this.row(track, on, false);
        row.addEventListener("click", () => this.options.onSelectSong(track.id));
        return row;
      })),
      el("div", { class: "lib__g" }, [
        el("span", { class: "icon" }, [icon("lock", 13)]),
        el("span", { textContent: "잠금 필요" }),
      ]),
      el("div", { class: "lib__rows" }, gated.map((track) => {
        const row = this.row(track, track.id === playingTrack, !held);
        row.addEventListener("click", () => this.options.onPlayTrack(track.id));
        return row;
      })),
      el("div", { class: "lib__opts" }, [
        this.toggle("반복", state?.loop === true, held, (next) => this.options.onLoop(next)),
        this.toggle(
          "노래 마치면 잠금 해제",
          state?.unlockWhenDone === true,
          held && state?.loop === false,
          (next) => this.options.onUnlockWhenDone(next),
        ),
      ]),
    );
  }

  private row(track: Track, on: boolean, off: boolean): HTMLButtonElement {
    const row = el("button", { class: `lib__r${on ? " on" : ""}`, type: "button" }, [
      el("span", { class: "lib__n", textContent: track.title }),
      el("span", { class: "lib__d num", textContent: minutes(track.durationSec) }),
    ]) as HTMLButtonElement;
    row.disabled = off;
    return row;
  }

  private toggle(label: string, on: boolean, enabled: boolean, onChange: (next: boolean) => void): HTMLElement {
    const button = el("button", { class: `lib__t${on ? " on" : ""}`, type: "button" }, [
      el("span", { class: "lib__box" }, on ? [icon("check", 13)] : []),
      el("span", { textContent: label }),
    ]) as HTMLButtonElement;
    button.disabled = !enabled;
    button.addEventListener("click", () => onChange(!on));
    return button;
  }
}
