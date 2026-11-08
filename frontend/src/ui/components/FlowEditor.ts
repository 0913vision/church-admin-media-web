import { BLANK, el } from "../../util/dom.js";
import { icon } from "../icons.js";
import { timeField } from "./TimeField.js";
import type { ScheduledTrack, SchedulePart, Track } from "../../protocol.js";
import type { FlowEntry, ScheduledFlow } from "../../api/device.js";
import type { FlowDraft } from "./WeekView.js";
import { countdownSpan, inOrder, lastSound, missingAudio, noticeLabel, noticesHeld } from "../../util/flow.js";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Note(yoochan.kim): how long a dropped song takes to settle into its slot, dnd-kit's 0.2s; the same as the rows' slide in styles.css.
const SETTLE_MS = 200;
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
  private countdown = false;
  /** Empty until somebody gives the countdown its time; kept through 빼기, so 넣기 brings it back. */
  private zeroAt = "";
  /** Seconds before zero of each notice ticked. */
  private notices = new Set<number>();
  /** Whether the flow holds a part this build cannot edit, which saving would drop. */
  private unknownPart = false;
  private tracks: Track[] = [];
  /** Whether this draft is already on the calendar — only then is deleting offered. */
  private existing = false;
  /**
   * The one part that changes as you type. Lasting, not remade by `render`:
   * redrawing the editor replaced the box being typed into and lost its focus.
   */
  private readonly summaryEl = el("div", { class: "editor__summary num" });
  /** The unlock key that names the last sound, renamed on a keystroke rather than redrawn. */
  private followsKey = el("button", { type: "button" });
  /** Whether 저장 has been pressed: until then an empty field is not yet a mistake. */
  private tried = false;
  /** Whether the draft holds anything the server would refuse. */
  private blocked = false;
  /** Whether it contradicts itself, said at once; an empty field is said only once 저장 is pressed. */
  private contradicts = false;
  private saveKey: HTMLButtonElement | null = null;
  /** The song picked up from the keyboard, moved by the arrow keys until it is put down. */
  private grabbed: number | null = null;
  private rendering = false;
  /** What the target time means, under its field; with the times below, redrawn on a keystroke. */
  private readonly zeroField = el("div", { class: "field" });
  private readonly zeroNote = el("p");
  /** Shown while the music runs into the countdown: the clash, and a key that moves the music's end to where the countdown's block opens. */
  private readonly clashText = el("span");
  private readonly alignKey = el("button", {
    class: "editor__fix",
    type: "button",
    textContent: "음악 앞당기기",
    title: "첫 안내 10초 전에 음악이 끝나도록 음악 마치는 시각을 옮깁니다",
  });
  private readonly clashBar = el("div", { class: "editor__clash is-hidden", role: "alert" }, [icon("alert", 16), this.clashText, this.alignKey]);
  private noticeTimes = new Map<number, HTMLElement>();
  private countTime = el("small");

  constructor(private readonly options: FlowEditorOptions) {
    this.el = el("div", { class: "editor is-hidden" });
    // Note(yoochan.kim): the block opens 10s before the first sound, so the music ends there, on the second at or before it (the user, 2026-11-08).
    this.alignKey.addEventListener("click", () => {
      if (!this.zeroAt) return;
      this.endsAt = asClock(Math.floor(countdownSpan(this.zeroAt, this.notices, this.tracks).opens));
      this.emit();
      this.render();
    });
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
    // Note(yoochan.kim): until the countdown has its time, the calendar draws the gate to the music's end.
    const closes = this.closesAt() ?? (this.cues.length > 0 ? this.endsAt : this.lockAt);
    this.options.onChange?.({
      id: this.id,
      weekdays: [...this.weekdays],
      // The calendar draws in minutes; seconds are below a pixel there.
      opens: asSeconds(this.lockAt) / 60,
      closes: asSeconds(closes) / 60,
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
    const countdown = flow?.parts.find((part) => part.kind === "countdown");
    this.countdown = countdown !== undefined;
    this.zeroAt = countdown?.at ?? "";
    this.grabbed = null;
    this.notices = new Set(countdown?.notices ?? []);
    this.unknownPart = (flow?.parts ?? []).some((part) => !["music", "countdown"].includes(part.kind));

    this.existing = flow !== null;
    this.tried = false;
    this.el.classList.remove("is-hidden");
    this.render();
    this.emit();
  }

  /** What it is and how it starts, then the times in the order they happen. */
  private render(): void {
    const follows = this.follows();
    this.rendering = true;
    this.el.replaceChildren(
      this.field("이름", this.text(this.name, (value) => { this.name = value; })),
      this.field("요일", this.weekdayRow()),
      this.field("시작", this.autoRow()),
      this.field("잠금 시작", this.time(this.lockAt, (value) => { this.lockAt = value; this.emit(); })),
      el("div", { class: "editor__row editor__row--block" }, [this.trackList()]),
      ...(this.cues.length > 0
        ? [this.field("음악 마치는 시각", this.time(this.endsAt, (value) => { this.endsAt = value; this.emit(); this.refresh(); }))]
        : []),
      this.field("카운트다운", this.countdownRow()),
      ...(this.countdown ? [this.zeroRow(), this.child("안내", this.noticeList())] : []),
      this.field("잠금 해제", this.unlockRow()),
      ...(follows
        ? []
        : [this.field("해제 시각", this.time(this.lockUntil, (value) => { this.lockUntil = value; this.emit(); this.refresh(); }))]),
      this.summaryEl,
    );
    this.rendering = false;
    this.refresh();
  }

  /** What a keystroke changes: the reading underneath, and nothing else. */
  private refresh(): void {
    this.summaryEl.replaceChildren(...this.summaryRows());
    // Note(yoochan.kim): a draft that contradicts itself cannot be saved, and the band beside 저장 says why.
    if (this.saveKey) this.saveKey.disabled = this.contradicts;
    this.followsKey.textContent = this.followsLabel();
    if (this.countdown) this.paintCountdown();
  }

  // --- fields ---

  /**
   * One setting: its name at the left, its control at the right.
   *
   * Note(yoochan.kim): a <label> only around a single field. Around a row of keys, a press
   * anywhere in the row's empty middle pressed its first key — 요일 switched 일요일 on.
   */
  private field(label: string, control: HTMLElement): HTMLElement {
    const tag = control instanceof HTMLInputElement || control.classList.contains("timefield") ? "label" : "div";
    return el(tag, { class: "editor__row" }, [
      el("span", { class: "editor__label", textContent: label }),
      control,
    ]);
  }

  /** A setting that belongs to the one above it, set in under it (Fluent's SettingsExpander). */
  private child(label: string, control: HTMLElement): HTMLElement {
    return el("div", { class: "editor__row editor__row--child" }, [
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
        this.render();
      });
      return button;
    };
    return el("div", { class: "segctl" }, [choice("직접 눌러서 시작", false), choice("자동으로 시작", true)]);
  }

  private text(value: string, onInput: (value: string) => void): HTMLElement {
    const input = el("input", { class: "editor__input", type: "text", value });
    input.addEventListener("input", () => { onInput(input.value); this.refresh(); });
    return input;
  }

  /**
   * A time to the second. The timeline is built by subtracting track lengths
   * from the finish, and those are not whole minutes — so a finish that can only
   * be set to a minute cannot express when the music should actually stop.
   */
  private time(value: string, onInput: (value: string) => void): HTMLElement {
    const field = timeField(asClock(asSeconds(value)));
    field.input.addEventListener("input", () => { if (field.input.value) onInput(asClock(asSeconds(field.input.value))); });
    return field.el;
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

  /**
   * The order as numbered rows in one group, dragged by the grip at their left
   * (Cuez, Rundown Studio), with the library behind the group's last row.
   */
  private trackList(): HTMLElement {
    const group = el("div", { class: "editor__group editor__songs" });
    const rows = this.cues.map((cue, index) => {
      const track = this.tracks.find((candidate) => candidate.id === cue.id);
      const label = track ? track.title : `${cue.id} (등록되지 않은 곡)`;
      const grip = el("span", { class: "editor__grip", title: "끌어서 순서 바꾸기", role: "button", tabIndex: 0 }, [icon("grip", 16)]);
      const row = el("div", { class: `editor__track${this.grabbed === index ? " is-dragging" : ""}` }, [
        grip,
        el("span", { class: "editor__track-no", textContent: String(index + 1) }),
        el("span", { class: "editor__track-name", textContent: label }),
        el("span", { class: "editor__track-len", textContent: track ? length(track.durationSec) : "" }),
        // Note(yoochan.kim): the speaker says what the number is, so the list needs no column names.
        el("span", { class: "editor__vol", title: "볼륨" }, [icon("speaker", 14), this.volumeInput(cue)]),
        this.smallButton("close", "빼기", () => {
          this.cues.splice(index, 1);
          this.grabbed = null;
          this.emit();
          this.render();
        }),
      ]);
      grip.addEventListener("pointerdown", (event) => this.drag(event, row, group));
      grip.addEventListener("keydown", (event) => this.nudge(event, index));
      grip.addEventListener("focusout", () => {
        if (this.rendering || this.grabbed === null) return;
        this.grabbed = null;
        row.classList.remove("is-dragging");
      });
      return row;
    });

    // Note(yoochan.kim): behind a button, because a button per track wrapped to
    // three lines once the manifest grew.
    // Note(yoochan.kim): a countdown's audio is played only by a countdown, so it is not offered as music.
    const pickable = this.tracks.filter((track) => track.role.kind === "music");
    const menu = el(
      "div",
      { class: "picker is-hidden" },
      pickable.map((track) =>
        el("button", { class: "picker__row", type: "button" }, [
          el("span", { class: "picker__n", textContent: track.title }),
          el("span", { class: "picker__d", textContent: length(track.durationSec) }),
        ]),
      ),
    );
    menu.querySelectorAll("button").forEach((row, index) => {
      row.addEventListener("click", () => {
        const track = pickable[index]!;
        // Note(yoochan.kim): a song joins at its own level, which is the one
        // someone would have picked anyway — and can then be changed here.
        this.cues.push({ id: track.id, volume: track.volume });
        this.emit();
        this.render();
      });
    });

    // Note(yoochan.kim): adding is the list's last row, its plus where the numbers are and its words where the names are.
    const open = el("button", { class: "editor__track editor__addrow", type: "button" }, [
      el("span"),
      el("span", { class: "editor__plus" }, [icon("plus", 14)]),
      el("span", { textContent: "곡 추가" }),
    ]);
    group.append(...rows, open);
    const adders = el("div", { class: "editor__adders" }, [menu]);

    // Note(yoochan.kim): a press anywhere else puts it away, which is what an open
    // menu means everywhere. The listener only lives while the menu is up, and
    // the modal takes the whole form down with it when it closes.
    const shut = (event: MouseEvent): void => {
      if (adders.contains(event.target as Node) || open.contains(event.target as Node)) return;
      menu.classList.add("is-hidden");
      open.classList.remove("on");
      document.removeEventListener("mousedown", shut);
    };
    open.addEventListener("click", () => {
      const opening = menu.classList.contains("is-hidden");
      menu.classList.toggle("is-hidden", !opening);
      open.classList.toggle("on", opening);
      if (opening) document.addEventListener("mousedown", shut);
      else document.removeEventListener("mousedown", shut);
    });

    const head = el("div", { class: "editor__track editor__track--head" }, [
      el("span", { class: "editor__track-title", textContent: "곡" }),
    ]);

    return el("div", { class: "editor__tracks" }, [head, group, adders]);
  }

  /**
   * Carries a song by its grip, as dnd-kit's sortable list does: the row is lifted
   * and follows the pointer, the others slide aside to open the slot it would land
   * in, and on release it settles into that slot before the order is written.
   */
  private drag(event: PointerEvent, row: HTMLElement, group: HTMLElement): void {
    if (event.button !== 0 || this.cues.length < 2) return;
    event.preventDefault();
    const songs = [...group.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.classList.contains("editor__addrow"));
    const from = songs.indexOf(row);
    const tops = songs.map((song) => song.getBoundingClientRect().top);
    const step = row.getBoundingClientRect().height;
    const startY = event.clientY;
    let to = from;

    // Note(yoochan.kim): a half-faded copy marks the slot it will land in, as dnd-kit's sortable leaves one; it sits beside the group, so the group's first and last rows keep their own edges.
    const list = group.parentElement!;
    const box = group.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.className = "editor__track editor__ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.cssText = `top: ${tops[from]! - list.getBoundingClientRect().top}px; left: ${box.left - list.getBoundingClientRect().left + 1}px; width: ${box.width - 2}px;`;
    ghost.classList.toggle("is-first", from === 0);
    list.append(ghost);

    group.classList.add("is-sorting");
    row.classList.add("is-dragging");
    document.documentElement.classList.add("is-grabbing");

    // Note(yoochan.kim): the slot whose middle is nearest the lifted row's (dnd-kit's closestCenter); the rows between it and the old slot move one row over.
    const place = (dy: number): void => {
      const offset = Math.min(Math.max(dy, tops[0]! - tops[from]!), tops[songs.length - 1]! - tops[from]!);
      row.style.transform = `translateY(${offset}px)`;
      to = Math.min(Math.max(from + Math.round(offset / step), 0), songs.length - 1);
      songs.forEach((song, at) => {
        if (song === row) return;
        const shift = from < to && at > from && at <= to ? -step : to < from && at >= to && at < from ? step : 0;
        song.style.transform = shift ? `translateY(${shift}px)` : "";
        const number = song.querySelector(".editor__track-no");
        if (number) number.textContent = String(at + 1 + Math.sign(shift));
      });
      const number = row.querySelector(".editor__track-no");
      if (number) number.textContent = String(to + 1);
      ghost.style.transform = `translateY(${tops[to]! - tops[from]!}px)`;
      ghost.classList.toggle("is-first", to === 0);
      const ghostNumber = ghost.querySelector(".editor__track-no");
      if (ghostNumber) ghostNumber.textContent = String(to + 1);
    };

    const move = (moved: PointerEvent): void => place(moved.clientY - startY);
    const finish = (commit: boolean): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape, true);
      if (!commit) to = from;
      // Note(yoochan.kim): it settles into its slot first, so the list never jumps when it is redrawn.
      row.classList.add("is-settling");
      row.style.transform = `translateY(${tops[to]! - tops[from]!}px)`;
      if (!commit) songs.forEach((song) => { if (song !== row) song.style.transform = ""; });
      if (!commit) ghost.style.transform = "";
      window.setTimeout(() => {
        ghost.remove();
        document.documentElement.classList.remove("is-grabbing");
        if (to !== from) {
          const [moved] = this.cues.splice(from, 1);
          this.cues.splice(to, 0, moved!);
          this.emit();
        }
        this.grabbed = null;
        this.render();
      }, SETTLE_MS);
    };
    const up = (): void => finish(true);
    const cancel = (): void => finish(false);
    // Note(yoochan.kim): caught first and kept from the dialog, whose Escape would close it with the song in mid-air.
    const escape = (pressed: KeyboardEvent): void => {
      if (pressed.key !== "Escape") return;
      pressed.preventDefault();
      pressed.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape, true);
  }

  /** The same from the keyboard: Space picks the song up, the arrow keys move it, Space or Enter puts it down. */
  private nudge(event: KeyboardEvent, index: number): void {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (event.key === " " || event.key === "Enter" || (event.key === "Escape" && this.grabbed !== null)) {
      event.preventDefault();
      this.grabbed = this.grabbed === null && event.key !== "Escape" ? index : null;
    } else if (by !== 0 && this.grabbed === index) {
      event.preventDefault();
      const to = index + by;
      if (to < 0 || to >= this.cues.length) return;
      const [moved] = this.cues.splice(index, 1);
      this.cues.splice(to, 0, moved!);
      this.grabbed = to;
      this.emit();
    } else {
      return;
    }
    const at = this.grabbed ?? index;
    this.render();
    this.el.querySelectorAll<HTMLElement>(".editor__grip")[at]?.focus();
  }

  /** How loud this song plays in this order, kept in 0-100 like the panel's. */
  private volumeInput(cue: ScheduledTrack): HTMLElement {
    const input = el("input", {
      class: "editor__input editor__track-vol",
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

    return input;
  }

  /** The gate closes with the music, or at a time of its own — a choice. The time is a row of its own. */
  private unlockRow(): HTMLElement {
    const follows = this.follows();
    const choice = (label: string, value: boolean, disabled = false): HTMLButtonElement => {
      const button = el("button", { class: follows === value ? "on" : "", type: "button", textContent: label }) as HTMLButtonElement;
      button.disabled = disabled;
      button.addEventListener("click", () => {
        this.followsMusic = value;
        this.emit();
        this.render();
      });
      return button;
    };

    this.followsKey = choice(this.followsLabel(), true, this.parts().length === 0 && !this.zeroMissing());
    return el("div", { class: "segctl" }, [this.followsKey, choice("시각을 정해서", false)]);
  }

  /** The count is in every countdown, so this says only whether there is one. */
  private countdownRow(): HTMLElement {
    const choice = (label: string, value: boolean): HTMLElement => {
      const button = el("button", { class: this.countdown === value ? "on" : "", type: "button", textContent: label });
      button.addEventListener("click", () => {
        this.countdown = value;
        this.emit();
        this.render();
      });
      return button;
    };
    // Note(yoochan.kim): the user's words, kept apart from the songs (2026-11-08).
    return el("div", { class: "segctl" }, [choice("넣기", true), choice("빼기", false)]);
  }

  /** When zero is, and under it what that means against the music. */
  private zeroRow(): HTMLElement {
    const field = timeField(this.zeroAt ? asClock(asSeconds(this.zeroAt)) : "");
    field.input.addEventListener("input", () => {
      this.zeroAt = field.input.value ? asClock(asSeconds(field.input.value)) : "";
      this.emit();
      this.refresh();
    });
    this.zeroField.replaceChildren(field.el, this.zeroNote, this.clashBar);
    return el("label", { class: "editor__row editor__row--child" }, [
      el("span", { class: "editor__label", textContent: "목표 시각" }),
      this.zeroField,
    ]);
  }

  /**
   * Every notice the library has audio for, a row each to tick, with when it sounds;
   * any ticked one the library has lost, so it can be unticked; and the count, which
   * every countdown has, ticked in grey since it cannot be left out.
   */
  private noticeList(): HTMLElement {
    const row = (label: string, time: HTMLElement, on: boolean): HTMLButtonElement => el("button", {
      class: `editor__pick${on ? " on" : ""}`,
      type: "button",
    }, [
      el("span", { class: "lib__box" }, on ? [icon("check", 13)] : []),
      el("span", { class: "editor__pick-n" }, [el("span", { class: "editor__pick-k", textContent: label }), time]),
    ]);

    this.noticeTimes = new Map();
    const picks = inOrder([...noticesHeld(this.tracks), ...this.notices]).map((beforeSec) => {
      const time = el("small");
      this.noticeTimes.set(beforeSec, time);
      const pick = row(noticeLabel(beforeSec), time, this.notices.has(beforeSec));
      pick.addEventListener("click", () => {
        if (this.notices.has(beforeSec)) this.notices.delete(beforeSec);
        else this.notices.add(beforeSec);
        const on = this.notices.has(beforeSec);
        pick.classList.toggle("on", on);
        pick.querySelector(".lib__box")!.replaceChildren(...(on ? [icon("check", 13)] : []));
        this.emit();
        this.refresh();
      });
      return pick;
    });

    this.countTime = el("small");
    const count = row("10초 카운트", this.countTime, true);
    count.classList.add("is-fixed");
    count.title = "뺄 수 없음";
    count.disabled = true;
    return el("div", { class: "editor__group" }, [...picks, count]);
  }

  /**
   * When each notice and the count will sound, worked out as the media server
   * will: a notice its seconds before zero, the count its own length before it,
   * and the block opening ahead of the first sound. A ticked one that would
   * sound while the music still plays is in red, so what clashes shows.
   */
  private paintCountdown(): void {
    const zero = this.zeroAt ? asSeconds(this.zeroAt) : null;
    const music = this.musicSpan();
    const underMusic = (at: number): boolean => music !== null && at >= music.from && at < music.to;
    const paint = (time: HTMLElement, at: number | null, on: boolean): void => {
      time.textContent = at === null ? BLANK : asClock(at);
      time.classList.toggle("is-bad", at !== null && on && underMusic(at));
    };
    for (const [beforeSec, time] of this.noticeTimes) {
      paint(time, zero === null ? null : zero - beforeSec, this.notices.has(beforeSec));
    }
    const count = this.tracks.find((track) => track.role.kind === "count");
    paint(this.countTime, zero === null || !count ? null : zero - count.durationSec, true);

    let note: { text: string; bad: boolean } | null = null;
    if (zero !== null && music !== null) {
      const span = countdownSpan(this.zeroAt, this.notices, this.tracks);
      const overlap = Math.round(Math.min(music.to, span.zero) - Math.max(span.opens, music.from));
      const gap = Math.round(span.opens - music.to);
      if (overlap > 0) note = { text: `음악과 ${howLong(overlap)} 겹칩니다`, bad: true };
      else if (gap >= 0) note = { text: gap === 0 ? "음악이 끝나자마자 시작" : `음악이 끝나고 ${howLong(gap)} 뒤에 시작`, bad: false };
    }
    const bad = note?.bad === true;
    this.zeroField.classList.toggle("is-bad", bad);
    this.clashBar.classList.toggle("is-hidden", !bad);
    this.clashText.textContent = bad ? note!.text : "";
    this.zeroNote.className = note === null || bad ? "is-hidden" : "editor__help";
    this.zeroNote.textContent = bad ? "" : note?.text ?? "";
  }

  /** When the music sounds, counted from the gate as the server counts it; null when there is none. */
  private musicSpan(): { from: number; to: number } | null {
    if (this.cues.length === 0) return null;
    const totalSec = this.cues.reduce(
      (sum, cue) => sum + (this.tracks.find((track) => track.id === cue.id)?.durationSec ?? 0),
      0,
    );
    const to = asSeconds(this.endsAt);
    return { from: Math.max(to - totalSec, asSeconds(this.lockAt)), to };
  }

  /** The draft's parts in the shape the calendar keeps them. */
  private parts(): SchedulePart[] {
    const parts: SchedulePart[] = [];
    if (this.cues.length > 0) {
      parts.push({ kind: "music", tracks: this.cues.map((cue) => ({ ...cue })), endsAt: asClock(asSeconds(this.endsAt)) });
    }
    if (this.countdown && this.zeroAt) {
      parts.push({ kind: "countdown", at: asClock(asSeconds(this.zeroAt)), notices: inOrder(this.notices) });
    }
    return parts;
  }

  /** A countdown put in and not yet given its time: in the draft, not yet a part. */
  private zeroMissing(): boolean {
    return this.countdown && !this.zeroAt;
  }

  private follows(): boolean {
    return this.followsMusic && (this.parts().length > 0 || this.zeroMissing());
  }

  /** When the gate opens again; null while that waits on a countdown with no time yet. */
  private closesAt(): string | null {
    if (!this.follows()) return this.lockUntil;
    if (this.zeroMissing()) return null;
    return lastSound(this.lockAt, this.parts())!.at;
  }

  private followsLabel(): string {
    return this.zeroMissing() || lastSound(this.lockAt, this.parts())?.kind === "countdown" ? "카운트다운이 끝나면" : "음악이 끝나면";
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
    const closesAt = this.closesAt();
    lines.push(["잠금", `${asClock(asSeconds(this.lockAt))} → ${closesAt === null ? BLANK : asClock(asSeconds(closesAt))}`]);

    if (this.cues.length > 0) {
      const startsAt = asClock(asSeconds(this.endsAt) - totalSec);
      const cut = asSeconds(startsAt) < asSeconds(this.lockAt) ? ", 앞 잘림" : "";
      lines.push(["음악", `${startsAt} → ${asClock(asSeconds(this.endsAt))} (${this.cues.length}곡${cut})`]);
      // Note(yoochan.kim): the media server refuses a track with no level, so a
      // blank box stops the save here rather than at the moment someone starts it.
      if (this.cues.some((cue) => !Number.isInteger(cue.volume) || cue.volume < 0 || cue.volume > 100)) {
        warnings.push("볼륨은 0에서 100 사이여야 합니다");
      }
      // Note(yoochan.kim): Only the finish is bound to the lock window: a timeline that begins
      // earlier just has its front cut, so an early start is not an error.
      if (asSeconds(this.endsAt) <= asSeconds(this.lockAt)) {
        warnings.push("음악이 잠금 시작 전에 끝납니다");
      }
      if (closesAt !== null && asSeconds(this.endsAt) > asSeconds(closesAt)) {
        warnings.push("음악이 잠금 해제보다 늦게 끝납니다");
      }
    }
    if (this.countdown) {
      // Note(yoochan.kim): countdown audio is not a song, so it is never said to be missing from the 곡 목록 (the user, 2026-11-08).
      warnings.push(...missingAudio(this.notices, this.tracks).map((name) => `${name} 파일이 없습니다`));
    }
    if (this.countdown && this.zeroAt) {
      // Note(yoochan.kim): the block, not the first sound: nothing else may sound in its lead either.
      const span = countdownSpan(this.zeroAt, this.notices, this.tracks);
      const told = inOrder(this.notices).map(noticeLabel);
      lines.push(["카운트다운", `${asClock(span.opens)} → ${asClock(span.zero)}${told.length > 0 ? ` (${told.join(", ")})` : ""}`]);
      if (span.opens < asSeconds(this.lockAt)) warnings.push("카운트다운이 잠금 시작보다 빠릅니다");
      if (closesAt !== null && span.zero > asSeconds(closesAt)) warnings.push("카운트다운이 잠금 해제보다 늦게 끝납니다");
      // Note(yoochan.kim): music timed before the gate is counted from the gate, as the server counts it.
      const music = this.musicSpan();
      if (music !== null && span.opens < music.to && span.zero > music.from) {
        warnings.push("음악이 카운트다운과 겹칩니다");
      }
    } else if (this.countdown) {
      lines.push(["카운트다운", BLANK]);
    }
    if (this.unknownPart) warnings.push("알 수 없는 순서가 있습니다");
    if (closesAt !== null && asSeconds(closesAt) <= asSeconds(this.lockAt)) {
      warnings.push("잠금 해제가 잠금 시작보다 빠릅니다");
    }
    // Note(yoochan.kim): a blank form is not a wrong one. Empty fields are said once
    // 저장 has been pressed; a schedule that contradicts itself is said at once.
    const empty: string[] = [];
    if (this.weekdays.size === 0) empty.push("요일이 비어 있습니다");
    if (!this.name.trim()) empty.push("이름이 비어 있습니다");
    if (this.zeroMissing()) empty.push("목표 시각이 비어 있습니다");
    this.blocked = warnings.length + empty.length > 0;
    this.contradicts = warnings.length > 0;
    if (this.tried) warnings.push(...empty);

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
   * Every key this dialog has, for its foot to carry. They read the draft when
   * pressed, so they can be made once while the form below is redrawn.
   *
   * Note(yoochan.kim): deleting rides here too — one dialog answered in two places is
   * a dialog you have to look twice at. It sits at the far left, away from 저장:
   * they are one press apart on a keypad and one of them cannot be taken back.
   */
  actions(): HTMLElement[] {
    const cancel = el("button", { class: "btn", type: "button", textContent: "닫기" });
    cancel.addEventListener("click", () => this.options.onCancel());

    const save = el("button", { class: "btn btn--go", type: "button", textContent: "저장" }) as HTMLButtonElement;
    // Note(yoochan.kim): everything listed is something the server refuses, so a draft
    // carrying any of it is not sent; pressing 저장 shows what is missing instead.
    save.addEventListener("click", () => {
      if (this.blocked) {
        this.tried = true;
        this.refresh();
        return;
      }
      this.options.onSave(this.id, this.entry());
    });
    this.saveKey = save;
    this.refresh();

    return this.existing ? [this.danger(), cancel, save] : [cancel, save];
  }

  /** Deleting. The question that makes it a second press is asked over this dialog. */
  private danger(): HTMLElement {
    const remove = el("button", { class: "textbtn textbtn--bad", type: "button", textContent: "삭제" });
    remove.addEventListener("click", () => this.options.onDelete(this.id));
    return el("div", { class: "editor__danger" }, [remove]);
  }

  private entry(): FlowEntry {
    const follows = this.follows();
    return {
      name: this.name.trim(),
      weekdays: [...this.weekdays].sort().map((day) => WEEKDAY_KEYS[day]!),
      autoStart: this.autoStart,
      // Note(yoochan.kim): one shape on the way out. A default that was never
      // touched is still HH:MM, and a file holding both spellings invites the
      // next reader to handle only one.
      lock: {
        at: asClock(asSeconds(this.lockAt)),
        until: follows ? { kind: "music" } : { kind: "clock", at: asClock(asSeconds(this.lockUntil)) },
      },
      parts: this.parts(),
    };
  }

  private smallButton(name: string, title: string, onClick: () => void): HTMLElement {
    const tone = name === "close" ? " textbtn--bad" : "";
    const button = el("button", { class: `textbtn textbtn--icon${tone}`, type: "button", title }, [icon(name, 15)]);
    button.addEventListener("click", onClick);
    return button;
  }
}

/**
 * A track's length, to the second. Rounding to minutes hid the very thing the
 * timeline is built from: five songs each rounded down can put the music a
 * couple of minutes away from where the summary says it starts.
 */
function length(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, "0")}초`;
}

/** A stretch of time in words: 22분 50초, 1분 10초, 40초, 1시간 5분. */
function howLong(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours ? `${hours}시간` : "", mins ? `${mins}분` : "", secs ? `${secs}초` : ""].filter(Boolean).join(" ");
}

/** Seconds since midnight, from HH:MM or HH:MM:SS. */
function asSeconds(clock: string): number {
  const [hours, mins, secs] = clock.split(":").map(Number);
  return (hours ?? 0) * 3600 + (mins ?? 0) * 60 + (secs ?? 0);
}

/** HH:MM:SS, the shape the media server takes and the one an editor round-trips. */
function asClock(totalSec: number): string {
  const wrapped = ((Math.round(totalSec) % 86400) + 86400) % 86400;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(Math.floor(wrapped / 3600))}:${pad(Math.floor((wrapped % 3600) / 60))}:${pad(wrapped % 60)}`;
}
