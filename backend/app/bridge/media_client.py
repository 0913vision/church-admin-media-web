import asyncio
import logging

import socketio

from app.bridge.broadcaster import Broadcaster
from app.config import settings
from app.domain.protocol import C2S, S2C
from app.domain.state import MediaState

logger = logging.getLogger("bridge")

_RECONNECT_DELAY_SECONDS = 3
_SNAPSHOT_EVENTS = (C2S.GET_STATE, C2S.GET_VOLUME, C2S.GET_MUTE, C2S.GET_CURRENT_SONG, C2S.GET_LOCK)


class MediaBridge:
    """The single Socket.IO client to the media server. It mirrors live state,
    holds the authenticated admin identity, and relays admin commands. This is
    the only layer that knows the wire protocol exists."""

    def __init__(self, broadcaster: Broadcaster) -> None:
        self._sio = socketio.AsyncClient(reconnection=True, logger=False, engineio_logger=False)
        self._broadcaster = broadcaster
        self._state = MediaState()
        self._admin_secret: str | None = None
        self._tracks: dict[str, dict] = {}
        self._register_handlers()

    @property
    def state(self) -> MediaState:
        return self._state

    @property
    def tracks(self) -> dict[str, dict]:
        """Track library as reported by the media server, keyed by id."""
        return self._tracks

    async def start(self) -> None:
        """Connect, retrying until the media server is reachable. Once connected,
        the client's own reconnection logic handles any later drops."""
        while True:
            try:
                await self._sio.connect(settings.media_server_url, transports=["websocket", "polling"])
                return
            except Exception as exc:  # noqa: BLE001 - log and keep retrying
                logger.warning("media bridge: initial connect failed (%s); retrying", exc)
                await asyncio.sleep(_RECONNECT_DELAY_SECONDS)

    async def stop(self) -> None:
        if self._sio.connected:
            await self._sio.disconnect()

    async def ensure_admin(self, secret: str) -> None:
        """Remember the admin secret and (re)authenticate the live connection."""
        self._admin_secret = secret
        await self._emit(C2S.AUTHENTICATE_ADMIN, secret)

    # --- relayed commands ---
    async def change_volume(self, volume: float) -> None:
        await self._emit(C2S.CHANGE_VOLUME, volume)

    async def change_state(self, state: int) -> None:
        await self._emit(C2S.CHANGE_STATE, state)

    async def change_song(self, song: str) -> None:
        await self._emit(C2S.CHANGE_SONG, self._state.current_song, song)

    async def change_mute(self, mute: int) -> None:
        await self._emit(C2S.CHANGE_MUTE, mute)

    async def enable_mic(self) -> None:
        await self._emit(C2S.MIC_ON)

    async def enable_aux(self) -> None:
        await self._emit(C2S.AUX_ON)

    async def set_admin_lock(self, locked: bool) -> None:
        await self._emit(C2S.SET_ADMIN_LOCK, locked)

    async def play_track_at(self, track_id: str, offset_sec: float) -> None:
        await self._emit(C2S.PLAY_TRACK_AT, track_id, offset_sec)

    async def restore_song(self) -> None:
        await self._emit(C2S.RESTORE_SONG)

    async def _emit(self, event: str, *args) -> None:
        # Commands are dropped (not queued) while the media server is unreachable;
        # the dashboard already reflects the disconnected state.
        if not self._sio.connected:
            logger.warning("media bridge: dropping %s while disconnected", event)
            return
        # Note(yoochan.kim): python-socketio sends multiple positional payload
        # arguments only when data is a tuple — emit(event, a, b) would put b
        # into the namespace parameter.
        data = args[0] if len(args) == 1 else tuple(args) if args else None
        await self._sio.emit(event, data)

    # --- internal wiring ---
    def _register_handlers(self) -> None:
        sio = self._sio

        @sio.event
        async def connect() -> None:
            self._state.connected = True
            await self._request_snapshot()
            await sio.emit(C2S.GET_TRACKS)
            if self._admin_secret is not None:
                await sio.emit(C2S.AUTHENTICATE_ADMIN, self._admin_secret)
            self._publish()

        @sio.event
        async def disconnect() -> None:
            self._state.connected = False
            self._state.admin_authed = False
            self._publish()

        @sio.on(S2C.STATE_CHANGED)
        async def on_state(value) -> None:
            self._state.state = value
            self._publish()

        @sio.on(S2C.VOLUME_CHANGED)
        async def on_volume(value) -> None:
            self._state.volume = value
            self._publish()

        @sio.on(S2C.MUTE_CHANGED)
        async def on_mute(value) -> None:
            self._state.mute = value
            self._publish()

        @sio.on(S2C.SONG_CHANGED)
        async def on_song(value) -> None:
            self._state.current_song = value
            self._publish()

        @sio.on(S2C.LOCK_CHANGED)
        async def on_audio_lock(value) -> None:
            self._state.audio_lock = value
            self._publish()

        @sio.on(S2C.ADMIN_LOCK_CHANGED)
        async def on_admin_lock(value) -> None:
            self._state.admin_lock = value
            self._publish()

        @sio.on(S2C.TRACKS_CHANGED)
        async def on_tracks(tracks) -> None:
            self._tracks = {track["id"]: track for track in tracks}

        @sio.on(S2C.ADMIN_AUTHENTICATED)
        async def on_admin_authed(result) -> None:
            self._state.admin_authed = bool(result.get("success"))
            self._publish()

    async def _request_snapshot(self) -> None:
        for event in _SNAPSHOT_EVENTS:
            await self._sio.emit(event)

    def _publish(self) -> None:
        self._broadcaster.publish("state", self._state.to_payload())
