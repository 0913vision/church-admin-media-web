import { el } from "../../util/dom.js";

/**
 * A dialog over a dimmed page.
 *
 * Closing is the part worth being careful about: the backdrop, Escape and the
 * ✕ all mean the same thing, and each has to leave the page exactly as it found
 * it — the listener gone, the scroll released, the focus back where it was.
 */
export class Modal {
  readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  /** What the dialog is for, kept in the head where it is found without scrolling. */
  private readonly actions: HTMLElement;
  private onClose: () => void = () => {};
  private opener: Element | null = null;
  /**
   * Where the press that led to this click started. A drag that begins on the
   * dialog and ends on the backdrop — selecting text past the edge, say — is
   * not someone asking to close.
   */
  private pressedOn: EventTarget | null = null;

  constructor() {
    this.title = el("b", { class: "modal__t" });
    this.body = el("div", { class: "modal__b" });
    const shut = el("button", { class: "modal__x", type: "button", textContent: "✕" });
    shut.title = "닫기";
    shut.addEventListener("click", () => this.close());

    this.actions = el("div", { class: "modal__a" });
    this.box = el("div", { class: "modal__box" }, [
      el("div", { class: "modal__h" }, [this.title, this.actions, shut]),
      this.body,
    ]);
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-modal", "true");

    this.el = el("div", { class: "modal is-hidden" }, [this.box]);
    this.el.addEventListener("pointerdown", (event) => { this.pressedOn = event.target; });
    this.el.addEventListener("click", (event) => {
      if (event.target === this.el && this.pressedOn === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.classList.contains("is-hidden");
  }

  open(title: string, content: HTMLElement, onClose: () => void, actions: HTMLElement[] = []): void {
    this.onClose = onClose;
    this.opener = document.activeElement;
    this.title.textContent = title;
    this.actions.replaceChildren(...actions);
    this.body.replaceChildren(content);
    this.el.classList.remove("is-hidden");
    document.body.classList.add("has-modal");
    document.addEventListener("keydown", this.onKey);
    // Note(yoochan.kim): into the dialog, so the keyboard is where the eye is and
    // Escape reaches this rather than the page underneath.
    (this.body.querySelector<HTMLElement>("input, button, select") ?? this.box).focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.classList.add("is-hidden");
    this.body.replaceChildren();
    this.actions.replaceChildren();
    document.body.classList.remove("has-modal");
    document.removeEventListener("keydown", this.onKey);
    if (this.opener instanceof HTMLElement) this.opener.focus();
    this.opener = null;
    const done = this.onClose;
    this.onClose = () => {};
    done();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
    }
  };
}
