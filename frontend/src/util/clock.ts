/**
 * Wall-clock time of an absolute instant, for reading.
 *
 * The media server sends instants rather than clock times, because it will not
 * guess which day a bare "21:30" belongs to. Turning one back into something
 * to read is the client's job, and it is done in this browser's own timezone.
 *
 * An instant that will not parse is returned as it arrived: wrong and visible
 * beats quietly plausible.
 */
export function clockOf(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return instant;
  return at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Same, with the date — for a window that does not land today. */
export function stampOf(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return instant;
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  return sameDay
    ? clockOf(instant)
    : `${at.getMonth() + 1}/${at.getDate()} ${clockOf(instant)}`;
}
