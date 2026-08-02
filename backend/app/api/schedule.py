from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_bridge, get_flows, require_session
from app.bridge.media_client import MediaBridge
from app.config import settings
from app.schedule.models import ScheduledFlow, parse_flow, save_flows

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(require_session)])


def church_now(bridge: MediaBridge) -> datetime:
    """Now, on the clock this building runs on.

    Every instant on the wire is church time, so a schedule turns into instants
    against that clock and not against this machine's.
    """
    offset = bridge.state.get("clockOffsetSec", 0)
    return datetime.now().astimezone() + timedelta(seconds=offset if isinstance(offset, (int, float)) else 0)


@router.get("")
async def list_flows(
    flows: dict[str, ScheduledFlow] = Depends(get_flows),
    bridge: MediaBridge = Depends(get_bridge),
) -> dict:
    """The flows this dashboard offers. What is *running* is not here: that is
    the media server's flow attribute, and it arrives on the event stream."""
    today = church_now(bridge).date()
    return {"flows": [flow.to_payload(today) for flow in flows.values()]}


@router.post("/{flow_id}/start")
async def start(
    flow_id: str,
    flows: dict[str, ScheduledFlow] = Depends(get_flows),
    bridge: MediaBridge = Depends(get_bridge),
) -> dict:
    """Hands a flow to the media server to run. The calendar is checked here,
    because it is this side's; everything after that is the server's."""
    flow = flows.get(flow_id)
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="등록되지 않은 순서입니다.")
    now = church_now(bridge)
    if not flow.runnable_on(now.date()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="오늘은 실행할 수 없는 순서입니다.")

    await bridge.invoke("startFlow", flow.to_start_args(now))
    return {"ok": True}


@router.post("/{flow_id}/skip")
async def skip(
    flow_id: str,
    request: Request,
    flows: dict[str, ScheduledFlow] = Depends(get_flows),
    bridge: MediaBridge = Depends(get_bridge),
) -> dict:
    """Passes over today's occurrence of an auto-start flow. Next week stands."""
    if flow_id not in flows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="등록되지 않은 순서입니다.")
    request.app.state.autostarter.skip(flow_id, church_now(bridge).date())
    return {"ok": True}


@router.post("/stop")
async def stop(bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.invoke("stopFlow", {})
    return {"ok": True}


def _check_covered(flow: ScheduledFlow) -> None:
    """Refuses a schedule the media server could never run.

    The server checks this too, but only when start is pressed — which is
    during a service. The same rule applied here catches it while someone is
    still editing. Only the finish is bound to the lock window: music timed to
    begin earlier is fine, the front is cut and the sound starts with the lock.
    """
    music = flow.music
    if music is None:
        return

    ends_at = _minutes(music["endsAt"])
    opens_at = _minutes(flow.lock["at"])
    closes_at = ends_at if flow.lock["until"]["kind"] == "music" else _minutes(flow.lock["until"]["at"])

    if ends_at <= opens_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="음악이 잠금 시작 전에 끝나요.",
        )
    if ends_at > closes_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="음악이 잠금 해제보다 늦게 끝나요.",
        )


def _minutes(clock: str) -> int:
    hours, mins = (int(part) for part in clock.split(":"))
    return hours * 60 + mins


@router.put("/{flow_id}")
async def save(
    flow_id: str,
    entry: dict,
    request: Request,
    flows: dict[str, ScheduledFlow] = Depends(get_flows),
) -> dict:
    """Creates or replaces one flow, and writes the schedule back to disk.

    Editing a definition never touches a run already in flight: the media
    server was handed a copy when it was started and owns it from there.
    """
    try:
        parsed = parse_flow({**entry, "id": flow_id})
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Pure schedule arithmetic — no track library needed, so it also guards
    # edits made while the media server is unreachable.
    _check_covered(parsed)

    updated = dict(flows)
    updated[flow_id] = parsed
    save_flows(settings.schedules_file_path, updated)
    request.app.state.flows = updated
    request.app.state.autostarter.set_flows(updated)
    return {"ok": True}


@router.delete("/{flow_id}")
async def remove(
    flow_id: str,
    request: Request,
    flows: dict[str, ScheduledFlow] = Depends(get_flows),
) -> dict:
    if flow_id not in flows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="등록되지 않은 순서입니다.")

    updated = {key: flow for key, flow in flows.items() if key != flow_id}
    save_flows(settings.schedules_file_path, updated)
    request.app.state.flows = updated
    request.app.state.autostarter.set_flows(updated)
    return {"ok": True}
