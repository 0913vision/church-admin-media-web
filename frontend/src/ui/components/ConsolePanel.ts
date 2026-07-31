import { el } from "../../util/dom.js";
import { icon } from "../icons.js";

export interface ConsolePanelOptions {
  onMic: () => void;
  onAux: () => void;
}

// X32 console actions plus the (not yet supported) equipment power controls.
// Console ops take no audio lock server-side; the admin console bypasses the
// admin lock, so buttons only disable while the bridge is disconnected.
export class ConsolePanel {
  readonly el: HTMLElement;
  private readonly micButton: HTMLButtonElement;
  private readonly auxButton: HTMLButtonElement;

  constructor(options: ConsolePanelOptions) {
    this.micButton = el("button", { class: "btn console__btn", type: "button" }, [
      icon("mic", 22),
      el("span", { textContent: "목사님 마이크 켜기" }),
    ]);
    this.auxButton = el("button", { class: "btn console__btn", type: "button" }, [
      icon("audio", 22),
      el("span", { textContent: "AUX 켜기" }),
    ]);
    this.micButton.addEventListener("click", () => options.onMic());
    this.auxButton.addEventListener("click", () => options.onAux());

    const powerOn = el("button", { class: "btn btn--small", type: "button", textContent: "켜기", disabled: true });
    const powerOff = el("button", { class: "btn btn--small", type: "button", textContent: "끄기", disabled: true });

    this.el = el("div", { class: "console" }, [
      el("div", { class: "console__actions" }, [this.micButton, this.auxButton]),
      el("hr", { class: "rule" }),
      el("div", { class: "ctl" }, [
        el("span", { class: "ctl__icon" }, [icon("power", 20)]),
        el("div", { class: "ctl__text" }, [
          el("span", { class: "ctl__label" }, ["음향장비 전원", el("span", { class: "tag", textContent: "준비 중" })]),
          el("span", { class: "ctl__hint", textContent: "아직 지원되지 않는 기능입니다." }),
        ]),
        el("div", { class: "console__power" }, [powerOn, powerOff]),
      ]),
    ]);
  }

  /** Disabled while the media server is out of reach — the console is its job. */
  setReachable(reachable: boolean): void {
    this.micButton.disabled = !reachable;
    this.auxButton.disabled = !reachable;
  }
}
