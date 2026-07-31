from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_runner, require_session
from app.schedule.runner import ScheduleRunner

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(require_session)])


@router.get("")
async def snapshot(runner: ScheduleRunner = Depends(get_runner)) -> dict:
    return runner.snapshot()


@router.post("/{flow_id}/start")
async def start(flow_id: str, runner: ScheduleRunner = Depends(get_runner)) -> dict:
    ok, message = await runner.start(flow_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return {"ok": True}


@router.post("/stop")
async def stop(runner: ScheduleRunner = Depends(get_runner)) -> dict:
    stopped = await runner.stop()
    return {"ok": stopped}
