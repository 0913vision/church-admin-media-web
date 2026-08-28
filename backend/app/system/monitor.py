import asyncio
import time

import psutil

from app.bridge.broadcaster import Broadcaster

_SAMPLE_INTERVAL_SECONDS = 2.0


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
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        return {
            "cpuPercent": psutil.cpu_percent(interval=None),
            "memPercent": memory.percent,
            "diskPercent": disk.percent,
            "tempC": self._temperature(),
            "uptimeSeconds": int(time.time() - psutil.boot_time()),
            # Note(yoochan.kim): The htop half of the system tab. Everything below is what makes
            # SSH-ing into the Pi unnecessary rather than merely inconvenient.
            "host": self._hostname(),
            "cores": psutil.cpu_percent(interval=None, percpu=True),
            "memUsedBytes": memory.used,
            "memTotalBytes": memory.total,
            "swapUsedBytes": swap.used,
            "swapTotalBytes": swap.total,
            "load": list(self._load()),
            "processes": self._processes(),
        }

    @staticmethod
    def _hostname() -> str:
        import socket

        try:
            return socket.gethostname()
        except Exception:  # noqa: BLE001
            return "—"

    @staticmethod
    def _load() -> tuple[float, float, float]:
        try:
            return psutil.getloadavg()
        except Exception:  # noqa: BLE001 - not every platform has it
            return (0.0, 0.0, 0.0)

    @staticmethod
    def _processes() -> list[dict]:
        """The few biggest, the way top shows them."""
        rows: list[dict] = []
        try:
            for proc in psutil.process_iter(["pid", "name", "cmdline", "cpu_percent", "memory_percent"]):
                info = proc.info
                command = " ".join(info.get("cmdline") or []) or (info.get("name") or "")
                rows.append(
                    {
                        "pid": info.get("pid", 0),
                        "command": command[:60],
                        "cpuPercent": round(info.get("cpu_percent") or 0.0, 1),
                        "memPercent": round(info.get("memory_percent") or 0.0, 1),
                    }
                )
        except Exception:  # noqa: BLE001 - process listing must never crash sampling
            return []
        rows.sort(key=lambda row: (row["cpuPercent"], row["memPercent"]), reverse=True)
        return rows[:6]

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
