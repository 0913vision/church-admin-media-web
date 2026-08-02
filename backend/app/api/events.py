import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import get_bridge, get_broadcaster, get_monitor, require_session
from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.system.monitor import SystemMonitor

router = APIRouter(prefix="/api", tags=["events"])

_HEARTBEAT_SECONDS = 15


def _event(name: str, payload: object) -> str:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"


@router.get("/events", dependencies=[Depends(require_session)])
async def events(
    bridge: MediaBridge = Depends(get_bridge),
    broadcaster: Broadcaster = Depends(get_broadcaster),
    monitor: SystemMonitor = Depends(get_monitor),
) -> StreamingResponse:
    """The dashboard's one live channel. It carries the media server's own
    events through unchanged — link, state patches and refusals — plus host
    stats, which are this machine's business rather than the device's."""

    async def stream():
        queue = broadcaster.register()
        try:
            # Note(yoochan.kim): Current picture first, so a fresh subscriber renders at once and
            # then follows the same patches as everyone else.
            yield _event("link", bridge.link)
            yield _event("state", bridge.state)
            if monitor.last is not None:
                yield _event("system", monitor.last)
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
