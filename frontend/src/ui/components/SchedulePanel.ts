import { el } from "../../util/dom.js";
import type { ScheduleActive, ScheduleFlow, ScheduleSnapshot } from "../../domain/protocol.js";
import { icon } from "../icons.js";

export interface SchedulePanelOptions {
  onStart: (flowId: string) => void;
  onStop: () => void;
}

export const PHASE_LABEL: Record<ScheduleActive["phase"], string> = {
  waiting_lock: "잠금 대기",
  waiting_play: "재생 대기",
  playing: "재생 중",
  waiting_unlock: "잠금 유지 중",
};

function toClock(iso: string): string {
  return iso.slice(11, 16);
}

// Flow list + the currently running flow. A flow row explains itself
// (weekday, timeline, track count); the run card shows phase, current track
// and when the admin lock will be released.
export class SchedulePanel {
  readonly el: HTMLElement;
  private readonly runBox: HTMLElement;
  private readonly listBox: HTMLElement;
  private readonly message: HTMLElement;
  private snapshotCache: ScheduleSnapshot = { flows: [], active: null };

  constructor(private readonly options: SchedulePanelOptions) {
    this.runBox = el("div", { class: "run is-hidden" });
    this.listBox = el("div", { class: "flows" });
    this.message = el("p", { class: "sched-msg" });
    this.el = el("div", { class: "sched" }, [this.runBox, this.listBox, this.message]);
  }

  showMessage(text: string): void {
    this.message.textContent = text;
  }

  update(snapshot: ScheduleSnapshot): void {
    this.snapshotCache = snapshot;
    this.message.textContent = "";
    this.renderRun(snapshot.active);
    this.renderFlows(snapshot.flows, snapshot.active !== null);
  }

  private renderRun(active: ScheduleActive | null): void {
    this.runBox.classList.toggle("is-hidden", active === null);
    if (!active) {
      this.runBox.replaceChildren();
      return;
    }

    const stop = el("button", { class: "btn btn--danger", type: "button", textContent: "중단" });
    stop.addEventListener("click", () => this.options.onStop());

    const detail =
      active.track !== null
        ? `${active.track.index}/${active.track.total} · ${active.track.title}`
        : active.playAt !== null && active.phase === "waiting_play"
          ? `${toClock(active.playAt)} 재생 시작`
          : "관리자 락이 유지되고 있습니다";

    this.runBox.replaceChildren(
      el("div", { class: "run__head" }, [
        el("span", { class: "run__eq" }, [icon("clock", 18)]),
        el("span", { class: "run__name", textContent: active.name }),
        el("span", { class: "badge is-live", textContent: PHASE_LABEL[active.phase] }),
        stop,
      ]),
      el("div", { class: "run__meta" }, [
        el("span", { textContent: detail }),
        el("span", { textContent: `${toClock(active.unlockAt)}에 관리자 락 해제` }),
      ]),
    );
  }

  private renderFlows(flows: ScheduleFlow[], running: boolean): void {
    if (flows.length === 0) {
      this.listBox.replaceChildren(
        el("div", { class: "empty" }, [
          el("span", { class: "empty__icon" }, [icon("clock", 26)]),
          el("span", { class: "empty__title", textContent: "등록된 스케줄이 없습니다" }),
          el("span", { class: "empty__desc", textContent: "스케줄 설정 파일에 플로우를 추가하면 여기에 표시됩니다." }),
        ]),
      );
      return;
    }

    this.listBox.replaceChildren(
      ...flows.map((flow) => {
        const start = el("button", { class: "btn btn--small", type: "button", textContent: "시작" });
        start.disabled = running;
        start.addEventListener("click", () => this.options.onStart(flow.id));

        const parts = [`${flow.weekdayLabels.join("·")}요일`];
        if (flow.playAt !== null && flow.tracks.length > 0) {
          parts.push(`${flow.playAt} 재생 · ${flow.tracks.length}곡`);
        }
        parts.push(`${flow.lockAt} 잠금 → ${flow.unlockAt} 해제`);
        const meta = parts.join(" · ");

        return el("div", { class: "flow" }, [
          el("div", { class: "flow__text" }, [
            el("span", { class: "flow__name", textContent: flow.name }),
            el("span", { class: "flow__meta", textContent: meta }),
          ]),
          start,
        ]);
      }),
    );
  }

  get snapshot(): ScheduleSnapshot {
    return this.snapshotCache;
  }
}
