import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import auth, device, events, schedule
from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.config import settings
from app.schedule.models import load_flows
from app.system.monitor import SystemMonitor

logging.basicConfig(level=logging.INFO)

WEB_ROOT = Path(__file__).resolve().parents[2] / "frontend" / "web"


@asynccontextmanager
async def lifespan(app: FastAPI):
    broadcaster = Broadcaster()
    bridge = MediaBridge(broadcaster)
    monitor = SystemMonitor(broadcaster)
    app.state.broadcaster = broadcaster
    app.state.bridge = bridge
    app.state.monitor = monitor
    # Flow definitions are this side's, and are read once at boot so a bad
    # schedules file fails here rather than when someone presses start.
    app.state.flows = load_flows(settings.schedules_file_path)

    connect_task = asyncio.create_task(bridge.start())
    monitor.start()
    try:
        yield
    finally:
        connect_task.cancel()
        await monitor.stop()
        await bridge.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Church Admin Media Web", lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(device.router)
    app.include_router(events.router)
    app.include_router(schedule.router)
    # Static frontend last so the API routes above take precedence.
    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="static")
    return app


app = create_app()
