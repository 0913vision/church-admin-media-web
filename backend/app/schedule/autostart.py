from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta

from app.bridge.media_client import MediaBridge
from app.schedule.models import ScheduledFlow

logger = logging.getLogger("autostart")

_TICK_SECONDS = 5
# Note(yoochan.kim): Only the moment itself is the runner's: past this, starting is a person's
# call, and the dashboard offers the start key for exactly that case.
_GRACE = timedelta(seconds=5)


class AutoStarter:
    """Starts flows marked autoStart when their window opens.

    It lives here rather than in the browser because a dashboard nobody has
    open is the normal case, and a service that runs itself has to run whether
    or not someone is watching. The media server still holds no calendar: this
    hands it one run, exactly as a person pressing start would.
    """

    def __init__(self, bridge: MediaBridge, flows: dict[str, ScheduledFlow]) -> None:
        self._bridge = bridge
        self._flows = flows
        self._task: asyncio.Task | None = None
        # Note(yoochan.kim): One occurrence each: (flow id, day) already started or skipped.
        self._done: set[tuple[str, date]] = set()

    def set_flows(self, flows: dict[str, ScheduledFlow]) -> None:
        self._flows = flows

    def skip(self, flow_id: str, day: date) -> None:
        """Passes over today's occurrence. Next week is unaffected."""
        self._done.add((flow_id, day))

    def is_skipped(self, flow_id: str, day: date) -> bool:
        return (flow_id, day) in self._done

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self._tick()
            except Exception:  # noqa: BLE001 - a bad tick must not end the loop
                logger.exception("autostart: tick failed")
            await asyncio.sleep(_TICK_SECONDS)

    async def _tick(self) -> None:
        from app.api.schedule import church_now

        if not self._bridge.link.get("connected"):
            return
        # Note(yoochan.kim): Only one flow runs at a time, and the server would refuse a second.
        flow_status = self._bridge.state.get("flow") or {}
        if flow_status.get("phase") not in (None, "idle"):
            return

        now = church_now(self._bridge)
        for flow in self._flows.values():
            if not flow.auto_start or not flow.runnable_on(now.date()):
                continue
            if self.is_skipped(flow.id, now.date()):
                continue
            opens_at = now.replace(
                hour=int(flow.lock["at"][:2]),
                minute=int(flow.lock["at"][3:]),
                second=0,
                microsecond=0,
            )
            if not opens_at <= now < opens_at + _GRACE:
                continue

            self._done.add((flow.id, now.date()))
            logger.info("autostart: starting %s (%s)", flow.name, flow.id)
            await self._bridge.invoke("startFlow", flow.to_start_args(now))
            return

    def prune(self, today: date) -> None:
        """Drops occurrences from other days so the set cannot grow forever."""
        self._done = {entry for entry in self._done if entry[1] >= today}
