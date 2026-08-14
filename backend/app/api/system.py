from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import require_session
from app.config import settings

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_session)])

_LINES = 200


@router.get("/log")
async def log() -> dict:
    """The tail of the media server's own log, in standard time.

    Not church time: a log records when something actually happened, and a
    corrected clock would make it disagree with every other machine.
    """
    path = Path(settings.media_log_path)
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            lines = list(deque(handle, maxlen=_LINES))
    except OSError as error:
        # Note(yoochan.kim): the path goes back with the failure. This panel exists so
        # that reading the log needs no SSH, and "cannot read it" without saying which
        # file sends you to SSH anyway — which is how a wrong path went unnoticed.
        return {"available": False, "lines": [], "path": str(path), "reason": error.strerror or "읽을 수 없어요"}
    return {"available": True, "lines": [line.rstrip("\n") for line in lines]}
