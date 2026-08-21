/**
 * The clock this building runs on, as this browser sees it.
 *
 * Never the browser's own clock: the whole reason the offset exists is that
 * clocks disagree, so a countdown drawn against this machine's would be wrong
 * in exactly the case the feature is for. The media server's heartbeat carries
 * church time; the difference from `performance`-anchored local time is kept
 * and applied between beats.
 */
export class ChurchClock {
  private skewMs = 0;
  private offsetSec = 0;
  private synced = false;
  private readonly listeners = new Set<(now: Date) => void>();
  private timer = 0;

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
    // Note(yoochan.kim): drawn at once on the first beat rather than at the next
    // tick, so the placeholder is on screen for as briefly as it can be.
    if (first) this.announce();
  }

  /**
   * The correction, as the device reports it. Held here rather than applied by
   * each caller: it arrives on connect and changes the instant someone nudges
   * it, while a beat is up to 30s away — a clock that waited for the beat would
   * show this browser's own time on every reload.
   */
  setOffset(offsetSec: number): void {
    this.offsetSec = offsetSec;
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
   * Calls back once a second with church time, and not at all before the first
   * beat. Until then the only answer available is this browser's own clock, and
   * showing it for a moment is worse than showing nothing: it is wrong, it looks
   * right, and it is the exact reading this class exists to avoid.
   */
  start(listener: (now: Date) => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) {
      this.timer = window.setInterval(() => this.announce(), 1000);
    }
    if (this.synced) listener(this.now());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        window.clearInterval(this.timer);
        this.timer = 0;
      }
    };
  }

  private announce(): void {
    if (!this.synced) return;
    const now = this.now();
    for (const each of this.listeners) each(now);
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

/** How the church clock differs from standard time, said the way people say it. */
export function driftOf(offsetSec: number): string {
  if (offsetSec === 0) return "보정 없음";
  return `표준 시각보다 ${durationOf(offsetSec)} ${offsetSec > 0 ? "빨라요" : "느려요"}`;
}

/** Signed seconds, for a log of what a correction did. */
export function signedOf(sec: number): string {
  return `${sec >= 0 ? "+" : "−"}${durationOf(sec)}`;
}

export function hhmmOf(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function ssOf(at: Date): string {
  return String(at.getSeconds()).padStart(2, "0");
}
