/**
 * The clock this building runs on, as this browser sees it.
 *
 * Never the browser's own clock: the whole reason the offset exists is that
 * clocks disagree, so a countdown drawn against this machine's would be wrong
 * in exactly the case the feature is for. The media server's heartbeat carries
 * church time; the difference from `performance`-anchored local time is kept
 * and applied between beats.
 */
/** How far past a second's turn a tick lands, so the second it reads is the new one. */
const TICK_PAST_MS = 10;

/** Which clock a tick follows: church time, or the standard time it is corrected from. */
export type Basis = "church" | "standard";

const BASES: Basis[] = ["church", "standard"];

export class ChurchClock {
  private skewMs = 0;
  private offsetSec = 0;
  private synced = false;
  private readonly listeners: Record<Basis, Set<(now: Date) => void>> = { church: new Set(), standard: new Set() };
  private readonly timers: Record<Basis, number> = { church: 0, standard: 0 };

  /**
   * Feeds a heartbeat. Anything unparseable is ignored rather than trusted.
   *
   * The beat carries church time and the correction it was built from, so the
   * server's standard time comes back out exactly. What is kept is how this
   * machine's clock differs from that — the one thing a heartbeat is for.
   */
  sync(at: string, offsetSec: number): void {
    const stamp = new Date(at).getTime();
    if (Number.isNaN(stamp)) return;
    this.skewMs = stamp - offsetSec * 1000 - Date.now();
    const first = !this.synced;
    this.synced = true;
    for (const basis of BASES) {
      // Note(yoochan.kim): drawn at once on the first beat rather than at the next
      // tick, so the placeholder is on screen for as briefly as it can be.
      if (first) this.announce(basis);
      // The skew moves where a second turns over, so the next tick is aimed again.
      this.schedule(basis);
    }
  }

  /**
   * The correction, as the device reports it. Held here rather than applied by
   * each caller: it arrives on connect and changes the instant someone nudges
   * it, while a beat is up to 30s away — a clock that waited for the beat would
   * show this browser's own time on every reload.
   */
  setOffset(offsetSec: number): void {
    if (offsetSec === this.offsetSec) return;
    this.offsetSec = offsetSec;
    // Note(yoochan.kim): drawn at once. A correction pressed on the wall clock's flip has
    // to show now, not at whatever moment the next tick was due.
    this.announce("church");
    this.schedule("church");
  }

  /** Standard time as the server keeps it, which is the same instant everywhere. */
  standardNow(): Date {
    return new Date(Date.now() + this.skewMs);
  }

  now(): Date {
    return new Date(Date.now() + this.skewMs + this.offsetSec * 1000);
  }

  /** False until the first heartbeat, when there is nothing honest to show. */
  isSynced(): boolean {
    return this.synced;
  }

  /**
   * Calls back once a second with church time, or standard time if asked, and
   * not at all before the first beat. Until then the only answer available is
   * this browser's own clock, and showing it for a moment is worse than showing
   * nothing: it is wrong, it looks right, and it is the exact reading this class
   * exists to avoid.
   */
  start(listener: (now: Date) => void, basis: Basis = "church"): () => void {
    const listeners = this.listeners[basis];
    listeners.add(listener);
    if (!this.timers[basis]) this.schedule(basis);
    if (this.synced) listener(this.read(basis));
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        window.clearTimeout(this.timers[basis]);
        this.timers[basis] = 0;
      }
    };
  }

  private read(basis: Basis): Date {
    return basis === "church" ? this.now() : this.standardNow();
  }

  /**
   * Aims the next tick at the moment that clock turns over a second, so a
   * second on screen changes when the wall clock's does. A plain one-second
   * interval turns at whatever fraction it happened to start on — up to a
   * second behind the clock it is meant to match.
   */
  private schedule(basis: Basis): void {
    window.clearTimeout(this.timers[basis]);
    if (this.listeners[basis].size === 0) {
      this.timers[basis] = 0;
      return;
    }
    const intoSecond = ((this.read(basis).getTime() % 1000) + 1000) % 1000;
    this.timers[basis] = window.setTimeout(() => {
      this.announce(basis);
      this.schedule(basis);
    }, 1000 - intoSecond + TICK_PAST_MS);
  }

  private announce(basis: Basis): void {
    if (!this.synced) return;
    const now = this.read(basis);
    for (const each of this.listeners[basis]) each(now);
  }
}

/** "1분 12초", for describing an offset or a wait. Never signed. */
export function durationOf(totalSec: number): string {
  const seconds = Math.abs(Math.round(totalSec));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${rest}초`;
}

/**
 * An offset to a tenth of a second, "1분 2.4초". Never signed. A correction set
 * on the wall clock's flip is rarely whole seconds, and rounding it for show
 * would print "+0초" for one that is there.
 */
function amountOf(totalSec: number): string {
  const tenths = Math.round(Math.abs(totalSec) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  const seconds = Number.isInteger(rest) ? String(rest) : rest.toFixed(1);
  if (minutes === 0) return `${seconds}초`;
  if (rest === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

/** Whether an offset is none at all, as far as a tenth of a second can say. */
export function noOffset(offsetSec: number): boolean {
  return Math.round(offsetSec * 10) === 0;
}

/** How the church clock differs from standard time, said the way people say it. */
export function driftOf(offsetSec: number): string {
  if (noOffset(offsetSec)) return "보정 없음";
  return `표준 시각보다 ${amountOf(offsetSec)} ${offsetSec > 0 ? "빨라요" : "느려요"}`;
}

function signOf(sec: number): string {
  return sec > 0 ? "+" : "−";
}

/**
 * Where the church clock stands: "+12초 빠름". The sign is for reading numbers
 * against each other; the word says what is twelve seconds ahead of what.
 */
export function standingOf(offsetSec: number): string {
  if (noOffset(offsetSec)) return "보정 없음";
  return `${signOf(offsetSec)}${amountOf(offsetSec)} ${offsetSec > 0 ? "빠름" : "느림"}`;
}

/** What one correction did to the church clock: "+3초 빠르게". */
export function changeOf(deltaSec: number): string {
  if (noOffset(deltaSec)) return "그대로";
  return `${signOf(deltaSec)}${amountOf(deltaSec)} ${deltaSec > 0 ? "빠르게" : "느리게"}`;
}

export function hhmmOf(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function ssOf(at: Date): string {
  return String(at.getSeconds()).padStart(2, "0");
}

/** The one shape an instant takes on this wire: 2026-08-05T19:30:00.000. */
export function instantOf(at: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}
