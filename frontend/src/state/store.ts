import type { MediaState } from "../domain/protocol.js";

type Listener = (state: MediaState) => void;

const DEFAULT_STATE: MediaState = {
  state: 0,
  volume: 50,
  mute: 0,
  currentSong: "slow",
  audioLock: false,
  adminLock: false,
  connected: false,
  adminAuthed: false,
};

export class Store {
  private current: MediaState = DEFAULT_STATE;
  private readonly listeners = new Set<Listener>();

  get state(): MediaState {
    return this.current;
  }

  set(state: MediaState): void {
    this.current = state;
    this.listeners.forEach((listener) => listener(state));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }
}
