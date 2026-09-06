import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import type { State, Track } from "../../protocol.js";

export interface LibraryPanelOptions {
  /** A song the panel itself offers: selected, not started. */
  onSelectSong: (songId: string) => void;
  /** A library track: put on the deck and played. Needs the gate. */
  onPlayTrack: (trackId: string) => void;
  /** Opens one track's settings, where its level is edited. */
  onSettings: (track: Track, volume: number) => void;
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

    const set = el("button", { class: "lib__when", type: "button" });
    set.addEventListener("click", () => this.options.onSetMusicEnd());

    if (state.musicEndsAt.kind === "at") {
      set.replaceChildren(el("span", { textContent: `${hhmmss(state.musicEndsAt.at)}에 멈춰요` }));
      return [set];
    }
    set.replaceChildren(el("span", { textContent: "멈출 시각 정하기" }));
    return [
      el("div", { class: "lib__warn" }, [
        el("span", { class: "led led--hold" }),
        el("span", { textContent: "반복 중이라 저절로 멈추지 않아요" }),
      ]),
      set,
    ];
  }

  /**
   * One track: its name, its length, and a key that opens its settings.
   *
   * Note(yoochan.kim): the level is not edited here. A row is for choosing, and a number
   * box in every row turned the list into a form — pressed by accident, it moves
   * a level that is heard the next time somebody picks that song.
   */
  private row(track: Track, on: boolean, off: boolean, onPick: () => void): HTMLElement {
    const pick = el("button", { class: "lib__pick", type: "button" }, [
      el("span", { class: "lib__n", textContent: track.title }),
      el("span", { class: "lib__d num", textContent: minutes(track.durationSec) }),
    ]) as HTMLButtonElement;
    pick.disabled = off;
    pick.addEventListener("click", onPick);

    const settings = el("button", { class: "lib__cog", type: "button", title: `${track.title} 설정` }, [
      icon("cog", 15),
    ]) as HTMLButtonElement;
    settings.addEventListener("click", () => this.options.onSettings(track, this.levels.get(track.id) ?? 50));

    return el("div", { class: `lib__r${on ? " on" : ""}` }, [pick, settings]);
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
