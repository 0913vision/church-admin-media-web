import { clamp, el } from "../../util/dom.js";
import { icon } from "../icons.js";

export interface FaderOptions {
  min?: number;
  max?: number;
  onInput: (value: number) => void;
}

// Horizontal volume fader built on Pointer Events: one capture-based drag path
// covers mouse and touch, the whole track is grabbable, and it is keyboard
// accessible. Disabled while the audio device is busy (audio lock).
export class Fader {
  readonly el: HTMLElement;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly valueLabel: HTMLElement;
  private readonly min: number;
  private readonly max: number;
  private value: number;
  private dragging = false;
  private disabled = false;

  constructor(private readonly options: FaderOptions) {
    this.min = options.min ?? 0;
    this.max = options.max ?? 100;
    this.value = this.min;

    this.valueLabel = el("span", { class: "fader__value" }, ["0"]);
    this.fill = el("div", { class: "fader__fill" });
    this.thumb = el("div", { class: "fader__thumb" });
    this.track = el("div", { class: "fader__track" }, [this.fill, this.thumb]);
    this.el = el(
      "div",
      { class: "fader", tabIndex: 0, role: "slider", ariaValueMin: String(this.min), ariaValueMax: String(this.max) },
      [
        el("div", { class: "fader__head" }, [
          el("span", { class: "fader__label" }, [icon("volume", 18), "볼륨"]),
          this.valueLabel,
        ]),
        this.track,
        el("div", { class: "fader__ends" }, [el("span", { textContent: String(this.min) }), el("span", { textContent: String(this.max) })]),
      ],
    );

    this.attachPointer();
    this.attachKeyboard();
    this.render();
  }

  setValue(value: number): void {
    if (this.dragging) return;
    this.value = clamp(value, this.min, this.max);
    this.render();
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.el.classList.toggle("is-disabled", disabled);
    this.el.setAttribute("aria-disabled", String(disabled));
  }

  private attachPointer(): void {
    this.track.addEventListener("pointerdown", (event) => {
      if (this.disabled) return;
      this.dragging = true;
      this.track.setPointerCapture(event.pointerId);
      this.commit(this.valueFromPointer(event.clientX));
    });
    this.track.addEventListener("pointermove", (event) => {
      if (this.dragging) this.commit(this.valueFromPointer(event.clientX));
    });
    this.track.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.track.releasePointerCapture(event.pointerId);
    });
    this.track.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
  }

  private attachKeyboard(): void {
    this.el.addEventListener("keydown", (event) => {
      if (this.disabled) return;
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        this.commit(this.value + step);
        event.preventDefault();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        this.commit(this.value - step);
        event.preventDefault();
      }
    });
  }

  private valueFromPointer(clientX: number): number {
    const rect = this.track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return this.min + ratio * (this.max - this.min);
  }

  private commit(value: number): void {
    this.value = clamp(value, this.min, this.max);
    this.render();
    this.options.onInput(this.value);
  }

  private render(): void {
    const percent = `${((this.value - this.min) / (this.max - this.min)) * 100}%`;
    this.fill.style.width = percent;
    this.thumb.style.left = percent;
    const rounded = Math.round(this.value);
    this.valueLabel.textContent = String(rounded);
    this.el.setAttribute("aria-valuenow", String(rounded));
  }
}
