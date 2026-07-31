from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_bridge, get_flows, require_session
from app.bridge.media_client import MediaBridge
from app.schedule.models import ScheduledFlow

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(require_session)])


@router.get("")
async def list_flows(flows: dict[str, ScheduledFlow] = Depends(get_flows)) -> dict:
    """The flows this dashboard offers. What is *running* is not here: that is
    the media server's flow attribute, and it arrives on the event stream."""
    today = date.today()
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
    if not flow.runnable_on(date.today()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="오늘은 실행할 수 없는 순서입니다.")

    await bridge.invoke("startFlow", {"name": flow.name, "parts": [dict(part) for part in flow.parts]})
    return {"ok": True}


@router.post("/stop")
async def stop(bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.invoke("stopFlow", {})
    return {"ok": True}
