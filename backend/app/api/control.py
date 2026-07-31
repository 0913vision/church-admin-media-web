from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_bridge, require_session
from app.bridge.media_client import MediaBridge
from app.domain.protocol import MuteState, PlayerState, SongType

router = APIRouter(prefix="/api/control", tags=["control"], dependencies=[Depends(require_session)])


class VolumeRequest(BaseModel):
    volume: float = Field(ge=0, le=100)


class StateRequest(BaseModel):
    state: int


class SongRequest(BaseModel):
    song: str


class MuteRequest(BaseModel):
    mute: int


class AdminLockRequest(BaseModel):
    locked: bool


@router.post("/volume")
async def set_volume(body: VolumeRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.change_volume(body.volume)
    return {"ok": True}


@router.post("/state")
async def set_state(body: StateRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    if body.state not in (PlayerState.PAUSED, PlayerState.PLAYING):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid state")
    await bridge.change_state(body.state)
    return {"ok": True}


@router.post("/song")
async def set_song(body: SongRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    if body.song not in (SongType.SLOW.value, SongType.FAST.value):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid song")
    await bridge.change_song(body.song)
    return {"ok": True}


@router.post("/mute")
async def set_mute(body: MuteRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    if body.mute not in (MuteState.UNMUTED, MuteState.MUTED):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid mute")
    await bridge.change_mute(body.mute)
    return {"ok": True}


@router.post("/mic")
async def enable_mic(bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.enable_mic()
    return {"ok": True}


@router.post("/aux")
async def enable_aux(bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.enable_aux()
    return {"ok": True}


@router.post("/admin-lock")
async def set_admin_lock(body: AdminLockRequest, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    await bridge.set_admin_lock(body.locked)
    return {"ok": True}
