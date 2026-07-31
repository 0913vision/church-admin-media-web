import { el } from "../../util/dom.js";
import { PlaybackState } from "../../protocol.js";
import type { Song, State } from "../../protocol.js";

/**
 * "Now" display: current song + live state, with a small equalizer that only
 * moves while sound is actually playing — the one glance that matters.
 *
 * Song names come from the server's catalogue, so this shows what the server
 * calls a song rather than a name copied here.
 */
export class NowPlaying {
  readonly el: HTMLElement;
  private readonly eq: HTMLElement;
  private readonly song: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly busy: HTMLElement;
  private titles = new Map<string, string>();

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

  setCatalogue(songs: Song[]): void {
    this.titles = new Map(songs.map((song) => [song.id, song.title]));
  }

  update(state: State): void {
    const playing = state.playback === PlaybackState.PLAYING;
    this.eq.classList.toggle("is-live", playing);
    // A song the catalogue does not cover is shown as its id rather than as a
    // guess, so an unfamiliar value is visible instead of silently prettified.
    this.song.textContent = this.titles.get(state.song) ?? state.song;
    this.badge.textContent = playing ? "재생 중" : "정지됨";
    this.badge.className = `badge ${playing ? "is-live" : ""}`.trim();
    this.busy.classList.toggle("is-hidden", !state.audioLock);
  }
}
