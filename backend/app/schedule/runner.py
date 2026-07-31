from __future__ import annotations

import asyncio
import datetime as dt
import logging

from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.schedule.models import Flow

logger = logging.getLogger("schedule")


class ScheduleRunner:
    """Executes one flow at a time as an asyncio task.

    A flow's steps are anchored to wall-clock times: engage the admin lock at
    lock_at, play the track sequence anchored at play_at (joining mid-track
    when started late), and release the lock at unlock_at — which PREEMPTS the
    sequence if it is still sounding. Ending or force-stopping always restores
    the two-song deck and releases the lock.
    """

    def __init__(self, bridge: MediaBridge, broadcaster: Broadcaster, flows: dict[str, Flow]) -> None:
        self._bridge = bridge
        self._broadcaster = broadcaster
        self._flows = flows
        self._task: asyncio.Task | None = None
        self._active: dict | None = None

    # --- queries ---
    def snapshot(self) -> dict:
        return {"flows": [self._flow_payload(flow) for flow in self._flows.values()], "active": self._active}

    def _flow_payload(self, flow: Flow) -> dict:
        payload = flow.to_payload()
        payload["tracks"] = [
            self._bridge.tracks.get(track_id, {"id": track_id, "title": track_id, "durationSec": None})
            for track_id in flow.track_ids
        ]
        return payload

    # --- commands ---
    async def start(self, flow_id: str) -> tuple[bool, str]:
        if self._task is not None and not self._task.done():
            return False, "이미 실행 중인 스케줄이 있습니다."
        flow = self._flows.get(flow_id)
        if flow is None:
            return False, "알 수 없는 스케줄입니다."
        if not self._bridge.state.connected:
            return False, "미디어 서버에 연결되어 있지 않습니다."

        now = dt.datetime.now()
        if now.weekday() not in flow.weekdays:
            return False, "오늘은 실행할 수 없는 스케줄입니다."
        if now >= dt.datetime.combine(now.date(), flow.unlock_at):
            return False, "이미 종료 시각이 지났습니다."

        missing = [track_id for track_id in flow.track_ids if track_id not in self._bridge.tracks]
        if missing:
            return False, f"미디어 서버에 없는 곡이 있습니다: {', '.join(missing)}"

        self._task = asyncio.create_task(self._run(flow))
        return True, ""

    async def stop(self) -> bool:
        if self._task is None or self._task.done():
            return False
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        return True

    # --- execution ---
    async def _run(self, flow: Flow) -> None:
        today = dt.date.today()
        lock_dt = dt.datetime.combine(today, flow.lock_at)
        play_dt = dt.datetime.combine(today, flow.play_at) if flow.play_at is not None else None
        unlock_dt = dt.datetime.combine(today, flow.unlock_at)

        try:
            self._set_active(flow, "waiting_lock", None, play_dt, unlock_dt)
            await self._sleep_until(lock_dt)

            await self._bridge.set_admin_lock(True)

            sequence_finished = True
            if flow.track_ids and play_dt is not None:
                self._set_active(flow, "waiting_play", None, play_dt, unlock_dt)
                sequence_finished = False
                timeout = (unlock_dt - dt.datetime.now()).total_seconds()
                try:
                    await asyncio.wait_for(self._play_sequence(flow, play_dt, unlock_dt), timeout=max(timeout, 0))
                    sequence_finished = True
                except asyncio.TimeoutError:
                    logger.info("schedule %s: unlock time preempted the sequence", flow.id)
                await self._bridge.restore_song()

            if sequence_finished:
                self._set_active(flow, "waiting_unlock", None, play_dt, unlock_dt)
                await self._sleep_until(unlock_dt)

            await self._bridge.set_admin_lock(False)
            logger.info("schedule %s: completed", flow.id)
        except asyncio.CancelledError:
            # Force stop: restore the deck and release the lock immediately.
            logger.info("schedule %s: force-stopped", flow.id)
            await self._bridge.restore_song()
            await self._bridge.set_admin_lock(False)
        except Exception:
            # Never leave the system locked because a step failed mid-flow.
            logger.exception("schedule %s: failed — restoring and unlocking", flow.id)
            await self._bridge.restore_song()
            await self._bridge.set_admin_lock(False)
        finally:
            self._active = None
            self._publish()

    async def _play_sequence(self, flow: Flow, play_dt: dt.datetime, unlock_dt: dt.datetime) -> None:
        await self._sleep_until(play_dt)

        tracks = [self._bridge.tracks[track_id] for track_id in flow.track_ids]
        elapsed = max((dt.datetime.now() - play_dt).total_seconds(), 0.0)

        # Late start: back-calculate where the timeline would be had it
        # started exactly at play_at, and join mid-track from there.
        position = 0.0
        for index, track in enumerate(tracks):
            duration = float(track["durationSec"])
            if elapsed < position + duration:
                offset = max(elapsed - position, 0.0)
                await self._play_from(flow, tracks, index, offset, play_dt, unlock_dt)
                return
            position += duration
        # The whole sequence is already in the past — nothing to play.

    async def _play_from(
        self,
        flow: Flow,
        tracks: list[dict],
        start_index: int,
        start_offset: float,
        play_dt: dt.datetime,
        unlock_dt: dt.datetime,
    ) -> None:
        for index in range(start_index, len(tracks)):
            track = tracks[index]
            offset = start_offset if index == start_index else 0.0
            duration = float(track["durationSec"])

            await self._bridge.play_track_at(track["id"], offset)
            self._set_active(flow, "playing", {"title": track["title"], "index": index + 1, "total": len(tracks)},
                             play_dt, unlock_dt)
            await asyncio.sleep(max(duration - offset, 0.0))

    # --- helpers ---
    async def _sleep_until(self, target: dt.datetime) -> None:
        delay = (target - dt.datetime.now()).total_seconds()
        if delay > 0:
            await asyncio.sleep(delay)

    def _set_active(self, flow: Flow, phase: str, track: dict | None,
                    play_dt: dt.datetime | None, unlock_dt: dt.datetime) -> None:
        self._active = {
            "flowId": flow.id,
            "name": flow.name,
            "phase": phase,
            "track": track,
            "playAt": play_dt.isoformat(timespec="seconds") if play_dt is not None else None,
            "unlockAt": unlock_dt.isoformat(timespec="seconds"),
        }
        self._publish()

    def _publish(self) -> None:
        self._broadcaster.publish("schedule", self.snapshot())
