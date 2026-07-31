from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

_WEEKDAY_KEYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
_CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# Field names each kind of flow part carries. Kept in step with the media
# server's protocol, but checked here so a typo in the schedules file fails at
# boot rather than at 19:30 on a Wednesday.
_PART_FIELDS: dict[str, tuple[str, ...]] = {"lock": ("at", "until"), "music": ("tracks", "endsAt")}


@dataclass(frozen=True)
class ScheduledFlow:
    """A flow the operator can start, authored here rather than on the media
    server. This side owns the calendar — which flows exist and when they may
    be run — and the parts pass through to the server untouched, because how a
    run is carried out is the server's business."""

    id: str
    name: str
    weekdays: frozenset[int]
    parts: tuple[dict, ...]

    def runnable_on(self, day: date) -> bool:
        return day.weekday() in self.weekdays

    def to_payload(self, today: date) -> dict:
        ordered = sorted(self.weekdays)
        return {
            "id": self.id,
            "name": self.name,
            "weekdays": ordered,
            "weekdayLabels": [WEEKDAY_LABELS[day] for day in ordered],
            "parts": [dict(part) for part in self.parts],
            "runnableToday": self.runnable_on(today),
        }


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


def _parse_flow(entry: object) -> ScheduledFlow:
    if not isinstance(entry, dict):
        raise ValueError(f"Invalid flow entry: {entry!r}")

    flow_id = entry.get("id")
    name = entry.get("name")
    weekday_keys = entry.get("weekdays")
    parts = entry.get("parts")

    if not isinstance(flow_id, str) or not flow_id:
        raise ValueError(f"Flow id must be a non-empty string: {entry!r}")
    if not isinstance(name, str) or not name:
        raise ValueError(f"Flow {flow_id}: name must be a non-empty string")
    if not isinstance(weekday_keys, list) or not weekday_keys:
        raise ValueError(f"Flow {flow_id}: weekdays must be a non-empty list")
    if not isinstance(parts, list) or not parts:
        raise ValueError(f"Flow {flow_id}: parts must be a non-empty list")

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

    return ScheduledFlow(id=flow_id, name=name, weekdays=weekdays, parts=tuple(parts))


def _check_part(flow_id: str, part: object) -> str:
    if not isinstance(part, dict):
        raise ValueError(f"Flow {flow_id}: each part must be an object")

    kind = part.get("kind")
    if kind not in _PART_FIELDS:
        raise ValueError(f"Flow {flow_id}: unknown part kind {kind!r} (use lock or music)")

    missing = [field for field in _PART_FIELDS[kind] if field not in part]
    if missing:
        raise ValueError(f"Flow {flow_id}: {kind} part is missing {', '.join(missing)}")

    if kind == "lock":
        _check_clock(flow_id, "at", part["at"])
        _check_clock(flow_id, "until", part["until"])
    else:
        tracks = part["tracks"]
        if not isinstance(tracks, list) or not tracks or not all(isinstance(t, str) and t for t in tracks):
            raise ValueError(f"Flow {flow_id}: music tracks must be a non-empty list of track ids")
        _check_clock(flow_id, "endsAt", part["endsAt"])

    return kind


def _check_clock(flow_id: str, field: str, value: object) -> None:
    if not isinstance(value, str) or not _CLOCK.match(value):
        raise ValueError(f"Flow {flow_id}: {field} must be an HH:MM time, got {value!r}")
