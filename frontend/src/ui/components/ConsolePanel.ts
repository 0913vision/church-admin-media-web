import { el } from "../../util/dom.js";
import type { ConsoleState } from "../../protocol.js";

export interface ConsolePanelOptions {
  onMic: () => void;
  onAux: () => void;
}

type InputKey = "mic" | "aux";

const CHANNELS: { key: InputKey; name: string }[] = [
  { key: "mic", name: "목사님 마이크" },
  { key: "aux", name: "노래" },
];

interface Row {
  key: InputKey;
  root: HTMLElement;
  led: HTMLElement;
  state: HTMLElement;
  fill: HTMLElement;
  db: HTMLElement;
  button: HTMLButtonElement;
}

/** The console as a channel strip, drawn from the desk's own answers. */
export class ConsolePanel {
  readonly el: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly led: HTMLElement;
  private readonly conn: HTMLElement;
  private reachable = false;
  private state: ConsoleState = { mic: { kind: "unknown" }, aux: { kind: "unknown" } };

  constructor(options: ConsolePanelOptions) {
    const rowEls = CHANNELS.map((channel) => {
      const button = el("button", { class: "pick", type: "button", textContent: "켜기" });
      button.addEventListener("click", () => (channel.key === "mic" ? options.onMic() : options.onAux()));

      const led = el("span", { class: "led led--off" });
      const state = el("span", { textContent: "—" });
      const fill = el("i", {});
      const db = el("span", { class: "chrow__db", textContent: "—" });
      const root = el("div", { class: "chrow" }, [
        el("span", { class: "chrow__n", textContent: channel.name }),
        el("span", { class: "chrow__s" }, [led, state]),
        el("span", { class: "chrow__bar" }, [fill]),
        db,
        el("span", {}),
        button,
      ]);
      this.rows.push({ key: channel.key, root, led, state, fill, db, button });
      return root;
    });

    this.led = el("span", { class: "led led--go" });
    this.conn = el("span", { textContent: "연결됨" });
    this.el = el("div", { class: "x32" }, [
      el("div", { class: "x32__h" }, [
        this.led,
        el("b", { textContent: "X32 콘솔" }),
        this.conn,
      ]),
      ...rowEls,
    ]);
  }

  /** Disabled while the media server is out of reach — the console is its job. */
  setReachable(reachable: boolean): void {
    this.reachable = reachable;
    this.led.className = `led ${reachable ? "led--go" : "led--bad"}`;
    this.conn.textContent = reachable ? "연결됨" : "알 수 없음";
    this.render();
  }

  setState(state: ConsoleState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    for (const row of this.rows) {
      const read = this.state[row.key];
      const on = read.kind === "read" && read.on;
      row.root.classList.toggle("on", on);
      row.led.className = `led ${on ? "led--go" : "led--off"}`;
      row.state.textContent = read.kind === "read" ? (read.on ? "ON" : "OFF") : "—";
      row.fill.style.width = read.kind === "read" ? `${Math.round(read.fader * 100)}%` : "0%";
      row.db.textContent = read.kind === "read" ? `${Math.round(read.fader * 100)}%` : "—";
      row.button.textContent = on ? "켜져 있음" : "켜기";
      row.button.disabled = !this.reachable || on;
    }
  }
}
