import { el } from "../../util/dom.js";

export interface AlertOptions {
  /** The question, naming what it is about */
  title: string;
  /** What happens, in a sentence */
  message: string;
  /** The key that acts, named for what it does */
  action: string;
  onAction: () => void;
}

/**
 * A question over whatever dialog asked it, for something that cannot be taken back.
 *
 * Note(yoochan.kim): laid out the way Apple's alerts and Material's dialogs both are —
 * the question as the title, the result in a sentence, the keys at the bottom
 * right with the one that acts nearest the edge. The page's Modal holds one dialog
 * at a time, so this is a layer of its own above it.
 */
export class Alert {
  readonly el = el("div", { class: "alert-layer is-hidden" });
  private opener: Element | null = null;
  private pressedOn: EventTarget | null = null;

  constructor() {
    this.el.addEventListener("pointerdown", (event) => { this.pressedOn = event.target; });
    this.el.addEventListener("click", (event) => {
      if (event.target === this.el && this.pressedOn === this.el) this.close();
    });
  }

  open(options: AlertOptions): void {
    this.opener = document.activeElement;
    const dismiss = el("button", { class: "btn", type: "button", textContent: "닫기" });
    dismiss.addEventListener("click", () => this.close());
    const act = el("button", { class: "btn btn--stop", type: "button", textContent: options.action });
    act.addEventListener("click", () => {
      this.close();
      options.onAction();
    });

    const box = el("div", { class: "alert" }, [
      el("p", { class: "alert__t", textContent: options.title }),
      el("p", { class: "alert__m", textContent: options.message }),
      el("div", { class: "alert__a" }, [dismiss, act]),
    ]);
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    this.el.replaceChildren(box);
    this.el.classList.remove("is-hidden");
    // Note(yoochan.kim): captured, so Escape closes this and not the dialog underneath too.
    document.addEventListener("keydown", this.onKey, true);
    // Note(yoochan.kim): the safe key has the focus, so Enter pressed out of habit changes nothing.
    dismiss.focus();
  }

  close(): void {
    if (this.el.classList.contains("is-hidden")) return;
    this.el.classList.add("is-hidden");
    this.el.replaceChildren();
    document.removeEventListener("keydown", this.onKey, true);
    if (this.opener instanceof HTMLElement) this.opener.focus();
    this.opener = null;
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };
}
