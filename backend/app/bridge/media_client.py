import asyncio
import logging
from datetime import datetime, timedelta
from time import monotonic

import socketio

from app.bridge.broadcaster import Broadcaster
from app.config import settings
from app.protocol import PROTOCOL_VERSION, C2S, S2C

logger = logging.getLogger("bridge")

_RECONNECT_DELAY_SECONDS = 3
_CLIENT_NAME = "관리자 웹"


class MediaBridge:
    """The single Socket.IO client to the media server, and the only layer that
    knows the wire protocol exists. It mirrors the device's attributes, holds
    the authenticated admin identity, and relays writes and commands."""

    def __init__(self, broadcaster: Broadcaster) -> None:
        self._sio = socketio.AsyncClient(reconnection=True, logger=False, engineio_logger=False)
        self._broadcaster = broadcaster
        # Note(yoochan.kim): Attribute values as last reported. Patches merge into this, so a
        # dashboard joining late gets the same picture as one already open.
        self._state: dict = {}
        # Note(yoochan.kim): What the far end is: either not there, or there and describing itself.
        # Tagged on `connected` rather than left half-filled, matching the
        # protocol's own rule about absence.
        self._link: dict = {"connected": False}
        self._last_ping: dict | None = None
        self._last_ping_at = 0.0
        # Note(yoochan.kim): configured, not borrowed from whoever logs in first, so
        # admin standing survives a restart of this process.
        self._admin_secret = settings.admin_password
        self._register_handlers()

    @property
    def state(self) -> dict:
        return self._state

    @property
    def link(self) -> dict:
        return self._link

    @property
    def last_ping(self) -> dict | None:
        """Church time now, for a subscriber that has just arrived.

        Carried forward by however long ago the beat landed. A heartbeat says
        what the time was when it was sent, and replaying a 20-second-old one
        verbatim would set a clock 20 seconds slow — worse than the browser's own,
        because it looks authoritative.
        """
        if self._last_ping is None:
            return None
        at = self._last_ping.get("at")
        if not isinstance(at, str):
            return self._last_ping
        try:
            sent = datetime.fromisoformat(at)
        except ValueError:
            return self._last_ping
        aged = sent + timedelta(seconds=monotonic() - self._last_ping_at)
        return {**self._last_ping, "at": aged.isoformat(timespec="milliseconds")}

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
        """Remember the admin secret and (re)claim admin rights on the live
        connection. Admin standing belongs to a connection, so it has to be
        reclaimed after every reconnect."""
        self._admin_secret = secret
        await self.invoke("authenticate", {"password": secret})

    async def write(self, field: str, value) -> None:
        """Sets one attribute. Refusals come back asynchronously as a rejected
        event, which is forwarded to the dashboard like any other."""
        await self._emit(C2S.WRITE, {"field": field, "value": value})

    async def invoke(self, command: str, args: dict) -> None:
        await self._emit(C2S.INVOKE, {"command": command, "args": args})

    async def _emit(self, event: str, payload: dict) -> None:
        # Note(yoochan.kim): Commands are dropped, not queued, while the media server is
        # unreachable — the dashboard already shows the link as down.
        if not self._sio.connected:
            logger.warning("media bridge: dropping %s while disconnected", event)
            return
        await self._sio.emit(event, payload)

    # --- internal wiring ---
    def _register_handlers(self) -> None:
        sio = self._sio

        @sio.event
        async def connect() -> None:
            await sio.emit(C2S.HELLO, {"client": _CLIENT_NAME, "protocolVersion": PROTOCOL_VERSION})

        @sio.event
        async def disconnect() -> None:
            self._link = {"connected": False}
            self._publish_link()

        @sio.on(S2C.READY)
        async def on_ready(payload) -> None:
            self._link = {"connected": True, **payload}
            if not payload.get("accepted"):
                logger.error(
                    "media bridge: protocol mismatch — server speaks v%s, this build speaks v%s",
                    payload.get("protocolVersion"),
                    PROTOCOL_VERSION,
                )
            self._publish_link()
            # Note(yoochan.kim): A reconnect drops admin standing, so claim it again straight away.
            if self._admin_secret:
                await self.invoke("authenticate", {"password": self._admin_secret})

        @sio.on(S2C.STATE)
        async def on_state(patch) -> None:
            self._state.update(patch)
            # Note(yoochan.kim): Forwarded as a patch, so the dashboard merges exactly what the
            # device reported rather than a re-derived snapshot.
            self._broadcaster.publish("state", patch)

        @sio.on(S2C.PING)
        async def on_ping(payload) -> None:
            # Note(yoochan.kim): Church time, straight through. The dashboard draws its clock from
            # this rather than from the browser's, which is the whole point. The
            # last beat is kept so a page that has just opened has an answer
            # before the next one — a beat is 30s away, and a clock with nothing
            # to go on falls back to the browser's, which is what it must not do.
            self._last_ping = payload
            self._last_ping_at = monotonic()
            self._broadcaster.publish("ping", payload)

        @sio.on(S2C.REJECTED)
        async def on_rejected(payload) -> None:
            logger.info("media bridge: %s refused (%s)", payload.get("target"), payload.get("reason"))
            self._broadcaster.publish("rejected", payload)

    def _publish_link(self) -> None:
        self._broadcaster.publish("link", self._link)
