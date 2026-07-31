import { el } from "../../util/dom.js";
import { PlayerState, SongType } from "../../domain/protocol.js";
import type { MediaState } from "../../domain/protocol.js";

export const SONG_LABEL: Record<string, string> = {
  [SongType.SLOW]: "잔잔한 음악",
  [SongType.FAST]: "통성기도 음악",
};

// "Now" display: current song + live state, with a small equalizer that only
// moves while sound is actually playing — the one glance that matters.
export class NowPlaying {
  readonly el: HTMLElement;
  private readonly eq: HTMLElement;
  private readonly song: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly busy: HTMLElement;

  constructor() {
    this.eq = el("div", { class: "eq" }, [el("i"), el("i"), el("i")]);
    this.song = el("span", { class: "now__song" });
    this.badge = el("span", { class: "badge" });
    this.busy = el("span", { class: "badge is-warn is-hidden", textContent: "기기 사용 중" });
    this.el = el("div", { class: "now" }, [
      this.eq,
      el("div", { class: "now__text" }, [this.song, this.badge]),
      this.busy,
    ]);
  }

  update(state: MediaState): void {
    const playing = state.state === PlayerState.PLAYING;
    this.eq.classList.toggle("is-live", playing);
    this.song.textContent = SONG_LABEL[state.currentSong] ?? "—";
    this.badge.textContent = playing ? "재생 중" : "정지됨";
    this.badge.className = `badge ${playing ? "is-live" : ""}`.trim();
    this.busy.classList.toggle("is-hidden", !state.audioLock);
  }
}
