import { authApi } from "../api/auth.js";
import { asScheduledFlow, deviceApi, scheduleApi } from "../api/device.js";
import { subscribeEvents } from "../api/events.js";
import type { Rejection, SystemStats } from "../api/events.js";
import { UnauthorizedError } from "../api/http.js";
import { MuteState } from "../protocol.js";
import type { State, StatePatch, Track } from "../protocol.js";
import { Store } from "../state/store.js";
import type { Dashboard, Link } from "../state/store.js";
import { BLANK, el } from "../util/dom.js";
import { throttle } from "../util/rate.js";
import { ConsolePanel } from "./components/ConsolePanel.js";
import { levelText, meter, unmuteButton } from "./components/meter.js";
import { holdToFire } from "./components/hold.js";
import { Modal } from "./components/Modal.js";
import { Fader } from "./components/Fader.js";
import { SchedulePanel } from "./components/SchedulePanel.js";
import { SystemPanel, formatUptime } from "./components/SystemPanel.js";
import { ClockPanel } from "./components/ClockPanel.js";
import { FlowPanel } from "./components/FlowPanel.js";
import { ChurchClock, driftOf, hhmmOf, instantOf, ssOf } from "../util/churchClock.js";
import { TransportControls } from "./components/TransportControls.js";
import { icon } from "./icons.js";
import { flowOwnsDeck } from "../util/flow.js";
import { LibraryPanel } from "./components/LibraryPanel.js";

type ViewKey = "overview" | "player" | "schedule" | "console" | "clock" | "system" | "logs";

// Note(yoochan.kim): the machine and its logs are two tabs, not one. A log line is
// long and there are hundreds of them, and sharing a page with the host's own
// readings left it a few rows deep — the one panel nobody can use in a strip.
const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "overview", label: "대시보드", icon: "grid" },
  { key: "player", label: "재생기", icon: "audio" },
  { key: "clock", label: "시계", icon: "clock" },
  { key: "schedule", label: "자동 진행", icon: "music" },
  { key: "console", label: "X32", icon: "sliders" },
  { key: "system", label: "시스템", icon: "cpu" },
  { key: "logs", label: "로그", icon: "logs" },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** The tab an address names, or nothing when it names none this build has. */
function viewOf(hash: string): ViewKey | null {
  const key = hash.replace(/^#/, "");
  return NAV.some((entry) => entry.key === key) ? (key as ViewKey) : null;
}

/**
 * A track's length for a column of them.
 *
 * Note(yoochan.kim): mm:ss rather than the list's "61분 25초". Right-aligned, the two
 * numbers in that form put 분 in a different place on every row.
 */
function lengthOf(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Every attribute the dashboard needs before it can claim to show the device */
const ATTRIBUTES = [
  "playback", "volume", "mute", "loop", "song", "deck", "unlockWhenDone", "musicEndsAt", "trackVolumes",
  "adminLock", "adminHold", "audioLock", "isAdmin", "flow", "schedule", "clockOffsetSec", "console",
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
  const chip = el("span", { class: "chip chip--go is-hidden" });
  return {
    // Note(yoochan.kim): no lamp and no "정지됨". The key beside this is already
    // the state and the way to change it; a second telling can only disagree.
    el: el("div", { class: "deck__meta" }, [chip]),
    set(state) {
      const flow = state.flow;
      chip.classList.toggle("is-hidden", flow.phase !== "playing");
      if (flow.phase === "playing") chip.textContent = `자동 진행 ${flow.track.index}/${flow.track.total}`;
    },
  };
}

/**
 * The deck's mute, read the same way a console input is: the key says what
 * pressing it does, and while the deck is silent its level is red.
 */
function muteChip(onChange: (next: boolean) => void): { el: HTMLButtonElement; set(on: boolean, disabled: boolean): void } {
  let muted = false;
  const button = el("button", { class: "mute", type: "button", textContent: "음소거" });
  button.addEventListener("click", () => onChange(!muted));
  return {
    el: button,
    set(on, disabled) {
      muted = on;
      button.classList.toggle("on", on);
      button.textContent = on ? "음소거 해제" : "음소거";
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

  /** What the library holds, kept for the settings dialog to open onto. */
  let libraryTracks: Track[] = [];
  let deckSongIds = new Set<string>();
  let trackLevels = new Map<string, number>();

  /**
   * Drives one console input to its own level.
   *
   * Note(yoochan.kim): a re-send says so out loud. Nothing on screen changes — the
   * desk already reported the input as sounding — so without a word the press
   * looks like it missed.
   */
  const sendConsole = (input: string, resend: boolean): void => {
    guard(deviceApi.invoke({ command: "enableConsoleInput", args: { input } }));
    if (!resend) return;
    const label = consoleState.find((entry) => entry.id === input)?.label ?? "입력";
    showNotice(`${label} 소리를 기준으로 되돌렸어요`, true);
  };

  /**
   * Puts the whole desk back to where a service starts — the same command the
   * panel's two-finger press sends.
   *
   * Note(yoochan.kim): asked first, in the same words the panel uses. It moves the
   * masters, so the room hears it the moment it lands.
   */
  const initializeConsole = (): void => {
    const body = el("p", { class: "ask", textContent: "본당 음향을 예배와 동일하게 변경합니다. 진행할까요?" });
    const no = el("button", { class: "btn", type: "button", textContent: "아니오" });
    no.addEventListener("click", () => confirm.close());
    const yes = el("button", { class: "btn btn--go", type: "button", textContent: "네" });
    yes.addEventListener("click", () => {
      confirm.close();
      guard(deviceApi.invoke({ command: "initializeConsole", args: {} }));
      showNotice("본당 음향을 예배와 동일하게 맞췄어요", true);
    });
    confirm.open("주의", body, () => {}, [no, yes]);
  };

  /**
   * A write to the calendar, and what it did. A refusal used to be swallowed by
   * `guard`, so a save the backend rejected left the dialog open saying nothing.
   */
  const written = (call: Promise<unknown>, done: string, failed: string): void => {
    call
      .then(() => {
        // Note(yoochan.kim): the new calendar is not read back here — it arrives as state,
        // to every screen at once, and this one is no more entitled than the rest.
        schedulePanel.closeEditor();
        schedulePanel.showMessage(done);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) leave();
        else showNotice(err instanceof Error && err.message ? err.message : failed);
      });
  };

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
      written(scheduleApi.save(id, entry), "저장했어요", "저장하지 못했어요");
    },
    onDelete: (id) => {
      written(scheduleApi.remove(id), "삭제했어요", "삭제하지 못했어요");
    },
  });
  const consolePanel = new ConsolePanel({
    onEnable: (input, resend) => sendConsole(input, resend),
    onInitialize: () => initializeConsole(),
  });
  // Note(yoochan.kim): one dialog for the whole page's questions, so a second one
  // can never open behind the first.
  const confirm = new Modal();
  const libraryPanel = new LibraryPanel({
    onSelectSong: (id) => write("song", id),
    onPlayTrack: (id) => guard(deviceApi.invoke({ command: "selectTrack", args: { id } })),
    onSettings: () => openLibrarySettings(),
    onLoop: (loop) => {
      write("loop", loop);
      // Asked at the moment it is switched on: repeating audio has no end of its
      // own, and the answer belongs with the decision that created the question.
      if (loop) openMusicEnd();
    },
    onUnlockWhenDone: (on) => write("unlockWhenDone", on),
    onSetMusicEnd: () => openMusicEnd(),
  });
  /**
   * The library's settings: every track and the level it comes back at.
   *
   * Note(yoochan.kim): one dialog for the whole library rather than one per track. These
   * are read against each other — a level only means something next to the
   * others — and adding and removing tracks will land here too.
   */
  const openLibrarySettings = (): void => {
    const fields = new Map<string, HTMLInputElement>();
    // Note(yoochan.kim): a table with named columns, so a number says what it is and a
    // setting added later is one more column rather than a redrawing.
    const body = el("div", { class: "setlist" }, [
      el("div", { class: "setlist__r setlist__r--h" }, [
        el("span", {}),
        el("span", { textContent: "곡" }),
        el("span", { textContent: "길이" }),
        el("span", { textContent: "볼륨" }),
      ]),
    ]);

    let index = 0;
    const row = (track: Track): HTMLElement => {
      const input = el("input", {
        class: "editor__input",
        type: "number",
        value: String(trackLevels.get(track.id) ?? 50),
      }) as HTMLInputElement;
      input.min = "0";
      input.max = "100";
      fields.set(track.id, input);
      index += 1;
      return el("div", { class: "setlist__r" }, [
        el("span", { class: "setlist__i num", textContent: String(index) }),
        el("span", { class: "setlist__n", textContent: track.title }),
        el("span", { class: "setlist__d num", textContent: lengthOf(track.durationSec) }),
        input,
      ]);
    };

    // Note(yoochan.kim): the same two groups the list is drawn in. Eight flat rows say the
    // tracks are alike; two of them can be reached from the wall and six cannot.
    const panelSongs = libraryTracks.filter((track) => deckSongIds.has(track.id));
    const gated = libraryTracks.filter((track) => !deckSongIds.has(track.id));
    body.append(...panelSongs.map(row));
    if (gated.length > 0) {
      body.append(el("div", { class: "setlist__g" }, [
        el("span", { class: "icon" }, [icon("lock", 13)]),
        el("span", { textContent: "잠금 필요" }),
      ]));
      body.append(...gated.map(row));
    }

    const cancel = el("button", { class: "btn", type: "button", textContent: "취소" });
    cancel.addEventListener("click", () => confirm.close());
    const save = el("button", { class: "btn btn--go", type: "button", textContent: "저장" });
    save.addEventListener("click", () => {
      confirm.close();
      // Only what actually moved: an untouched track needs no write, and every
      // write is a broadcast to every screen.
      for (const [id, input] of fields) {
        const asked = Math.round(Number(input.value));
        if (!Number.isFinite(asked) || asked < 0 || asked > 100) continue;
        if (asked === (trackLevels.get(id) ?? 50)) continue;
        guard(deviceApi.invoke({ command: "setTrackVolume", args: { id, volume: asked } }));
      }
    });
    confirm.open("곡 설정", body, () => {}, [cancel, save]);
  };

  /**
   * When the music should stop.
   *
   * Note(yoochan.kim): offered as durations rather than a clock, because the question
   * being answered is "how much longer", and the person asking is standing at
   * the desk with the music already playing.
   */
  const openMusicEnd = (): void => {
    const body = el("div", { class: "whens" });
    for (const minutes of [10, 20, 30, 60]) {
      const key = el("button", { class: "btn", type: "button", textContent: `${minutes}분 뒤` });
      key.addEventListener("click", () => {
        confirm.close();
        write("musicEndsAt", { kind: "at", at: instantOf(new Date(church.now().getTime() + minutes * 60_000)) });
      });
      body.append(key);
    }
    // Note(yoochan.kim): saying "until the gate opens" is an answer, not a refusal to
    // answer — so it is a key here and it silences the warning, while closing
    // the dialog leaves the question open and the warning standing.
    const untilGate = el("button", { class: "btn btn--wide", type: "button", textContent: "관리자 잠금이 풀릴 때까지" });
    untilGate.addEventListener("click", () => {
      confirm.close();
      write("musicEndsAt", { kind: "withHold" });
    });
    body.append(untilGate);
    confirm.open("음악을 언제 멈출까요", body, () => {});
  };

  const systemPanel = new SystemPanel({
    onOpenFile: (title, body) => confirm.open(title, body, () => {}),
  });
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
  const deckSong = el("div", { class: "deck__song", textContent: BLANK });
  const meta = deckMeta();
  // Note(yoochan.kim): a placeholder until the first beat, never a time — the
  // browser's own clock is the one reading that must not appear here.
  const clockVal = el("div", { class: "clock__v", textContent: "--:--" });
  const clockDrift = el("div", { class: "clock__d" });

  // --- topbar ---
  const topDate = el("div", { class: "clock__date num" });
  // Note(yoochan.kim): The gate is toggled here and only here: press the chip, the server answers.
  const lockValue = el("span", { class: "gate__l" });
  const gate = el("button", { class: "gate", type: "button" }, [
    el("span", { class: "led led--off" }),
    lockValue,
  ]);
  let adminLocked = false;
  // Note(yoochan.kim): The gate only moves if you mean it: hold until the chip fills.
  holdToFire(gate, () => write("adminLock", !adminLocked));
  // Note(yoochan.kim): the gate lapses on its own within the hour, so what is left of it is
  // shown rather than left to be discovered when the panel comes back to life.
  const holdLeft = el("span", { class: "hold__l num" });
  const extend = el("button", { class: "btn btn--small", type: "button", textContent: "+30분" });
  extend.addEventListener("click", () => guard(deviceApi.invoke({ command: "extendAdminHold", args: {} })));
  const holdRow = el("div", { class: "hold is-hidden" }, [holdLeft, extend]);
  let holdEndsAt: Date | null = null;
  const renderHold = (): void => {
    holdRow.classList.toggle("is-hidden", holdEndsAt === null);
    if (!holdEndsAt) return;
    const left = Math.max(0, Math.round((holdEndsAt.getTime() - church.now().getTime()) / 1000));
    holdLeft.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} 뒤 해제`;
    holdRow.classList.toggle("is-soon", left <= 300);
  };
  const notice = el("span", { class: "notice" });
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
  // Note(yoochan.kim): shaped like a tab, because it stands in the same column as
  // them — an icon and a word on the same left margin as everything above.
  const logout = el("button", { class: "nav__tab", type: "button" }, [
    icon("logout", 15),
    el("span", { textContent: "로그아웃" }),
  ]);
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
        const on = input.state.kind === "read" && input.state.on;
        const button = unmuteButton(input, consoleReachable, (resend) => sendConsole(input.id, resend));

        return el("div", { class: `chrow${on ? " on" : ""}` }, [
          el("span", { class: "chrow__n", textContent: input.label }),
          meter(input),
          levelText(input),
          el("span", {}),
          button,
        ]);
      }),
    );
  };
  const x32Led = el("span", { class: "led led--go" });
  const x32Conn = el("span", { textContent: BLANK });
  const sysBars = el("div", {});
  const sysLog = el("div", { class: "log log--sum" });

  // --- views ---
  const songRadios = el("div", { class: "radios" });
  const renderSongRadios = (state: State): void => {
    const held = flowOwnsDeck(state.flow) || state.deck.source === "track";
    songRadios.replaceChildren(
      ...[...songTitles.entries()].map(([id, title]) => {
        const selected = !held && id === state.song;
        const row = el("button", { class: selected ? "on" : "", type: "button" }, [
          el("span", { class: "r" }),
          title,
        ]) as HTMLButtonElement;
        row.disabled = state.audioLock || flowOwnsDeck(state.flow);
        if (!selected) row.addEventListener("click", () => write("song", id));
        return row;
      }),
    );
  };

  const dashDeck = el("div", { class: "deck" }, [
    // Note(yoochan.kim): the chip is a line of its own, not stacked under the title inside
    // this row. Stacked, the block beside the play key was two lines tall and the
    // key centred on the pair, leaving the song title riding well above it.
    el("div", { class: "deck__top" }, [
      transport.el,
      deckSong,
    ]),
    meta.el,
    el("div", { class: "volrow" }, [
      // Note(yoochan.kim): a speaker rather than the word. The row already reads as
      // a level — a slider, a number, a mute key — so the label was only telling
      // the reader something the shape of the row had said already.
      el("span", { class: "volrow__l", title: "볼륨" }, [icon("volume", 22)]),
      fader.el,
      fader.valueEl,
      mute.el,
    ]),
    // Note(yoochan.kim): inside the card. Beside it, the rule floated on the page.
    el("div", { class: "deck__songs" }, [songRadios]),
  ]);

  /**
   * Where the deck sits on each page that shows it.
   *
   * Note(yoochan.kim): one deck, not two. Its transport, fader, mute and song list
   * are single controls wired to one stream of state — built twice they would be
   * two things to keep in step, and the moment they disagreed the panel would be
   * lying about what is playing. Only one view is ever on screen, so the deck is
   * moved into whichever that is.
   */
  const deckOnOverview = el("div", { class: "deck-slot" }, [dashDeck]);
  const deckOnPlayer = el("div", { class: "deck-slot deck-slot--wide" });

  const views: Record<ViewKey, HTMLElement> = {
    overview: el("section", { class: "view" }, [
      el("div", { class: "head" }, [
        deckOnOverview,
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
          el("b", { textContent: "X32 콘솔" }),
          el("span", { class: "x32__link" }, [x32Conn, x32Led]),
          goto("console", true),
        ]),
        consoleStrip,
      ]),
      el("div", { class: "sum" }, [
        el("div", {}, [
          el("div", { class: "sum__t" }, [el("span", { textContent: "시스템" }), goto("system")]),
          sysBars,
        ]),
        el("div", {}, [
          el("div", { class: "sum__t" }, [el("span", { textContent: "미디어 서버 로그" }), goto("logs")]),
          sysLog,
        ]),
      ]),
    ]),
    schedule: el("section", { class: "view" }, [schedulePanel.el, ...schedulePanel.below()]),
    console: el("section", { class: "view" }, [consolePanel.el]),
    clock: el("section", { class: "view" }, [clockPanel.el]),
    player: el("section", { class: "view" }, [
      el("div", { class: "player" }, [deckOnPlayer, libraryPanel.el]),
    ]),
    system: el("section", { class: "view" }, [systemPanel.el]),
    logs: el("section", { class: "view" }, [systemPanel.logEl]),
  };

  const navButtons = new Map<ViewKey, HTMLButtonElement>();
  // Note(yoochan.kim): no title bar — the sidebar already says which tab this is.
  const setView = (key: ViewKey): void => {
    navButtons.forEach((button, k) => button.classList.toggle("is-active", k === key));
    (Object.keys(views) as ViewKey[]).forEach((k) => views[k].classList.toggle("is-hidden", k !== key));
    // The one deck goes to the page being opened; see the note where the slots are made.
    (key === "player" ? deckOnPlayer : deckOnOverview).append(dashDeck);
    // A tab title takes a string and nothing else, so this one separator is a
    // character. A plain hyphen: no dashes anywhere a reader sees.
    document.title = `${NAV.find((entry) => entry.key === key)?.label ?? ""} - 미디어 관리자`;
    // Note(yoochan.kim): in the address, so a reload comes back to the tab it was on. A
    // dashboard is left open on the log or the desk for an hour at a time, and
    // refreshing to see something is not asking to be sent home.
    if (viewOf(location.hash) !== key) history.replaceState(null, "", `#${key}`);
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
      // Note(yoochan.kim): what belongs to the dashboard rather than to one tab. The
      // bar across the top had nothing left in it once these moved, so it is gone.
      el("aside", { class: "side" }, [gate, holdRow, nav, el("div", { class: "side__gap" }), theme, logout]),
      el("div", { class: "main" }, [
        // Note(yoochan.kim): every view, taken from the map rather than listed by
        // hand. Written out one by one, a new tab is a section that exists and is
        // never mounted — and the deck, moved into it, left the page altogether.
        el("main", { class: "page" }, Object.values(views)),
      ]),
      confirm.el,
    ]),
    // Note(yoochan.kim): last, and outside the shell. A dialog opens deeper in the
    // tree than this sat, and later siblings win however high a z-index the
    // earlier one is given — a refusal hidden behind the dialog that caused it
    // is a refusal nobody reads.
    notice,
  );

  setView(viewOf(location.hash) ?? "overview");
  // The address is the tab, so the browser's own back and forward move between them.
  window.addEventListener("hashchange", () => setView(viewOf(location.hash) ?? "overview"));

  church.start((now) => {
    topDate.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS[now.getDay()]})`;
    clockVal.replaceChildren(hhmmOf(now), el("s", { textContent: `:${ssOf(now)}` }));
    flowPanel.setNow(now);
    schedulePanel.setNow(now);
    renderHold();
  });

  /** Shows why something did nothing, rather than leaving it looking broken. */
  const showNotice = (text: string, done = false): void => {
    notice.textContent = text;
    notice.classList.toggle("is-ok", done);
    notice.classList.add("on");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.remove("on"), 4000);
  };

  const showRejection = (rejection: Rejection): void => {
    showNotice(REJECT_LABEL[rejection.reason] ?? `거부됐어요: ${rejection.reason}`);
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
    trackTitles = new Map(link.tracks.map((track) => [track.id, track.title]));
    libraryTracks = link.tracks;
    deckSongIds = new Set(link.songs.map((song) => song.id));
    libraryPanel.setTracks(link.tracks, link.songs.map((song) => song.id));
    schedulePanel.setTracks(link.tracks);
    flowPanel.setTracks(link.tracks);
  };

  let songTitles = new Map<string, string>();
  let trackTitles = new Map<string, string>();

  const renderDevice = (patch: StatePatch): void => {
    const device = deviceOf(patch);
    if (!device.known) return;
    const state = device.state;

    // Note(yoochan.kim): the deck names what is sounding, not what is selected. A flow's
    // track and an admin's both take the deck while `song` still points at the
    // panel's own, which is the one thing this must never show as playing.
    deckSong.textContent =
      state.flow.phase === "playing"
        ? state.flow.track.title
        : state.deck.source === "track"
          ? (trackTitles.get(state.deck.id) ?? state.deck.id)
          : (songTitles.get(state.song) ?? state.song);
    meta.set(state, songTitles);

    fader.setValue(state.volume);
    // Note(yoochan.kim): a silent deck reads red, the same as a muted console
    // input — one colour for one meaning, wherever sound is being held back.
    fader.setMuted(state.mute === MuteState.MUTED);
    const deckHeld = state.audioLock || flowOwnsDeck(state.flow);
    fader.setDisabled(deckHeld);
    transport.update(state);
    mute.set(state.mute === MuteState.MUTED, deckHeld);

    adminLocked = state.adminLock;
    // A state, not an instruction: this chip says what the gate is, and pressing
    // it changes that. "해제" alone reads as the button's own name.
    lockValue.textContent = state.adminLock ? "관리자 잠금 활성화됨" : "관리자 잠금 해제됨";
    gate.classList.toggle("on", state.adminLock);
    gate.querySelector(".led")!.className = `led led--${state.adminLock ? "bad" : "off"}`;
    // Note(yoochan.kim): A running flow owns the gate, so the chip goes quiet rather than
    // offering a toggle the server would refuse.
    gate.disabled = !state.isAdmin || state.flow.phase !== "idle";
    holdEndsAt = state.adminHold.kind === "at" ? new Date(state.adminHold.at) : null;
    renderHold();

    consoleState = state.console;
    renderConsoleRows();
    consolePanel.setState(state.console);

    schedulePanel.setStatus(state.flow);
    flowPanel.setStatus(state.flow);
    // Note(yoochan.kim): the clock is told before anything drawn against it, so a
    // correction shows at once rather than at the next heartbeat.
    church.setOffset(state.clockOffsetSec);
    // Note(yoochan.kim): "runnable today" is worked out against church time, not this
    // machine's — a laptop an hour out would grey out the evening's service.
    const flows = state.schedule.map((entry) => asScheduledFlow(entry, church.now()));
    schedulePanel.setFlows(flows);
    flowPanel.setFlows(flows);
    renderSongRadios(state);
    trackLevels = new Map(state.trackVolumes.map((each) => [each.id, each.volume]));
    schedulePanel.setLevels(trackLevels);
    libraryPanel.setState(state);
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
      // The machine's own words, matching the tab this summarises.
      ["Mem", stats.memPercent, `${Math.round(stats.memPercent)}%`],
      ["Disk", stats.diskPercent, `${Math.round(stats.diskPercent)}%`],
    ];
    if (stats.tempC !== null) rows.push(["Temp", Math.min(100, stats.tempC), `${Math.round(stats.tempC)}°C`]);
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
        el("span", { textContent: "Uptime" }),
        el("span", { class: "sum__plain", textContent: formatUptime(stats.uptimeSeconds) }),
        el("span", {}),
      ]),
    );
  };

  store.subscribe((dashboard: Dashboard) => {
    renderLink(dashboard.link);
    renderDevice(dashboard.device);
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
    onPing: (beat) => church.sync(beat.at, beat.offsetSec),
  });
  stopStream = () => {
    stopLog();
    stopEvents();
  };

}
