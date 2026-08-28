import { el } from "../../util/dom.js";

/**
 * Makes a button fire only when it is held.
 *
 * For presses that are hard to take back: the gate that silences every panel in
 * the building, and re-sending a level to a desk that already reports it. A
 * gauge fills across the key while the finger is down, and letting go early
 * abandons it. Once it fires the key ignores presses until the gauge has
 * drained, so a second press cannot ride in on the first.
 *
 * The gauge is a child element, so the caller's own contents must sit above it
 * — `.arm` and the rules beside it in the stylesheet do that.
 */
export function holdToFire(button: HTMLElement, onFire: () => void): void {
  const gauge = el("i", { class: "arm" });
  button.prepend(gauge);

  gauge.addEventListener("transitionend", () => {
    if (button.classList.contains("arming")) {
      button.classList.remove("arming");
      button.classList.add("cooling");
      onFire();
    } else {
      button.classList.remove("cooling");
    }
  });

  button.addEventListener("pointerdown", () => {
    if (!button.classList.contains("cooling")) button.classList.add("arming");
  });
  for (const event of ["pointerup", "pointerleave", "pointercancel"]) {
    button.addEventListener(event, () => button.classList.remove("arming"));
  }
}
