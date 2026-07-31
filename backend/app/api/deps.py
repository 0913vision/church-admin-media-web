from fastapi import Request, HTTPException, status

from app.bridge.broadcaster import Broadcaster
from app.bridge.media_client import MediaBridge
from app.schedule.models import ScheduledFlow
from app.security.session import verify_session, COOKIE_NAME
from app.system.monitor import SystemMonitor


def get_bridge(request: Request) -> MediaBridge:
    return request.app.state.bridge


def get_broadcaster(request: Request) -> Broadcaster:
    return request.app.state.broadcaster


def get_monitor(request: Request) -> SystemMonitor:
    return request.app.state.monitor


def get_flows(request: Request) -> dict[str, ScheduledFlow]:
    return request.app.state.flows


def require_session(request: Request) -> None:
    if not verify_session(request.cookies.get(COOKIE_NAME)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
