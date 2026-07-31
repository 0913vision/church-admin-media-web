import { authApi } from "../api/auth.js";
import { controlApi, scheduleApi } from "../api/control.js";
import { subscribeEvents } from "../api/events.js";
import { UnauthorizedError } from "../api/http.js";
import { MuteState } from "../domain/protocol.js";
import type { MediaState, ScheduleSnapshot, SystemStats } from "../domain/protocol.js";
import { Store } from "../state/store.js";
import { el } from "../util/dom.js";
import { throttle } from "../util/rate.js";
import { ConsolePanel } from "./components/ConsolePanel.js";
import { Fader } from "./components/Fader.js";
import { NowPlaying } from "./components/NowPlaying.js";
import { PHASE_LABEL, SchedulePanel } from "./components/SchedulePanel.js";
import { SongSelector } from "./components/SongSelector.js";
import { Switch } from "./components/Switch.js";
import { SystemPanel } from "./components/SystemPanel.js";
import { TransportControls } from "./components/TransportControls.js";
import { icon } from "./icons.js";

type ViewKey = "overview" | "playback" | "schedule" | "console" | "system";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "대시보드", icon: "grid" },
  { key: "playback", label: "재생", icon: "play" },
  { key: "schedule", label: "스케줄", icon: "clock" },
  { key: "console", label: "콘솔", icon: "sliders" },
  { key: "system", label: "시스템", icon: "cpu" },
];

const DOMAIN: Record<Exclude<ViewKey, "overview">, { icon: string; accent: string }> = {
  playback: { icon: "play", accent: "is-indigo" },
  schedule: { icon: "clock", accent: "is-violet" },
  console: { icon: "sliders", accent: "is-amber" },
  system: { icon: "cpu", accent: "is-green" },
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function renderDashboard(root: HTMLElement, onLoggedOut: () => void): void {
  const store = new Store();

  let stopStream: () => void = () => {};
  let clockTimer = 0;
  const leave = (): void => {
    stopStream();
    window.clearInterval(clockTimer);
    onLoggedOut();
  };
  const guard = (promise: Promise<unknown>): void => {
    promise.catch((err) => {
      if (err instanceof UnauthorizedError) leave();
    });
  };

  const sendVolume = throttle((value: number) => guard(controlApi.setVolume(value)), 60);

  // --- controls ---
  const now = new NowPlaying();
  const fader = new Fader({ onInput: sendVolume });
  const transport = new TransportControls({ onToggle: (next) => guard(controlApi.setState(next)) });
  const songs = new SongSelector({ onSelect: (song) => guard(controlApi.setSong(song)) });
  const muteSwitch = new Switch({
    onLabel: "음소거 중",
    offLabel: "소리 켜짐",
    tone: "accent",
    onChange: (next) => guard(controlApi.setMute(next ? MuteState.MUTED : MuteState.UNMUTED)),
  });
  const lockSwitch = new Switch({
    onLabel: "잠금",
    offLabel: "해제",
    tone: "danger",
    onChange: (next) => guard(controlApi.setAdminLock(next)),
  });
  const schedulePanel = new SchedulePanel({
    onStart: (flowId) => {
      scheduleApi.start(flowId).catch((err) => {
        if (err instanceof UnauthorizedError) leave();
        else schedulePanel.showMessage(err instanceof Error ? err.message : "시작하지 못했습니다.");
      });
    },
    onStop: () => guard(scheduleApi.stop()),
  });
  const consolePanel = new ConsolePanel({
    onMic: () => guard(controlApi.enableMic()),
    onAux: () => guard(controlApi.enableAux()),
  });
  const systemPanel = new SystemPanel();

  // --- dashboard widgets (live readouts) ---
  const nowDash = new NowPlaying();
  const sysDash = new SystemPanel();
  const wgVolFill = el("div", { class: "wvol__fill" });
  const wgVolNum = el("span", { class: "wvol__num", textContent: "—" });
  const wgMute = el("span", { class: "badge is-warn is-hidden", textContent: "음소거" });
  const ovSchedMain = el("span", { class: "widget__big", textContent: "예정된 작업이 없습니다" });
  const ovSchedSub = el("span", { class: "widget__sub", textContent: "자동 재생 작업이 등록되면 여기에 표시됩니다" });
  const ovLockBadge = el("span", { class: "badge" });
  const ovConnBadge = el("span", { class: "badge" });

  // --- topbar ---
  const clockTime = el("time", { class: "clock__time" });
  const clockDate = el("span", { class: "clock__date" });
  const connDot = el("span", { class: "conn" });
  const logout = el("button", { class: "logout", type: "button", textContent: "로그아웃" });
  logout.addEventListener("click", () => authApi.logout().finally(leave));

  // --- views ---
  const views: Record<ViewKey, HTMLElement> = {
    overview: el("section", { class: "view view--overview" }, []),
    playback: el("section", { class: "view" }, [
      el("div", { class: "sheet" }, [
        now.el,
        el("hr", { class: "rule" }),
        el("div", { class: "playback__controls" }, [transport.el, songs.el]),
        el("hr", { class: "rule" }),
        fader.el,
        controlRow("음소거", muteSwitch.el, undefined, "volume"),
      ]),
    ]),
    schedule: el("section", { class: "view" }, [
      el("div", { class: "sheet" }, [
        schedulePanel.el,
        el("hr", { class: "rule" }),
        controlRow("관리자 락", lockSwitch.el, "관리자가 아닌 사용자의 조작을 막습니다.", "lock"),
      ]),
    ]),
    console: el("section", { class: "view" }, [el("div", { class: "sheet" }, [consolePanel.el])]),
    system: el("section", { class: "view" }, [el("div", { class: "sheet" }, [systemPanel.el])]),
  };

  const pageTitle = el("h1", { class: "topbar__title" });
  const navButtons = new Map<ViewKey, HTMLButtonElement>();
  const setView = (key: ViewKey): void => {
    navButtons.forEach((button, k) => button.classList.toggle("is-active", k === key));
    (Object.keys(views) as ViewKey[]).forEach((k) => views[k].classList.toggle("is-hidden", k !== key));
    pageTitle.textContent = NAV.find((entry) => entry.key === key)?.label ?? "";
  };

  const nav = el(
    "nav",
    { class: "nav" },
    NAV.map((entry) => {
      const button = el("button", { class: "nav__tab", type: "button" }, [
        icon(entry.icon, 17),
        el("span", { textContent: entry.label }),
      ]);
      button.addEventListener("click", () => setView(entry.key));
      navButtons.set(entry.key, button);
      return button;
    }),
  );

  views.overview.append(
    widget("재생", "playback", "widget--playback", [
      nowDash.el,
      el("div", { class: "wvol" }, [
        icon("volume", 18),
        el("div", { class: "wvol__bar" }, [wgVolFill]),
        wgVolNum,
        wgMute,
      ]),
    ]),
    widget("시스템 상태", "system", "widget--system", [sysDash.el]),
    widget("스케줄", "schedule", "widget--schedule", [
      ovSchedMain,
      ovSchedSub,
      el("div", { class: "widget__row" }, [ovLockBadge]),
    ]),
    widget("X32 콘솔", "console", "widget--console", [
      el("div", { class: "widget__row" }, [ovConnBadge]),
      el("span", { class: "widget__sub", textContent: "목사님 마이크와 AUX 입력을 켭니다" }),
    ]),
  );

  function widget(title: string, key: Exclude<ViewKey, "overview">, span: string, children: (Node | string)[]): HTMLElement {
    const domain = DOMAIN[key];
    const go = el("button", { class: "whead__go", type: "button" }, [el("span", { textContent: "관리" }), icon("arrow", 15)]);
    go.addEventListener("click", () => setView(key));
    return el("section", { class: `widget ${span} ${domain.accent}` }, [
      el("div", { class: "whead" }, [
        el("span", { class: "chip-ic" }, [icon(domain.icon, 20)]),
        el("span", { class: "whead__title", textContent: title }),
        go,
      ]),
      el("div", { class: "widget__body" }, children),
    ]);
  }

  root.replaceChildren(
    el("div", { class: "app" }, [
      el("aside", { class: "side" }, [
        el("div", { class: "brand" }, [el("span", { class: "brand__mark" }), el("span", { class: "brand__name", textContent: "미디어 관리자" })]),
        nav,
      ]),
      el("div", { class: "main" }, [
        el("header", { class: "topbar" }, [
          pageTitle,
          el("div", { class: "topbar__right" }, [
            el("div", { class: "clock" }, [clockTime, clockDate]),
            connDot,
            logout,
          ]),
        ]),
        el("main", { class: "stage" }, [views.overview, views.playback, views.schedule, views.console, views.system]),
      ]),
    ]),
  );

  setView("overview");

  const tick = (): void => {
    const d = new Date();
    clockTime.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    clockDate.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  };
  tick();
  clockTimer = window.setInterval(tick, 1000);

  const render = (state: MediaState): void => {
    connDot.textContent = state.connected ? "연결됨" : "연결 끊김";
    connDot.className = `conn ${state.connected ? "is-ok" : "is-bad"}`;

    setBadge(ovLockBadge, state.adminLock ? "관리자 락 잠금" : "관리자 락 해제", state.adminLock ? "is-bad" : "");
    setBadge(ovConnBadge, state.connected ? "서버 연결됨" : "서버 연결 끊김", state.connected ? "is-ok" : "is-bad");

    nowDash.update(state);
    wgVolFill.style.width = `${state.volume}%`;
    wgVolNum.textContent = String(Math.round(state.volume));
    wgMute.classList.toggle("is-hidden", state.mute !== MuteState.MUTED);

    now.update(state);
    fader.setValue(state.volume);
    fader.setDisabled(state.audioLock);
    transport.update(state);
    songs.update(state);
    muteSwitch.set(state.mute === MuteState.MUTED, state.audioLock);
    lockSwitch.set(state.adminLock, !state.adminAuthed);
    consolePanel.update(state);
  };

  const renderSystem = (stats: SystemStats): void => {
    systemPanel.update(stats);
    sysDash.update(stats);
  };

  const renderSchedule = (snapshot: ScheduleSnapshot): void => {
    schedulePanel.update(snapshot);
    if (snapshot.active) {
      ovSchedMain.textContent = snapshot.active.name;
      const track = snapshot.active.track;
      ovSchedSub.textContent =
        `${PHASE_LABEL[snapshot.active.phase]}` +
        `${track ? ` · ${track.index}/${track.total} ${track.title}` : ""}` +
        ` · ${snapshot.active.unlockAt.slice(11, 16)} 락 해제`;
    } else if (snapshot.flows.length > 0) {
      ovSchedMain.textContent = "예정된 작업이 없습니다";
      ovSchedSub.textContent = `등록된 스케줄 ${snapshot.flows.length}개 · 스케줄 탭에서 시작할 수 있습니다`;
    } else {
      ovSchedMain.textContent = "등록된 스케줄이 없습니다";
      ovSchedSub.textContent = "스케줄 설정 파일에 플로우를 추가하면 여기에 표시됩니다";
    }
  };

  store.subscribe(render);
  stopStream = subscribeEvents({
    onState: (state) => store.set(state),
    onSystem: renderSystem,
    onSchedule: renderSchedule,
  });
}

function controlRow(label: string, control: HTMLElement, hint?: string, iconName?: string): HTMLElement {
  const text = [el("span", { class: "ctl__label", textContent: label })];
  if (hint) text.push(el("span", { class: "ctl__hint", textContent: hint }));
  const children: (Node | string)[] = [];
  if (iconName) children.push(el("span", { class: "ctl__icon" }, [icon(iconName, 20)]));
  children.push(el("div", { class: "ctl__text" }, text), control);
  return el("div", { class: "ctl" }, children);
}

function setBadge(badge: HTMLElement, text: string, modifier: string): void {
  badge.textContent = text;
  badge.className = `badge ${modifier}`.trim();
}
