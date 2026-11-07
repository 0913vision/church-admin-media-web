import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import { objectParticle, trackLength } from "../../util/korean.js";
import { isCountdownAudio } from "../../util/flow.js";
import type { AlertOptions } from "./Alert.js";
import type { Rejection } from "../../api/events.js";
import type { LevelAnswer, LevelFailure, LevelMatch, LevelMeter, State, Track } from "../../protocol.js";

/** The level commands that take no arguments: the dialog's keys once a measurement exists. */
export type LevelCommand = "stopLevelMatch" | "resumeLevelMatch" | "applyLevelMatch" | "cancelLevelMatch" | "revertLevelMatch";

export interface LevelMatchOptions {
  onStart: (args: { track: string; meter: LevelMeter; targetDb: number; span: { kind: "whole" } }) => void;
  onCommand: (command: LevelCommand) => void;
  /** Asks before the X32 is touched, over this dialog. */
  onConfirm: (alert: AlertOptions) => void;
  onClose: () => void;
}

type Ran = Extract<LevelMatch, { phase: "measuring" }>;
type Answered = Extract<LevelMatch, { phase: "paused" | "measured" }>;

const TARGET = { MIN: -60, MAX: 0 };
const LEVEL_COMMANDS = new Set<string>(["matchTrackLevel", "stopLevelMatch", "resumeLevelMatch", "applyLevelMatch", "cancelLevelMatch", "revertLevelMatch"]);

/** Why a measurement stopped, as a tag under 멈춤. */
export const LEVEL_FAILED: Record<LevelFailure, string> = {
  stopped: "중지됨",
  gateReleased: "잠금 해제됨",
  deckTaken: "다른 재생 시작",
  deckFailed: "재생 실패",
  deskMoved: "X32 설정 변경됨",
  deskSilent: "X32 미터 없음",
  deskHeld: "X32 사용 중",
  noSignal: "소리 없음",
};

const REFUSED: Record<string, string> = {
  adminUnlocked: "잠금을 걸어야 측정할 수 있습니다",
  flowActive: "자동 진행 중에는 측정할 수 없습니다",
  deckPlaying: "재생 중에는 측정할 수 없습니다",
  deckMuted: "음소거 중에는 측정할 수 없습니다",
  levelMatching: "이미 측정 중입니다",
  notMeasuring: "측정 중이 아닙니다",
  outOfReach: "볼륨 범위를 벗어납니다",
  unknownTrack: "등록되지 않은 곡입니다",
  invalidValue: "값이 올바르지 않습니다",
  consoleHeld: "다른 작업이 X32를 쓰고 있습니다",
};

const MINUS = "−";
/** A level as typed: whole dB stays whole. */
function dbText(db: number): string {
  return `${db < 0 ? MINUS : ""}${Number.isInteger(db) ? Math.abs(db) : Math.abs(db).toFixed(1)}`;
}
/** A reading off the meter, always one decimal. */
function readText(db: number): string {
  return `${db < 0 ? MINUS : ""}${Math.abs(db).toFixed(1)}`;
}
function clock(sec: number): string {
  const whole = Math.max(0, Math.round(sec));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
/** Where a level sits on the meter, −60 dB at the left and 0 at the right. */
function onMeter(db: number): number {
  return Math.min(100, Math.max(0, ((db - TARGET.MIN) / (TARGET.MAX - TARGET.MIN)) * 100));
}
function fact(label: string, value: string): HTMLElement {
  return el("div", {}, [el("dt", { textContent: label }), el("dd", { textContent: value })]);
}

/** What the measured average says, in the words of the result screens. */
export function answerText(answer: LevelAnswer): string {
  if (answer.kind === "reachable") return `볼륨 ${answer.volumeAfter}`;
  if (answer.kind === "outOfReach") return answer.volumeNeeded > 100 ? "100 초과" : "1 미만";
  return "--";
}

/** The 볼륨 튜닝 dialog, drawn as its mockup: the form, the run, and what it came to, at one size. */
// Note(yoochan.kim): what is shown follows levelMatch; only the form is this screen's own.
export class LevelMatchWindow {
  readonly el = el("div", { class: "tn__b" });
  /** The dialog's keys, laid into the foot as they are. */
  readonly keys = el("div", { class: "lm__keys" });

  private tracks: Track[] = [];
  private state: State | null = null;
  private open = false;
  /** The form rather than the server's state: no measurement yet, or 다시 측정 pressed. */
  private setup = true;
  /** A key was pressed and the server has not answered yet. */
  private waiting = false;
  private refused = "";

  private track = "";
  private meter: "output" | "main" | null = null;
  private mainMute = false;
  private picking = false;
  private readonly target = el("input", { class: "tn__in num", type: "text", inputMode: "decimal", placeholder: `${MINUS}60 ~ 0`, autocomplete: "off" }) as HTMLInputElement;

  constructor(private readonly options: LevelMatchOptions) {
    this.target.addEventListener("input", () => {
      this.refused = "";
      this.render();
    });
    // Note(yoochan.kim): the minus as the screen sets it, whichever key typed it.
    this.target.addEventListener("blur", () => {
      this.target.value = this.target.value.replace(/-/g, MINUS);
    });
  }

  setTracks(tracks: Track[]): void {
    this.tracks = tracks.filter((track) => !isCountdownAudio(track));
    this.render();
  }

  setState(state: State): void {
    const before = this.state?.levelMatch;
    this.state = state;
    const now: LevelMatch = state.levelMatch ?? { phase: "idle" };
    if (now.phase === "measuring" || now.phase === "paused") this.setup = false;
    if (JSON.stringify(before) !== JSON.stringify(now)) this.waiting = false;
    this.render();
  }

  /** Opens onto whatever the measurement is doing, or the form when there is none. */
  opened(): void {
    this.open = true;
    this.refused = "";
    this.picking = false;
    this.setup = (this.state?.levelMatch.phase ?? "idle") === "idle";
    this.render();
  }

  closed(): void {
    this.open = false;
    this.picking = false;
  }

  /** A refusal of a level command is this dialog's to show while it is open. */
  onRejected(rejection: Rejection): boolean {
    if (!this.open || !LEVEL_COMMANDS.has(rejection.target)) return false;
    this.waiting = false;
    this.refused = REFUSED[rejection.reason] ?? `거부됐습니다: ${rejection.reason}`;
    this.render();
    return true;
  }

  private render(): void {
    const match = this.state?.levelMatch ?? { phase: "idle" as const };
    if (this.setup || match.phase === "idle") {
      this.renderSetup();
      return;
    }
    if (match.phase === "measuring") this.renderRun(match);
    else if (match.phase === "paused" || match.phase === "measured") this.renderAnswer(match);
    else if (match.phase === "done") this.renderDone(match);
    else this.renderFailed(match);
  }

  // ---------------- 1. the form ----------------

  private renderSetup(): void {
    const chosen = this.tracks.find((track) => track.id === this.track);
    const select = el("button", { class: `tn__sel${chosen ? "" : " is-empty"}`, type: "button" }, chosen
      ? [el("span", { textContent: chosen.title }), el("small", { textContent: trackLength(chosen.durationSec) })]
      : [el("span", { textContent: "곡 선택" })]);
    select.addEventListener("click", () => {
      this.picking = !this.picking;
      this.render();
    });

    const cards = el("div", { class: "tn__cards" }, [
      this.card("output", "재생기 출력", "aux 5/6 입력 미터", this.check("aux 5/6 뮤트", true, false, () => {})),
      this.card("main", "메인 LR 출력", "메인 LR 미터", this.check("메인 LR 뮤트", this.mainMute, this.meter === "main", (next) => {
        this.mainMute = next;
        this.render();
      })),
    ]);

    const bad = this.targetProblem();
    const unit = el("div", { class: `tn__unit${bad ? " is-bad" : ""}` }, [this.target, el("span", { textContent: "dB" })]);

    this.el.replaceChildren(
      el("div", { class: "tn__field tn__pick" }, [el("span", { class: "tn__lab", textContent: "곡" }), select, ...(this.picking ? [this.list()] : [])]),
      el("div", { class: "tn__field" }, [el("span", { class: "tn__lab", textContent: "측정 위치" }), cards]),
      el("div", { class: "tn__pair" }, [el("div", { class: "tn__field" }, [el("span", { class: "tn__lab", textContent: "목표 레벨" }), unit])]),
    );

    const why = this.refused || bad;
    const close = el("button", { class: "btn", type: "button", textContent: "닫기" });
    close.addEventListener("click", () => this.options.onClose());
    const start = el("button", { class: "btn btn--go", type: "button", textContent: "측정" }) as HTMLButtonElement;
    start.disabled = this.waiting || !chosen || this.meter === null || this.targetDb() === null;
    start.addEventListener("click", () => this.ask());
    this.keys.replaceChildren(...(why ? [el("span", { class: "lm__aside is-bad", textContent: why })] : []), close, start);
  }

  /** The library's tracks, name left and length right, under the field. */
  private list(): HTMLElement {
    return el("div", { class: "picker tn__list" }, this.tracks.map((track) => {
      const row = el("button", { class: "picker__row", type: "button" }, [
        el("span", { class: "picker__n", textContent: track.title }),
        el("span", { class: "picker__d", textContent: trackLength(track.durationSec) }),
      ]);
      row.addEventListener("click", () => {
        this.track = track.id;
        this.picking = false;
        this.refused = "";
        this.render();
      });
      return row;
    }));
  }

  private card(kind: "output" | "main", name: string, meter: string, mute: HTMLElement): HTMLElement {
    const card = el("div", { class: `tn__card${this.meter === kind ? " on" : ""}`, role: "radio", tabIndex: 0 }, [
      el("div", { class: "tn__cardT" }, [el("b", { textContent: name }), el("i", { class: "tn__r" })]),
      el("small", { textContent: meter }),
      mute,
    ]);
    card.setAttribute("aria-checked", String(this.meter === kind));
    const choose = (): void => {
      this.meter = kind;
      this.refused = "";
      this.render();
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      choose();
    });
    return card;
  }

  /** The app's tick box; ticked and greyed is one that cannot be taken off. */
  private check(label: string, on: boolean, enabled: boolean, onChange: (next: boolean) => void): HTMLElement {
    const button = el("button", { class: `tn__check${on ? " on" : ""}`, type: "button" }, [
      el("span", { class: "lib__box" }, on ? [icon("check", 13)] : []),
      el("span", { textContent: label }),
    ]) as HTMLButtonElement;
    button.disabled = !enabled;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onChange(!on);
    });
    return button;
  }

  private targetDb(): number | null {
    const typed = this.target.value.trim().replace(new RegExp(MINUS, "g"), "-");
    if (typed === "") return null;
    const db = Number(typed);
    return Number.isFinite(db) && db >= TARGET.MIN && db <= TARGET.MAX ? db : null;
  }

  private targetProblem(): string {
    if (this.target.value.trim() === "" || this.targetDb() !== null) return "";
    return `목표 레벨은 ${MINUS}60에서 0 dB 사이여야 합니다`;
  }

  private ask(): void {
    const track = this.tracks.find((each) => each.id === this.track);
    const targetDb = this.targetDb();
    if (!track || this.meter === null || targetDb === null) return;
    const meter: LevelMeter = this.meter === "output" ? { kind: "output" } : { kind: "main", mute: this.mainMute };
    this.options.onConfirm({
      title: `‘${track.title}’${objectParticle(track.title)} 측정하시겠습니까?`,
      message: meter.kind === "output" ? "측정이 끝날 때까지 X32 aux 5/6이 뮤트됩니다."
        : meter.mute ? "측정이 끝날 때까지 X32 메인 LR이 뮤트됩니다."
        : "측정하는 동안 본당에 곡이 들립니다.",
      action: "측정",
      tone: "go",
      onAction: () => {
        this.waiting = true;
        this.refused = "";
        this.render();
        this.options.onStart({ track: track.id, meter, targetDb, span: { kind: "whole" } });
      },
    });
  }

  // ---------------- 2. the run ----------------

  private renderRun(match: Ran): void {
    const playing = match.stage === "playing";
    const heard = playing && match.averageDb > -120;
    const target = onMeter(match.targetDb);
    const desk = match.meter.kind === "output" ? { tone: "is-bad", text: "aux 5/6 꺼짐" }
      : match.meter.mute ? { tone: "is-bad", text: "메인 LR 꺼짐" }
      : { tone: "is-go", text: "메인 LR 켜짐" };
    // Note(yoochan.kim): the ends of the scale give way to the target's number when it sits on them.
    const scale = [
      ...(target > 10 ? [el("span", { style: "left:0", textContent: `${MINUS}60` })] : []),
      el("span", { class: "is-target", style: `left:${target}%`, textContent: dbText(match.targetDb) }),
      ...(target < 90 ? [el("span", { textContent: "0" })] : []),
    ];

    this.el.replaceChildren(
      this.trackRow(match.track, match.elapsedSec, match.totalSec, true),
      el("div", { class: "tn__now" }, [
        el("span", { class: "tn__lbl", textContent: "평균" }),
        el("div", { class: `tn__num${heard ? "" : " is-wait"}` }, [heard ? readText(match.averageDb) : "--", el("small", { textContent: "dB" })]),
      ]),
      el("dl", { class: "tn__facts" }, [
        fact("현재", playing && match.levelDb > -120 ? `${readText(match.levelDb)} dB` : "--"),
        fact("목표", `${dbText(match.targetDb)} dB`),
      ]),
      el("div", {}, [
        el("div", { class: "tn__meter" }, [
          ...(playing ? [el("i", { style: `width:${onMeter(match.levelDb)}%` })] : []),
          el("div", { class: "tn__mark", style: `left:${target}%` }),
          ...(heard ? [el("div", { class: "tn__avg", style: `left:${onMeter(match.averageDb)}%` })] : []),
        ]),
        el("div", { class: "tn__scale" }, scale),
      ]),
      el("div", { class: "tn__desk" }, [
        el("span", { class: "tn__busy" }, [el("span", { class: "tn__spin" }), playing ? "측정 중" : "X32 맞추는 중"]),
        ...(playing ? [el("span", { class: desk.tone, textContent: desk.text })] : []),
      ]),
    );
    this.keys.replaceChildren(this.key("중지", "btn--stop", "stopLevelMatch"));
  }

  // ---------------- 3. what it came to ----------------

  /** Paused or played to the end: the level it says, not yet applied. */
  private renderAnswer(match: Answered): void {
    const answer = match.answer;
    const out = answer.kind === "outOfReach";
    const number = answer.kind === "reachable" ? String(answer.volumeAfter)
      : answer.kind === "outOfReach" ? String(Math.round(answer.volumeNeeded)) : "--";
    const tag = out ? el("span", { class: "chip tn__tag", textContent: answerText(answer) })
      : el("span", { class: "chip tn__tag tn__tag--wait", textContent: "적용 전" });

    this.el.replaceChildren(
      this.trackRow(match.track, match.elapsedSec, match.totalSec, false),
      el("div", { class: "tn__ans" }, [
        el("span", { class: "tn__lbl", textContent: out ? "필요한 볼륨" : "새 볼륨" }),
        el("div", { class: `tn__num${answer.kind === "none" ? " is-wait" : ""}` }, [number, ...(answer.kind === "none" ? [] : [tag])]),
      ]),
      el("div", { class: "tn__line" }),
      el("dl", { class: "tn__facts" }, [
        fact(out ? "볼륨" : "지금 볼륨", String(match.volumeBefore)),
        fact("평균", answer.kind === "none" ? "--" : `${readText(answer.averageDb)} dB`),
        fact("목표", `${dbText(match.targetDb)} dB`),
      ]),
    );

    const apply = this.key("볼륨 적용", "btn--go", "applyLevelMatch");
    (apply as HTMLButtonElement).disabled ||= answer.kind !== "reachable";
    const paused = match.phase === "paused";
    const keys = paused
      ? [this.key("측정 취소", "", "cancelLevelMatch"), this.key("계속 측정", "", "resumeLevelMatch"), ...(out ? [] : [apply])]
      : out ? [this.again()]
      : [this.key("측정 취소", "", "cancelLevelMatch"), this.again(), apply];
    this.keys.replaceChildren(...this.aside(), ...keys);
  }

  private renderDone(match: Extract<LevelMatch, { phase: "done" }>): void {
    this.el.replaceChildren(
      this.trackRow(match.track, match.elapsedSec, match.totalSec, false),
      el("div", { class: "tn__ans" }, [
        el("span", { class: "tn__lbl", textContent: "새 볼륨" }),
        el("div", { class: "tn__num" }, [String(match.volumeAfter), el("span", { class: "chip tn__tag tn__tag--done", textContent: "적용됨" })]),
      ]),
      el("div", { class: "tn__line" }),
      el("dl", { class: "tn__facts" }, [
        fact("이전 볼륨", String(match.volumeBefore)),
        fact("평균", `${readText(match.averageDb)} dB`),
        fact("목표", `${dbText(match.targetDb)} dB`),
      ]),
    );
    this.keys.replaceChildren(...this.aside(), this.key("되돌리기", "", "revertLevelMatch"), this.again());
  }

  private renderFailed(match: Extract<LevelMatch, { phase: "failed" }>): void {
    this.el.replaceChildren(
      this.trackRow(match.track, match.elapsedSec, match.totalSec, false),
      el("div", { class: "tn__ans" }, [
        el("span", { class: "tn__lbl", textContent: "멈춤" }),
        el("div", { class: "tn__why", textContent: LEVEL_FAILED[match.why] ?? match.why }),
      ]),
      el("div", { class: "tn__line" }),
      el("dl", { class: "tn__facts" }, [
        fact("볼륨", String(match.volumeBefore)),
        fact("평균", "--"),
        fact("목표", `${dbText(match.targetDb)} dB`),
      ]),
    );
    this.keys.replaceChildren(...this.aside(), this.again());
  }

  // ---------------- parts ----------------

  /** What is measured first: its name, how far it has played, and while it runs a bar. */
  private trackRow(id: string, elapsedSec: number, totalSec: number, running: boolean): HTMLElement {
    const title = this.tracks.find((track) => track.id === id)?.title ?? id;
    const done = totalSec > 0 ? Math.min(100, (elapsedSec / totalSec) * 100) : 0;
    return el("div", { class: "tn__track" }, [
      el("div", { class: "tn__trackT" }, [el("span", { textContent: title }), el("small", { textContent: `${clock(elapsedSec)} / ${clock(totalSec)}` })]),
      ...(running ? [el("div", { class: "tn__prog" }, [el("i", { style: `width:${done}%` })])] : []),
    ]);
  }

  private key(label: string, tone: string, command: LevelCommand): HTMLElement {
    const key = el("button", { class: `btn${tone ? ` ${tone}` : ""}`, type: "button", textContent: label }) as HTMLButtonElement;
    key.disabled = this.waiting;
    key.addEventListener("click", () => {
      this.waiting = true;
      this.refused = "";
      this.render();
      this.options.onCommand(command);
    });
    return key;
  }

  /** 다시 측정: back to the form, filled as the last one was. */
  private again(): HTMLElement {
    const key = el("button", { class: "btn", type: "button", textContent: "다시 측정" }) as HTMLButtonElement;
    key.disabled = this.waiting;
    key.addEventListener("click", () => {
      const match = this.state?.levelMatch;
      if (match && match.phase !== "idle") {
        this.track = match.track;
        this.meter = match.meter.kind;
        this.mainMute = match.meter.kind === "main" && match.meter.mute;
        this.target.value = dbText(match.targetDb);
      }
      this.setup = true;
      this.refused = "";
      this.render();
    });
    return key;
  }

  private aside(): HTMLElement[] {
    return this.refused ? [el("span", { class: "lm__aside is-bad", textContent: this.refused })] : [];
  }
}
