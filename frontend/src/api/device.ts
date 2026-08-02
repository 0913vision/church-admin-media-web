import type { InvokeRequest, State } from "../protocol.js";
import { http } from "./http.js";

/** When the panel unlocks: with the music, or at a time of its own. */
export type LockUntil = { kind: "music" } | { kind: "clock"; at: string };

export interface MusicPart {
  kind: "music";
  tracks: string[];
  endsAt: string;
}

/** A flow as it is written in schedules.json — what an edit sends back. */
export interface FlowEntry {
  name: string;
  weekdays: string[];
  /** Starts without anyone approving it when its window opens. */
  autoStart: boolean;
  lock: { at: string; until: LockUntil };
  parts: MusicPart[];
}

/** A flow as the dashboard reads it, with the day names already worked out. */
export interface ScheduledFlow {
  id: string;
  name: string;
  weekdays: number[];
  weekdayLabels: string[];
  autoStart: boolean;
  lock: { at: string; until: LockUntil };
  parts: MusicPart[];
  runnableToday: boolean;
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

export const scheduleApi = {
  list: (): Promise<{ flows: ScheduledFlow[] }> => http.get("/api/schedule"),
  save: (id: string, entry: FlowEntry): Promise<unknown> =>
    http.put(`/api/schedule/${encodeURIComponent(id)}`, entry),
  remove: (id: string): Promise<unknown> =>
    http.delete(`/api/schedule/${encodeURIComponent(id)}`),
  start: (flowId: string): Promise<unknown> => http.post(`/api/schedule/${encodeURIComponent(flowId)}/start`),
  skip: (flowId: string): Promise<unknown> => http.post(`/api/schedule/${encodeURIComponent(flowId)}/skip`),
  stop: (): Promise<unknown> => http.post("/api/schedule/stop"),
};
