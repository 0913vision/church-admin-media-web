from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.api.deps import get_bridge
from app.bridge.media_client import MediaBridge
from app.config import settings
from app.security.password import verify_password
from app.security.session import COOKIE_NAME, issue_session, verify_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, bridge: MediaBridge = Depends(get_bridge)) -> dict:
    if not verify_password(body.password, settings.admin_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    # The verified plaintext is the media-server admin password too; hand it to
    # the bridge so the console acts as admin. It lives only in process memory.
    await bridge.ensure_admin(body.password)

    response.set_cookie(
        COOKIE_NAME,
        issue_session(),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_max_age,
    )
    return {"authenticated": True}


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME)
    return {"authenticated": False}


@router.get("/session")
async def session(request: Request) -> dict:
    return {"authenticated": verify_session(request.cookies.get(COOKIE_NAME))}
