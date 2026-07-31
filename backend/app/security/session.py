from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from app.config import settings

COOKIE_NAME = "admin_session"
_SESSION_SALT = "admin-session"

_serializer = URLSafeTimedSerializer(settings.session_secret, salt=_SESSION_SALT)


def issue_session() -> str:
    return _serializer.dumps({"role": "admin"})


def verify_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        _serializer.loads(token, max_age=settings.session_max_age)
        return True
    except (BadSignature, SignatureExpired):
        return False
