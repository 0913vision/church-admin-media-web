import { el } from "../../util/dom.js";
import { PlayerState } from "../../domain/protocol.js";
import type { MediaState } from "../../domain/protocol.js";
import { icon } from "../icons.js";

export interface TransportOptions {
  onToggle: (next: number) => void;
}

// Play/pause as one large button whose fill means "currently playing".
export class TransportControls {
  readonly el: HTMLButtonElement;
  private state: number = PlayerState.PAUSED;

  constructor(options: TransportOptions) {
    this.el = el("button", { class: "btn play__btn", type: "button" });
    this.el.addEventListener("click", () => {
      options.onToggle(this.state === PlayerState.PLAYING ? PlayerState.PAUSED : PlayerState.PLAYING);
    });
  }

  update(state: MediaState): void {
    this.state = state.state;
    const playing = state.state === PlayerState.PLAYING;
    this.el.classList.toggle("is-active", playing);
    this.el.replaceChildren(icon(playing ? "pause" : "play", 22), el("span", { textContent: playing ? "정지" : "재생" }));
    this.el.disabled = state.audioLock;
  }
}
