from enum import IntEnum, Enum


class PlayerState(IntEnum):
    PAUSED = 0
    PLAYING = 1


class MuteState(IntEnum):
    UNMUTED = 0
    MUTED = 1


class SongType(str, Enum):
    SLOW = "slow"
    FAST = "fast"


class C2S:
    """Client-to-server event names (mirror server/constants/socketConfig.ts)."""

    GET_VOLUME = "getVolume"
    GET_STATE = "getState"
    GET_MUTE = "getMute"
    GET_CURRENT_SONG = "getCurrentSong"
    GET_LOCK = "getLock"
    CHANGE_SONG = "changeSong"
    CHANGE_VOLUME = "changeVolume"
    CHANGE_STATE = "changeState"
    CHANGE_MUTE = "changeMute"
    MIC_ON = "micOn"
    AUX_ON = "auxOn"
    GET_TRACKS = "getTracks"
    PLAY_TRACK_AT = "playTrackAt"
    RESTORE_SONG = "restoreSong"
    AUTHENTICATE_ADMIN = "authenticateAdmin"
    SET_ADMIN_LOCK = "setAdminLock"


class S2C:
    """Server-to-client event names."""

    STATE_CHANGED = "stateChanged"
    VOLUME_CHANGED = "volumeChanged"
    MUTE_CHANGED = "muteChanged"
    SONG_CHANGED = "songChanged"
    LOCK_CHANGED = "lockChanged"
    ADMIN_LOCK_CHANGED = "adminLockChanged"
    TRACKS_CHANGED = "tracksChanged"
    TRACK_CHANGED = "trackChanged"
    ADMIN_AUTHENTICATED = "adminAuthenticated"
    PING = "ping"
