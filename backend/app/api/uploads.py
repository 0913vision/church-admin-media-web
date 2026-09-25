import logging

import aiohttp
from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import require_session
from app.config import settings

router = APIRouter(prefix="/api/uploads", tags=["uploads"], dependencies=[Depends(require_session)])

logger = logging.getLogger("uploads")


@router.post("")
async def upload(request: Request) -> Response:
    """Relays an mp3 to the media server's upload door as it arrives, unread.

    Bytes only: the file becomes a track when the dashboard invokes addTrack with
    the id answered here, through the same relay as every other command. What
    counts as an acceptable file is the media server's call, so its answer is
    passed straight back.
    """
    headers = {"x-admin-password": settings.admin_password}
    length = request.headers.get("content-length")
    if length is not None:
        headers["content-length"] = length

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{settings.media_server_url}/uploads", data=request.stream(), headers=headers
            ) as upstream:
                body = await upstream.read()
                # Note(yoochan.kim): a 401 from the media server means this backend holds the
                # wrong password. Passed on as it is, the dashboard would read it as its
                # own session ending and log out.
                if upstream.status == status.HTTP_401_UNAUTHORIZED:
                    logger.error("uploads: the media server refused the configured admin password")
                    return Response(status_code=status.HTTP_502_BAD_GATEWAY)
                return Response(
                    content=body,
                    status_code=upstream.status,
                    media_type=upstream.headers.get("content-type"),
                )
    except aiohttp.ClientError as exc:
        logger.warning("uploads: media server unreachable (%s)", exc)
        return Response(status_code=status.HTTP_502_BAD_GATEWAY)
