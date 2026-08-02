import { el } from "../../util/dom.js";
import type { ScheduledFlow } from "../../api/device.js";

/** Sunday first: this is a church, and the week starts at 주일. */
const DAYS = ["주일", "월", "화", "수", "목", "금", "토"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // python weekday() (mon=0) → column

function minutesOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

/** A flow being edited, drawn as a dashed outline before it exists. */
export interface FlowDraft {
  id: string;
  weekdays: number[];
  opens: number;
  closes: number;
}

interface WeekViewOptions {
  onPick: (flowId: string) => void;
}

/**
 * The week as a grid: days across, hours down.
 *
 * A list of flows makes you read each one and hold the times in your head to
 * see whether two collide. Laid out against a clock the collision is just
 * visible, and so is how much of a lock is music and how much is silence.
 */
export class WeekView {
  readonly el = el("div", { class: "cal" });

  private flows: ScheduledFlow[] = [];
  private selected = "";
  private now = new Date();
  private draft: FlowDraft | null = null;

  constructor(private readonly options: WeekViewOptions) {
    // Clicking past the blocks lets the pick go.
    this.el.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".blk")) return;
      if (!this.selected) return;
      this.selected = "";
      this.options.onPick("");
      this.render();
    });
  }

  setFlows(flows: ScheduledFlow[]): void {
    this.flows = flows;
    // Nothing is picked for the user: the calendar opens quiet.
    if (!flows.some((flow) => flow.id === this.selected)) this.selected = "";
    this.render();
  }

  setNow(now: Date): void {
    this.now = now;
    this.render();
  }

  setDraft(draft: FlowDraft | null): void {
    this.draft = draft;
    this.render();
  }

  selectedFlow(): ScheduledFlow | undefined {
    return this.flows.find((flow) => flow.id === this.selected);
  }

  select(flowId: string): void {
    this.selected = flowId;
    this.render();
  }

  /**
   * A fixed 06:00–24:00 ruler. It used to hug the registered flows, but an
   * axis that moves whenever the schedule changes reads as arbitrary — a
   * calendar should look the same every time it is opened.
   */
  private range(): { from: number; to: number } {
    return { from: 6 * 60, to: 24 * 60 };
  }


  private spanOf(flow: ScheduledFlow): { opens: number; closes: number } {
    const opens = minutesOf(flow.lock.at);
    const music = flow.parts.find((part) => part.kind === "music");
    const closesRaw = flow.lock.until.kind === "clock"
      ? minutesOf(flow.lock.until.at)
      : music
        ? minutesOf(music.endsAt)
        : opens + 60;
    return { opens, closes: closesRaw <= opens ? 24 * 60 : closesRaw };
  }

  private render(): void {
    const { from, to } = this.range();
    const span = to - from;
    const pct = (minutes: number): number => ((minutes - from) / span) * 100;
    const today = DAY_ORDER[(this.now.getDay() + 6) % 7]!;
    const nowMinutes = this.now.getHours() * 60 + this.now.getMinutes();

    const head = el(
      "div",
      { class: "cal__days" },
      [el("span", {}), ...DAYS.map((label, column) =>
        el("span", { class: column === today ? "wk" : "", textContent: `${label}${column === today && label.length === 1 ? "요일" : ""}` }),
      )],
    );

    const hourMarks: number[] = [];
    for (let mark = from; mark <= to; mark += 60) hourMarks.push(mark);
    const hours = el(
      "div",
      { class: "cal__hours" },
      hourMarks.map((mark) =>
        el("span", { style: `top:${pct(mark)}%`, textContent: `${String(Math.floor(mark / 60)).padStart(2, "0")}:00` }),
      ),
    );

    const lines = hourMarks
      .slice(1, -1)
      .map((mark) => el("div", { class: "cal__line", style: `top:${pct(mark)}%` }));

    const columns = DAYS.map((_, column) => {
      const blocks = this.flows
        .filter((flow) => flow.weekdays.some((day) => DAY_ORDER[day] === column))
        .map((flow) => this.block(flow, pct, to));
      const draft = this.draftBlock(column, pct, to);
      if (draft) blocks.push(draft);
      return el("div", { class: `cal__col${column === today ? " today" : ""}` }, blocks);
    });

    const inRange = nowMinutes >= from && nowMinutes <= to;
    const marker = inRange
      ? [el("div", { class: "cal__now", style: `top:${pct(nowMinutes)}%` }, [
          el("span", { textContent: `지금 ${String(this.now.getHours()).padStart(2, "0")}:${String(this.now.getMinutes()).padStart(2, "0")}` }),
        ])]
      : [];

    this.el.replaceChildren(head, el("div", { class: "cal__grid" }, [...lines, ...marker, hours, ...columns]));
  }

  /**
   * The flow being edited, dashed — and red where it would sit on top of one
   * that already exists.
   */
  private draftBlock(column: number, pct: (minutes: number) => number, rangeTo: number): HTMLElement | null {
    const draft = this.draft;
    if (!draft || !draft.weekdays.some((day) => DAY_ORDER[day] === column)) return null;

    const closes = Math.min(rangeTo, draft.closes);
    const clash = this.flows.some(
      (flow) =>
        flow.id !== draft.id &&
        flow.weekdays.some((day) => DAY_ORDER[day] === column) &&
        draft.opens < this.spanOf(flow).closes &&
        closes > this.spanOf(flow).opens,
    );
    return el("div", {
      class: `blk draft${clash ? " clash" : ""}`,
      style: `top:${pct(draft.opens)}%;height:${Math.max(2, pct(closes) - pct(draft.opens))}%`,
    });
  }

  private block(flow: ScheduledFlow, pct: (minutes: number) => number, rangeTo: number): HTMLElement {
    const opens = minutesOf(flow.lock.at);
    const music = flow.parts.find((part) => part.kind === "music");
    const closesFlow = this.spanOf(flow).closes;
    const closes = Math.min(rangeTo, closesFlow);

    const children: HTMLElement[] = [];
    if (music) {
      const endsAt = minutesOf(music.endsAt);
      // Without track lengths here the music span is drawn from the lock's own
      // start; the editor is where exact lengths are checked.
      const top = ((Math.max(opens, endsAt - 60) - opens) / Math.max(1, closes - opens)) * 100;
      const height = ((endsAt - Math.max(opens, endsAt - 60)) / Math.max(1, closes - opens)) * 100;
      children.push(el("div", { class: "blk__m", style: `top:${top}%;height:${height}%` }));
    }
    children.push(
      el("div", { class: "blk__n" }, [
        ...(flow.autoStart ? [el("i", { class: "auto" })] : []),
        flow.name,
      ]),
    );

    const block = el(
      "button",
      {
        class: `blk${flow.id === this.selected ? " sel" : ""}`,
        type: "button",
        style: `top:${pct(opens)}%;height:${pct(closes) - pct(opens)}%`,
      },
      children,
    );
    block.addEventListener("click", () => {
      this.selected = flow.id;
      this.options.onPick(flow.id);
      this.render();
    });
    return block;
  }
}
