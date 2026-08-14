from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Required configuration, loaded from the environment / .env (fail-fast:
    a missing value raises at startup, matching the media server's policy)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    host: str
    port: int
    media_server_url: str
    admin_password_hash: str
    # Note(yoochan.kim): the same password in the clear — the media server verifies a
    # password, not a hash, and the bridge claims admin without waiting for a login.
    admin_password: str
    session_secret: str
    session_max_age: int
    cookie_secure: bool
    schedules_file_path: str
    # Note(yoochan.kim): Where the media server writes its log. Shown in the system tab so the
    # answer to "what happened at 19:30" is on screen, not behind SSH.
    media_log_path: str


settings = Settings()
