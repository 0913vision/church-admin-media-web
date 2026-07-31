import { el } from "../../util/dom.js";

export interface SwitchOptions {
  onLabel: string;
  offLabel: string;
  tone?: "accent" | "danger";
  onChange: (next: boolean) => void;
}

// Unambiguous on/off control: a track + knob that slides, with the current
// state spelled out in words. Used wherever a value is simply on or off.
export class Switch {
  readonly el: HTMLButtonElement;
  private readonly text: HTMLElement;
  private checked = false;

  constructor(private readonly options: SwitchOptions) {
    const track = el("span", { class: "switch__track" }, [el("span", { class: "switch__knob" })]);
    this.text = el("span", { class: "switch__text" });
    this.el = el(
      "button",
      { class: `switch switch--${options.tone ?? "accent"}`, type: "button", role: "switch" },
      [track, this.text],
    );
    this.el.addEventListener("click", () => {
      if (!this.el.disabled) this.options.onChange(!this.checked);
    });
  }

  set(checked: boolean, disabled = false): void {
    this.checked = checked;
    this.el.classList.toggle("is-on", checked);
    this.el.setAttribute("aria-checked", String(checked));
    this.el.disabled = disabled;
    this.text.textContent = checked ? this.options.onLabel : this.options.offLabel;
  }
}
