import type { FlowStatus, SchedulePart, Track } from "../protocol.js";

/**
 * Whether a run has the deck.
 *
 * Note(yoochan.kim): the same condition the device applies — sounding music, not
 * merely holding the gate. A flow holding the gate keeps the panel out; the deck
 * is still free, and the device takes writes to it.
 */
export function flowOwnsDeck(flow: FlowStatus): boolean {
  return flow.phase === "playing";
}

// Note(yoochan.kim): the quiet a countdown's block keeps ahead of its first sound, as the protocol states it.
const COUNTDOWN_LEAD_SEC = 10;

/** Seconds as the band hears them: 90 is 1분 30초. */
function spoken(beforeSec: number): string {
  const mins = Math.floor(beforeSec / 60);
  const secs = beforeSec % 60;
  if (mins === 0) return `${secs}초`;
  return secs === 0 ? `${mins}분` : `${mins}분 ${secs}초`;
}

/** When a notice sounds: 1분 30초 전. */
export function noticeLabel(beforeSec: number): string {
  return `${spoken(beforeSec)} 전`;
}

/** What a notice's audio is called in the library: 1분 30초 알림. */
function noticeName(beforeSec: number): string {
  return `${spoken(beforeSec)} 알림`;
}

/** The notices the library has audio for, earliest first. */
export function noticesHeld(tracks: Track[]): number[] {
  return inOrder(tracks.flatMap((track) => (track.role.kind === "notice" ? [track.role.beforeSec] : [])));
}

/** Whether a track is a countdown's, which only a countdown plays. */
export function isCountdownAudio(track: Track): boolean {
  return track.role.kind !== "music";
}

/** A countdown's audio in the order it sounds: the notices earliest first, then the count. */
export function countdownAudio(tracks: Track[]): Track[] {
  const at = (track: Track): number => (track.role.kind === "notice" ? track.role.beforeSec : 0);
  return tracks.filter(isCountdownAudio).sort((a, b) => at(b) - at(a));
}

/** Seconds since midnight, from HH:MM or HH:MM:SS. */
export function secondsOf(clock: string): number {
  const [hours, mins, secs] = clock.split(":").map(Number);
  return (hours ?? 0) * 3600 + (mins ?? 0) * 60 + (secs ?? 0);
}

/** The notices in the order they sound, earliest first. */
export function inOrder(notices: Iterable<number>): number[] {
  return [...new Set(notices)].sort((a, b) => b - a);
}

/** A countdown in seconds since midnight: when its block opens, when it first sounds, and zero. */
export function countdownSpan(at: string, notices: Iterable<number>, tracks: Track[]): { opens: number; first: number; zero: number } {
  const zero = secondsOf(at);
  const count = tracks.find((track) => track.role.kind === "count")?.durationSec ?? 0;
  const first = Math.min(zero - count, ...inOrder(notices).map((beforeSec) => zero - beforeSec));
  return { opens: first - COUNTDOWN_LEAD_SEC, first, zero };
}

/** What a countdown needs from the library and it lacks, by name. */
export function missingAudio(notices: Iterable<number>, tracks: Track[]): string[] {
  const held = new Set(noticesHeld(tracks));
  const missing = inOrder(notices).filter((beforeSec) => !held.has(beforeSec)).map(noticeName);
  return tracks.some((track) => track.role.kind === "count") ? missing : [...missing, "카운트다운"];
}

/** The part that sounds last, counted from the gate so a run past midnight compares right. */
export function lastSound(lockAt: string, parts: SchedulePart[]): { kind: SchedulePart["kind"]; at: string } | undefined {
  const after = (clock: string): number => (((secondsOf(clock) - secondsOf(lockAt)) % 86400) + 86400) % 86400;
  let last: { kind: SchedulePart["kind"]; at: string } | undefined;
  for (const part of parts) {
    const at = part.kind === "music" ? part.endsAt : part.at;
    if (!last || after(at) > after(last.at)) last = { kind: part.kind, at };
  }
  return last;
}
