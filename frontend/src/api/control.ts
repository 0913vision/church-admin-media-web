import { http } from "./http.js";

export const scheduleApi = {
  start: (flowId: string): Promise<unknown> => http.post(`/api/schedule/${encodeURIComponent(flowId)}/start`),
  stop: (): Promise<unknown> => http.post("/api/schedule/stop"),
};

export const controlApi = {
  setVolume: (volume: number): Promise<unknown> => http.post("/api/control/volume", { volume }),
  setState: (state: number): Promise<unknown> => http.post("/api/control/state", { state }),
  setSong: (song: string): Promise<unknown> => http.post("/api/control/song", { song }),
  setMute: (mute: number): Promise<unknown> => http.post("/api/control/mute", { mute }),
  enableMic: (): Promise<unknown> => http.post("/api/control/mic"),
  enableAux: (): Promise<unknown> => http.post("/api/control/aux"),
  setAdminLock: (locked: boolean): Promise<unknown> => http.post("/api/control/admin-lock", { locked }),
};
