import type { InvokeRequest, State } from "../protocol.js";
import { http } from "./http.js";

export interface ScheduledFlow {
  id: string;
  name: string;
  weekdays: number[];
  weekdayLabels: string[];
  parts: ({ kind: "lock"; at: string; until: string } | { kind: "music"; tracks: string[]; endsAt: string })[];
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
  start: (flowId: string): Promise<unknown> => http.post(`/api/schedule/${encodeURIComponent(flowId)}/start`),
  stop: (): Promise<unknown> => http.post("/api/schedule/stop"),
};
