import { el } from "../../util/dom.js";
import { ChurchClock, changeOf, driftOf, hhmmOf, noOffset, ssOf, standingOf } from "../../util/churchClock.js";

interface ClockPanelOptions {
  clock: ChurchClock;
  onOffset: (offsetSec: number) => void;
}

/** Each group's steps, largest first on the slow side so both run outward from the middle. */
const SLOWER = [60, 10, 1];
const FASTER = [1, 10, 60];

function stepLabel(stepSec: number): string {
  return stepSec === 60 ? "1분" : `${stepSec}초`;
}

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

  // Placeholders until the first beat: see the note on the dashboard's clock.
  private readonly church = el("div", { class: "ck__big", textContent: "--:--" });
  private readonly standard = el("div", { class: "ck__ref", textContent: "--:--:--" });
  private readonly drift = el("div", { class: "ck__off" });
  private readonly standing = el("span", { class: "ckset__now" });
  private readonly last = el("div", { class: "ckset__last" });
  private readonly steps = el("div", { class: "ckset" });
  private readonly tap = el("div", { class: "tap" });
  private readonly locked = el("span", { class: "gate on is-hidden" }, [
    el("span", { class: "led led--bad" }),
    el("span", { class: "gate__v", textContent: "잠금 중 변경 불가" }),
  ]);

  private offsetSec = 0;
  private gated = false;
  private armed = false;
  private readonly onOffset: ClockPanelOptions["onOffset"];
  private readonly clock: ChurchClock;

  constructor(options: ClockPanelOptions) {
    this.clock = options.clock;
    this.onOffset = options.onOffset;

    // Note(yoochan.kim): said the way a clock is talked about, 빠르게 and 느리게, with the
    // sign kept on each key. A bare "+1초" left open what was a second ahead of what.
    const group = (label: string, steps: number[], sign: number): void => {
      this.steps.append(el("span", { class: "ckset__g", textContent: label }));
      for (const step of steps) {
        const button = el("button", {
          class: "pick",
          type: "button",
          textContent: `${sign > 0 ? "+" : "−"}${stepLabel(step)}`,
        });
        button.addEventListener("click", () => this.nudge(sign * step));
        this.steps.append(button);
      }
    };
    group("느리게", SLOWER, -1);
    group("빠르게", FASTER, 1);
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
          this.standing,
          this.locked,
        ]),
        this.steps,
        this.tap,
        this.last,
      ]),
    ]);

    this.renderTap();
    this.clock.start((now) => this.tick(now));
    document.addEventListener("keydown", (event) => this.onKey(event));
  }

  /** The offset as the device reports it, plus whether the gate is holding. */
  setOffset(offsetSec: number): void {
    this.offsetSec = offsetSec;
    this.standing.textContent = `지금: ${standingOf(offsetSec)}`;
    this.drift.textContent = driftOf(offsetSec);
    this.drift.classList.toggle("is-off", !noOffset(offsetSec));
  }

  setGated(gated: boolean): void {
    if (this.gated === gated) return;
    this.gated = gated;
    if (gated) this.armed = false;
    this.locked.classList.toggle("is-hidden", !gated);
    this.steps.classList.toggle("is-off", gated);
    this.renderTap();
  }

  /** Each clock from its own source, so neither is derived from a stale other. */
  private tick(now: Date): void {
    const standard = this.clock.standardNow();
    this.standard.textContent = `${hhmmOf(standard)}:${ssOf(standard)}`;
    this.church.replaceChildren(hhmmOf(now), el("s", { textContent: `:${ssOf(now)}` }));
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
   * the step buttons made them. Kept to the millisecond: rounded to a second,
   * the press could land half a second either side of the flip it was made on.
   */
  private markNow(): void {
    const now = this.clock.now();
    const secondsIntoMinute = now.getSeconds() + now.getMilliseconds() / 1000;
    const correction = secondsIntoMinute > 30 ? 60 - secondsIntoMinute : -secondsIntoMinute;
    const next = Math.round((this.offsetSec + correction) * 1000) / 1000;
    this.armed = false;
    // Note(yoochan.kim): the minute it was set to, not the one it was pressed in — pressed at
    // 22:23:59.6, the clock now says 22:24.
    const setTo = new Date(now.getTime() + correction * 1000);
    this.last.textContent = `마지막 보정 ${hhmmOf(setTo)}에 ${changeOf(correction)}`;
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
