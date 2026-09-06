import { el } from "../../util/dom.js";
import type { State, Track } from "../../protocol.js";

export interface LibraryPanelOptions {
  onPlay: (trackId: string) => void;
  onLoop: (loop: boolean) => void;
  onUnlockWhenDone: (on: boolean) => void;
}

function minutes(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, "0")}초`;
}

/**
 * Every track the server holds, playable while the gate is held.
 *
 * Note(yoochan.kim): the list is always here and goes quiet without the gate, rather
 * than appearing with it. A control that comes and goes is one nobody learns; a
 * greyed one says what it needs.
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
    const playingId = state?.deck.source === "track" ? state.deck.id : "";

    const rows = this.tracks.map((track) => {
      const on = track.id === playingId;
      const row = el("button", { class: `lib__r${on ? " on" : ""}`, type: "button" }, [
        el("span", { class: "lib__n", textContent: track.title }),
        // The panel's own songs are marked: they are the two a person can also
        // reach from the wall, and they repeat by default.
        ...(this.deckSongs.has(track.id) ? [el("span", { class: "lib__tag", textContent: "패널" })] : []),
        el("span", { class: "lib__d num", textContent: minutes(track.durationSec) }),
      ]) as HTMLButtonElement;
      row.disabled = !held;
      row.addEventListener("click", () => this.options.onPlay(track.id));
      return row;
    });

    const loop = this.toggle("반복", state?.loop === true, held, (next) => this.options.onLoop(next));
    const auto = this.toggle(
      "노래 마치면 잠금 해제",
      state?.unlockWhenDone === true,
      held && state?.loop === false,
      (next) => this.options.onUnlockWhenDone(next),
    );

    this.el.replaceChildren(
      el("div", { class: "lib__h" }, [
        el("b", { textContent: "라이브러리" }),
        ...(held ? [] : [el("span", { class: "lib__why", textContent: "관리자 잠금을 걸면 고를 수 있어요" })]),
      ]),
      el("div", { class: "lib__rows" }, rows),
      el("div", { class: "lib__opts" }, [loop, auto]),
    );
  }

  private toggle(label: string, on: boolean, enabled: boolean, onChange: (next: boolean) => void): HTMLElement {
    const button = el("button", { class: `lib__t${on ? " on" : ""}`, type: "button" }, [
      el("span", { class: "lib__box" }),
      el("span", { textContent: label }),
    ]) as HTMLButtonElement;
    button.disabled = !enabled;
    button.addEventListener("click", () => onChange(!on));
    return button;
  }
}
