import { el } from "../../util/dom.js";
import { ChurchClock, driftOf, hhmmOf, signedOf, ssOf } from "../../util/churchClock.js";

interface ClockPanelOptions {
  clock: ChurchClock;
  onOffset: (offsetSec: number) => void;
}

const STEPS = [-60, -10, -1, 1, 10, 60];

/**
 * The clock tab: what time this building is on, and how to correct it.
 *
 * Correcting the seconds is done the way watches are set — wait for the wall
 * clock to flip, press the key on the flip. Arming is explicit: a page that
 * quietly listens for the space bar would eventually eat a stray press and move
 * a clock the whole building follows.
 */
export class ClockPanel {
  readonly el: HTMLElement;

  private readonly church = el("div", { class: "ck__big" });
  private readonly standard = el("div", { class: "ck__ref" });
  private readonly drift = el("div", { class: "ck__off" });
  private readonly value = el("span", { class: "ckset__v" });
  private readonly last = el("span", { class: "tap__last" });
  private readonly steps = el("div", { class: "ckset" });
  private readonly tap = el("div", { class: "tap" });
  private readonly locked = el("span", { class: "gate on is-hidden" }, [
    el("span", { class: "led led--bad" }),
    el("span", { class: "gate__v", textContent: "잠금 중 변경 불가" }),
  ]);

  private offsetSec = 0;
  /**
   * The offset that was in force when the clock last synced. It lags `offsetSec`
   * between a correction and the next heartbeat, and taking it out is what turns
   * the synced reading back into standard time.
   */
  private syncedOffsetSec = 0;
  private gated = false;
  private armed = false;
  private readonly onOffset: ClockPanelOptions["onOffset"];
  private readonly clock: ChurchClock;

  constructor(options: ClockPanelOptions) {
    this.clock = options.clock;
    this.onOffset = options.onOffset;

    for (const step of STEPS) {
      const button = el("button", {
        class: "pick",
        type: "button",
        textContent: `${step > 0 ? "+" : "−"}${Math.abs(step) === 60 ? "1분" : `${Math.abs(step)}초`}`,
      });
      button.addEventListener("click", () => this.nudge(step));
      this.steps.append(button);
      if (step === -1) this.steps.append(this.value);
    }
    const clear = el("button", { class: "pick ckset__clear", type: "button", textContent: "보정 제거" });
    clear.addEventListener("click", () => this.apply(0));
    this.steps.append(clear);

    this.el = el("div", { class: "clockpanel" }, [
      el("div", { class: "tl" }, [
        el("div", { class: "ck" }, [
          el("div", {}, [el("div", { class: "ck__l", textContent: "교회 시각" }), this.church]),
          el("div", {}, [
            el("div", { class: "ck__l", textContent: "표준 시각 (KST)" }),
            this.standard,
            this.drift,
          ]),
        ]),
      ]),
      el("div", { class: "tl" }, [
        el("div", { class: "tl__head" }, [
          el("b", { textContent: "보정" }),
          this.last,
          this.locked,
        ]),
        this.steps,
        this.tap,
      ]),
    ]);

    this.renderTap();
    this.clock.onSync(() => { this.syncedOffsetSec = this.offsetSec; });
    this.clock.start((now) => this.tick(now));
    document.addEventListener("keydown", (event) => this.onKey(event));
  }

  /** The offset as the device reports it, plus whether the gate is holding. */
  setOffset(offsetSec: number): void {
    this.offsetSec = offsetSec;
    this.value.textContent = offsetSec === 0 ? "0초" : signedOf(offsetSec);
    this.drift.textContent = driftOf(offsetSec);
    this.drift.classList.toggle("is-off", offsetSec !== 0);
  }

  setGated(gated: boolean): void {
    if (this.gated === gated) return;
    this.gated = gated;
    if (gated) this.armed = false;
    this.locked.classList.toggle("is-hidden", !gated);
    this.steps.classList.toggle("is-off", gated);
    this.renderTap();
  }

  /**
   * Note(yoochan.kim): standard time is the anchor and church time is derived from
   * it, not the other way round. The heartbeat that syncs the church clock comes
   * every 30s, so deriving standard by subtracting the offset from it left the
   * church reading stale while standard jumped — a correction of +1분 appeared as
   * standard time going back a minute, which is the one thing it never does.
   */
  private tick(now: Date): void {
    const standard = new Date(now.getTime() - this.syncedOffsetSec * 1000);
    this.standard.textContent = `${hhmmOf(standard)}:${ssOf(standard)}`;
    const church = new Date(standard.getTime() + this.offsetSec * 1000);
    this.church.replaceChildren(hhmmOf(church), el("s", { textContent: `:${ssOf(church)}` }));
  }

  private nudge(stepSec: number): void {
    this.apply(this.offsetSec + stepSec);
  }

  private apply(offsetSec: number): void {
    if (this.gated) return;
    this.onOffset(offsetSec);
  }

  /**
   * Sets the seconds from a keypress: the moment pressed becomes the top of the
   * nearest minute. Only ever moves within ±30s, so the minutes stay whatever
   * the step buttons made them.
   */
  private markNow(): void {
    const now = this.clock.now();
    const secondsIntoMinute = now.getSeconds() + now.getMilliseconds() / 1000;
    const correction = secondsIntoMinute > 30 ? 60 - secondsIntoMinute : -secondsIntoMinute;
    const next = Math.round(this.offsetSec + correction);
    this.armed = false;
    this.last.textContent = `마지막 보정 ${hhmmOf(now)}  ${signedOf(Math.round(correction))}`;
    this.renderTap();
    this.apply(next);
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.armed || event.code !== "Space") return;
    event.preventDefault();
    this.markNow();
  }

  private renderTap(): void {
    this.tap.classList.toggle("is-armed", this.armed);
    this.tap.classList.toggle("is-off", this.gated);

    if (this.armed) {
      const cancel = el("button", { class: "pick", type: "button", textContent: "취소" });
      cancel.addEventListener("click", () => {
        this.armed = false;
        this.renderTap();
      });
      this.tap.replaceChildren(
        el("span", { class: "led led--hold" }),
        el("span", { class: "tap__t" }, [
          el("b", { textContent: "분이 바뀔 때" }),
          el("kbd", { class: "kbd", textContent: "Space" }),
          "를 누르세요",
        ]),
        cancel,
      );
      return;
    }

    const start = el("button", { class: "pick", type: "button", textContent: "초 맞추기" });
    start.disabled = this.gated;
    start.addEventListener("click", () => {
      if (this.gated) return;
      this.armed = true;
      this.renderTap();
    });
    this.tap.replaceChildren(
      start,
      el("span", { class: "tap__t" }, [
        "교회 시계가 바뀔 때를 보고 ",
        el("kbd", { class: "kbd", textContent: "Space" }),
        "를 눌러 맞출 수 있어요",
      ]),
    );
  }
}
