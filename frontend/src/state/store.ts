import type { S2CPayloads, State, StatePatch } from "../protocol.js";

/**
 * What the bridge reports about the far end: absent, or present and describing
 * itself. The present case is the media server's own ready payload, taken from
 * the generated protocol so it cannot drift from what actually arrives.
 */
export type Link = { connected: false } | ({ connected: true } & S2CPayloads["ready"]);

export interface Dashboard {
  link: Link;
  /** Attribute values as reported so far. Partial until the first full state. */
  device: StatePatch;
}

type Listener = (dashboard: Dashboard) => void;

/**
 * Holds what the dashboard knows. The device half is built by merging the
 * patches the media server sends, so this never re-derives a picture the
 * device did not describe.
 */
export class Store {
  private current: Dashboard = { link: { connected: false }, device: {} };
  private readonly listeners = new Set<Listener>();

  get dashboard(): Dashboard {
    return this.current;
  }

  /** Reads one attribute, or the fallback while it is still unknown. */
  attribute<K extends keyof State>(name: K, fallback: State[K]): State[K] {
    const value = this.current.device[name];
    return value === undefined ? fallback : (value as State[K]);
  }

  setLink(link: Link): void {
    this.current = { ...this.current, link };
    this.emit();
  }

  mergeState(patch: StatePatch): void {
    this.current = { ...this.current, device: { ...this.current.device, ...patch } };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.current));
  }
}
