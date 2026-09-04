import { el } from "../../util/dom.js";
import type { ScheduledFlow } from "../../api/device.js";
import type { FlowStatus, Track } from "../../protocol.js";
import { durationOf } from "../../util/churchClock.js";

/** How early a flow announces itself on the dashboard. */
export const WINDOW_MINUTES = 30;
/** Mirrors the backend AutoStarter's grace: past this, starting is a person's call. */
const GRACE_SECONDS = 5;

interface FlowPanelOptions {
  onStart: (flowId: string) => void;
  onSkip: (flowId: string) => void;
  onStop: () => void;
  onGoto: () => void;
}

function minutesOf(clock: string): number {
  // Minutes since midnight, from HH:MM or HH:MM:SS. Seconds count as a fraction
  // so a bar drawn from this lands where the music actually starts.
  const [hours, mins, secs] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (mins ?? 0) + (secs ?? 0) / 60;
}

function hhmm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

interface Span {
  opens: number;
  closes: number;
  musicFrom: number;
  musicTo: number;
  segments: { from: number; to: number; title: string }[];
}

/**
 * The one flow that matters right now, drawn against its own window — the
 * mockup's `.tl` block, markup for markup.
 *
 * The device reports what phase a run is in but not the shape of it; the
 * window and the track list belong to the calendar on this side. Matching the
 * two by name is what lets the dashboard draw the whole run rather than a
 * sentence about part of it.
 */
export class FlowPanel {
  readonly el = el("div", { class: "tl" });

  private flows: ScheduledFlow[] = [];
  private tracks = new Map<string, Track>();
  private status: FlowStatus = { phase: "idle" };
  private now = new Date();

  constructor(private readonly options: FlowPanelOptions) {}

  setFlows(flows: ScheduledFlow[]): void {
    this.flows = flows;
    this.render();
  }

  setTracks(tracks: Track[]): void {
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    this.render();
  }

  setStatus(status: FlowStatus): void {
    this.status = status;
    this.render();
  }

  setNow(now: Date): void {
    this.now = now;
    this.render();
  }

  private goto(): HTMLElement {
    const go = el("button", { class: "goto", type: "button", textContent: "자동 진행 탭" });
    go.addEventListener("click", () => this.options.onGoto());
    return go;
  }

  private render(): void {
    const running = this.status.phase !== "idle";
    const flow = running
      ? this.flows.find((each) => each.name === (this.status as { name?: string }).name)
      : this.candidate();

    if (!flow) {
      this.el.className = "tl";
      this.el.replaceChildren(
        el("div", { class: "tl__head" }, [
          el("b", {
            textContent: running
              ? ((this.status as { name?: string }).name ?? "자동 진행 중")
              : "지금 시작할 수 있는 자동 진행이 없어요",
          }),
          gotoRight(this.goto()),
        ]),
      );
      return;
    }

    const span = this.spanOf(flow);
    const minutesNow = this.now.getHours() * 60 + this.now.getMinutes() + this.now.getSeconds() / 60;
    const opensInSec = Math.max(0, Math.round((span.opens - minutesNow) * 60));

    this.el.className = `tl${running ? "" : flow.autoStart ? " is-auto" : " is-ask"}`;
    this.el.replaceChildren(
      el("div", { class: "tl__head" }, [
        el("b", { textContent: flow.name }),
        el("span", { class: "tl__facts" }, this.facts(flow, span, running, opensInSec)),
        gotoRight(this.goto()),
      ]),
      el("div", { class: "tl__row" }, [
        el("div", { class: `tl__col${running ? "" : " is-preview"}` }, [
          this.bar(span, minutesNow),
          this.ticks(span),
        ]),
        el("div", { class: "tl__act" }, [this.action(flow, running, minutesNow > span.opens + GRACE_SECONDS / 60)]),
      ]),
    );
  }

  private facts(flow: ScheduledFlow, span: Span, running: boolean, opensInSec: number): HTMLElement[] {
    const facts: (string | HTMLElement)[] = [];
    if (running) {
      if (span.segments.length > 0) facts.push(`${hhmm(span.musicTo)}에 음악 종료`);
      facts.push(`${hhmm(span.closes)}에 잠금 해제`);
    } else {
      if (flow.autoStart) facts.push("자동으로 시작해요");
      facts.push(opensInSec > 0 ? `${durationOf(opensInSec)} 뒤 시작해요` : "자동 진행을 시작할 수 있어요");
      if (span.segments.length > 0) {
        // Note(yoochan.kim): written out here rather than left to the scale, where a
        // music time falling within a few minutes of the lock would land on top
        // of it. In words it is always readable and never collides.
        const from = Math.max(span.musicFrom, span.opens);
        facts.push(`음악 ${hhmm(from)} → ${hhmm(span.musicTo)}`);
        facts.push(`${span.segments.length}곡`);
      }
    }
    return facts.map((fact) =>
      typeof fact === "string" ? el("span", { textContent: fact }) : el("span", {}, [fact]),
    );
  }

  private action(flow: ScheduledFlow, running: boolean, missed: boolean): HTMLElement {
    if (running) {
      const stop = el("button", { class: "btn btn--stop", type: "button", textContent: "중단" });
      stop.addEventListener("click", () => this.options.onStop());
      return stop;
    }
    // Note(yoochan.kim): An autostart the runner let pass is a person's to start now.
    if (flow.autoStart && !missed) {
      const skip = el("button", { class: "btn", type: "button", textContent: "이번만 건너뛰기" });
      skip.addEventListener("click", () => this.options.onSkip(flow.id));
      return skip;
    }
    const start = el("button", { class: "btn btn--go", type: "button", textContent: "시작" });
    start.addEventListener("click", () => this.options.onStart(flow.id));
    return start;
  }

  /**
   * The scale under the bar. Times belong here rather than inside the blocks:
   * a block is as wide as its song is long, and a clock written into a sliver
   * lands on top of its neighbour's.
   */
  private ticks(span: Span): HTMLElement {
    const width = Math.max(1, span.closes - span.opens);
    const at = (minutes: number): number => ((minutes - span.opens) / width) * 100;
    const marks: HTMLElement[] = [el("span", { class: "tick is-edge", textContent: `${hhmm(span.opens)} 잠금` })];

    if (span.segments.length > 0) {
      // Note(yoochan.kim): only where the music ends, and only when it is clear of
      // the two fixed labels. Where the music begins is in the head, which is a
      // line of text and cannot collide with anything.
      const end = at(span.musicTo);
      if (end > 14 && end < 86) {
        marks.push(el("span", { class: "tick is-music", style: `left:${end}%`, textContent: hhmm(span.musicTo) }));
      }
    }

    marks.push(el("span", { class: "tick is-edge is-end", textContent: `${hhmm(span.closes)} 해제` }));
    return el("div", { class: "tl__ticks" }, marks);
  }

  /** The bar: hatched lock window, the music inside it, and where we are. */
  private bar(span: Span, nowMinutes: number): HTMLElement {
    const width = Math.max(1, span.closes - span.opens);
    const pct = (minutes: number): number => ((minutes - span.opens) / width) * 100;

    const children: HTMLElement[] = [el("div", { class: "tl__lock" })];
    // Note(yoochan.kim): The bar shows the lock window, so a timeline that begins earlier is cut
    // at the gate — the part before it never sounds.
    children.push(el("div", { class: "seg seg--gap", style: `width:${pct(Math.max(span.opens, span.musicFrom))}%` }));
    // Note(yoochan.kim): half an hour of music inside a two-hour window leaves each
    // song a sliver, so a block carries no writing of its own — it is told apart
    // by its edge and, when it is the one playing, by its colour. What it is and
    // when it starts is in the tooltip and on the scale below.
    const minutesPerPercent = width / 100;
    for (const segment of span.segments) {
      if (segment.to <= span.opens) continue;
      const from = Math.max(segment.from, span.opens);
      const share = pct(segment.to) - pct(from);
      const live =
        this.status.phase === "playing" && this.status.track.title === segment.title ? " is-now" : "";
      const seg = el("div", { class: `seg${live}`, style: `width:${share}%` });
      seg.title = `${hhmm(from)} ${segment.title}`;
      // Room for a name is rare on this bar; when there is, it is worth having.
      if (share * minutesPerPercent >= 14) seg.append(segment.title);
      children.push(seg);
    }
    if (nowMinutes >= span.opens && nowMinutes <= span.closes) {
      children.push(el("div", { class: "now", style: `left:${pct(nowMinutes)}%` }));
    }
    return el("div", { class: "tl__bar" }, children);
  }

  /** Clock positions for one flow, with the music derived from track lengths. */
  private spanOf(flow: ScheduledFlow): Span {
    const opens = minutesOf(flow.lock.at);
    const music = flow.parts.find((part) => part.kind === "music");
    const musicEnds = music ? minutesOf(music.endsAt) : opens;
    const closesRaw = flow.lock.until.kind === "clock" ? minutesOf(flow.lock.until.at) : musicEnds;
    const closes = closesRaw <= opens ? closesRaw + 24 * 60 : closesRaw;

    const segments: Span["segments"] = [];
    let from = musicEnds;
    if (music) {
      const known = music.tracks.map((cue) => this.tracks.get(cue.id));
      const totalMin = known.reduce((sum, track) => sum + (track?.durationSec ?? 0), 0) / 60;
      from = musicEnds - totalMin;
      let cursor = from;
      music.tracks.forEach((cue, index) => {
        const lengthMin = (known[index]?.durationSec ?? 0) / 60;
        segments.push({ from: cursor, to: cursor + lengthMin, title: known[index]?.title ?? cue.id });
        cursor += lengthMin;
      });
    }
    return { opens, closes, musicFrom: music ? from : closes, musicTo: musicEnds, segments };
  }

  /** The soonest flow whose window is open, or about to be. */
  private candidate(): ScheduledFlow | undefined {
    const minutesNow = this.now.getHours() * 60 + this.now.getMinutes() + this.now.getSeconds() / 60;
    let best: { flow: ScheduledFlow; opensIn: number } | undefined;

    for (const flow of this.flows) {
      if (!flow.runnableToday) continue;
      const span = this.spanOf(flow);
      if (minutesNow < span.opens - WINDOW_MINUTES || minutesNow >= span.closes) continue;
      const opensIn = span.opens - minutesNow;
      if (!best || opensIn < best.opensIn) best = { flow, opensIn };
    }
    return best?.flow;
  }
}

/** The mockup floats the tab link at the right edge of the head. */
function gotoRight(go: HTMLElement): HTMLElement {
  go.setAttribute("style", "margin-left:auto");
  return go;
}
