import { el } from "../../util/dom.js";
import type { FlowStatus } from "../../protocol.js";
import type { ScheduledFlow } from "../../api/device.js";
import { icon } from "../icons.js";

export interface SchedulePanelOptions {
  onStart: (flowId: string) => void;
  onStop: () => void;
}

/** One line describing what a part of a flow will do */
function describePart(part: ScheduledFlow["parts"][number]): string {
  if (part.kind === "lock") return `${part.at} 잠금 → ${part.until} 해제`;
  return `${part.endsAt}에 끝나도록 ${part.tracks.length}곡`;
}

/**
 * The flows this dashboard offers, plus whatever the media server is running.
 *
 * Those are two different things and are kept apart on purpose: the list is
 * this side's schedule, while the running flow is the device's own status and
 * arrives with the rest of its state.
 */
export class SchedulePanel {
  readonly el: HTMLElement;
  private readonly runBox: HTMLElement;
  private readonly listBox: HTMLElement;
  private readonly message: HTMLElement;
  private flows: ScheduledFlow[] = [];
  private running = false;

  constructor(private readonly options: SchedulePanelOptions) {
    this.runBox = el("div", { class: "run is-hidden" });
    this.listBox = el("div", { class: "flows" });
    this.message = el("p", { class: "sched-msg" });
    this.el = el("div", { class: "sched" }, [this.runBox, this.listBox, this.message]);
  }

  showMessage(text: string): void {
    this.message.textContent = text;
  }

  setFlows(flows: ScheduledFlow[]): void {
    this.flows = flows;
    this.renderFlows();
  }

  setStatus(status: FlowStatus): void {
    this.message.textContent = "";
    this.renderRun(status);
    this.renderFlows();
  }

  private renderRun(status: FlowStatus): void {
    if (status.phase === "idle") {
      this.running = false;
      this.runBox.classList.add("is-hidden");
      this.runBox.replaceChildren();
      return;
    }

    const described = describeStatus(status);
    if (!described.known) {
      // A phase this build does not know is a fault, not a quiet case: showing
      // nothing here would read as "no flow is running", which may be false.
      this.running = true;
      this.runBox.classList.remove("is-hidden");
      this.runBox.replaceChildren(
        el("div", { class: "run__head" }, [
          el("span", { class: "run__eq" }, [icon("clock", 18)]),
          el("span", { class: "run__name", textContent: "알 수 없는 상태" }),
          el("span", { class: "badge is-bad", textContent: "업데이트 필요" }),
        ]),
        el("div", { class: "run__meta" }, [
          el("span", { textContent: "서버가 이 버전이 모르는 상태를 보고했습니다. 화면을 믿지 마십시오." }),
        ]),
      );
      return;
    }

    const stop = el("button", { class: "btn btn--danger", type: "button", textContent: "중단" });
    stop.addEventListener("click", () => this.options.onStop());

    this.running = true;
    this.runBox.classList.remove("is-hidden");
    this.runBox.replaceChildren(
      el("div", { class: "run__head" }, [
        el("span", { class: "run__eq" }, [icon("clock", 18)]),
        el("span", { class: "run__name", textContent: described.name }),
        el("span", { class: "badge is-live", textContent: described.phase }),
        stop,
      ]),
      el("div", { class: "run__meta" }, described.details.map((text) => el("span", { textContent: text }))),
    );
  }

  private renderFlows(): void {
    if (this.flows.length === 0) {
      this.listBox.replaceChildren(
        el("div", { class: "empty" }, [
          el("span", { class: "empty__icon" }, [icon("clock", 26)]),
          el("span", { class: "empty__title", textContent: "등록된 순서가 없습니다" }),
          el("span", { class: "empty__desc", textContent: "스케줄 설정 파일에 순서를 추가하면 여기에 표시됩니다." }),
        ]),
      );
      return;
    }

    this.listBox.replaceChildren(
      ...this.flows.map((flow) => {
        const start = el("button", { class: "btn btn--small", type: "button", textContent: "시작" });
        start.disabled = this.running || !flow.runnableToday;
        start.title = flow.runnableToday ? "" : "오늘은 실행할 수 없는 순서입니다";
        start.addEventListener("click", () => this.options.onStart(flow.id));

        const meta = [`${flow.weekdayLabels.join("·")}요일`, ...flow.parts.map(describePart)].join(" · ");

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
}

type Described = { known: false } | { known: true; name: string; phase: string; details: string[] };

/** Turns a flow status into what to show, one branch per phase. */
export function describeStatus(status: FlowStatus): Described {
  switch (status.phase) {
    case "idle":
      return { known: true, name: "", phase: "", details: [] };
    case "waiting":
      return { known: true, name: status.name, phase: "대기 중", details: [`${status.startsAt}에 시작`] };
    case "playing":
      return {
        known: true,
        name: status.name,
        phase: "재생 중",
        details: [`${status.track.index}/${status.track.total} · ${status.track.title}`, `${status.endsAt}에 종료`],
      };
    case "holding":
      return {
        known: true,
        name: status.name,
        phase: "잠금 유지 중",
        details: [`${status.unlockAt}에 관리자 락 해제`],
      };
    default:
      return { known: false };
  }
}
