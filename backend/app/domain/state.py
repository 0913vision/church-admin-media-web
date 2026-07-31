from dataclasses import dataclass

from app.domain.protocol import PlayerState, MuteState, SongType


@dataclass
class MediaState:
    """Mirror of the media server's live state, plus the bridge's own
    connection / admin status. Serialized to the dashboard over SSE."""

    state: int = int(PlayerState.PAUSED)
    volume: float = 50.0
    mute: int = int(MuteState.UNMUTED)
    current_song: str = SongType.SLOW.value
    audio_lock: bool = False
    admin_lock: bool = False
    connected: bool = False
    admin_authed: bool = False

    def to_payload(self) -> dict:
        return {
            "state": self.state,
            "volume": self.volume,
            "mute": self.mute,
            "currentSong": self.current_song,
            "audioLock": self.audio_lock,
            "adminLock": self.admin_lock,
            "connected": self.connected,
            "adminAuthed": self.admin_authed,
        }
