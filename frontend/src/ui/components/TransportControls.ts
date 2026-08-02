import { el } from "../../util/dom.js";
import { PlaybackState } from "../../protocol.js";
import type { State } from "../../protocol.js";

export interface TransportOptions {
  onToggle: (next: PlaybackState) => void;
}

// Note(yoochan.kim): The mockup's own glyphs, so the deck reads exactly like the approved design.
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

/** The deck's round play button: green while sounding, raised while paused. */
export class TransportControls {
  readonly el: HTMLButtonElement;
  private state: PlaybackState = PlaybackState.PAUSED;

  constructor(options: TransportOptions) {
    this.el = el("button", { class: "play paused", type: "button" });
    this.el.innerHTML = PLAY;
    this.el.addEventListener("click", () => {
      options.onToggle(this.state === PlaybackState.PLAYING ? PlaybackState.PAUSED : PlaybackState.PLAYING);
    });
  }

  update(state: State): void {
    this.state = state.playback;
    const playing = state.playback === PlaybackState.PLAYING;
    this.el.classList.toggle("paused", !playing);
    // Note(yoochan.kim): The glyph is the action, not the state: press ▶ to play, ⏸ to stop.
    this.el.innerHTML = playing ? PAUSE : PLAY;
    this.el.title = playing ? "정지" : "재생";
    // Note(yoochan.kim): A flow's music is the flow's to stop: pausing under it would leave the
    // run describing sound that is not there.
    const flowOwnsDeck = state.flow.phase === "playing";
    this.el.disabled = state.audioLock || flowOwnsDeck;
    if (flowOwnsDeck) this.el.title = "자동 진행이 재생 중이에요";
  }
}
