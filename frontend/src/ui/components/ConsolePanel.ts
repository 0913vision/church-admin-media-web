import { el } from "../../util/dom.js";
import type { ConsoleInput } from "../../protocol.js";
import { levelText, meter, statusOf, unmuteButton } from "./meter.js";
import { icon } from "../icons.js";

export interface ConsolePanelOptions {
  onEnable: (inputId: string) => void;
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
  private reachable = false;
  private state: ConsoleInput[] = [];

  constructor(private readonly options: ConsolePanelOptions) {
    this.strip = el("div", {});
    this.led = el("span", { class: "led led--go" });
    this.conn = el("span", { textContent: "연결됨" });
    this.el = el("div", { class: "x32" }, [
      el("div", { class: "x32__h" }, [
        this.led,
        el("b", { textContent: "X32 콘솔" }),
        this.conn,
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
    this.conn.textContent = !this.reachable ? "알 수 없음" : heard ? "연결됨" : "응답 없음";

    this.strip.replaceChildren(
      ...this.state.map((input) => {
        const on = input.state.kind === "read" && input.state.on;
        const button = unmuteButton(input, this.reachable, () => this.options.onEnable(input.id));

        // Note(yoochan.kim): the same command as switching on — it drives every
        // channel to its own level — offered where a moved fader is visible.
        const reset = el("button", { class: "iconbtn", type: "button" }, [icon("reset", 16)]) as HTMLButtonElement;
        reset.disabled = !this.reachable;
        reset.title = `${input.nominalDb.toFixed(1)} dB로 되돌려요`;
        reset.addEventListener("click", () => this.options.onEnable(input.id));

        return el("div", { class: `chrow${on ? " on" : ""}` }, [
          el("span", { class: "chrow__n", textContent: input.label }),
          statusOf(input),
          meter(input),
          el("span", { class: "chrow__db", textContent: levelText(input) }),
          reset,
          button,
        ]);
      }),
    );
  }
}
