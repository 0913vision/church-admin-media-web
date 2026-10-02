import { UnauthorizedError } from "./http.js";

/** What the upload door said about a file. */
export type UploadOutcome =
  | { ok: true; upload: string }
  | { ok: false; reason: "tooLarge" | "notMp3" | "failed" };

/** An upload in flight, which can be given up. */
export interface Upload {
  done: Promise<UploadOutcome>;
  abort(): void;
}

/**
 * Sends an mp3 through the backend to the media server's upload door.
 *
 * Note(yoochan.kim): XMLHttpRequest rather than fetch, because only it reports how
 * much of a request body has gone. The file becomes a track only when addTrack
 * is invoked with the id this answers.
 */
export function uploadTrack(file: File, onProgress: (percent: number) => void): Upload {
  const xhr = new XMLHttpRequest();
  const done = new Promise<UploadOutcome>((resolve, reject) => {
    xhr.open("POST", "/api/uploads");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.floor((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 401) {
        reject(new UnauthorizedError());
        return;
      }
      if (xhr.status === 201) {
        resolve({ ok: true, upload: (JSON.parse(xhr.responseText) as { upload: string }).upload });
        return;
      }
      resolve({ ok: false, reason: xhr.status === 413 ? "tooLarge" : xhr.status === 415 ? "notMp3" : "failed" });
    });
    xhr.addEventListener("error", () => resolve({ ok: false, reason: "failed" }));
    xhr.addEventListener("abort", () => resolve({ ok: false, reason: "failed" }));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}
