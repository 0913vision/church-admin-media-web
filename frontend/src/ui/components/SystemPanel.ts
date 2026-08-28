import { BLANK, el } from "../../util/dom.js";
import type { SystemStats } from "../../api/events.js";
import { http } from "../../api/http.js";

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function toneOf(percent: number): string {
  return percent > 85 ? "is-bad" : percent > 70 ? "is-warn" : "is-ok";
}

function bar(percent: number): HTMLElement {
  return el("span", { class: "htop__b" }, [
    el("i", { class: toneOf(percent), style: `width:${Math.min(100, Math.max(0, percent))}%` }),
  ]);
}

const LEVEL = /\[(INFO|WARN|ERROR|DEBUG)\]/;

/** The tail of the log, or why there is none — with the file it looked in. */
interface LogPayload {
  available: boolean;
  lines: string[];
  path?: string;
  reason?: string;
}

type LogSource = "media" | "kernel";

/** One scheduled job as the machine holds it, plus whatever note was written beside it. */
interface CronPayload {
  available: boolean;
  jobs: { when: string; command: string; note: string }[];
  reason?: string;
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * A crontab's five fields in words. Only the shapes this building actually uses
 * are spelled out; anything else goes back as written rather than as a guess,
 * because a schedule described wrongly is worse than one left in its own syntax.
 */
function whenInWords(when: string): string {
  const [min, hour, dom, mon, dow] = when.split(/\s+/);
  if (min === undefined || hour === undefined || !/^\d+$/.test(min) || !/^\d+$/.test(hour)) return when;
  const at = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `매일 ${at}`;
  if (dom === "*" && mon === "*" && dow !== undefined && /^\d$/.test(dow)) {
    return `${DAYS[Number(dow) % 7]}요일 ${at}`;
  }
  return when;
}

/**
 * htop on the left, the media server's own log on the right.
 *
 * Both halves exist to remove a reason to SSH into the Pi. The log is the
 * server's real output in standard time, not a Korean summary written here —
 * a second telling of the same events is one more thing that can be wrong.
 */
export class SystemPanel {
  readonly el: HTMLElement;

  private readonly host = el("span", { textContent: BLANK });
  private readonly htop = el("div", { class: "htop" });
  private readonly log = el("div", { class: "log" });
  private readonly cron = el("div", { class: "cron" });
  /**
   * Which log the right-hand panel is showing. The dashboard's small copy always
   * follows the media server's, whichever is picked here — it is a summary of
   * the thing this dashboard drives, not of whatever is being read at the moment.
   */
  private source: LogSource = "media";
  private readonly tabs: Record<LogSource, HTMLButtonElement>;
  private pull: (() => void) | null = null;
  private timer = 0;

  constructor() {
    const tab = (key: LogSource, label: string): HTMLButtonElement => {
      const button = el("button", { type: "button", textContent: label }) as HTMLButtonElement;
      button.classList.toggle("on", this.source === key);
      button.addEventListener("click", () => this.pick(key));
      return button;
    };
    this.tabs = { media: tab("media", "미디어 서버"), kernel: tab("kernel", "커널") };

    this.el = el("div", { class: "sys" }, [
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [el("span", { textContent: "호스트" }), this.host]),
        this.htop,
        // Note(yoochan.kim): what this machine does on its own. The checks that run
        // before a service are root's jobs and belong to no login, so they are
        // invisible from here unless the panel goes and reads them.
        el("div", { class: "sys__t sys__t--sub" }, [el("span", { textContent: "예약 작업" })]),
        this.cron,
      ]),
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [
          el("span", { textContent: "로그" }),
          el("div", { class: "segctl segctl--logs" }, [this.tabs.media, this.tabs.kernel]),
        ]),
        this.log,
      ]),
    ]);
  }

  private pick(source: LogSource): void {
    this.source = source;
    for (const [key, button] of Object.entries(this.tabs)) button.classList.toggle("on", key === source);
    this.log.replaceChildren(el("div", { class: "log__none", textContent: "읽는 중이에요" }));
    this.pull?.();
  }

  /**
   * Starts polling the log. Returns a stop function.
   *
   * `onLines` gets the same rendered lines, newest first, so the dashboard can
   * show the top of the same log rather than a second telling of it.
   */
  watchLog(onLines?: (lines: HTMLElement[]) => void): () => void {
    this.pull = (): void => {
      http
        .get<LogPayload>("/api/system/log")
        .then((payload) => onLines?.(this.mediaRows(payload, this.source === "media")))
        .catch(() => onLines?.(this.mediaRows({ available: false, lines: [] }, this.source === "media")));
      if (this.source === "kernel") {
        http
          .get<LogPayload>("/api/system/kernel")
          .then((payload) => this.paintKernel(payload))
          .catch(() => this.paintKernel({ available: false, lines: [] }));
      }
    };
    // Note(yoochan.kim): the jobs are read once. A crontab is edited by hand every
    // year or two, and asking the machine for it every five seconds spends a
    // process on an answer that has not changed since the page opened.
    http
      .get<CronPayload>("/api/system/cron")
      .then((payload) => this.paintCron(payload))
      .catch(() => this.paintCron({ available: false, jobs: [] }));
    this.pull();
    this.timer = window.setInterval(() => this.pull?.(), 5000);
    return () => window.clearInterval(this.timer);
  }

  update(stats: SystemStats): void {
    this.host.textContent = stats.host ?? BLANK;

    const rows: HTMLElement[] = [];
    (stats.cores ?? []).forEach((percent, index) => {
      rows.push(
        el("div", { class: "htop__r" }, [
          el("span", { class: "htop__l", textContent: String(index + 1) }),
          bar(percent),
          el("span", { class: "htop__v", textContent: `${percent.toFixed(1)}%` }),
        ]),
      );
    });
    if (rows.length === 0) {
      rows.push(
        el("div", { class: "htop__r" }, [
          el("span", { class: "htop__l", textContent: "CPU" }),
          bar(stats.cpuPercent),
          el("span", { class: "htop__v", textContent: `${Math.round(stats.cpuPercent)}%` }),
        ]),
      );
    }

    rows.push(
      el("div", { class: "htop__r", style: "margin-top:7px" }, [
        el("span", { class: "htop__l", textContent: "Mem" }),
        bar(stats.memPercent),
        el("span", {
          class: "htop__v",
          textContent:
            stats.memTotalBytes !== undefined
              ? `${gigabytes(stats.memUsedBytes ?? 0)}/${gigabytes(stats.memTotalBytes)}`
              : `${Math.round(stats.memPercent)}%`,
        }),
      ]),
      el("div", { class: "htop__r" }, [
        el("span", { class: "htop__l", textContent: "Swp" }),
        bar(stats.swapTotalBytes ? ((stats.swapUsedBytes ?? 0) / stats.swapTotalBytes) * 100 : 0),
        el("span", {
          class: "htop__v",
          textContent: stats.swapTotalBytes
            ? `${gigabytes(stats.swapUsedBytes ?? 0)}/${gigabytes(stats.swapTotalBytes)}`
            : BLANK,
        }),
      ]),
      el("div", { class: "htop__r" }, [
        el("span", { class: "htop__l", textContent: "디스크" }),
        bar(stats.diskPercent),
        el("span", { class: "htop__v", textContent: `${Math.round(stats.diskPercent)}%` }),
      ]),
    );

    const load = (stats.load ?? []).map((value) => value.toFixed(2)).join("  ");
    rows.push(
      el("div", { class: "htop__load" }, [
        el("span", { class: "htop__l", textContent: "Load" }),
        el("span", { textContent: load || BLANK }),
        el("span", { class: "htop__l", style: "margin-left:14px", textContent: "온도" }),
        el("span", { textContent: stats.tempC === null ? BLANK : `${stats.tempC.toFixed(1)}°C` }),
        el("span", { class: "htop__l", style: "margin-left:14px", textContent: "가동" }),
        el("span", { textContent: formatUptime(stats.uptimeSeconds) }),
      ]),
    );

    const processes = stats.processes ?? [];
    if (processes.length > 0) {
      rows.push(
        el("div", { class: "htop__proc" }, [
          el("div", { class: "h" }, [
            el("span", { textContent: "PID" }),
            el("span", { textContent: "COMMAND" }),
            el("span", { textContent: "CPU%" }),
            el("span", { textContent: "MEM%" }),
          ]),
          ...processes.map((row) =>
            el("div", {}, [
              el("span", { textContent: String(row.pid) }),
              el("span", { textContent: row.command }),
              el("span", { textContent: row.cpuPercent.toFixed(1) }),
              el("span", { textContent: row.memPercent.toFixed(1) }),
            ]),
          ),
        ]),
      );
    }

    this.htop.replaceChildren(...rows);
  }

  /** The kernel's tail. Its lines are the machine's own, so they are shown as they came. */
  private paintKernel(payload: LogPayload): void {
    if (!payload.available) {
      this.log.replaceChildren(
        el("div", { class: "log__none", textContent: `커널 로그를 읽을 수 없어요: ${payload.reason ?? "확인해 주세요"}` }),
      );
      return;
    }
    this.log.replaceChildren(
      ...payload.lines
        .slice(-120)
        .reverse()
        .map((line) => {
          // "Aug 28 14:26:36 raspberrypi kernel: ..." — the stamp, then the rest.
          const match = /^(\w{3}\s+\d+\s[\d:]{8})\s+\S+\s+([^:]+):\s*(.*)$/.exec(line);
          const text = match?.[3] ?? line;
          const bad = /error|fail|corrupt|read-only|panic|oops/i.test(text);
          const warn = /warn|throttl|voltage|temperature/i.test(text);
          return el("div", {}, [
            el("time", { textContent: match?.[1]?.slice(7) ?? "" }),
            el("b", { class: bad ? "error" : warn ? "warn" : "debug", textContent: match?.[2] ?? "" }),
            el("span", { textContent: text }),
          ]);
        }),
    );
  }

  /** What this machine does on its own, and when. */
  private paintCron(payload: CronPayload): void {
    if (!payload.available || payload.jobs.length === 0) {
      const why = payload.available ? "예약된 작업이 없어요" : `읽을 수 없어요: ${payload.reason ?? "확인해 주세요"}`;
      this.cron.replaceChildren(el("div", { class: "log__none", textContent: why }));
      return;
    }
    this.cron.replaceChildren(
      ...payload.jobs.map((job) =>
        el("div", { class: "cron__r" }, [
          el("span", { class: "cron__w", textContent: whenInWords(job.when) }),
          el("span", { class: "cron__c", textContent: job.note || job.command, title: job.command }),
        ]),
      ),
    );
  }

  /**
   * The media server's tail. Always rendered, because the dashboard's small copy
   * wants these rows whichever log this panel happens to be showing; `paint` is
   * whether they also belong on the panel itself.
   */
  private mediaRows(payload: LogPayload, paint: boolean): HTMLElement[] {
    if (!payload.available) {
      // Note(yoochan.kim): which file, and why. "읽을 수 없어요" on its own sends
      // the reader to SSH, which is the one thing this panel is here to avoid.
      const none = [
        el("div", { class: "log__none" }, [
          el("span", { textContent: `로그 파일을 읽을 수 없어요: ${payload.reason ?? "확인해 주세요"}` }),
          ...(payload.path === undefined ? [] : [el("code", { textContent: payload.path })]),
        ]),
      ];
      if (paint) this.log.replaceChildren(...none);
      return none;
    }
    if (payload.lines.length === 0) {
      const none = [el("div", { class: "log__none", textContent: "아직 기록이 없어요" })];
      if (paint) this.log.replaceChildren(...none);
      return none;
    }
    const rows = payload.lines
      .slice(-120)
      .reverse()
      .map((line) => {
        const level = LEVEL.exec(line)?.[1] ?? "";
        const stamp = line.slice(1, 20).split(" ")[1] ?? "";
        const text = line.replace(/^\[[^\]]*\]/, "").replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, "");
        return el("div", {}, [
          el("time", { textContent: stamp }),
          el("b", { class: level.toLowerCase(), textContent: level }),
          el("span", { textContent: text.trim() }),
        ]);
      });
    if (paint) this.log.replaceChildren(...rows.map((row) => row.cloneNode(true)));
    return rows;
  }
}
