from fastapi import Request, HTTPException, status

from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.schedule.runner import ScheduleRunner
from app.security.session import verify_session, COOKIE_NAME
from app.system.monitor import SystemMonitor


def get_bridge(request: Request) -> MediaBridge:
    return request.app.state.bridge


def get_broadcaster(request: Request) -> Broadcaster:
    return request.app.state.broadcaster


def get_monitor(request: Request) -> SystemMonitor:
    return request.app.state.monitor


def get_runner(request: Request) -> ScheduleRunner:
    return request.app.state.runner


def require_session(request: Request) -> None:
    if not verify_session(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
