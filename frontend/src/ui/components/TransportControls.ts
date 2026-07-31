import { el } from "../../util/dom.js";
import { PlaybackState } from "../../protocol.js";
import type { State } from "../../protocol.js";
import { icon } from "../icons.js";

export interface TransportOptions {
  onToggle: (next: PlaybackState) => void;
}

// Play/pause as one large button whose fill means "currently playing".
export class TransportControls {
  readonly el: HTMLButtonElement;
  private state: PlaybackState = PlaybackState.PAUSED;

  constructor(options: TransportOptions) {
    this.el = el("button", { class: "btn play__btn", type: "button" });
    this.el.addEventListener("click", () => {
      options.onToggle(this.state === PlaybackState.PLAYING ? PlaybackState.PAUSED : PlaybackState.PLAYING);
    });
  }

  update(state: State): void {
    this.state = state.playback;
    const playing = state.playback === PlaybackState.PLAYING;
    this.el.classList.toggle("is-active", playing);
    this.el.replaceChildren(icon(playing ? "pause" : "play", 22), el("span", { textContent: playing ? "정지" : "재생" }));
    this.el.disabled = state.audioLock;
  }
}
