import { el } from "../../util/dom.js";
import type { ConsoleInput } from "../../protocol.js";
import { levelText, meter, unmuteButton } from "./meter.js";

export interface ConsolePanelOptions {
  /** `resend` when the press was a hold on an input that already sounds. */
  onEnable: (inputId: string, resend: boolean) => void;
  /** Puts the whole desk back to where a service starts. */
  onInitialize: () => void;
}

/**
 * The console as a channel strip, drawn from the desk's own answers.
 *
 * The inputs, their order and their names all arrive with the state: how a
 * building is wired is the media server's to say, so rewiring or renaming one
 * never means touching this page.
 */
export class ConsolePanel {
  readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly led: HTMLElement;
  private readonly conn: HTMLElement;
  private readonly initialize: HTMLButtonElement;
  private reachable = false;
  private state: ConsoleInput[] = [];

  constructor(private readonly options: ConsolePanelOptions) {
    this.strip = el("div", {});
    this.led = el("span", { class: "led led--go" });
    this.conn = el("span", { textContent: "연결됨" });
    // Note(yoochan.kim): the same act as the panel's two-finger press — every
    // input up, the mute group released, the masters at their levels. It is one
    // press for the whole desk, so it sits with the desk rather than in a row.
    this.initialize = el("button", { class: "btn btn--small x32__init", type: "button", textContent: "전체 초기화" });
    this.initialize.addEventListener("click", () => this.options.onInitialize());
    this.el = el("div", { class: "x32" }, [
      // Note(yoochan.kim): the lamp sits with the word it is about. Beside the
      // title it looked like a lamp for the desk itself, which is not what it
      // reports — it reports whether we are hearing from it.
      el("div", { class: "x32__h" }, [
        el("b", { textContent: "X32 콘솔" }),
        el("span", { class: "x32__link" }, [this.conn, this.led]),
        this.initialize,
      ]),
      this.strip,
    ]);
  }

  /** Disabled while the media server is out of reach — the console is its job. */
  setReachable(reachable: boolean): void {
    this.reachable = reachable;
    this.render();
  }

  setState(state: ConsoleInput[]): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    // Note(yoochan.kim): connected means the desk itself answered, not that
    // the media server did — a silent desk says 응답 없음.
    const heard = this.state.some((input) => input.state.kind === "read");
    this.led.className = `led ${this.reachable && heard ? "led--go" : "led--bad"}`;
    this.initialize.disabled = !this.reachable;
    this.conn.textContent = !this.reachable ? "알 수 없음" : heard ? "연결됨" : "응답 없음";

    this.strip.replaceChildren(
      ...this.state.map((input) => {
        const on = input.state.kind === "read" && input.state.on;
        const button = unmuteButton(input, this.reachable, (resend) => this.options.onEnable(input.id, resend));

        // Note(yoochan.kim): no per-row reset key. Holding the row's own button
        // already re-sends that input's level, and putting the whole desk back
        // is one act — it belongs to the panel, not to a row.
        return el("div", { class: `chrow${on ? " on" : ""}` }, [
          el("span", { class: "chrow__n", textContent: input.label }),
          meter(input),
          levelText(input),
          el("span", {}),
          button,
        ]);
      }),
    );
  }
}
