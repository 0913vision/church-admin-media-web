import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import type { State, Track } from "../../protocol.js";

export interface LibraryPanelOptions {
  /** A song the panel itself offers: selected, not started. */
  onSelectSong: (songId: string) => void;
  /** A library track: put on the deck and played. Needs the gate. */
  onPlayTrack: (trackId: string) => void;
  /** Opens the library's settings, where levels are edited. */
  onSettings: () => void;
  onLoop: (loop: boolean) => void;
  onUnlockWhenDone: (on: boolean) => void;
  /** Asks when the music should stop; the panel only says that it must be asked. */
  onSetMusicEnd: () => void;
}

function minutes(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, "0")}초`;
}

/** The clock part of a wire instant. */
function hhmmss(at: string): string {
  return at.slice(11, 19);
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
      el("div", { class: "lib__h" }, [el("b", { textContent: "곡 목록" }), this.settingsKey()]),
      el("div", { class: "lib__rows" }, panel.map((track) => {
        const on = state?.deck.source === "song" && state.song === track.id;
        return this.row(track, panel.indexOf(track) + 1, on, false, () => this.options.onSelectSong(track.id));
      })),
      el("div", { class: "lib__g" }, [
        el("span", { class: "icon" }, [icon("lock", 13)]),
        el("span", { textContent: "잠금 필요" }),
      ]),
      el("div", { class: "lib__rows" }, gated.map((track, at) =>
        // Numbered straight on from the panel songs: it says which of them all this is.
        this.row(track, panel.length + at + 1, track.id === playingTrack, !held, () => this.options.onPlayTrack(track.id)),
      )),
      el("div", { class: "lib__opts" }, [
        this.toggle("반복", state?.loop === true, held, (next) => this.options.onLoop(next)),
        this.toggle(
          "노래 마치면 잠금 해제",
          state?.unlockWhenDone === true,
          held && state?.loop === false,
          (next) => this.options.onUnlockWhenDone(next),
        ),
        ...this.musicEnd(state),
      ]),
    );
  }

  /**
   * When the music stops, and a warning while nothing does.
   *
   * Note(yoochan.kim): a repeating track has no end of its own, so with loop on and no
   * end set, the gate stays shut until somebody walks back to the desk.
   */
  private musicEnd(state: State | null): HTMLElement[] {
    if (state?.adminLock !== true || state.loop !== true) return [];

    const end = state.musicEndsAt;
    const said = end.kind === "at" ? `${hhmmss(end.at)}에 멈춰요`
      : end.kind === "withHold" ? "잠금이 풀릴 때 멈춰요"
      : "언제 멈출지 정하지 않았어요";

    const set = el("button", { class: "lib__when", type: "button", textContent: said });
    set.addEventListener("click", () => this.options.onSetMusicEnd());
    return [set];
  }

  /** Opens the whole library's settings. One dialog, not a control per row. */
  private settingsKey(): HTMLElement {
    const key = el("button", { class: "lib__cog", type: "button", title: "곡 설정" }, [icon("cog", 16)]);
    key.addEventListener("click", () => this.options.onSettings());
    return key;
  }

  /**
   * One track: its name and its length.
   *
   * Note(yoochan.kim): a row is for choosing and nothing else. A number box in every row
   * turned the list into a form, and one pressed by accident moves a level that
   * is heard the next time somebody picks that song.
   */
  private row(track: Track, index: number, on: boolean, off: boolean, onPick: () => void): HTMLElement {
    const pick = el("button", { class: "lib__pick", type: "button" }, [
      el("span", { class: "lib__i num", textContent: String(index) }),
      el("span", { class: "lib__n", textContent: track.title }),
      el("span", { class: "lib__d num", textContent: minutes(track.durationSec) }),
    ]) as HTMLButtonElement;
    pick.disabled = off;
    pick.addEventListener("click", onPick);
    return el("div", { class: `lib__r${on ? " on" : ""}` }, [pick]);
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
