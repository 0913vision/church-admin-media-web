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
import { SchedulePanel } from "./components/SchedulePanel.js";
import { SystemPanel, formatUptime } from "./components/SystemPanel.js";
import { ClockPanel } from "./components/ClockPanel.js";
import { FlowPanel } from "./components/FlowPanel.js";
import { ChurchClock, driftOf, hhmmOf, ssOf } from "../util/churchClock.js";
import { TransportControls } from "./components/TransportControls.js";
import { icon } from "./icons.js";

type ViewKey = "overview" | "schedule" | "console" | "clock" | "system";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "대시보드", icon: "grid" },
  { key: "schedule", label: "자동 진행", icon: "music" },
  { key: "clock", label: "시계", icon: "clock" },
  { key: "console", label: "X32", icon: "sliders" },
  { key: "system", label: "라즈베리파이", icon: "cpu" },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** Every attribute the dashboard needs before it can claim to show the device */
const ATTRIBUTES = [
  "playback", "volume", "mute", "song", "adminLock", "audioLock", "isAdmin", "flow", "clockOffsetSec", "console",
] as const;

const REJECT_LABEL: Record<string, string> = {
  invalidValue: "값이 올바르지 않아요",
  invalidPassword: "비밀번호가 올바르지 않아요",
  notAdmin: "방송실에서만 할 수 있어요",
  notWritable: "바꿀 수 없어요",
  adminLocked: "관리자 잠금이 걸려 있어요",
  deviceBusy: "바뀌는 중이에요",
  unknownTrack: "등록되지 않은 곡이에요",
  flowActive: "이미 도는 자동 진행이 있어요",
  noFlow: "도는 자동 진행이 없어요",
  windowPassed: "이미 지난 시각이에요",
  musicOutsideLock: "곡이 잠금 시간을 벗어나요",
  unknownTarget: "서버가 모르는 요청이에요",
  protocolMismatch: "버전이 맞지 않아요. 업데이트가 필요해요",
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

/** The deck's second line: a lamp and a phrase, plus the flow chip when one plays. */
interface DeckMeta {
  el: HTMLElement;
  set(state: State, titles: Map<string, string>): void;
}

function deckMeta(): DeckMeta {
  const led = el("span", { class: "led led--off" });
  const text = el("span", {});
  const chip = el("span", { class: "chip chip--go is-hidden" });
  return {
    el: el("div", { class: "deck__meta" }, [led, text, chip]),
    set(state) {
      const playing = state.playback === "playing";
      led.className = `led ${playing ? "led--go" : "led--off"}`;
      text.textContent = playing ? "재생 중" : "정지됨";
      const flow = state.flow;
      chip.classList.toggle("is-hidden", flow.phase !== "playing");
      if (flow.phase === "playing") chip.textContent = `자동 진행 ${flow.track.index}/${flow.track.total}`;
    },
  };
}

/** The mockup's mute chip: a small pill that goes amber while muted. */
function muteChip(onChange: (next: boolean) => void): { el: HTMLButtonElement; set(on: boolean, disabled: boolean): void } {
  let muted = false;
  const button = el("button", { class: "mute", type: "button", textContent: "음소거" });
  button.addEventListener("click", () => onChange(!muted));
  return {
    el: button,
    set(on, disabled) {
      muted = on;
      button.classList.toggle("on", on);
      button.textContent = on ? "음소거 중" : "음소거";
      button.disabled = disabled;
    },
  };
}

export function renderDashboard(root: HTMLElement, onLoggedOut: () => void): void {
  const store = new Store();

  let stopStream: () => void = () => {};
  let noticeTimer = 0;
  const leave = (): void => {
    stopStream();
    onLoggedOut();
  };
  const guard = (promise: Promise<unknown>): void => {
    promise.catch((err) => {
      if (err instanceof UnauthorizedError) leave();
    });
  };

  // Note(yoochan.kim): Writes are relayed as attribute writes, the same shape the device speaks.
  const write = <K extends keyof State>(field: K, value: State[K]): void => {
    guard(deviceApi.write(field, value));
  };
  const sendVolume = throttle((value: number) => write("volume", value), 60);

  // --- controls ---
  const transport = new TransportControls({ onToggle: (next) => write("playback", next) });
  const fader = new Fader({ onInput: sendVolume });
  const mute = muteChip((next) => write("mute", next ? MuteState.MUTED : MuteState.UNMUTED));
  const schedulePanel = new SchedulePanel({
    onStart: (flowId) => {
      scheduleApi.start(flowId).catch((err) => {
        if (err instanceof UnauthorizedError) leave();
        else schedulePanel.showMessage(err instanceof Error ? err.message : "시작하지 못했어요");
      });
    },
    onStop: () => guard(scheduleApi.stop()),
    onSave: (id, entry) => {
      guard(
        scheduleApi
          .save(id, entry)
          .then(() => scheduleApi.list())
          .then(({ flows }) => {
            schedulePanel.setFlows(flows);
            flowPanel.setFlows(flows);
            schedulePanel.closeEditor();
            schedulePanel.showMessage("저장했어요");
          }),
      );
    },
    onDelete: (id) => {
      guard(
        scheduleApi
          .remove(id)
          .then(() => scheduleApi.list())
          .then(({ flows }) => {
            schedulePanel.setFlows(flows);
            flowPanel.setFlows(flows);
            schedulePanel.closeEditor();
            schedulePanel.showMessage("삭제했어요");
          }),
      );
    },
  });
  const consolePanel = new ConsolePanel({
    onEnable: (input) => guard(deviceApi.invoke({ command: "enableConsoleInput", args: { input } })),
  });
  const systemPanel = new SystemPanel();
  const church = new ChurchClock();
  const clockPanel = new ClockPanel({
    clock: church,
    onOffset: (offsetSec) => write("clockOffsetSec", offsetSec),
  });
  const flowPanel = new FlowPanel({
    onStart: (flowId) => {
      scheduleApi.start(flowId).catch((err) => {
        if (err instanceof UnauthorizedError) leave();
      });
    },
    onSkip: (flowId) => guard(scheduleApi.skip(flowId)),
    onStop: () => guard(scheduleApi.stop()),
    onGoto: () => setView("schedule"),
  });

  // --- deck readouts ---
  const deckSong = el("div", { class: "deck__song", textContent: "—" });
  const meta = deckMeta();
  const clockVal = el("div", { class: "clock__v" });
  const clockDrift = el("div", { class: "clock__d" });

  // --- topbar ---
  const topDate = el("div", { class: "clock__date num" });
  // Note(yoochan.kim): The gate is toggled here and only here: press the chip, the server answers.
  const lockValue = el("span", { class: "gate__v" });
  const gate = el("button", { class: "gate", type: "button" }, [
    el("span", { class: "led led--off" }),
    el("span", { class: "gate__l", textContent: "관리자 잠금" }),
    lockValue,
  ]);
  let adminLocked = false;
  // Note(yoochan.kim): The gate only moves if you mean it: hold until the chip fills.
  const gateArm = el("i", { class: "arm" });
  gate.prepend(gateArm);
  gateArm.addEventListener("transitionend", () => {
    if (gate.classList.contains("arming")) {
      // Note(yoochan.kim): Fired: ignore further presses until the gauge has drained back.
      gate.classList.remove("arming");
      gate.classList.add("cooling");
      write("adminLock", !adminLocked);
    } else {
      gate.classList.remove("cooling");
    }
  });
  gate.addEventListener("pointerdown", () => {
    if (!gate.classList.contains("cooling")) gate.classList.add("arming");
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"])
    gate.addEventListener(ev, () => gate.classList.remove("arming"));
  const notice = el("span", { class: "notice is-hidden" });
  // Note(yoochan.kim): Light while setting up, dark during a service. Remembered per browser.
  const SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
  const theme = el("button", { class: "nav__tab themebtn", type: "button" });
  const applyTheme = (mode: string): void => {
    document.documentElement.dataset.theme = mode;
    theme.innerHTML = `<span class="icon">${mode === "dark" ? SUN : MOON}</span><span>${mode === "dark" ? "밝게" : "어둡게"}</span>`;
    localStorage.setItem("theme", mode);
  };
  applyTheme(document.documentElement.dataset.theme ?? "light");
  theme.addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"),
  );
  const logout = el("button", { type: "button", textContent: "로그아웃" });
  logout.addEventListener("click", () => authApi.logout().finally(leave));

  /** A link naming the tab that owns the block it sits in. */
  const goto = (key: Exclude<ViewKey, "overview">, atRight = false): HTMLElement => {
    const go = el("button", {
      class: "goto",
      type: "button",
      textContent: `${NAV.find((entry) => entry.key === key)!.label} 탭`,
    });
    if (atRight) go.setAttribute("style", "margin-left:auto");
    go.addEventListener("click", () => setView(key));
    return go;
  };

  // Note(yoochan.kim): the desk's inputs — how many and what they are called —
  // come with the state, so rewiring or renaming one is a media-server change
  const consoleStrip = el("div", {});
  let consoleReachable = false;
  let consoleState: State["console"] = [];

  const renderConsoleRows = (): void => {
    const heard = consoleState.some((input) => input.state.kind === "read");
    x32Led.className = `led ${consoleReachable && heard ? "led--go" : "led--bad"}`;
    x32Conn.textContent = !consoleReachable ? "알 수 없음" : heard ? "연결됨" : "응답 없음";

    consoleStrip.replaceChildren(
      ...consoleState.map((input) => {
        const read = input.state;
        const on = read.kind === "read" && read.on;
        const percent = read.kind === "read" ? `${Math.round(read.fader * 100)}%` : "—";
        const button = el("button", {
          class: "pick",
          type: "button",
          textContent: on ? "켜져 있음" : "켜기",
        }) as HTMLButtonElement;
        button.disabled = !consoleReachable || on;
        button.addEventListener("click", () =>
          guard(deviceApi.invoke({ command: "enableConsoleInput", args: { input: input.id } })),
        );

        return el("div", { class: `chrow${on ? " on" : ""}` }, [
          el("span", { class: "chrow__n", textContent: input.label }),
          el("span", { class: "chrow__s" }, [
            el("span", { class: `led ${on ? "led--go" : "led--off"}` }),
            el("span", { textContent: read.kind === "read" ? (read.on ? "ON" : "OFF") : "—" }),
          ]),
          el("span", { class: "chrow__bar" }, [
            el("i", { style: `width:${read.kind === "read" ? Math.round(read.fader * 100) : 0}%` }),
          ]),
          el("span", { class: "chrow__db", textContent: percent }),
          el("span", {}),
          button,
        ]);
      }),
    );
  };
  const x32Led = el("span", { class: "led led--go" });
  const x32Conn = el("span", { textContent: "—" });
  const sysBars = el("div", {});
  const sysLog = el("div", { class: "log log--sum" });
  const songRadios = el("div", { class: "radios" });

  /** The deck's song list — the confirmed radio, one row per song. */
  const renderSongRadios = (state: State): void => {
    const flowOwnsDeck = state.flow.phase === "playing";
    songRadios.replaceChildren(
      ...[...songTitles.entries()].map(([id, title]) => {
        const selected = !flowOwnsDeck && id === state.song;
        const row = el("button", { class: selected ? "on" : "", type: "button" }, [
          el("span", { class: "r" }),
          title,
        ]);
        row.disabled = state.audioLock || flowOwnsDeck;
        row.title = flowOwnsDeck ? "자동 진행이 재생 중이에요" : "";
        if (!selected) row.addEventListener("click", () => write("song", id));
        return row;
      }),
    );
  };

  // --- views ---
  const dashDeck = el("div", { class: "deck" }, [
    el("div", { class: "deck__top" }, [
      transport.el,
      el("div", {}, [deckSong, meta.el]),
    ]),
    el("div", { class: "volrow" }, [
      el("span", { class: "volrow__l", textContent: "볼륨" }),
      fader.el,
      fader.valueEl,
      mute.el,
    ]),
    el("div", { class: "deck__songs" }, [songRadios]),
  ]);

  const views: Record<ViewKey, HTMLElement> = {
    overview: el("section", { class: "view" }, [
      el("div", { class: "head" }, [
        dashDeck,
        el("div", { class: "clock" }, [
          el("div", { class: "clock__t" }, [el("span", { textContent: "교회 시각" }), goto("clock")]),
          el("div", { class: "clock__b" }, [clockVal]),
          topDate,
          clockDrift,
        ]),
      ]),
      flowPanel.el,
      el("div", { class: "x32" }, [
        el("div", { class: "x32__h" }, [
          x32Led,
          el("b", { textContent: "X32 콘솔" }),
          x32Conn,
          goto("console", true),
        ]),
        consoleStrip,
      ]),
      el("div", { class: "sum" }, [
        el("div", {}, [el("div", { class: "sum__t" }, [el("span", { textContent: "시스템" })]), sysBars]),
        el("div", {}, [
          el("div", { class: "sum__t" }, [el("span", { textContent: "미디어 서버 로그" }), goto("system")]),
          sysLog,
        ]),
      ]),
    ]),
    schedule: el("section", { class: "view" }, [schedulePanel.el, ...schedulePanel.below()]),
    console: el("section", { class: "view" }, [consolePanel.el]),
    clock: el("section", { class: "view" }, [clockPanel.el]),
    system: el("section", { class: "view" }, [systemPanel.el]),
  };

  const pageTitle = el("b", {});
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
        icon(entry.icon, 15),
        el("span", { textContent: entry.label }),
      ]);
      button.addEventListener("click", () => setView(entry.key));
      navButtons.set(entry.key, button);
      return button;
    }),
  );

  root.replaceChildren(
    el("div", { class: "app" }, [
      el("aside", { class: "side" }, [
        el("div", { class: "brand" }, [
          el("span", { class: "brand__mark" }),
          el("span", { textContent: "미디어 관리자" }),
        ]),
        nav,
        theme,
      ]),
      el("div", { class: "main" }, [
        el("header", { class: "top" }, [
          pageTitle,
          el("div", { class: "right" }, [notice, gate, logout]),
        ]),
        el("main", { class: "page" }, [
          views.overview,
          views.schedule,
          views.console,
          views.clock,
          views.system,
        ]),
      ]),
    ]),
  );

  setView("overview");

  church.start((now) => {
    topDate.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS[now.getDay()]})`;
    clockVal.replaceChildren(hhmmOf(now), el("s", { textContent: `:${ssOf(now)}` }));
    flowPanel.setNow(now);
    schedulePanel.setNow(now);
  });

  /** Shows why something did nothing, rather than leaving it looking broken. */
  const showRejection = (rejection: Rejection): void => {
    notice.textContent = REJECT_LABEL[rejection.reason] ?? `거부됐어요: ${rejection.reason}`;
    notice.classList.remove("is-hidden");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.add("is-hidden"), 4000);
  };

  const renderLink = (link: Link): void => {
    x32Led.className = `led ${link.connected ? "led--go" : "led--bad"}`;
    x32Conn.textContent = link.connected ? "연결됨" : "알 수 없음";
    consolePanel.setReachable(link.connected);
    consoleReachable = link.connected;
    renderConsoleRows();

    if (!link.connected) return;
    if (!link.accepted) {
      showRejection({ target: "hello", reason: "protocolMismatch" });
    }
    // Note(yoochan.kim): Catalogues are fixed for the connection, so they are applied once here
    // rather than re-read on every state patch.
    songTitles = new Map(link.songs.map((song) => [song.id, song.title]));
    schedulePanel.setTracks(link.tracks);
    flowPanel.setTracks(link.tracks);
  };

  let songTitles = new Map<string, string>();

  const renderDevice = (patch: StatePatch): void => {
    const device = deviceOf(patch);
    if (!device.known) return;
    const state = device.state;

    // Note(yoochan.kim): While a flow plays its own track, the selected song is not what sounds.
    const title =
      state.flow.phase === "playing" ? state.flow.track.title : (songTitles.get(state.song) ?? state.song);
    deckSong.textContent = title;
    meta.set(state, songTitles);

    fader.setValue(state.volume);
    fader.setDisabled(state.audioLock);
    transport.update(state);
    renderSongRadios(state);
    mute.set(state.mute === MuteState.MUTED, state.audioLock);

    adminLocked = state.adminLock;
    lockValue.textContent = state.adminLock ? "잠김" : "풀림";
    gate.classList.toggle("on", state.adminLock);
    gate.querySelector(".led")!.className = `led led--${state.adminLock ? "bad" : "off"}`;
    // Note(yoochan.kim): A running flow owns the gate, so the chip goes quiet rather than
    // offering a toggle the server would refuse.
    gate.disabled = !state.isAdmin || state.flow.phase !== "idle";

    consoleState = state.console;
    renderConsoleRows();
    consolePanel.setState(state.console);

    schedulePanel.setStatus(state.flow);
    flowPanel.setStatus(state.flow);
    clockPanel.setOffset(state.clockOffsetSec);
    // Note(yoochan.kim): A run always holds the gate, so this is also "no clock changes while
    // music is playing".
    clockPanel.setGated(state.adminLock);
    clockDrift.textContent = driftOf(state.clockOffsetSec);
    clockDrift.className = `clock__d${state.clockOffsetSec !== 0 ? " is-off" : ""}`;
  };

  const renderSystem = (stats: SystemStats): void => {
    systemPanel.update(stats);
    const rows: [string, number, string][] = [
      ["CPU", stats.cpuPercent, `${Math.round(stats.cpuPercent)}%`],
      ["메모리", stats.memPercent, `${Math.round(stats.memPercent)}%`],
      ["디스크", stats.diskPercent, `${Math.round(stats.diskPercent)}%`],
    ];
    if (stats.tempC !== null) rows.push(["온도", Math.min(100, stats.tempC), `${Math.round(stats.tempC)}°C`]);
    sysBars.replaceChildren(
      ...rows.map(([label, percent, text]) =>
        el("div", { class: "sum__row" }, [
          el("span", { textContent: label }),
          el("span", { class: "htop__b" }, [
            el("i", {
              class: percent > 85 ? "is-bad" : percent > 70 ? "is-warn" : "",
              style: `width:${Math.min(100, Math.max(0, percent))}%`,
            }),
          ]),
          el("span", { class: "htop__v", textContent: text }),
        ]),
      ),
      el("div", { class: "sum__row" }, [
        el("span", { textContent: "가동" }),
        el("span", { class: "sum__plain", textContent: formatUptime(stats.uptimeSeconds) }),
        el("span", {}),
      ]),
    );
  };

  store.subscribe((dashboard: Dashboard) => {
    renderLink(dashboard.link);
    renderDevice(dashboard.device);
  });

  scheduleApi
    .list()
    .then(({ flows }) => {
      schedulePanel.setFlows(flows);
      flowPanel.setFlows(flows);
    })
    .catch((err) => {
      if (err instanceof UnauthorizedError) leave();
    });

  const stopLog = systemPanel.watchLog((lines) => {
    // Note(yoochan.kim): The same log the system tab shows, cut to what fits here.
    sysLog.replaceChildren(...lines.slice(0, 5).map((line) => line.cloneNode(true)));
  });
  const stopEvents = subscribeEvents({
    onLink: (link) => store.setLink(link),
    onState: (patch) => store.mergeState(patch),
    onRejected: showRejection,
    onSystem: renderSystem,
    onPing: (beat) => church.sync(beat.at),
  });
  stopStream = () => {
    stopLog();
    stopEvents();
  };

}
