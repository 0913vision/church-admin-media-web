from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import get_bridge, require_session
from app.bridge.media_client import MediaBridge

router = APIRouter(prefix="/api/device", tags=["device"], dependencies=[Depends(require_session)])

# Note(yoochan.kim): Admin standing belongs to the bridge, not to a browser: it is claimed once
# with a secret the dashboard never sees, so the dashboard may not claim it.
_BRIDGE_ONLY_COMMANDS = frozenset({"authenticate"})


class WriteRequest(BaseModel):
    field: str
    value: object


class InvokeRequest(BaseModel):
    command: str
    args: dict = {}


@router.post("/write")
async def write(body: WriteRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    """Relays one attribute write. What counts as a valid value is the media
    server's to decide, and a refusal arrives on the event stream as rejected —
    so this stays a relay rather than a second, drifting copy of the rules."""
    await bridge.write(body.field, body.value)
    return {"ok": True}


@router.post("/invoke")
async def invoke(body: InvokeRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    if body.command in _BRIDGE_ONLY_COMMANDS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="이 명령은 브리지만 사용할 수 있습니다.")
    await bridge.invoke(body.command, body.args)
    return {"ok": True}
