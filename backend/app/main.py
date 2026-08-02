import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


class FreshStaticFiles(StaticFiles):
    """Static files that a browser must revalidate.

    The booth browser stays open for weeks; without this it keeps yesterday's
    UI after a deploy and nobody notices until something misbehaves.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response

from app.api import auth, device, events, schedule, system
from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.config import settings
from app.schedule.autostart import AutoStarter
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
    # Note(yoochan.kim): Flow definitions are this side's, and are read once at boot so a bad
    # schedules file fails here rather than when someone presses start.
    app.state.flows = load_flows(settings.schedules_file_path)
    # Note(yoochan.kim): Flows marked autoStart run whether or not a dashboard is open, so the
    # runner lives on this machine rather than in a browser.
    autostarter = AutoStarter(bridge, app.state.flows)
    app.state.autostarter = autostarter

    connect_task = asyncio.create_task(bridge.start())
    monitor.start()
    autostarter.start()
    try:
        yield
    finally:
        connect_task.cancel()
        await autostarter.stop()
        await monitor.stop()
        await bridge.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Church Admin Media Web", lifespan=lifespan)
    app.include_router(auth.router)
    app.include_router(device.router)
    app.include_router(events.router)
    app.include_router(schedule.router)
    app.include_router(system.router)
    # Note(yoochan.kim): Static frontend last so the API routes above take precedence.
    app.mount("/", FreshStaticFiles(directory=WEB_ROOT, html=True), name="static")
    return app


app = create_app()
