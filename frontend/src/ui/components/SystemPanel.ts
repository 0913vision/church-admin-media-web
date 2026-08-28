import { BLANK, el } from "../../util/dom.js";
import type { SystemStats } from "../../api/events.js";
import { http } from "../../api/http.js";

/** How long it has been up, in the units the rest of this panel is written in. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
type SortKey = "pid" | "command" | "cpuPercent" | "memPercent";

export interface SystemPanelOptions {
  /** Shows a file this panel fetched. The dialog belongs to the page, not to a panel. */
  onOpenFile?: (title: string, body: HTMLElement) => void;
}

/** One scheduled job as the machine holds it, plus whatever note was written beside it. */
interface CronPayload {
  available: boolean;
  jobs: { when: string; command: string; note: string }[];
  reason?: string;
}

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A stamp as MM-DD HH:MM:SS.
 *
 * Note(yoochan.kim): the day is kept. A log tail can reach back past midnight, and a
 * column of times alone says a run happened at 21:57 without saying which 21:57 —
 * which is exactly the question being asked after something went wrong overnight.
 */
function stamp(date: string, time: string): string {
  return date ? `${date} ${time}` : time;
}

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
  /** The machine: what it is, what it runs on its own, what it is busy with. */
  readonly el: HTMLElement;
  /** Its logs, which are their own tab. */
  readonly logEl: HTMLElement;

  private readonly host = el("span", { textContent: BLANK });
  private readonly htop = el("div", { class: "htop" });
  private readonly proc = el("div", { class: "htop" });
  private processes: NonNullable<SystemStats["processes"]> = [];
  /** Busiest first, which is the reason anybody opens a process table. */
  private sort: { key: SortKey; desc: boolean } = { key: "cpuPercent", desc: true };
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

  constructor(private readonly options: SystemPanelOptions = {}) {
    const tab = (key: LogSource, label: string): HTMLButtonElement => {
      const button = el("button", { type: "button", textContent: label }) as HTMLButtonElement;
      button.classList.toggle("on", this.source === key);
      button.addEventListener("click", () => this.pick(key));
      return button;
    };
    this.tabs = { media: tab("media", "미디어 서버"), kernel: tab("kernel", "커널") };

    // What the machine is on the left, what it is running on the right.
    this.el = el("div", { class: "sys" }, [
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [el("span", { textContent: "호스트" }), this.host]),
        this.htop,
        // What this machine does on its own. The checks that run before a service
        // are root's jobs and belong to no login, so they are invisible from here
        // unless the panel goes and reads them.
        el("div", { class: "sys__t sys__t--sub" }, [el("span", { textContent: "cron" })]),
        this.cron,
      ]),
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [el("span", { textContent: "프로세스" })]),
        this.proc,
      ]),
    ]);

    /**
     * The logs, on a page of their own — hundreds of long lines want the height.
     *
     * Note(yoochan.kim): the choice sits above the panel rather than inside it, and
     * nothing here says "로그". The sidebar has already said so, and a page that
     * names itself twice spends a row on it.
     */
    this.logEl = el("div", { class: "logs" }, [
      el("div", { class: "logtabs logtabs--page" }, [this.tabs.media, this.tabs.kernel]),
      el("div", { class: "sys__p" }, [this.log]),
    ]);
  }

  private pick(source: LogSource): void {
    this.source = source;
    for (const [key, button] of Object.entries(this.tabs)) button.classList.toggle("on", key === source);
    // Note(yoochan.kim): a turning mark, not a sentence. Waiting has no news in it,
    // and words here are read as if they were the log's first line.
    this.log.replaceChildren(el("div", { class: "log__wait" }, [el("i", { class: "spin" })]));
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
    this.timer = window.setInterval(() => this.pull?.(), 2000);
    return () => window.clearInterval(this.timer);
  }

  update(stats: SystemStats): void {
    this.host.textContent = stats.host ?? BLANK;

    const rows: HTMLElement[] = [];
    (stats.cores ?? []).forEach((percent, index) => {
      rows.push(
        el("div", { class: "htop__r" }, [
          // Note(yoochan.kim): numbered from zero, the way the kernel numbers them —
          // cpu0 in /proc/stat is core 0 to taskset and to every other tool on the
          // machine. htop counts from one, and matching htop would mean a reading
          // here that names a different core than the shell does.
          el("span", { class: "htop__l", textContent: `Core ${index}` }),
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
        el("span", { class: "htop__l", textContent: "Disk" }),
        bar(stats.diskPercent),
        el("span", { class: "htop__v", textContent: `${Math.round(stats.diskPercent)}%` }),
      ]),
    );

    const load = (stats.load ?? []).map((value) => value.toFixed(2)).join("  ");
    rows.push(
      el("div", { class: "htop__load" }, [
        el("span", { class: "htop__l", textContent: "Load" }),
        el("span", { textContent: load || BLANK }),
        el("span", { class: "htop__l", style: "margin-left:14px", textContent: "Temp" }),
        el("span", { textContent: stats.tempC === null ? BLANK : `${stats.tempC.toFixed(1)}°C` }),
        el("span", { class: "htop__l", style: "margin-left:14px", textContent: "Uptime" }),
        el("span", { textContent: formatUptime(stats.uptimeSeconds) }),
      ]),
    );

    this.htop.replaceChildren(...rows);

    // Note(yoochan.kim): its own panel, because it is a different question. The left
    // asks what this machine is; this asks what it is busy with.
    this.processes = stats.processes ?? [];
    this.paintProcesses();
  }

  /**
   * The process table, in whatever order the header was last asked for.
   *
   * Note(yoochan.kim): sorted here rather than by the server. The list arrives every
   * two seconds and re-sorting it costs nothing, whereas a column that had to ask
   * the Pi would change order a beat after the press.
   */
  private paintProcesses(): void {
    const { key, desc } = this.sort;
    // Note(yoochan.kim): ties fall through the same chain every time — busiest, then
    // hungriest, then oldest, then by name — with whichever column was pressed
    // lifted to the front. Two idle processes then keep a stable order instead of
    // swapping places every two seconds.
    const chain: SortKey[] = [key, ...(["cpuPercent", "memPercent", "pid", "command"] as SortKey[]).filter((k) => k !== key)];
    const rows = [...this.processes].sort((a, b) => {
      for (const column of chain) {
        // Ascending first, so one rule can turn it round: the pressed column
        // follows the arrow, the rest keep their natural way — numbers largest
        // first, a name from A.
        const up = column === "command" ? a.command.localeCompare(b.command) : Number(a[column]) - Number(b[column]);
        const natural = column === "command" ? up : -up;
        const order = column === key ? (desc ? -up : up) : natural;
        if (order !== 0) return order;
      }
      return 0;
    });

    const head = (label: string, column: SortKey): HTMLElement => {
      const button = el("span", { class: `htop__h${key === column ? " on" : ""}`, textContent: label });
      if (key === column) button.append(el("i", { textContent: desc ? "▾" : "▴" }));
      button.addEventListener("click", () => {
        // A new column starts the way that column is usually wanted: names from A,
        // numbers from the largest — nobody opens this looking for the idlest process.
        this.sort = key === column ? { key, desc: !desc } : { key: column, desc: column !== "command" };
        this.paintProcesses();
      });
      return button;
    };

    this.proc.replaceChildren(
      el("div", { class: "htop__proc" }, [
        el("div", { class: "h" }, [head("PID", "pid"), head("COMMAND", "command"), head("CPU%", "cpuPercent"), head("MEM%", "memPercent")]),
        ...rows.map((row) =>
          el("div", {}, [
            el("span", { textContent: String(row.pid) }),
            el("span", { textContent: row.command, title: row.command }),
            el("span", { textContent: row.cpuPercent.toFixed(1) }),
            el("span", { textContent: row.memPercent.toFixed(1) }),
          ]),
        ),
      ]),
    );
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
          // "Aug 28 14:26:36 raspberrypi kernel: ..." — a month name, so it is
          // turned into the same MM-DD the media server's log already writes.
          const match = /^(\w{3})\s+(\d+)\s+([\d:]{8})\s+\S+\s+[^:]+:\s*(.*)$/.exec(line);
          const month = MONTHS.indexOf(match?.[1] ?? "");
          const day =
            match && month >= 0 ? `${String(month + 1).padStart(2, "0")}-${(match[2] ?? "").padStart(2, "0")}` : "";
          const text = match?.[4] ?? line;
          const bad = /error|fail|corrupt|read-only|panic|oops/i.test(text);
          const warn = /warn|throttl|voltage|temperature/i.test(text);
          return el("div", {}, [
            el("time", { textContent: stamp(day, match?.[3] ?? "") }),
            // Note(yoochan.kim): the severity, not the word "kernel" — every line in a
            // kernel log comes from the kernel, so printing it down the column
            // says nothing and takes the width the message needs.
            el("b", { class: bad ? "error" : warn ? "warn" : "", textContent: bad ? "ERROR" : warn ? "WARN" : "" }),
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
      ...payload.jobs.map((job) => {
        // Note(yoochan.kim): when, then what — never the note beside it. These lines
        // carry a hand-written "매일 오전 8시 50분" that says the schedule over
        // again, so printing both put two times on one row.
        const row = el("button", { class: "cron__r", type: "button", title: job.note || job.command }, [
          el("span", { class: "cron__w", textContent: whenInWords(job.when) }),
          el("span", { class: "cron__c", textContent: job.command }),
        ]) as HTMLButtonElement;
        row.addEventListener("click", () => this.openScript(job.command));
        return row;
      }),
    );
  }

  /** Shows what a job actually runs, so the schedule is not the only thing knowable. */
  private openScript(command: string): void {
    const path = command.split(/\s+/).find((token) => token.startsWith("/")) ?? "";
    if (!path || !this.options.onOpenFile) return;
    const show = (body: HTMLElement): void => this.options.onOpenFile?.(path, body);
    http
      .get<LogPayload>(`/api/system/cron/file?path=${encodeURIComponent(path)}`)
      .then((payload) =>
        show(
          payload.available
            ? el("pre", { class: "file", textContent: payload.lines.join("\n") })
            : el("div", { class: "log__none", textContent: payload.reason ?? "읽을 수 없어요" }),
        ),
      )
      .catch(() => show(el("div", { class: "log__none", textContent: "읽을 수 없어요" })));
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
        // "[2026-08-28 21:57:49] [INFO] ..." — the year is the one part nobody reads.
        const [day = "", clock = ""] = line.slice(1, 20).split(" ");
        const text = line.replace(/^\[[^\]]*\]/, "").replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, "");
        return el("div", {}, [
          el("time", { textContent: stamp(day.slice(5), clock) }),
          el("b", { class: level.toLowerCase(), textContent: level }),
          el("span", { textContent: text.trim() }),
        ]);
      });
    if (paint) this.log.replaceChildren(...rows.map((row) => row.cloneNode(true)));
    return rows;
  }
}
