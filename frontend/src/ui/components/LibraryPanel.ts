import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import type { State, Track } from "../../protocol.js";

export interface LibraryPanelOptions {
  /** A song the panel itself offers: selected, not started. */
  onSelectSong: (songId: string) => void;
  /** A library track: put on the deck and played. Needs the gate. */
  onPlayTrack: (trackId: string) => void;
  /** The level a track sounds at, kept across restarts. */
  onLevel: (trackId: string, volume: number) => void;
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
  private levels = new Map<string, number>();

  constructor(private readonly options: LibraryPanelOptions) {}

  setTracks(tracks: Track[], deckSongIds: string[]): void {
    this.tracks = tracks;
    this.deckSongs = new Set(deckSongIds);
    this.render();
  }

  setState(state: State, levels: Map<string, number>): void {
    this.state = state;
    this.levels = levels;
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
        return this.row(track, on, false, () => this.options.onSelectSong(track.id));
      })),
      el("div", { class: "lib__g" }, [
        el("span", { class: "icon" }, [icon("lock", 13)]),
        el("span", { textContent: "잠금 필요" }),
      ]),
      el("div", { class: "lib__rows" }, gated.map((track) =>
        this.row(track, track.id === playingTrack, !held, () => this.options.onPlayTrack(track.id)),
      )),
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

  /**
   * One track: its name, its level, its length.
   *
   * Note(yoochan.kim): the level box sits outside the choosing key rather than inside
   * it — a field within a button cannot be typed into, and pressing one would be
   * pressing the other.
   */
  private row(track: Track, on: boolean, off: boolean, onPick: () => void): HTMLElement {
    const pick = el("button", { class: "lib__pick", type: "button" }, [
      el("span", { class: "lib__n", textContent: track.title }),
      el("span", { class: "lib__d num", textContent: minutes(track.durationSec) }),
    ]) as HTMLButtonElement;
    pick.disabled = off;
    pick.addEventListener("click", onPick);
    return el("div", { class: `lib__r${on ? " on" : ""}` }, [pick, this.level(track.id)]);
  }

  /** The level this track sounds at, kept across restarts. */
  private level(id: string): HTMLElement {
    const input = el("input", { class: "lib__v", type: "number", value: String(this.levels.get(id) ?? 50) }) as HTMLInputElement;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.title = "이 곡을 고를 때의 볼륨";
    // Note(yoochan.kim): sent when the box is left, not per keystroke. Rewriting 5 into
    // 50 under somebody's fingers is worse than a moment out of range.
    input.addEventListener("blur", () => {
      const asked = Number(input.value);
      const level = Number.isFinite(asked) ? Math.min(100, Math.max(0, Math.round(asked))) : (this.levels.get(id) ?? 50);
      input.value = String(level);
      if (level !== this.levels.get(id)) this.options.onLevel(id, level);
    });
    return el("span", { class: "vol" }, [input]);
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
