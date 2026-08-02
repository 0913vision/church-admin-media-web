import { el } from "../../util/dom.js";
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

/**
 * htop on the left, the media server's own log on the right.
 *
 * Both halves exist to remove a reason to SSH into the Pi. The log is the
 * server's real output in standard time, not a Korean summary written here —
 * a second telling of the same events is one more thing that can be wrong.
 */
export class SystemPanel {
  readonly el: HTMLElement;

  private readonly host = el("span", { textContent: "—" });
  private readonly htop = el("div", { class: "htop" });
  private readonly log = el("div", { class: "log" });
  private timer = 0;

  constructor() {
    this.el = el("div", { class: "sys" }, [
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [el("span", { textContent: "호스트" }), this.host]),
        this.htop,
      ]),
      el("div", { class: "sys__p" }, [
        el("div", { class: "sys__t" }, [el("span", { textContent: "미디어 서버 로그" })]),
        this.log,
      ]),
    ]);
  }

  /**
   * Starts polling the log. Returns a stop function.
   *
   * `onLines` gets the same rendered lines, newest first, so the dashboard can
   * show the top of the same log rather than a second telling of it.
   */
  watchLog(onLines?: (lines: HTMLElement[]) => void): () => void {
    const pull = (): void => {
      http
        .get<{ available: boolean; lines: string[] }>("/api/system/log")
        .then((payload) => onLines?.(this.renderLog(payload)))
        .catch(() => onLines?.(this.renderLog({ available: false, lines: [] })));
    };
    pull();
    this.timer = window.setInterval(pull, 5000);
    return () => window.clearInterval(this.timer);
  }

  update(stats: SystemStats): void {
    this.host.textContent = stats.host ?? "—";

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
            : "—",
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
        el("span", { textContent: load || "—" }),
        el("span", { class: "htop__l", style: "margin-left:14px", textContent: "온도" }),
        el("span", { textContent: stats.tempC === null ? "—" : `${stats.tempC.toFixed(1)}°C` }),
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

  private renderLog(payload: { available: boolean; lines: string[] }): HTMLElement[] {
    if (!payload.available) {
      const none = [el("div", { class: "log__none", textContent: "로그 파일을 읽을 수 없어요" })];
      this.log.replaceChildren(...none);
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
    this.log.replaceChildren(...rows.map((row) => row.cloneNode(true)));
    return rows;
  }
}
