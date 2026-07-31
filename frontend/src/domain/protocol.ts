// Domain enums and the live-state shape, mirroring the media server protocol.

export const PlayerState = { PAUSED: 0, PLAYING: 1 } as const;
export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

export const MuteState = { UNMUTED: 0, MUTED: 1 } as const;
export type MuteState = (typeof MuteState)[keyof typeof MuteState];

export const SongType = { SLOW: "slow", FAST: "fast" } as const;
export type SongType = (typeof SongType)[keyof typeof SongType];

export interface MediaState {
  state: number;
  volume: number;
  mute: number;
  currentSong: string;
  audioLock: boolean;
  adminLock: boolean;
  connected: boolean;
  adminAuthed: boolean;
}

export interface SystemStats {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  tempC: number | null;
  uptimeSeconds: number;
}

export interface TrackInfo {
  id: string;
  title: string;
  durationSec: number | null;
}

export interface ScheduleFlow {
  id: string;
  name: string;
  weekdays: number[];
  weekdayLabels: string[];
  lockAt: string;
  playAt: string | null;
  unlockAt: string;
  trackIds: string[];
  tracks: TrackInfo[];
}

export interface ScheduleActive {
  flowId: string;
  name: string;
  phase: "waiting_lock" | "waiting_play" | "playing" | "waiting_unlock";
  track: { title: string; index: number; total: number } | null;
  playAt: string | null;
  unlockAt: string;
}

export interface ScheduleSnapshot {
  flows: ScheduleFlow[];
  active: ScheduleActive | null;
}
