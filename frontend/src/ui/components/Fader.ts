import { clamp, el } from "../../util/dom.js";

export interface FaderOptions {
  min?: number;
  max?: number;
  onInput: (value: number) => void;
}

/**
 * The mockup's slider, exactly: a 6px track with a fill and a round thumb.
 * The label and the big number live in the volrow around it — `valueEl` is
 * handed out so the row can place the number where the mockup puts it.
 */
export class Fader {
  readonly el: HTMLElement;
  readonly valueEl: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly min: number;
  private readonly max: number;
  private value: number;
  private dragging = false;
  private disabled = false;

  constructor(private readonly options: FaderOptions) {
    this.min = options.min ?? 0;
    this.max = options.max ?? 100;
    this.value = this.min;

    this.fill = el("i", {});
    this.thumb = el("u", {});
    this.valueEl = el("span", { class: "volrow__n num", textContent: "0" });
    this.el = el(
      "span",
      { class: "slider", tabIndex: 0, role: "slider", ariaValueMin: String(this.min), ariaValueMax: String(this.max) },
      [this.fill, this.thumb],
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
    this.el.addEventListener("pointerdown", (event) => {
      if (this.disabled) return;
      this.dragging = true;
      this.el.setPointerCapture(event.pointerId);
      this.commit(this.valueFromPointer(event.clientX));
    });
    this.el.addEventListener("pointermove", (event) => {
      if (this.dragging) this.commit(this.valueFromPointer(event.clientX));
    });
    this.el.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.el.releasePointerCapture(event.pointerId);
    });
    this.el.addEventListener("pointercancel", () => {
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
    const rect = this.el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return this.min + ratio * (this.max - this.min);
  }

  private commit(value: number): void {
    this.value = clamp(value, this.min, this.max);
    this.render();
    this.options.onInput(this.value);
  }

  /** Colours the track and the number red while the deck is held silent. */
  setMuted(muted: boolean): void {
    this.el.classList.toggle("is-muted", muted);
    this.valueEl.classList.toggle("is-muted", muted);
  }

  private render(): void {
    const percent = `${((this.value - this.min) / (this.max - this.min)) * 100}%`;
    this.fill.style.width = percent;
    this.thumb.style.left = percent;
    const rounded = Math.round(this.value);
    this.valueEl.textContent = String(rounded);
    this.el.setAttribute("aria-valuenow", String(rounded));
  }
}
