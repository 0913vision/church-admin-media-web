import type { RejectReason, StatePatch } from "../protocol.js";
import type { Link } from "../state/store.js";

export interface SystemStats {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  tempC: number | null;
  uptimeSeconds: number;
}

export interface Rejection {
  target: string;
  reason: RejectReason;
}

export interface StreamHandlers {
  onLink: (link: Link) => void;
  onState: (patch: StatePatch) => void;
  onRejected: (rejection: Rejection) => void;
  onSystem: (stats: SystemStats) => void;
}

/**
 * Subscribes to the dashboard's live channel. The media server's own events
 * come through unchanged, so the browser merges the same patches the bridge
 * did rather than a second, re-derived view.
 */
export function subscribeEvents(handlers: StreamHandlers): () => void {
  const source = new EventSource("/api/events", { withCredentials: true });
  const on = <T>(name: string, handle: (payload: T) => void): void => {
    source.addEventListener(name, (event) => handle(JSON.parse((event as MessageEvent).data) as T));
  };

  on<Link>("link", handlers.onLink);
  on<StatePatch>("state", handlers.onState);
  on<Rejection>("rejected", handlers.onRejected);
  on<SystemStats>("system", handlers.onSystem);

  return () => source.close();
}
