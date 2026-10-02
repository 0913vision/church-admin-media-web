import { el } from "../../util/dom.js";
import { UnauthorizedError } from "../../api/http.js";
import { uploadTrack } from "../../api/uploads.js";
import type { Upload } from "../../api/uploads.js";
import type { Rejection } from "../../api/events.js";
import type { Track, TrackFetch, TrackSource } from "../../protocol.js";

export interface TrackAddOptions {
  /** Invokes addTrack. The answer comes back as state, or as a refusal. */
  onAdd: (title: string, source: TrackSource) => void;
  /** An upload became a track: the dialog is done. */
  onAdded: () => void;
  /** The server took the address and is fetching: the dialog is done, the list shows the rest. */
  onFetching: () => void;
  onUnauthorized: () => void;
}

type Source = "file" | "youtube";

/** Where the form is: being filled in, sending a file, or waiting on the server's word. */
type Phase =
  | { kind: "editing" }
  | { kind: "uploading"; percent: number }
  | { kind: "waiting"; on: "upload" | "fetch" };

/** What is wrong, and by which field it is said. */
type Problem = { kind: "none" } | { kind: "field"; field: "file" | "url"; text: string };

const EDITING: Phase = { kind: "editing" };
const FINE: Problem = { kind: "none" };

/** What a refusal of addTrack means, said by the field it is about. */
const REFUSED: Record<string, string> = {
  invalidValue: "유튜브 주소가 아니에요",
  fetchBusy: "다른 곡을 받고 있어요",
  fetchFailed: "영상을 받지 못했어요",
  tooLarge: "300MB를 넘어요",
  unknownUpload: "재생기에 올리지 못했어요",
};

function sizeOf(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;
  return megabytes < 1 ? `${Math.ceil(bytes / 1024)}KB` : `${megabytes.toFixed(1)}MB`;
}

/**
 * The 곡 추가 dialog's form: where the audio comes from, and what to call it.
 *
 * Note(yoochan.kim): the dialog closes on the server's word, not on the press. An upload
 * is done when a tracks patch names a track that was not there; a fetch is under
 * way when trackFetch says so, and the list shows the rest of that wait. A
 * refusal arrives while the dialog is still open, so it is shown by its field.
 * The fields are made once and kept, so redrawing never takes the box being typed in.
 */
export class TrackAdd {
  readonly el = el("div", { class: "addtrack" });
  readonly addKey = el("button", { class: "btn btn--go", type: "button", textContent: "추가" }) as HTMLButtonElement;

  private source: Source = "file";
  private file: File | undefined;
  private phase: Phase = EDITING;
  private problem: Problem = FINE;
  private known = new Set<string>();
  private upload: Upload | undefined;
  /** Bumped on every reset, so an upload finishing after the dialog closed is ignored. */
  private round = 0;

  private readonly fromFile = el("button", { type: "button", textContent: "파일" }) as HTMLButtonElement;
  private readonly fromYoutube = el("button", { type: "button", textContent: "유튜브" }) as HTMLButtonElement;
  private readonly picker = el("input", { type: "file", accept: ".mp3,audio/mpeg" }) as HTMLInputElement;
  private readonly fileKey = el("button", { class: "filebar__k", type: "button", textContent: "파일 선택" }) as HTMLButtonElement;
  private readonly fileName = el("button", { class: "filebar__n", type: "button" }) as HTMLButtonElement;
  private readonly fileField = el("div", { class: "field" });
  private readonly fileRow: HTMLElement;
  private readonly url = el("input", { class: "editor__input", placeholder: "https://youtu.be/..." }) as HTMLInputElement;
  private readonly urlField = el("div", { class: "field" });
  private readonly urlRow: HTMLElement;
  private readonly title = el("input", { class: "editor__input" }) as HTMLInputElement;

  constructor(private readonly options: TrackAddOptions) {
    this.picker.hidden = true;
    this.fromFile.addEventListener("click", () => this.choose("file"));
    this.fromYoutube.addEventListener("click", () => this.choose("youtube"));
    this.fileKey.addEventListener("click", () => this.picker.click());
    this.fileName.addEventListener("click", () => this.picker.click());
    this.picker.addEventListener("change", () => {
      this.file = this.picker.files?.[0];
      this.problem = FINE;
      this.refresh();
    });
    this.url.addEventListener("input", () => {
      this.problem = FINE;
      this.refresh();
    });
    this.title.addEventListener("input", () => this.refresh());
    this.addKey.addEventListener("click", () => this.add());

    this.fileRow = this.row("파일", this.fileField);
    this.urlRow = this.row("주소", this.urlField);
    this.el.append(
      this.row("가져오기", el("div", { class: "segctl" }, [this.fromFile, this.fromYoutube])),
      this.fileRow,
      this.urlRow,
      this.row("제목", el("div", { class: "field" }, [this.title])),
      this.picker,
    );
  }

  /** A fresh form, for a dialog about to open. */
  reset(): void {
    this.round += 1;
    this.upload?.abort();
    this.upload = undefined;
    this.source = "file";
    this.file = undefined;
    this.phase = EDITING;
    this.problem = FINE;
    this.picker.value = "";
    this.url.value = "";
    this.title.value = "";
    this.refresh();
  }

  /** The ids the library holds now, so the track this adds can be told from the rest. */
  setKnown(ids: string[]): void {
    this.known = new Set(ids);
  }

  /** New tracks arrived. True when one of them is the upload this form was waiting on. */
  onTracks(tracks: Track[]): boolean {
    if (!this.waitingOn("upload") || !tracks.some((track) => !this.known.has(track.id))) return false;
    this.phase = EDITING;
    this.options.onAdded();
    return true;
  }

  onFetch(fetch: TrackFetch | undefined): void {
    if (!this.waitingOn("fetch") || fetch?.kind !== "fetching") return;
    this.phase = EDITING;
    this.options.onFetching();
  }

  /** A refusal of addTrack while this form waits is this form's to show. */
  onRejected(rejection: Rejection): boolean {
    if (this.phase.kind !== "waiting" || rejection.target !== "addTrack") return false;
    const onFile = this.phase.on === "upload";
    this.phase = EDITING;
    this.problem = {
      kind: "field",
      field: onFile ? "file" : "url",
      text: onFile ? REFUSED.unknownUpload! : (REFUSED[rejection.reason] ?? "추가하지 못했어요"),
    };
    this.refresh();
    return true;
  }

  private waitingOn(what: "upload" | "fetch"): boolean {
    return this.phase.kind === "waiting" && this.phase.on === what;
  }

  private choose(source: Source): void {
    if (this.phase.kind !== "editing") return;
    this.source = source;
    this.problem = FINE;
    this.refresh();
  }

  private ready(): boolean {
    const from = this.source === "file" ? this.file !== undefined : this.url.value.trim().length > 0;
    return from && this.title.value.trim().length > 0 && this.phase.kind === "editing";
  }

  private add(): void {
    if (!this.ready()) return;
    const title = this.title.value.trim();
    this.problem = FINE;

    if (this.source === "youtube") {
      this.phase = { kind: "waiting", on: "fetch" };
      this.refresh();
      this.options.onAdd(title, { kind: "youtube", url: this.url.value.trim() });
      return;
    }

    const round = this.round;
    this.phase = { kind: "uploading", percent: 0 };
    this.refresh();
    this.upload = uploadTrack(this.file!, (percent) => {
      if (round !== this.round) return;
      this.phase = { kind: "uploading", percent };
      this.refresh();
    });
    this.upload.done
      .then((outcome) => {
        if (round !== this.round) return;
        this.upload = undefined;
        if (!outcome.ok) {
          this.phase = EDITING;
          this.problem = {
            kind: "field",
            field: "file",
            text: outcome.reason === "tooLarge" ? "300MB를 넘어요"
              : outcome.reason === "notMp3" ? "mp3 파일이 아니에요"
              : "재생기에 올리지 못했어요",
          };
          this.refresh();
          return;
        }
        this.phase = { kind: "waiting", on: "upload" };
        this.options.onAdd(title, { kind: "upload", upload: outcome.upload });
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) this.options.onUnauthorized();
      });
  }

  private refresh(): void {
    const busy = this.phase.kind !== "editing";
    const onFile = this.source === "file";
    this.fromFile.classList.toggle("on", onFile);
    this.fromYoutube.classList.toggle("on", !onFile);
    this.fromFile.disabled = busy;
    this.fromYoutube.disabled = busy;
    this.fileRow.classList.toggle("is-hidden", !onFile);
    this.urlRow.classList.toggle("is-hidden", onFile);

    const sending = this.phase.kind === "uploading" ? this.phase.percent : undefined;
    this.fileKey.disabled = busy;
    this.fileName.disabled = busy;
    this.fileName.classList.toggle("is-empty", this.file === undefined);
    this.fileName.replaceChildren(
      ...(sending !== undefined ? [el("i", { class: "filebar__fill", style: `width:${sending}%` })] : []),
      el("span", { textContent: this.file?.name ?? "mp3 파일" }),
      ...(sending !== undefined
        ? [el("small", { textContent: `올리는 중 ${sending}%` })]
        : this.file ? [el("small", { textContent: sizeOf(this.file.size) })] : []),
    );
    this.fileField.replaceChildren(el("div", { class: "filebar" }, [this.fileKey, this.fileName]), ...this.message("file"));
    this.fileField.classList.toggle("is-bad", this.problemAt("file"));

    this.url.disabled = busy;
    this.urlField.replaceChildren(this.url, ...this.message("url"));
    this.urlField.classList.toggle("is-bad", this.problemAt("url"));

    this.title.disabled = busy;
    this.addKey.disabled = !this.ready();
  }

  private problemAt(field: "file" | "url"): boolean {
    return this.problem.kind === "field" && this.problem.field === field;
  }

  private message(field: "file" | "url"): HTMLElement[] {
    return this.problem.kind === "field" && this.problem.field === field
      ? [el("p", { class: "field__msg", textContent: this.problem.text })]
      : [];
  }

  private row(label: string, field: HTMLElement): HTMLElement {
    return el("div", { class: "editor__row" }, [el("span", { class: "editor__label", textContent: label }), field]);
  }
}
