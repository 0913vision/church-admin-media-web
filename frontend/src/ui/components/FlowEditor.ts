import { el } from "../../util/dom.js";
import type { ScheduledTrack, Track } from "../../protocol.js";
import type { FlowEntry, ScheduledFlow } from "../../api/device.js";
import type { FlowDraft } from "./WeekView.js";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Note(yoochan.kim): Sunday first, matching the calendar next to this editor.
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
  private cues: ScheduledTrack[] = [];
  private endsAt = "20:00";
  private tracks: Track[] = [];
  /**
   * The one part that changes as you type. Lasting, not remade by `render`:
   * redrawing the editor replaced the box being typed into and lost its focus.
   */
  private readonly summaryEl = el("div", { class: "editor__summary num" });
  /** Lives in the dialog's head, so it is held rather than redrawn with the form. */
  private saveButton: HTMLButtonElement | null = null;

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
    const closes = this.followsMusic && this.cues.length > 0 ? this.endsAt : this.lockUntil;
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
    this.cues = music ? music.tracks.map((cue) => ({ ...cue })) : [];
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
      ...(this.cues.length > 0
        ? [this.field("음악 마치는 시각", this.time(this.endsAt, (value) => { this.endsAt = value; this.emit(); this.refresh(); }))]
        : []),
      this.field("잠금 해제", this.unlockRow()),
      this.field("시작", this.autoRow()),
      this.summaryEl,
      this.buttons(existing),
    );
    this.refresh();
  }

  /** What a keystroke changes: the reading underneath, and nothing else. */
  private refresh(): void {
    this.summaryEl.replaceChildren(...this.summaryRows());
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
    input.addEventListener("input", () => { onInput(input.value); this.refresh(); });
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
      // Note(yoochan.kim): seven cells of one character, sized as a week rather than
      // as seven buttons.
      { class: "segctl segctl--days" },
      DAY_CHOICES.map(({ day, label }) => {
        const button = el("button", { type: "button", textContent: label });
        button.classList.toggle("on", this.weekdays.has(day));
        button.addEventListener("click", () => {
          if (this.weekdays.has(day)) this.weekdays.delete(day);
          else this.weekdays.add(day);
          button.classList.toggle("on", this.weekdays.has(day));
          this.emit();
          this.refresh();
        });
        return button;
      }),
    );
  }

  /** The order as numbered rows, with the library behind an add button. */
  private trackList(): HTMLElement {
    const rows = this.cues.map((cue, index) => {
      const track = this.tracks.find((candidate) => candidate.id === cue.id);
      const label = track ? track.title : `${cue.id} (등록되지 않은 곡)`;
      return el("div", { class: "editor__track" }, [
        el("span", { class: "editor__track-no", textContent: `${index + 1}.` }),
        el("span", { class: "editor__track-name", textContent: label }),
        el("span", { class: "editor__track-len", textContent: track ? minutes(track.durationSec) : "" }),
        this.volumeInput(cue),
        this.smallButton("↑", "위로", () => this.move(index, -1)),
        this.smallButton("↓", "아래로", () => this.move(index, 1)),
        this.smallButton("✕", "빼기", () => {
          this.cues.splice(index, 1);
          this.emit();
          this.render(true);
        }),
      ]);
    });

    // Note(yoochan.kim): behind a button, because a button per track wrapped to
    // three lines once the manifest grew.
    const menu = el(
      "div",
      { class: "picker is-hidden" },
      this.tracks.map((track) =>
        el("button", { class: "picker__row", type: "button" }, [
          el("span", { class: "picker__n", textContent: track.title }),
          el("span", { class: "picker__d", textContent: minutes(track.durationSec) }),
        ]),
      ),
    );
    menu.querySelectorAll("button").forEach((row, index) => {
      row.addEventListener("click", () => {
        const track = this.tracks[index]!;
        // Note(yoochan.kim): a song joins at its own level, which is the one
        // someone would have picked anyway — and can then be changed here.
        this.cues.push({ id: track.id, volume: track.volume });
        this.emit();
        this.render(true);
      });
    });

    const open = el("button", { class: "textbtn textbtn--add", type: "button", textContent: "+ 추가" });
    open.addEventListener("click", () => {
      menu.classList.toggle("is-hidden");
      open.classList.toggle("on", !menu.classList.contains("is-hidden"));
    });

    const adders = el("div", { class: "editor__adders" }, [open, menu]);

    // Note(yoochan.kim): named once above the list; a label per row costs the width
    // the song's own name needs.
    const head =
      rows.length === 0
        ? []
        : [
            el("div", { class: "editor__track editor__track--head" }, [
              el("span", { class: "editor__track-no" }),
              // The field is already called 곡; only the two numbers need naming.
              el("span", { class: "editor__track-name" }),
              el("span", { class: "editor__track-len", textContent: "길이" }),
              el("span", { class: "editor__track-volh", textContent: "볼륨" }),
            ]),
          ];

    return el("div", { class: "editor__tracks" }, [...head, ...rows, adders]);
  }

  /** How loud this song plays in this order, kept in 0-100 like the panel's. */
  private volumeInput(cue: ScheduledTrack): HTMLElement {
    const input = el("input", {
      class: "editor__track-vol",
      type: "number",
      value: String(cue.volume),
      ariaLabel: "이 순서에서의 볼륨",
    }) as HTMLInputElement;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    let last = cue.volume;

    input.addEventListener("input", () => {
      cue.volume = input.value === "" ? Number.NaN : Number(input.value);
      this.refresh();
    });

    // Note(yoochan.kim): put right on the way out, not under someone's fingers. An
    // emptied box gets its level back rather than becoming a silent song.
    input.addEventListener("blur", () => {
      cue.volume = Number.isFinite(cue.volume) ? Math.min(100, Math.max(0, Math.round(cue.volume))) : last;
      last = cue.volume;
      input.value = String(cue.volume);
      this.refresh();
    });

    return el("span", { class: "vol" }, [input]);
  }

  /** The gate closes with the music, or at a time of its own — a choice. */
  private unlockRow(): HTMLElement {
    const follows = this.followsMusic && this.cues.length > 0;
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
        choice("음악이 끝나면", true, this.cues.length === 0),
        choice("시각을 정해서", false),
      ]),
    ];
    if (!follows) {
      children.push(this.time(this.lockUntil, (value) => { this.lockUntil = value; this.emit(); this.refresh(); }));
    }
    return el("div", { class: "editor__unlock" }, children);
  }

  // --- summary ---

  /**
   * What this schedule actually does, worked out the same way the media server
   * will. A flow the server would refuse is better caught here, before someone
   * presses start during a service.
   */
  private summaryRows(): HTMLElement[] {
    const lines: [string, string][] = [];
    const warnings: string[] = [];

    const totalSec = this.cues.reduce(
      (sum, cue) => sum + (this.tracks.find((track) => track.id === cue.id)?.durationSec ?? 0),
      0,
    );
    const closesAt = this.followsMusic && this.cues.length > 0 ? this.endsAt : this.lockUntil;
    lines.push(["잠금", `${this.lockAt} → ${closesAt}`]);

    if (this.cues.length > 0) {
      const startsAt = minusSeconds(this.endsAt, totalSec);
      const cut = asMinutes(startsAt) < asMinutes(this.lockAt) ? ", 앞 잘림" : "";
      lines.push(["음악", `${startsAt} → ${this.endsAt} (${this.cues.length}곡${cut})`]);
      // Note(yoochan.kim): the media server refuses a track with no level, so a
      // blank box stops the save here rather than at the moment someone starts it.
      if (this.cues.some((cue) => !Number.isInteger(cue.volume) || cue.volume < 0 || cue.volume > 100)) {
        warnings.push("볼륨은 0에서 100 사이여야 해요");
      }
      // Note(yoochan.kim): Only the finish is bound to the lock window: a timeline that begins
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

    // Note(yoochan.kim): every one of these is something the server refuses, so a
    // draft carrying any of them cannot be saved — the button says so rather
    // than sending a request that comes back 400 and shows nothing.
    if (this.saveButton) this.saveButton.disabled = warnings.length > 0;

    return [
      ...lines.map(([label, value]) =>
        el("div", { class: "editor__srow" }, [
          el("span", { textContent: label }),
          el("span", { textContent: value }),
        ]),
      ),
      ...warnings.map((line) => el("span", { class: "editor__warn", textContent: line })),
    ];
  }

  /**
   * What this dialog is for, for its head to carry. They read the draft when
   * pressed, so they can be made once while the form below is redrawn.
   */
  actions(): HTMLElement[] {
    const cancel = el("button", { class: "btn", type: "button", textContent: "취소" });
    cancel.addEventListener("click", () => this.options.onCancel());

    const save = el("button", { class: "btn btn--go", type: "button", textContent: "저장" }) as HTMLButtonElement;
    save.addEventListener("click", () => this.options.onSave(this.id, this.entry()));
    this.saveButton = save;
    this.refresh();

    return [cancel, save];
  }

  /**
   * Note(yoochan.kim): deleting is nowhere near saving. They are one press apart
   * on a keypad and one of them cannot be taken back.
   */
  private buttons(existing: boolean): HTMLElement {
    if (!existing) return el("div", {});
    const row = el("div", { class: "editor__buttons" });

    const offer = (): void => {
      const remove = el("button", { class: "textbtn textbtn--bad", type: "button", textContent: "이 자동 진행 삭제" });
      remove.addEventListener("click", ask);
      row.replaceChildren(remove);
    };

    // Note(yoochan.kim): asked in place rather than in a second dialog over this
    // one. The question takes the button's spot, so the press that deletes is
    // never the press that was already on its way.
    const ask = (): void => {
      const keep = el("button", { class: "btn btn--small", type: "button", textContent: "그대로 두기" });
      keep.addEventListener("click", offer);
      const yes = el("button", { class: "btn btn--stop btn--small", type: "button", textContent: "삭제" });
      yes.addEventListener("click", () => this.options.onDelete(this.id));
      row.replaceChildren(el("span", { class: "editor__warn", textContent: "삭제하면 되돌릴 수 없어요" }), keep, yes);
    };

    offer();
    return row;
  }

  private entry(): FlowEntry {
    const follows = this.followsMusic && this.cues.length > 0;
    return {
      name: this.name.trim(),
      weekdays: [...this.weekdays].sort().map((day) => WEEKDAY_KEYS[day]!),
      autoStart: this.autoStart,
      lock: {
        at: this.lockAt,
        until: follows ? { kind: "music" } : { kind: "clock", at: this.lockUntil },
      },
      parts:
        this.cues.length > 0
          ? [{ kind: "music", tracks: this.cues.map((cue) => ({ ...cue })), endsAt: this.endsAt }]
          : [],
    };
  }

  private move(index: number, by: number): void {
    const to = index + by;
    if (to < 0 || to >= this.cues.length) return;
    const [moved] = this.cues.splice(index, 1);
    this.cues.splice(to, 0, moved!);
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
