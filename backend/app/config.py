from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Required configuration, loaded from the environment / .env (fail-fast:
    a missing value raises at startup, matching the media server's policy)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    host: str
    port: int
    media_server_url: str
    admin_password_hash: str
    session_secret: str
    session_max_age: int
    cookie_secure: bool
    schedules_file_path: str


settings = Settings()
