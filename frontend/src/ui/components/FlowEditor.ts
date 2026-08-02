import { el } from "../../util/dom.js";
import type { Track } from "../../protocol.js";
import type { FlowEntry, ScheduledFlow } from "../../api/device.js";
import type { FlowDraft } from "./WeekView.js";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Sunday first, matching the calendar next to this editor.
const DAY_CHOICES: { day: number; label: string }[] = [
  { day: 6, label: "주일" },
  { day: 0, label: "월" }, { day: 1, label: "화" }, { day: 2, label: "수" },
  { day: 3, label: "목" }, { day: 4, label: "금" }, { day: 5, label: "토" },
];

export interface FlowEditorOptions {
  onSave: (id: string, entry: FlowEntry) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  /** Every keystroke, so the calendar can draw the flow before it exists. */
  onChange?: (draft: FlowDraft | null) => void;
}

/**
 * Writes one flow: which songs, in what order, when the music ends, and how
 * long the panel stays locked.
 *
 * The gate normally closes with the music, so that is a checkbox rather than a
 * second time to keep in step by hand — and it is stored as that intent, so
 * moving the music moves the gate with it. Unticking it is for the services
 * where the lock outlives the songs.
 */
export class FlowEditor {
  readonly el: HTMLElement;

  private id = "";
  private name = "";
  private weekdays = new Set<number>();
  private lockAt = "19:30";
  private lockUntil = "21:30";
  private followsMusic = true;
  private autoStart = false;
  private trackIds: string[] = [];
  private endsAt = "20:00";
  private tracks: Track[] = [];

  constructor(private readonly options: FlowEditorOptions) {
    this.el = el("div", { class: "editor is-hidden" });
  }

  setTracks(tracks: Track[]): void {
    this.tracks = tracks;
  }

  close(): void {
    this.el.classList.add("is-hidden");
    this.el.replaceChildren();
    this.options.onChange?.(null);
  }

  /** Where this draft sits on the week, for the calendar's dashed preview. */
  private emit(): void {
    const closes = this.followsMusic && this.trackIds.length > 0 ? this.endsAt : this.lockUntil;
    this.options.onChange?.({
      id: this.id,
      weekdays: [...this.weekdays],
      opens: asMinutes(this.lockAt),
      closes: asMinutes(closes),
    });
  }

  /** Opens on an existing flow, or on a blank one when none is given. */
  open(flow: ScheduledFlow | null): void {
    const music = flow?.parts.find((part) => part.kind === "music");
    this.id = flow?.id ?? `flow-${Date.now().toString(36)}`;
    this.name = flow?.name ?? "";
    this.weekdays = new Set(flow?.weekdays ?? []);
    this.lockAt = flow?.lock.at ?? "19:30";
    this.followsMusic = flow ? flow.lock.until.kind === "music" : false;
    this.lockUntil = flow && flow.lock.until.kind === "clock" ? flow.lock.until.at : "21:30";
    this.autoStart = flow?.autoStart ?? false;
    this.trackIds = music ? [...music.tracks] : [];
    this.endsAt = music?.endsAt ?? "20:00";

    this.el.classList.remove("is-hidden");
    this.render(flow !== null);
    this.emit();
  }

  private render(existing: boolean): void {
    this.el.replaceChildren(
      this.field("이름", this.text(this.name, (value) => { this.name = value; })),
      this.field("요일", this.weekdayRow()),
      this.field("잠금 시작", this.time(this.lockAt, (value) => { this.lockAt = value; this.emit(); })),
      this.field("곡", this.trackList()),
      ...(this.trackIds.length > 0
        ? [this.field("음악 마치는 시각", this.time(this.endsAt, (value) => { this.endsAt = value; this.emit(); this.render(existing); }))]
        : []),
      this.field("잠금 해제", this.unlockRow()),
      this.field("시작", this.autoRow()),
      this.summary(),
      this.buttons(existing),
    );
  }

  // --- fields ---

  private field(label: string, control: HTMLElement): HTMLElement {
    return el("label", { class: "editor__row" }, [
      el("span", { class: "editor__label", textContent: label }),
      control,
    ]);
  }

  /** Two ways to start, so it reads as a choice rather than a toggle. */
  private autoRow(): HTMLElement {
    const choice = (label: string, value: boolean): HTMLElement => {
      const button = el("button", {
        class: this.autoStart === value ? "on" : "",
        type: "button",
        textContent: label,
      });
      button.addEventListener("click", () => {
        this.autoStart = value;
        this.render(true);
      });
      return button;
    };
    return el("div", { class: "segctl" }, [choice("눌러야 시작해요", false), choice("자동으로 시작해요", true)]);
  }

  private text(value: string, onInput: (value: string) => void): HTMLElement {
    const input = el("input", { class: "editor__input", type: "text", value });
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  private time(value: string, onInput: (value: string) => void): HTMLElement {
    const input = el("input", { class: "editor__input", type: "time", value });
    input.addEventListener("input", () => { if (input.value) onInput(input.value); });
    return input;
  }

  private weekdayRow(): HTMLElement {
    return el(
      "div",
      { class: "segctl" },
      DAY_CHOICES.map(({ day, label }) => {
        const button = el("button", { type: "button", textContent: label });
        button.classList.toggle("on", this.weekdays.has(day));
        button.addEventListener("click", () => {
          if (this.weekdays.has(day)) this.weekdays.delete(day);
          else this.weekdays.add(day);
          button.classList.toggle("on", this.weekdays.has(day));
          this.emit();
        });
        return button;
      }),
    );
  }

  /**
   * The order as numbered rows, and every library track as an add button
   * underneath — nothing hides in a dropdown.
   */
  private trackList(): HTMLElement {
    const rows = this.trackIds.map((id, index) => {
      const track = this.tracks.find((candidate) => candidate.id === id);
      const label = track ? track.title : `${id} (등록되지 않은 곡)`;
      return el("div", { class: "editor__track" }, [
        el("span", { class: "editor__track-no", textContent: `${index + 1}.` }),
        el("span", { class: "editor__track-name", textContent: label }),
        el("span", { class: "editor__track-len", textContent: track ? minutes(track.durationSec) : "" }),
        this.smallButton("↑", "위로", () => this.move(index, -1)),
        this.smallButton("↓", "아래로", () => this.move(index, 1)),
        this.smallButton("✕", "빼기", () => {
          this.trackIds.splice(index, 1);
          this.emit();
          this.render(true);
        }),
      ]);
    });

    const adders = el(
      "div",
      { class: "editor__adders" },
      this.tracks.map((track) => {
        const add = el("button", { class: "textbtn textbtn--add", type: "button", textContent: `+ ${track.title}` });
        add.addEventListener("click", () => {
          this.trackIds.push(track.id);
          this.emit();
          this.render(true);
        });
        return add;
      }),
    );

    return el("div", { class: "editor__tracks" }, [...rows, adders]);
  }

  /** The gate closes with the music, or at a time of its own — a choice. */
  private unlockRow(): HTMLElement {
    const follows = this.followsMusic && this.trackIds.length > 0;
    const choice = (label: string, value: boolean, disabled = false): HTMLElement => {
      const button = el("button", { class: follows === value ? "on" : "", type: "button", textContent: label });
      button.disabled = disabled;
      button.addEventListener("click", () => {
        this.followsMusic = value;
        this.emit();
        this.render(true);
      });
      return button;
    };

    const children: HTMLElement[] = [
      el("div", { class: "segctl" }, [
        choice("음악이 끝나면", true, this.trackIds.length === 0),
        choice("시각을 정해서", false),
      ]),
    ];
    if (!follows) {
      children.push(this.time(this.lockUntil, (value) => { this.lockUntil = value; this.emit(); this.render(true); }));
    }
    return el("div", { class: "editor__unlock" }, children);
  }

  // --- summary ---

  /**
   * What this schedule actually does, worked out the same way the media server
   * will. A flow the server would refuse is better caught here, before someone
   * presses start during a service.
   */
  private summary(): HTMLElement {
    const lines: [string, string][] = [];
    const warnings: string[] = [];

    const totalSec = this.trackIds.reduce(
      (sum, id) => sum + (this.tracks.find((track) => track.id === id)?.durationSec ?? 0),
      0,
    );
    const closesAt = this.followsMusic && this.trackIds.length > 0 ? this.endsAt : this.lockUntil;
    lines.push(["잠금", `${this.lockAt} → ${closesAt}`]);

    if (this.trackIds.length > 0) {
      const startsAt = minusSeconds(this.endsAt, totalSec);
      const cut = asMinutes(startsAt) < asMinutes(this.lockAt) ? ", 앞 잘림" : "";
      lines.push(["음악", `${startsAt} → ${this.endsAt} (${this.trackIds.length}곡${cut})`]);
      // Only the finish is bound to the lock window: a timeline that begins
      // earlier just has its front cut, so an early start is not an error.
      if (asMinutes(this.endsAt) <= asMinutes(this.lockAt)) {
        warnings.push("음악이 잠금 시작 전에 끝나요");
      }
      if (asMinutes(this.endsAt) > asMinutes(closesAt)) {
        warnings.push("음악이 잠금 해제보다 늦게 끝나요");
      }
    }
    if (this.weekdays.size === 0) warnings.push("요일이 비어 있어요");
    if (!this.name.trim()) warnings.push("이름이 비어 있어요");
    if (asMinutes(closesAt) <= asMinutes(this.lockAt)) {
      warnings.push("잠금 해제가 잠금 시작보다 빨라요");
    }

    return el("div", { class: "editor__summary num" }, [
      ...lines.map(([label, value]) =>
        el("div", { class: "editor__srow" }, [
          el("span", { textContent: label }),
          el("span", { textContent: value }),
        ]),
      ),
      ...warnings.map((line) => el("span", { class: "editor__warn", textContent: line })),
    ]);
  }

  private buttons(existing: boolean): HTMLElement {
    const save = el("button", { class: "btn btn--go", type: "button", textContent: "저장" });
    save.addEventListener("click", () => this.options.onSave(this.id, this.entry()));

    const cancel = el("button", { class: "btn", type: "button", textContent: "취소" });
    cancel.addEventListener("click", () => this.options.onCancel());

    const children = [save, cancel];
    if (existing) {
      const remove = el("button", { class: "btn btn--stop", type: "button", textContent: "삭제" });
      remove.addEventListener("click", () => this.options.onDelete(this.id));
      children.push(remove);
    }
    return el("div", { class: "editor__buttons" }, children);
  }

  private entry(): FlowEntry {
    const follows = this.followsMusic && this.trackIds.length > 0;
    return {
      name: this.name.trim(),
      weekdays: [...this.weekdays].sort().map((day) => WEEKDAY_KEYS[day]!),
      autoStart: this.autoStart,
      lock: {
        at: this.lockAt,
        until: follows ? { kind: "music" } : { kind: "clock", at: this.lockUntil },
      },
      parts:
        this.trackIds.length > 0
          ? [{ kind: "music", tracks: [...this.trackIds], endsAt: this.endsAt }]
          : [],
    };
  }

  private move(index: number, by: number): void {
    const to = index + by;
    if (to < 0 || to >= this.trackIds.length) return;
    const [moved] = this.trackIds.splice(index, 1);
    this.trackIds.splice(to, 0, moved!);
    this.emit();
    this.render(true);
  }

  private smallButton(glyph: string, title: string, onClick: () => void): HTMLElement {
    const tone = glyph === "✕" ? " textbtn--bad" : "";
    const button = el("button", { class: `textbtn${tone}`, type: "button", title, textContent: glyph });
    button.addEventListener("click", onClick);
    return button;
  }
}

function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)}분`;
}

function asMinutes(clock: string): number {
  const [hours, mins] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0);
}

function minusSeconds(clock: string, seconds: number): string {
  const total = (asMinutes(clock) * 60 - Math.round(seconds) + 24 * 3600) % (24 * 3600);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
