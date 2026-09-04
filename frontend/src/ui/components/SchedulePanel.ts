import { el } from "../../util/dom.js";
import type { FlowStatus } from "../../protocol.js";
import type { FlowEntry, ScheduledFlow } from "../../api/device.js";
import type { Track } from "../../protocol.js";
import { FlowEditor } from "./FlowEditor.js";
import { Modal } from "./Modal.js";
import { WeekView } from "./WeekView.js";

export interface SchedulePanelOptions {
  onStart: (flowId: string) => void;
  onStop: () => void;
  onSave: (id: string, entry: FlowEntry) => void;
  onDelete: (id: string) => void;
}

function minutesOf(clock: string): number {
  // Minutes since midnight, from HH:MM or HH:MM:SS. Seconds count as a fraction
  // so a bar drawn from this lands where the music actually starts.
  const [hours, mins, secs] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0) + (secs ?? 0) / 60;
}

/** HH:MM:SS from seconds since midnight. The seconds show even at :00 — a time
    written two ways in one panel reads as two kinds of time. */
function hhmmss(totalSec: number): string {
  const wrapped = ((Math.round(totalSec) % 86400) + 86400) % 86400;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(Math.floor(wrapped / 3600))}:${pad(Math.floor((wrapped % 3600) / 60))}:${pad(wrapped % 60)}`;
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
  private readonly modal: Modal;
  private tracks = new Map<string, Track>();
  private running = false;
  /** The id of the flow the device is running, or "" when none is. */
  private runningId = "";

  constructor(private readonly options: SchedulePanelOptions) {
    this.runBox = el("div", { class: "run is-hidden" });
    this.message = el("p", { class: "sched-msg" });
    this.editor = new FlowEditor({
      onSave: (id, entry) => options.onSave(id, entry),
      onDelete: (id) => options.onDelete(id),
      onCancel: () => this.closeEditor(),
      // Note(yoochan.kim): The calendar draws the draft as it is typed — dashed, red on a clash.
      onChange: (draft) => this.week.setDraft(draft),
    });
    this.week = new WeekView({ onPick: () => this.renderDetail() });
    this.detail = el("div", { class: "detail" });
    this.modal = new Modal();
    this.el = el("div", { class: "week" }, [
      this.week.el,
      el("div", { class: "detail-col" }, [this.detail]),
      this.modal.el,
    ]);
  }

  /** Everything that sits under the week grid, for the view to place. */
  below(): HTMLElement[] {
    return [this.runBox, this.message];
  }

  /** Editing happens over the page; the column beside the week stays a reading of it. */
  private openEditor(flow: Parameters<FlowEditor["open"]>[0]): void {
    this.editor.open(flow);
    // Note(yoochan.kim): whichever way it is dismissed — the ✕, the backdrop, Escape
    // — the draft has to come off the calendar, so that is the modal's own close.
    this.modal.open(flow ? flow.name : "새 자동 진행", this.editor.el, () => this.editor.close(), this.editor.actions());
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
    this.modal.close();
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
    this.runningId = status.phase === "idle" ? "" : status.id;
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
      row("시작", el("span", { textContent: flow.autoStart ? "자동으로 시작" : "직접 눌러서 시작" })),
      row("잠금", el("span", { class: "num", textContent: `${hhmmss(minutesOf(flow.lock.at) * 60)} → ${this.closesOf(flow)}` })),
    ];

    // Note(yoochan.kim): The music line and the per-track list carry computed start times: the
    // schedule stores when the music *ends*, and the tracks' lengths say when
    // each one begins.
    const songs = el("div", { class: "detail__songs" });
    if (!music) rows.push(row("음악", el("span", { textContent: "없음" })));
    if (music) {
      // Note(yoochan.kim): in seconds, since track lengths are not whole minutes and
      // rounding each one walks the later songs away from where they really begin.
      const lengths = music.tracks.map((cue) => this.tracks.get(cue.id)?.durationSec ?? 0);
      const total = lengths.reduce((sum, seconds) => sum + seconds, 0);
      const startsAt = minutesOf(music.endsAt) * 60 - total;
      rows.push(row("음악", el("span", { class: "num", textContent: `${hhmmss(startsAt)} → ${hhmmss(minutesOf(music.endsAt) * 60)}` })));

      let cursor = startsAt;
      music.tracks.forEach((cue, index) => {
        songs.append(
          el("div", {}, [
            el("span", { textContent: `${index + 1}. ${this.tracks.get(cue.id)?.title ?? cue.id}` }),
            // A time and a level are different kinds of thing, so they are told
            // apart by a rule rather than by a character in the middle of a string.
            el("span", { class: "detail__cue num" }, [
              el("span", { textContent: hhmmss(cursor) }),
              el("span", { class: "detail__vol", textContent: `볼륨 ${cue.volume}` }),
            ]),
          ]),
        );
        cursor += lengths[index]!;
      });
    }

    // Note(yoochan.kim): the device owns its run, so a save here would change the
    // calendar without changing what is playing.
    const edit = el("button", { class: "pick", type: "button", textContent: "편집" }) as HTMLButtonElement;
    edit.disabled = this.runningId === flow.id;
    if (edit.disabled) edit.title = "진행 중에는 편집할 수 없어요";
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
      el("div", { class: "detail__b" }, [action, edit]),
    );
  }

  private closesOf(flow: ScheduledFlow): string {
    if (flow.lock.until.kind === "clock") return hhmmss(minutesOf(flow.lock.until.at) * 60);
    const music = flow.parts.find((part) => part.kind === "music");
    return music ? hhmmss(minutesOf(music.endsAt) * 60) : "음악이 끝나면";
  }
}

function row(label: string, value: HTMLElement): HTMLElement {
  return el("div", { class: "detail__r" }, [el("span", { textContent: label }), value]);
}
