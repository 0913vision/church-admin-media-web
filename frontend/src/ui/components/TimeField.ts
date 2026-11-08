import { el } from "../../util/dom.js";
import { icon } from "../icons.js";

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * A time to the second: the browser's typed field, and in place of its own
 * dropdown a popover of three columns, hours, minutes and seconds, as Ant Design's
 * and MUI's time pickers lay one out. A press on a cell sets that part at once and
 * the field reports it as if it had been typed; a press anywhere else, or Escape,
 * puts the popover away.
 */
export function timeField(value: string): { el: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { class: "editor__input", type: "time" }) as HTMLInputElement;
  input.step = "1";
  input.value = value;
  const key = el("button", { class: "timefield__key", type: "button", title: "시각 고르기" }, [icon("clock", 16)]);

  let picking = false;
  const parts = (): [number, number, number] | null => {
    if (!input.value) return null;
    const [hours, mins, secs] = input.value.split(":").map(Number);
    return [hours ?? 0, mins ?? 0, secs ?? 0];
  };
  const columns = [24, 60, 60].map((count, part) =>
    el("div", { class: "timepop__col", role: "listbox" }, Array.from({ length: count }, (_, at) => {
      const cell = el("button", { class: "timepop__cell", type: "button", textContent: pad(at) });
      cell.addEventListener("click", () => {
        const now = parts() ?? [0, 0, 0];
        now[part] = at;
        input.value = now.map(pad).join(":");
        picking = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        picking = false;
        show(part);
      });
      return cell;
    })),
  );
  const pop = el("div", { class: "timepop is-hidden" }, columns);
  const wrap = el("div", { class: "timefield" }, [input, key, pop]);

  // Note(yoochan.kim): the chosen cell of each column painted, and brought to the column's top as Ant Design does.
  const show = (moved?: number): void => {
    const now = parts();
    columns.forEach((column, part) => {
      [...column.children].forEach((cell, at) => cell.classList.toggle("on", now !== null && now[part] === at));
      const chosen = column.querySelector<HTMLElement>(".on");
      if (chosen && (moved === undefined || moved === part)) {
        column.scrollTo({ top: chosen.offsetTop - column.offsetTop - 4, behavior: moved === undefined ? "auto" : "smooth" });
      }
    });
  };

  const away = (event: MouseEvent): void => {
    if (!wrap.contains(event.target as Node)) close();
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" && event.key !== "Enter") return;
    // Note(yoochan.kim): caught first, so the dialog under it is not closed along with the popover.
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const close = (): void => {
    pop.classList.add("is-hidden");
    key.classList.remove("on");
    document.removeEventListener("mousedown", away);
    window.removeEventListener("keydown", escape, true);
  };
  const open = (): void => {
    pop.classList.remove("is-hidden");
    key.classList.add("on");
    show();
    pop.scrollIntoView({ block: "nearest" });
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", escape, true);
  };
  key.addEventListener("click", () => (pop.classList.contains("is-hidden") ? open() : close()));
  input.addEventListener("input", () => { if (!picking && !pop.classList.contains("is-hidden")) show(); });

  return { el: wrap, input };
}
