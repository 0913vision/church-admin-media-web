import { el } from "../../util/dom.js";
import type { SystemStats } from "../../domain/protocol.js";

interface Meter {
  root: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
}

function meter(label: string): Meter {
  const fill = el("div", { class: "meter__fill" });
  const value = el("span", { class: "meter__value", textContent: "—" });
  const root = el("div", { class: "meter" }, [
    el("span", { class: "meter__label", textContent: label }),
    el("div", { class: "meter__bar" }, [fill]),
    value,
  ]);
  return { root, fill, value };
}

function setMeter(target: Meter, percent: number): void {
  target.fill.style.width = `${percent}%`;
  target.fill.className = `meter__fill ${percent > 85 ? "is-bad" : percent > 70 ? "is-warn" : ""}`.trim();
  target.value.textContent = `${Math.round(percent)}%`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

// Host (Raspberry Pi) health: gauge per resource plus temperature and uptime.
export class SystemPanel {
  readonly el: HTMLElement;
  private readonly cpu = meter("CPU");
  private readonly mem = meter("메모리");
  private readonly disk = meter("디스크");
  private readonly temp: HTMLElement;
  private readonly uptime: HTMLElement;

  constructor() {
    this.temp = el("span", { class: "fact__value", textContent: "—" });
    this.uptime = el("span", { class: "fact__value", textContent: "—" });
    this.el = el("div", { class: "sys" }, [
      el("div", { class: "sys__meters" }, [this.cpu.root, this.mem.root, this.disk.root]),
      el("div", { class: "sys__facts" }, [
        el("div", { class: "fact" }, [el("span", { class: "fact__label", textContent: "온도" }), this.temp]),
        el("div", { class: "fact" }, [el("span", { class: "fact__label", textContent: "가동 시간" }), this.uptime]),
      ]),
    ]);
  }

  update(stats: SystemStats): void {
    setMeter(this.cpu, stats.cpuPercent);
    setMeter(this.mem, stats.memPercent);
    setMeter(this.disk, stats.diskPercent);
    this.temp.textContent = stats.tempC === null ? "—" : `${stats.tempC.toFixed(1)}°C`;
    this.uptime.textContent = formatUptime(stats.uptimeSeconds);
  }
}
