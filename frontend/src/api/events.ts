import type { MediaState, ScheduleSnapshot, SystemStats } from "../domain/protocol.js";

export interface StreamHandlers {
  onState: (state: MediaState) => void;
  onSystem: (stats: SystemStats) => void;
  onSchedule: (snapshot: ScheduleSnapshot) => void;
}

// Subscribes to the server's live event stream. Returns an unsubscribe fn.
export function subscribeEvents(handlers: StreamHandlers): () => void {
  const source = new EventSource("/api/events", { withCredentials: true });
  source.addEventListener("state", (event) => {
    handlers.onState(JSON.parse((event as MessageEvent).data) as MediaState);
  });
  source.addEventListener("system", (event) => {
    handlers.onSystem(JSON.parse((event as MessageEvent).data) as SystemStats);
  });
  source.addEventListener("schedule", (event) => {
    handlers.onSchedule(JSON.parse((event as MessageEvent).data) as ScheduleSnapshot);
  });
  return () => source.close();
}
