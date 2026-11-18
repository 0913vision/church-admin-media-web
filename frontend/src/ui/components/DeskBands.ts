import { el } from "../../util/dom.js";
import { icon } from "../icons.js";
import { DeskUser } from "../../protocol.js";
import type { DeskHold, DeskMove, DeskNote, DeskSetting, DeskUse } from "../../protocol.js";

const NOTHING: DeskUse = { holds: [], notes: [] };

/** Who is using the desk, as the subject of 쓰고 있습니다. */
const USING: Record<DeskUser, string> = {
  [DeskUser.COUNTDOWN]: "카운트다운이",
  [DeskUser.LEVEL_MATCH]: "볼륨 측정이",
  [DeskUser.RESTART]: "서버가",
};

/** What was running when a hand moved the desk, before 중에. */
const DURING: Record<DeskUser, string> = {
  [DeskUser.COUNTDOWN]: "카운트다운",
  [DeskUser.LEVEL_MATCH]: "볼륨 측정",
  [DeskUser.RESTART]: "되돌리는",
};

/** The strips the server holds, so the row that drives one can say so. */
export function heldStrips(use: DeskUse | undefined): Set<string> {
  return new Set((use ?? NOTHING).holds.flatMap((hold) => hold.strips));
}

/** Beside the name of a row whose strip the server holds. */
export function heldChip(): HTMLElement {
  return el("span", { class: "chip chip--hold", textContent: "사용 중" });
}

/**
 * What the server does with the X32 for itself, as bands over an X32 card.
 *
 * Note(yoochan.kim): yellow while it holds part of the desk, red for what a hand
 * moved there meanwhile and for what the desk has not taken back, grey for a move
 * it put back, kept until somebody presses 닫기 (the user, 2026-11-13).
 */
export class DeskBands {
  readonly el: HTMLElement = el("div", {});
  private use: DeskUse = NOTHING;
  /** The waiting holds whose list is open, by when they began. */
  private readonly open = new Set<string>();

  constructor(
    private readonly onDismiss: (id: string) => void,
    /** Today in church time, 2026-11-13, so a note from another day says which. */
    private readonly today: () => string,
  ) {}

  set(use: DeskUse | undefined): void {
    this.use = use ?? NOTHING;
    const waiting = new Set(this.use.holds.filter((hold) => hold.phase === "waiting").map((hold) => hold.since));
    for (const since of this.open) if (!waiting.has(since)) this.open.delete(since);
    this.render();
  }

  private render(): void {
    this.el.replaceChildren(
      ...this.use.holds.flatMap((hold) => this.holdBands(hold)),
      ...this.use.notes.map((note) => this.noteBand(note)),
    );
  }

  private holdBands(hold: DeskHold): HTMLElement[] {
    const strips = paired(hold.strips).map(spoken).join(", ");
    if (hold.phase === "waiting") {
      const open = this.open.has(hold.since);
      const more = el("button", { class: `dh__more${open ? " on" : ""}`, type: "button" }, [
        open ? "접기" : "자세히",
        icon("chevron", 14, 2.4),
      ]);
      more.addEventListener("click", () => {
        if (!this.open.delete(hold.since)) this.open.add(hold.since);
        this.render();
      });
      const band = this.band("bad", "alert", "X32가 아직 원래대로 돌아오지 않았습니다", strips, more);
      if (!open) return [band];
      const rows = notBack(hold.unrestored).map(([strip, what]) =>
        el("div", {}, [el("b", { textContent: strip }), el("span", { textContent: what })]),
      );
      return [band, el("div", { class: "dh-list" }, rows)];
    }

    const bands = [this.band("hold", "lock", `${USING[hold.by]} X32를 쓰고 있습니다`, strips)];
    if (hold.moved.length > 0) {
      const what = moves(hold.moved);
      bands.push(this.band("bad", "alert", `${what}${after(what, "이", "가")} 바뀌었습니다`, this.when(firstAt(hold.moved))));
    }
    return bands;
  }

  private noteBand(note: DeskNote): HTMLElement {
    const shut = el("button", { class: "textbtn", type: "button", textContent: "닫기" });
    shut.addEventListener("click", () => this.onDismiss(note.id));
    const what = moves(note.moved);
    const title = `${DURING[note.by]} 중에 바뀐 ${what}${after(what, "을", "를")} 원래대로 돌렸습니다`;
    return this.band("done", "check", title, this.when(note.at), shut);
  }

  private band(kind: string, glyph: string, title: string, detail: string, key?: HTMLElement): HTMLElement {
    return el("div", { class: `dh dh--${kind}` }, [
      icon(glyph, 16),
      el("span", { class: "dh__t" }, [el("b", { textContent: title }), ...(detail ? [el("small", { textContent: detail })] : [])]),
      ...(key ? [key] : []),
    ]);
  }

  /** The clock part of a wire instant, with its date when that is not today. */
  private when(at: string): string {
    const time = at.slice(11, 19);
    if (at.slice(0, 10) === this.today()) return time;
    return `${Number(at.slice(5, 7))}월 ${Number(at.slice(8, 10))}일 ${time}`;
  }
}

function firstAt(moved: readonly DeskMove[]): string {
  return moved.map((move) => move.at).sort()[0]!;
}

/** "Aux 5" and "Aux 6" as "Aux 5/6": the X32 links an odd strip with the even one after it. */
function paired(strips: readonly string[]): string[] {
  const out: string[] = [];
  for (const strip of strips) {
    const numbered = /^(.*) (\d+)$/.exec(strip);
    const odd = numbered && Number(numbered[2]) % 2 === 0 ? `${numbered[1]} ${Number(numbered[2]) - 1}` : null;
    const at = odd === null ? -1 : out.indexOf(odd);
    if (at >= 0) out[at] = `${odd}/${numbered![2]}`;
    else out.push(strip);
  }
  return out;
}

/** A strip as the room says it in a sentence: aux 5/6, 메인 LR, 버스 3. */
function spoken(strip: string): string {
  const words: [RegExp, string][] = [
    [/^Aux /, "aux "], [/^Ch /, "ch "], [/^FX Return /, "FX 리턴 "], [/^Bus /, "버스 "], [/^Matrix /, "매트릭스 "],
    [/^Main LR$/, "메인 LR"], [/^Mono$/, "모노"], [/^Mute Group /, "뮤트 그룹 "],
  ];
  const word = words.find(([desk]) => desk.test(strip));
  return word ? strip.replace(word[0], word[1]) : strip;
}

/** A setting as the room says it in a sentence: 뮤트, 페이더, 버스 3 센드. */
function spokenSetting(setting: string): string {
  const send = /^(Bus|Matrix) (\d+) Send( Level)?$/.exec(setting);
  if (send) return `${send[1] === "Bus" ? "버스" : "매트릭스"} ${send[2]} 센드${send[3] ? " 레벨" : ""}`;
  const words: Record<string, string> = {
    Mute: "뮤트", Fader: "페이더", "Main LR": "메인 LR 센드", Mono: "모노 센드", "Mute Group": "뮤트 그룹", DCA: "DCA",
  };
  return words[setting] ?? setting;
}

/** What a hand moved, one setting at a time, the strips it moved it on paired: aux 5/6 뮤트. */
function moves(moved: readonly DeskMove[]): string {
  const bySetting = new Map<string, string[]>();
  for (const move of moved) bySetting.set(move.setting, [...(bySetting.get(move.setting) ?? []), move.strip]);
  return [...bySetting]
    .map(([setting, strips]) => `${paired(strips).map(spoken).join(", ")} ${spokenSetting(setting)}`.trim())
    .join(", ");
}

/**
 * 이/가 or 을/를 after a desk word, as it is read aloud.
 *
 * Note(yoochan.kim): these words end in Hangul, a digit or a letter, and all three
 * have a sound: DCA가, LR을, 버스 1을.
 */
function after(word: string, closed: string, open: string): string {
  const last = word.slice(-1);
  const syllable = last.charCodeAt(0) - 0xac00;
  const ends = syllable >= 0 && syllable <= 11171 ? syllable % 28 !== 0 : "013678LMNRlmnr".includes(last);
  return ends ? closed : open;
}

/** What is not back, one row per strip (a linked pair as one), in the X32's own words. */
function notBack(settings: readonly DeskSetting[]): [string, string][] {
  const byStrip = new Map<string, string[]>();
  for (const { strip, setting } of settings) byStrip.set(strip, [...(byStrip.get(strip) ?? []), setting]);
  const rows: [string, string][] = [];
  for (const [strip, list] of byStrip) {
    const what = folded(list);
    const numbered = /^(.*) (\d+)$/.exec(strip);
    const before = rows[rows.length - 1];
    if (numbered && Number(numbered[2]) % 2 === 0 && before?.[0] === `${numbered[1]} ${Number(numbered[2]) - 1}` && before[1] === what) {
      before[0] = `${before[0]}/${numbered[2]}`;
    } else {
      rows.push([strip, what]);
    }
  }
  return rows;
}

/** Bus 1 Send to Bus 16 Send as "Bus 1–7, 9–16 Sends", where the first of them was. */
function folded(settings: readonly string[]): string {
  const items: (string | { kind: string; what: string; numbers: number[] })[] = [];
  for (const setting of new Set(settings)) {
    const send = /^(Bus|Matrix) (\d+) (Send(?: Level)?)$/.exec(setting);
    if (!send) {
      items.push(setting);
      continue;
    }
    const group = items.find((item) => typeof item !== "string" && item.kind === send[1] && item.what === send[3]);
    if (group && typeof group !== "string") group.numbers.push(Number(send[2]));
    else items.push({ kind: send[1]!, what: send[3]!, numbers: [Number(send[2])] });
  }
  return items
    .map((item) => (typeof item === "string" ? item : `${item.kind} ${runs(item.numbers)} ${item.what}${item.numbers.length > 1 ? "s" : ""}`))
    .filter((item) => item !== "")
    .join(", ");
}

/** 1, 2, 3, 5 as "1–3, 5". */
function runs(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return out.join(", ");
}
