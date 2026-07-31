import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_bridge, get_broadcaster, get_monitor, get_runner, require_session
from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.schedule.runner import ScheduleRunner
from app.system.monitor import SystemMonitor

router = APIRouter(prefix="/api", tags=["events"])

_HEARTBEAT_SECONDS = 15


@router.get("/events", dependencies=[Depends(require_session)])
async def events(
    bridge: MediaBridge = Depends(get_bridge),
    broadcaster: Broadcaster = Depends(get_broadcaster),
    monitor: SystemMonitor = Depends(get_monitor),
    runner: ScheduleRunner = Depends(get_runner),
) -> StreamingResponse:
    async def stream():
        queue = broadcaster.register()
        try:
            # Send the current snapshots first so a fresh subscriber renders at once.
            yield f"event: state\ndata: {json.dumps(bridge.state.to_payload())}\n\n"
            if monitor.last is not None:
                yield f"event: system\ndata: {json.dumps(monitor.last)}\n\n"
            yield f"event: schedule\ndata: {json.dumps(runner.snapshot())}\n\n"
            while True:
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            broadcaster.unregister(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
