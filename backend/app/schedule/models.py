from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import time
from pathlib import Path

_WEEKDAY_KEYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]


@dataclass(frozen=True)
class Flow:
    """A scheduled flow: admin-lock engage/release at fixed clock times,
    optionally around a wall-clock-anchored track sequence. The song sequence
    ending does NOT release the lock — unlock_at is its own scheduled step.
    A flow with no tracks simply holds the lock between lock_at and unlock_at."""

    id: str
    name: str
    weekdays: frozenset[int]
    lock_at: time
    play_at: time | None
    unlock_at: time
    track_ids: tuple[str, ...]

    def to_payload(self) -> dict:
        ordered = sorted(self.weekdays)
        return {
            "id": self.id,
            "name": self.name,
            "weekdays": ordered,
            "weekdayLabels": [WEEKDAY_LABELS[day] for day in ordered],
            "lockAt": self.lock_at.isoformat(timespec="minutes"),
            "playAt": self.play_at.isoformat(timespec="minutes") if self.play_at is not None else None,
            "unlockAt": self.unlock_at.isoformat(timespec="minutes"),
            "trackIds": list(self.track_ids),
        }


def load_flows(path: str) -> dict[str, Flow]:
    """Loads flow definitions from a JSON file, failing fast on any invalid
    entry (matching the media server's no-defaults policy)."""
    entries = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"Schedules file must be a JSON array: {path}")

    flows: dict[str, Flow] = {}
    for entry in entries:
        flow = _parse_flow(entry)
        if flow.id in flows:
            raise ValueError(f"Duplicate flow id: {flow.id}")
        flows[flow.id] = flow
    return flows


def _parse_flow(entry: object) -> Flow:
    if not isinstance(entry, dict):
        raise ValueError(f"Invalid flow entry: {entry!r}")

    flow_id = entry.get("id")
    name = entry.get("name")
    weekday_keys = entry.get("weekdays")
    track_ids = entry.get("tracks")
    if not isinstance(flow_id, str) or not flow_id:
        raise ValueError(f"Flow id must be a non-empty string: {entry!r}")
    if not isinstance(name, str) or not name:
        raise ValueError(f"Flow {flow_id}: name must be a non-empty string")
    if not isinstance(weekday_keys, list) or not weekday_keys:
        raise ValueError(f"Flow {flow_id}: weekdays must be a non-empty list")
    if not isinstance(track_ids, list) or not all(isinstance(t, str) and t for t in track_ids):
        raise ValueError(f"Flow {flow_id}: tracks must be a list of track ids (may be empty)")

    try:
        weekdays = frozenset(_WEEKDAY_KEYS[key] for key in weekday_keys)
    except KeyError as exc:
        raise ValueError(f"Flow {flow_id}: unknown weekday {exc} (use mon..sun)") from exc

    lock_at = _parse_time(flow_id, "lockAt", entry.get("lockAt"))
    unlock_at = _parse_time(flow_id, "unlockAt", entry.get("unlockAt"))
    if lock_at >= unlock_at:
        raise ValueError(f"Flow {flow_id}: lockAt must be before unlockAt")

    raw_play_at = entry.get("playAt")
    if track_ids and raw_play_at is None:
        raise ValueError(f"Flow {flow_id}: playAt is required when tracks are set")
    play_at = _parse_time(flow_id, "playAt", raw_play_at) if raw_play_at is not None else None
    if play_at is not None and not (lock_at <= play_at < unlock_at):
        raise ValueError(f"Flow {flow_id}: times must satisfy lockAt <= playAt < unlockAt")

    return Flow(
        id=flow_id,
        name=name,
        weekdays=weekdays,
        lock_at=lock_at,
        play_at=play_at,
        unlock_at=unlock_at,
        track_ids=tuple(track_ids),
    )


def _parse_time(flow_id: str, field: str, value: object) -> time:
    if not isinstance(value, str):
        raise ValueError(f"Flow {flow_id}: {field} must be an HH:MM string")
    try:
        return time.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Flow {flow_id}: invalid {field} time {value!r}") from exc
