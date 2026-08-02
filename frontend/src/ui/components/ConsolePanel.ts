import { el } from "../../util/dom.js";

export interface ConsolePanelOptions {
  onMic: () => void;
  onAux: () => void;
}

interface Channel {
  key: "mic" | "aux";
  name: string;
}

const CHANNELS: Channel[] = [
  { key: "mic", name: "목사님 마이크" },
  { key: "aux", name: "노래" },
];

/**
 * The console as a channel strip.
 *
 * ON/OFF and the fader are what a booth reads first, so they are rows on the
 * same label column as everything else rather than a pair of buttons. The
 * server cannot read either back yet, so both say so plainly instead of
 * showing a state nobody measured.
 */
export class ConsolePanel {
  readonly el: HTMLElement;
  private led!: HTMLElement;
  private conn!: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(options: ConsolePanelOptions) {
    const rows = CHANNELS.map((channel) => {
      const button = el("button", { class: "pick", type: "button", textContent: "켜기" });
      button.addEventListener("click", () => (channel.key === "mic" ? options.onMic() : options.onAux()));
      this.buttons.push(button);

      return el("div", { class: "chrow" }, [
        el("span", { class: "chrow__n", textContent: channel.name }),
        el("span", { class: "chrow__s" }, [el("span", { class: "led" }), "—"]),
        el("span", { class: "chrow__bar" }),
        el("span", { class: "chrow__db", textContent: "—" }),
        el("span", {}),
        button,
      ]);
    });

    this.led = el("span", { class: "led led--go" });
    this.conn = el("span", { textContent: "연결됨" });
    this.el = el("div", { class: "x32" }, [
      el("div", { class: "x32__h" }, [
        this.led,
        el("b", { textContent: "X32 콘솔" }),
        this.conn,
        el("span", { class: "tag", textContent: "미개발" }),
      ]),
      ...rows,
    ]);
  }

  /** Disabled while the media server is out of reach — the console is its job. */
  setReachable(reachable: boolean): void {
    this.led.className = `led ${reachable ? "led--go" : "led--bad"}`;
    this.conn.textContent = reachable ? "연결됨" : "알 수 없음";
    for (const button of this.buttons) button.disabled = !reachable;
  }
}
