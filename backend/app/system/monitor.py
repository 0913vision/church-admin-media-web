import asyncio
import time

import psutil

from app.bridge.broadcaster import Broadcaster

_SAMPLE_INTERVAL_SECONDS = 5.0


class SystemMonitor:
    """Samples host health (CPU / memory / disk / temperature / uptime) and
    publishes it on the dashboard SSE stream. Keeps the last sample so a new
    subscriber paints immediately instead of waiting a full interval."""

    def __init__(self, broadcaster: Broadcaster) -> None:
        self._broadcaster = broadcaster
        self._task: asyncio.Task | None = None
        self.last: dict | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass

    async def _run(self) -> None:
        while True:
            self.last = self._sample()
            self._broadcaster.publish("system", self.last)
            await asyncio.sleep(_SAMPLE_INTERVAL_SECONDS)

    def _sample(self) -> dict:
        disk = psutil.disk_usage("/")
        return {
            "cpuPercent": psutil.cpu_percent(interval=None),
            "memPercent": psutil.virtual_memory().percent,
            "diskPercent": disk.percent,
            "tempC": self._temperature(),
            "uptimeSeconds": int(time.time() - psutil.boot_time()),
        }

    @staticmethod
    def _temperature() -> float | None:
        # Note(yoochan.kim): available on the Raspberry Pi (Linux); macOS dev
        # machines expose no sensors, so the dashboard shows a placeholder.
        sensors = getattr(psutil, "sensors_temperatures", None)
        if sensors is None:
            return None
        try:
            for entries in (sensors() or {}).values():
                if entries:
                    return round(entries[0].current, 1)
        except Exception:  # noqa: BLE001 - sensor probing must never crash sampling
            return None
        return None
