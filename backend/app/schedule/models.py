from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

_WEEKDAY_KEYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
_CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# Note(yoochan.kim): Field names each kind of flow part carries. Kept in step with the media
# server's protocol, but checked here so a typo in the schedules file fails at
# boot rather than at 19:30 on a Wednesday.
#
# The admin lock is not among them: every flow holds it, so it is a field of
# the flow rather than a part that could be left out.
_PART_FIELDS: dict[str, tuple[str, ...]] = {"music": ("tracks", "endsAt")}


@dataclass(frozen=True)
class ScheduledFlow:
    """A flow the operator can start, authored here rather than on the media
    server. This side owns the calendar — which flows exist and when they may
    be run — and the parts pass through to the server untouched, because how a
    run is carried out is the server's business."""

    id: str
    name: str
    weekdays: frozenset[int]
    lock: dict
    parts: tuple[dict, ...]
    # Note(yoochan.kim): Whether this flow starts without anyone approving it. Dangerous on
    # purpose: an unattended service still needs its music.
    auto_start: bool

    def runnable_on(self, day: date) -> bool:
        return day.weekday() in self.weekdays

    @property
    def music(self) -> dict | None:
        """The music part, if this flow has one."""
        return next((part for part in self.parts if part["kind"] == "music"), None)

    def to_start_args(self, now: datetime) -> dict:
        """The flow as startFlow wants it: absolute instants in church time.

        The media server takes instants only — it will not decide which day a
        bare "19:30" belongs to. That decision belongs here, where the weekly
        calendar is, and it is made against the day the operator pressed start.
        `now` must already be church time; every instant on the wire is.
        """
        opens_at = _on_day(now, self.lock["at"])

        parts = []
        music_ends_at: datetime | None = None
        for part in self.parts:
            ends_at = _on_day(now, part["endsAt"])
            if ends_at < opens_at:
                ends_at += timedelta(days=1)
            music_ends_at = ends_at
            parts.append({**part, "endsAt": _wire(ends_at)})

        until = self.lock["until"]
        if until["kind"] == "music":
            # Note(yoochan.kim): The usual case: the gate opens for the music and closes with it.
            # Written as an intent rather than a copied time, so changing when
            # the music ends moves the gate with it.
            closes_at = music_ends_at
        else:
            closes_at = _on_day(now, until["at"])
            if closes_at <= opens_at:
                closes_at += timedelta(days=1)

        return {
            "name": self.name,
            "lock": {"at": _wire(opens_at), "until": _wire(closes_at)},
            "parts": parts,
        }

    def to_entry(self) -> dict:
        """The flow as it is written in schedules.json."""
        keys = [key for key, day in _WEEKDAY_KEYS.items()]
        return {
            "id": self.id,
            "name": self.name,
            "weekdays": [key for key in keys if _WEEKDAY_KEYS[key] in self.weekdays],
            "autoStart": self.auto_start,
            "lock": dict(self.lock),
            "parts": [dict(part) for part in self.parts],
        }

    def to_payload(self, today: date) -> dict:
        ordered = sorted(self.weekdays)
        return {
            "id": self.id,
            "name": self.name,
            "weekdays": ordered,
            "weekdayLabels": [WEEKDAY_LABELS[day] for day in ordered],
            "autoStart": self.auto_start,
            "lock": dict(self.lock),
            "parts": [dict(part) for part in self.parts],
            "runnableToday": self.runnable_on(today),
        }


def _wire(at: datetime) -> str:
    """An instant in the one shape the media server accepts: 2026-08-05T19:30:00.000.

    Wall-clock digits with no zone — every machine here stands on the same
    clock, and the media server refuses any other spelling rather than guessing.
    """
    return at.replace(tzinfo=None).isoformat(timespec="milliseconds")


def _on_day(now: datetime, clock: str) -> datetime:
    """Today's occurrence of an HH:MM, keeping the caller's timezone."""
    hours, minutes = (int(part) for part in clock.split(":"))
    return now.replace(hour=hours, minute=minutes, second=0, microsecond=0)


def load_flows(path: str) -> dict[str, ScheduledFlow]:
    """Loads flow definitions, failing fast on any invalid entry (matching the
    media server's no-defaults policy)."""
    entries = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"Schedules file must be a JSON array: {path}")

    flows: dict[str, ScheduledFlow] = {}
    for entry in entries:
        flow = _parse_flow(entry)
        if flow.id in flows:
            raise ValueError(f"Duplicate flow id: {flow.id}")
        flows[flow.id] = flow
    return flows


def parse_flow(entry: object) -> ScheduledFlow:
    """Validates one flow the way the loader does, for edits arriving over HTTP.

    Same rules as the file, so a schedule saved from the dashboard cannot be
    something the loader would refuse on the next boot.
    """
    return _parse_flow(entry)


def save_flows(path: str, flows: dict[str, ScheduledFlow]) -> None:
    """Writes the schedule back, replacing the file in one step.

    Through a temporary file in the same directory: a half-written schedules
    file is one the backend refuses to boot with, and that is not a state to
    leave a church media server in.
    """
    entries = [flow.to_entry() for flow in flows.values()]
    target = Path(path)
    handle, temp = tempfile.mkstemp(dir=str(target.parent), suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(entries, out, ensure_ascii=False, indent=2)
            out.write("\n")
        os.replace(temp, target)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def _parse_flow(entry: object) -> ScheduledFlow:
    if not isinstance(entry, dict):
        raise ValueError(f"Invalid flow entry: {entry!r}")

    flow_id = entry.get("id")
    name = entry.get("name")
    weekday_keys = entry.get("weekdays")
    lock = entry.get("lock")
    parts = entry.get("parts", [])
    auto_start = entry.get("autoStart", False)

    if not isinstance(flow_id, str) or not flow_id:
        raise ValueError(f"Flow id must be a non-empty string: {entry!r}")
    if not isinstance(name, str) or not name:
        raise ValueError(f"Flow {flow_id}: name must be a non-empty string")
    if not isinstance(weekday_keys, list) or not weekday_keys:
        raise ValueError(f"Flow {flow_id}: weekdays must be a non-empty list")
    # Note(yoochan.kim): Every flow holds the gate; music on an open panel could be taken over
    # from the tablet mid-run, so a flow without a lock is not a flow.
    if not isinstance(lock, dict):
        raise ValueError(f"Flow {flow_id}: lock is required")
    _check_clock(flow_id, "lock.at", lock.get("at"))
    _check_until(flow_id, lock.get("until"), parts)
    if not isinstance(parts, list):
        raise ValueError(f"Flow {flow_id}: parts must be a list")
    if not isinstance(auto_start, bool):
        raise ValueError(f"Flow {flow_id}: autoStart must be true or false")

    try:
        weekdays = frozenset(_WEEKDAY_KEYS[key] for key in weekday_keys)
    except KeyError as exc:
        raise ValueError(f"Flow {flow_id}: unknown weekday {exc} (use mon..sun)") from exc

    seen: set[str] = set()
    for part in parts:
        kind = _check_part(flow_id, part)
        if kind in seen:
            raise ValueError(f"Flow {flow_id}: {kind} appears more than once")
        seen.add(kind)

    return ScheduledFlow(
        id=flow_id,
        name=name,
        weekdays=weekdays,
        lock=dict(lock),
        parts=tuple(parts),
        auto_start=auto_start,
    )


def _check_until(flow_id: str, until: object, parts: object) -> None:
    """When the gate closes: with the music, or at a time of its own.

    Spelled out as a tagged value rather than a magic string, so a schedule
    says which of the two it means instead of leaving it to be inferred.
    """
    if not isinstance(until, dict):
        raise ValueError(f"Flow {flow_id}: lock.until must be an object")

    kind = until.get("kind")
    if kind == "music":
        has_music = isinstance(parts, list) and any(
            isinstance(part, dict) and part.get("kind") == "music" for part in parts
        )
        if not has_music:
            raise ValueError(f"Flow {flow_id}: lock.until follows the music, but there is none")
        return
    if kind == "clock":
        _check_clock(flow_id, "lock.until.at", until.get("at"))
        return
    raise ValueError(f"Flow {flow_id}: unknown lock.until kind {kind!r} (use music or clock)")


def _check_part(flow_id: str, part: object) -> str:
    if not isinstance(part, dict):
        raise ValueError(f"Flow {flow_id}: each part must be an object")

    kind = part.get("kind")
    if kind not in _PART_FIELDS:
        raise ValueError(f"Flow {flow_id}: unknown part kind {kind!r} (only music today)")

    missing = [field for field in _PART_FIELDS[kind] if field not in part]
    if missing:
        raise ValueError(f"Flow {flow_id}: {kind} part is missing {', '.join(missing)}")

    # Note(yoochan.kim): every track carries the level it plays at. The editor
    # fills it in from the track's own volume when a song is added, so a flow
    # never reaches the media server with the level left open.
    tracks = part["tracks"]
    if not isinstance(tracks, list) or not tracks:
        raise ValueError(f"Flow {flow_id}: music needs at least one track")
    for track in tracks:
        if not isinstance(track, dict) or not isinstance(track.get("id"), str) or not track["id"]:
            raise ValueError(f"Flow {flow_id}: each music track needs an id")
        volume = track.get("volume")
        if not isinstance(volume, int) or isinstance(volume, bool) or not 0 <= volume <= 100:
            raise ValueError(f"Flow {flow_id}: track {track['id']} needs a volume between 0 and 100")
    _check_clock(flow_id, "endsAt", part["endsAt"])

    return kind


def _check_clock(flow_id: str, field: str, value: object) -> None:
    if not isinstance(value, str) or not _CLOCK.match(value):
        raise ValueError(f"Flow {flow_id}: {field} must be an HH:MM time, got {value!r}")
