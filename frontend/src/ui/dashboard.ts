import { authApi } from "../api/auth.js";
import { deviceApi, scheduleApi } from "../api/device.js";
import { subscribeEvents } from "../api/events.js";
import type { Rejection, SystemStats } from "../api/events.js";
import { UnauthorizedError } from "../api/http.js";
import { MuteState } from "../protocol.js";
import type { State, StatePatch } from "../protocol.js";
import { Store } from "../state/store.js";
import type { Dashboard, Link } from "../state/store.js";
import { el } from "../util/dom.js";
import { throttle } from "../util/rate.js";
import { ConsolePanel } from "./components/ConsolePanel.js";
import { Fader } from "./components/Fader.js";
import { NowPlaying } from "./components/NowPlaying.js";
import { SchedulePanel, describeStatus } from "./components/SchedulePanel.js";
import { SongSelector } from "./components/SongSelector.js";
import { Switch } from "./components/Switch.js";
import { SystemPanel } from "./components/SystemPanel.js";
import { TransportControls } from "./components/TransportControls.js";
import { icon } from "./icons.js";

type ViewKey = "overview" | "playback" | "schedule" | "console" | "system";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "대시보드", icon: "grid" },
  { key: "playback", label: "재생", icon: "play" },
  { key: "schedule", label: "순서", icon: "clock" },
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

/** Every attribute the dashboard needs before it can claim to show the device */
const ATTRIBUTES = ["playback", "volume", "mute", "song", "adminLock", "audioLock", "isAdmin", "flow"] as const;

const REJECT_LABEL: Record<string, string> = {
  invalidValue: "값이 올바르지 않습니다",
  invalidPassword: "비밀번호가 올바르지 않습니다",
  notAdmin: "관리자만 할 수 있습니다",
  notWritable: "바꿀 수 없는 값입니다",
  adminLocked: "관리자 락이 걸려 있습니다",
  deviceBusy: "기기가 사용 중입니다",
  unknownTrack: "등록되지 않은 곡입니다",
  flowActive: "진행 중인 순서가 있습니다",
  noFlow: "진행 중인 순서가 없습니다",
  windowPassed: "이미 지난 시간이라 실행할 수 없습니다",
  unknownTarget: "서버가 모르는 요청입니다",
  protocolMismatch: "서버와 버전이 맞지 않습니다. 업데이트가 필요합니다",
};

/**
 * The device's state, but only once every attribute has arrived. Until then
 * there is nothing honest to draw, and filling the gaps with defaults would
 * show values the device never reported.
 */
function deviceOf(patch: StatePatch): { known: true; state: State } | { known: false } {
  return ATTRIBUTES.every((name) => patch[name] !== undefined)
    ? { known: true, state: patch as State }
    : { known: false };
}

export function renderDashboard(root: HTMLElement, onLoggedOut: () => void): void {
  const store = new Store();

  let stopStream: () => void = () => {};
  let clockTimer = 0;
  let noticeTimer = 0;
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

  // Writes are relayed as attribute writes, the same shape the device speaks.
  const write = <K extends keyof State>(field: K, value: State[K]): void => {
    guard(deviceApi.write(field, value));
  };
  const sendVolume = throttle((value: number) => write("volume", value), 60);

  // --- controls ---
  const now = new NowPlaying();
  const fader = new Fader({ onInput: sendVolume });
  const transport = new TransportControls({ onToggle: (next) => write("playback", next) });
  const songs = new SongSelector({ onSelect: (songId) => write("song", songId) });
  const muteSwitch = new Switch({
    onLabel: "음소거 중",
    offLabel: "소리 켜짐",
    tone: "accent",
    onChange: (next) => write("mute", next ? MuteState.MUTED : MuteState.UNMUTED),
  });
  const lockSwitch = new Switch({
    onLabel: "잠금",
    offLabel: "해제",
    tone: "danger",
    onChange: (next) => write("adminLock", next),
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
    onMic: () => guard(deviceApi.invoke({ command: "enableConsoleInput", args: { input: "mic" } })),
    onAux: () => guard(deviceApi.invoke({ command: "enableConsoleInput", args: { input: "aux" } })),
  });
  const systemPanel = new SystemPanel();

  // --- dashboard widgets (live readouts) ---
  const nowDash = new NowPlaying();
  const sysDash = new SystemPanel();
  const wgVolFill = el("div", { class: "wvol__fill" });
  const wgVolNum = el("span", { class: "wvol__num", textContent: "—" });
  const wgMute = el("span", { class: "badge is-warn is-hidden", textContent: "음소거" });
  const ovSchedMain = el("span", { class: "widget__big", textContent: "진행 중인 순서가 없습니다" });
  const ovSchedSub = el("span", { class: "widget__sub" });
  const ovLockBadge = el("span", { class: "badge" });
  const ovConnBadge = el("span", { class: "badge" });

  // --- topbar ---
  const clockTime = el("time", { class: "clock__time" });
  const clockDate = el("span", { class: "clock__date" });
  const connDot = el("span", { class: "conn" });
  const notice = el("span", { class: "badge is-bad is-hidden" });
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
      el("div", { class: "wvol" }, [icon("volume", 18), el("div", { class: "wvol__bar" }, [wgVolFill]), wgVolNum, wgMute]),
    ]),
    widget("시스템 상태", "system", "widget--system", [sysDash.el]),
    widget("순서", "schedule", "widget--schedule", [ovSchedMain, ovSchedSub, el("div", { class: "widget__row" }, [ovLockBadge])]),
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
        el("div", { class: "brand" }, [
          el("span", { class: "brand__mark" }),
          el("span", { class: "brand__name", textContent: "미디어 관리자" }),
        ]),
        nav,
      ]),
      el("div", { class: "main" }, [
        el("header", { class: "topbar" }, [
          pageTitle,
          el("div", { class: "topbar__right" }, [
            notice,
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

  /** Shows why something did nothing, rather than leaving it looking broken. */
  const showRejection = (rejection: Rejection): void => {
    notice.textContent = REJECT_LABEL[rejection.reason] ?? `거부됨: ${rejection.reason}`;
    notice.classList.remove("is-hidden");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.add("is-hidden"), 4000);
  };

  const renderLink = (link: Link): void => {
    connDot.textContent = link.connected ? "연결됨" : "연결 끊김";
    connDot.className = `conn ${link.connected ? "is-ok" : "is-bad"}`;
    setBadge(ovConnBadge, link.connected ? "서버 연결됨" : "서버 연결 끊김", link.connected ? "is-ok" : "is-bad");
    consolePanel.setReachable(link.connected);

    if (!link.connected) return;
    if (!link.accepted) {
      showRejection({ target: "hello", reason: "protocolMismatch" });
    }
    // Catalogues are fixed for the connection, so they are applied once here
    // rather than re-read on every state patch.
    songs.setCatalogue(link.songs);
    now.setCatalogue(link.songs);
    nowDash.setCatalogue(link.songs);
  };

  const renderDevice = (patch: StatePatch): void => {
    const device = deviceOf(patch);
    if (!device.known) return;
    const state = device.state;

    setBadge(ovLockBadge, state.adminLock ? "관리자 락 잠금" : "관리자 락 해제", state.adminLock ? "is-bad" : "");

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
    // A running flow owns the gate, so the switch goes quiet rather than
    // offering a toggle the server would refuse.
    lockSwitch.set(state.adminLock, !state.isAdmin || state.flow.phase !== "idle");

    schedulePanel.setStatus(state.flow);
    renderFlowWidget(state);
  };

  const renderFlowWidget = (state: State): void => {
    const described = describeStatus(state.flow);
    if (!described.known) {
      ovSchedMain.textContent = "알 수 없는 상태";
      ovSchedSub.textContent = "업데이트가 필요합니다";
      return;
    }
    if (state.flow.phase === "idle") {
      ovSchedMain.textContent = "진행 중인 순서가 없습니다";
      ovSchedSub.textContent = "순서 탭에서 시작할 수 있습니다";
      return;
    }
    ovSchedMain.textContent = described.name;
    ovSchedSub.textContent = [described.phase, ...described.details].join(" · ");
  };

  const renderSystem = (stats: SystemStats): void => {
    systemPanel.update(stats);
    sysDash.update(stats);
  };

  store.subscribe((dashboard: Dashboard) => {
    renderLink(dashboard.link);
    renderDevice(dashboard.device);
  });

  scheduleApi
    .list()
    .then(({ flows }) => schedulePanel.setFlows(flows))
    .catch((err) => {
      if (err instanceof UnauthorizedError) leave();
    });

  stopStream = subscribeEvents({
    onLink: (link) => store.setLink(link),
    onState: (patch) => store.mergeState(patch),
    onRejected: showRejection,
    onSystem: renderSystem,
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

