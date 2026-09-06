import type { InvokeRequest, ScheduleEntry, ScheduleUntil, SchedulePart, State } from "../protocol.js";
import { http } from "./http.js";

/** When the panel unlocks: with the music, or at a time of its own. */
export type LockUntil = ScheduleUntil;
export type MusicPart = Extract<SchedulePart, { kind: "music" }>;

/** A flow as an edit sends it back — the calendar's own shape, minus the id. */
export type FlowEntry = Omit<ScheduleEntry, "id">;

/**
 * A flow as the dashboard reads it: the calendar entry, plus the two things
 * screens ask of it.
 *
 * Note(yoochan.kim): worked out here rather than sent. The media server states the days
 * as mon..sun and says nothing about today, because "today" turns over at
 * midnight and a flag sent once would be wrong by morning.
 */
export interface ScheduledFlow extends Omit<ScheduleEntry, "weekdays"> {
  weekdays: number[];
  weekdayLabels: string[];
  runnableToday: boolean;
}

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

export function asScheduledFlow(entry: ScheduleEntry, today: Date): ScheduledFlow {
  const days = entry.weekdays
    .map((key) => WEEKDAY_KEYS.indexOf(key))
    .filter((day) => day >= 0)
    .sort((a, b) => a - b);
  return {
    ...entry,
    weekdays: days,
    weekdayLabels: days.map((day) => WEEKDAY_LABELS[day]!),
    // getDay() counts Sunday first; the calendar counts Monday first.
    runnableToday: days.includes((today.getDay() + 6) % 7),
  };
}

/**
 * The device is driven the same way over HTTP as it is over the wire: write an
 * attribute, or invoke a command. Whether a value is acceptable is the media
 * server's call, and a refusal arrives on the event stream — so there is no
 * second copy of the rules here to drift out of step.
 */
export const deviceApi = {
  write: <K extends keyof State>(field: K, value: State[K]): Promise<unknown> =>
    http.post("/api/device/write", { field, value }),

  invoke: (request: InvokeRequest): Promise<unknown> =>
    http.post("/api/device/invoke", { command: request.command, args: request.args }),
};

/**
 * The calendar, driven the same way as everything else: commands to the device.
 *
 * Note(yoochan.kim): there is no list here. The calendar arrives as state, so a dashboard
 * left open sees an edit made on another screen without asking for it.
 */
export const scheduleApi = {
  save: (id: string, entry: FlowEntry): Promise<unknown> =>
    deviceApi.invoke({ command: "saveFlow", args: { flow: { ...entry, id } } }),
  remove: (id: string): Promise<unknown> =>
    deviceApi.invoke({ command: "deleteFlow", args: { id } }),
  start: (id: string): Promise<unknown> =>
    deviceApi.invoke({ command: "startScheduledFlow", args: { id } }),
  skip: (id: string): Promise<unknown> =>
    deviceApi.invoke({ command: "skipFlow", args: { id } }),
  stop: (): Promise<unknown> => deviceApi.invoke({ command: "stopFlow", args: {} }),
};
