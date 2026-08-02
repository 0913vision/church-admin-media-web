import { el } from "../../util/dom.js";
import type { FlowStatus } from "../../protocol.js";
import type { FlowEntry, ScheduledFlow } from "../../api/device.js";
import type { Track } from "../../protocol.js";
import { FlowEditor } from "./FlowEditor.js";
import { WeekView } from "./WeekView.js";

export interface SchedulePanelOptions {
  onStart: (flowId: string) => void;
  onStop: () => void;
  onSave: (id: string, entry: FlowEntry) => void;
  onDelete: (id: string) => void;
}

function minutesOf(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

function hhmm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * The week grid and the picked flow's detail — the mockup's 자동 진행 tab.
 *
 * The calendar is this side's; what is *running* is the device's own status,
 * and the only place it shows here is the 중단 button when the picked flow is
 * the one on the deck.
 */
export class SchedulePanel {
  readonly el: HTMLElement;
  private readonly runBox: HTMLElement;
  private readonly message: HTMLElement;
  private readonly editor: FlowEditor;
  private readonly week: WeekView;
  private readonly detail: HTMLElement;
  private tracks = new Map<string, Track>();
  private running = false;

  constructor(private readonly options: SchedulePanelOptions) {
    this.runBox = el("div", { class: "run is-hidden" });
    this.message = el("p", { class: "sched-msg" });
    this.editor = new FlowEditor({
      onSave: (id, entry) => options.onSave(id, entry),
      onDelete: (id) => options.onDelete(id),
      onCancel: () => this.closeEditor(),
      // The calendar draws the draft as it is typed — dashed, red on a clash.
      onChange: (draft) => this.week.setDraft(draft),
    });
    this.week = new WeekView({ onPick: () => this.renderDetail() });
    this.detail = el("div", { class: "detail" });
    this.el = el("div", { class: "week" }, [
      this.week.el,
      el("div", { class: "detail-col" }, [this.detail, this.editor.el]),
    ]);
  }

  /** Everything that sits under the week grid, for the view to place. */
  below(): HTMLElement[] {
    return [this.runBox, this.message];
  }

  /** Editing happens where the detail was: same column, more room. */
  private openEditor(flow: Parameters<FlowEditor["open"]>[0]): void {
    this.detail.classList.add("is-hidden");
    this.el.classList.add("is-editing");
    this.editor.open(flow);
  }

  /** Church time, so today and the now-line follow the same clock as the rest. */
  setNow(now: Date): void {
    this.week.setNow(now);
  }

  setTracks(tracks: Track[]): void {
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    this.editor.setTracks([...this.tracks.values()]);
    this.renderDetail();
  }

  closeEditor(): void {
    this.editor.close();
    this.detail.classList.remove("is-hidden");
    this.el.classList.remove("is-editing");
  }

  showMessage(text: string): void {
    this.message.textContent = text;
  }

  setFlows(flows: ScheduledFlow[]): void {
    this.week.setFlows(flows);
    this.renderDetail();
  }

  setStatus(status: FlowStatus): void {
    this.message.textContent = "";
    this.running = status.phase !== "idle";
    this.renderFault(status);
    this.renderDetail();
  }

  /** A phase this build does not know is a fault, not a quiet case. */
  private renderFault(status: FlowStatus): void {
    const known = ["idle", "waiting", "playing", "holding"].includes(status.phase);
    this.runBox.classList.toggle("is-hidden", known);
    if (known) {
      this.runBox.replaceChildren();
      return;
    }
    this.runBox.replaceChildren(
      el("div", { class: "run__head" }, [
        el("span", { class: "run__name", textContent: "알 수 없는 상태예요" }),
        el("span", { class: "badge is-bad", textContent: "업데이트 필요" }),
      ]),
      el("div", { class: "run__meta" }, [
        el("span", { textContent: "이 버전이 모르는 상태예요. 화면을 믿지 마세요" }),
      ]),
    );
  }

  private addButton(): HTMLElement {
    const add = el("button", { class: "pick", type: "button", textContent: "새로 만들기" });
    add.addEventListener("click", () => this.openEditor(null));
    return add;
  }

  /** The picked flow, spelled out the way the mockup's detail panel does. */
  private renderDetail(): void {
    const flow = this.week.selectedFlow();
    if (!flow) {
      this.detail.replaceChildren(
        el("span", { class: "sched-msg", textContent: "선택된 순서가 없어요" }),
        el("div", { class: "detail__b" }, [this.addButton()]),
      );
      return;
    }

    const music = flow.parts.find((part) => part.kind === "music");
    const rows: HTMLElement[] = [
      row("요일", el("span", { textContent: `${flow.weekdayLabels.join(", ")}요일` })),
      row("시작", el("span", {}, [
        el("span", {
          class: flow.autoStart ? "tag tag--auto" : "tag",
          textContent: flow.autoStart ? "자동 시작" : "승인 필요",
        }),
      ])),
      row("잠금", el("span", { class: "num", textContent: `${flow.lock.at} → ${this.closesOf(flow)}` })),
    ];

    // The music line and the per-track list carry computed start times: the
    // schedule stores when the music *ends*, and the tracks' lengths say when
    // each one begins.
    const songs = el("div", { class: "detail__songs" });
    if (music) {
      const lengths = music.tracks.map((id) => (this.tracks.get(id)?.durationSec ?? 0) / 60);
      const total = lengths.reduce((sum, minutes) => sum + minutes, 0);
      const startsAt = minutesOf(music.endsAt) - total;
      rows.push(row("음악", el("span", { class: "num", textContent: `${hhmm(startsAt)} → ${music.endsAt}` })));

      let cursor = startsAt;
      music.tracks.forEach((id, index) => {
        songs.append(
          el("div", {}, [
            el("span", { textContent: `${index + 1}. ${this.tracks.get(id)?.title ?? id}` }),
            el("span", { class: "num", textContent: hhmm(cursor) }),
          ]),
        );
        cursor += lengths[index]!;
      });
    }

    const edit = el("button", { class: "pick", type: "button", textContent: "편집" });
    edit.addEventListener("click", () => this.openEditor(flow));

    let action: HTMLElement;
    if (this.running) {
      action = el("button", { class: "btn btn--stop", type: "button", textContent: "중단" });
      action.addEventListener("click", () => this.options.onStop());
    } else {
      const start = el("button", { class: "btn btn--go", type: "button", textContent: "시작" });
      start.disabled = !flow.runnableToday;
      start.title = flow.runnableToday ? "" : "오늘은 실행할 수 없어요";
      start.addEventListener("click", () => this.options.onStart(flow.id));
      action = start;
    }

    this.detail.replaceChildren(
      el("div", { class: "detail__n", textContent: flow.name }),
      ...rows,
      songs,
      el("div", { class: "detail__b" }, [action, edit, this.addButton()]),
    );
  }

  private closesOf(flow: ScheduledFlow): string {
    if (flow.lock.until.kind === "clock") return flow.lock.until.at;
    const music = flow.parts.find((part) => part.kind === "music");
    return music ? music.endsAt : "음악이 끝나면";
  }
}

function row(label: string, value: HTMLElement): HTMLElement {
  return el("div", { class: "detail__r" }, [el("span", { textContent: label }), value]);
}
