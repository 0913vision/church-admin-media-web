import { http } from "./http.js";

interface SessionResult {
  authenticated: boolean;
}

export const authApi = {
  login: (password: string): Promise<SessionResult> => http.post("/api/auth/login", { password }),
  logout: (): Promise<SessionResult> => http.post("/api/auth/logout"),
  session: (): Promise<SessionResult> => http.get("/api/auth/session"),
};
