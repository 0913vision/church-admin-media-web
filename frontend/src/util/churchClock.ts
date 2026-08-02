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
  private synced = false;
  private readonly listeners = new Set<(now: Date) => void>();
  private timer = 0;

  /** Feeds a heartbeat. Anything unparseable is ignored rather than trusted. */
  sync(at: string): void {
    const stamp = new Date(at).getTime();
    if (Number.isNaN(stamp)) return;
    this.skewMs = stamp - Date.now();
    this.synced = true;
  }

  now(): Date {
    return new Date(Date.now() + this.skewMs);
  }

  /** False until the first heartbeat, when there is nothing honest to show. */
  isSynced(): boolean {
    return this.synced;
  }

  /** Calls back once a second with church time. Returns a stop function. */
  start(listener: (now: Date) => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) {
      this.timer = window.setInterval(() => {
        const now = this.now();
        for (const each of this.listeners) each(now);
      }, 1000);
    }
    listener(this.now());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        window.clearInterval(this.timer);
        this.timer = 0;
      }
    };
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
