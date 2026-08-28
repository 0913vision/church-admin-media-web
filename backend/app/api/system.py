import asyncio
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import require_session
from app.config import settings

router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_session)])

_LINES = 200
_RUN_TIMEOUT = 5.0


async def _run(*command: str) -> tuple[bool, list[str], str]:
    """Runs a fixed read-only command and returns its lines.

    Note(yoochan.kim): the words are literals in this file and never come from a
    request, and the shell is not involved — this reads the machine, and the only
    way it could ever write to it is if somebody passed input in here.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        out, _ = await asyncio.wait_for(process.communicate(), timeout=_RUN_TIMEOUT)
    except (OSError, asyncio.TimeoutError) as error:
        return False, [], str(error) or "실행할 수 없어요"
    if process.returncode != 0:
        # The exit code, not the machine's own words: stderr is thrown away here so
        # that nothing this process is told ever reaches a browser.
        return False, [], f"이 기계에서 {command[0]}을(를) 쓸 수 없어요 (코드 {process.returncode})"
    text = out.decode("utf-8", errors="replace")
    return True, [line for line in text.splitlines() if line.strip()], ""


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


@router.get("/kernel")
async def kernel() -> dict:
    """The kernel's own tail.

    Note(yoochan.kim): this is where a Pi says the things nothing else reports — an SD
    card going read-only, USB audio dropping off, the board browning out. None of
    that reaches the media server's log, so a panel that only shows that log is
    quiet in exactly the failures worth catching early.
    """
    ok, lines, reason = await _run("journalctl", "-k", "--no-pager", "-n", str(_LINES))
    return {"available": ok, "lines": lines, "reason": reason}


def _script_of(command: str) -> str:
    """The file a job runs, if it names one. Arguments and shell words are not it."""
    for token in command.split():
        if token.startswith("/"):
            return token
    return ""


@router.get("/cron/file")
async def cron_file(path: str) -> dict:
    """The contents of a script one of root's jobs runs.

    Note(yoochan.kim): the path is checked against the crontab rather than sanitised.
    A request can only name a file this machine has already decided to run, so
    there is no path to traverse to — an allow-list the machine writes itself.
    """
    ok, lines, reason = await _run("sudo", "-n", "crontab", "-l")
    if not ok:
        return {"available": False, "lines": [], "path": path, "reason": reason}
    allowed = {
        _script_of(line.split(None, 5)[5])
        for line in lines
        if not line.lstrip().startswith("#") and len(line.split(None, 5)) >= 6
    }
    if path not in allowed or not path:
        return {"available": False, "lines": [], "path": path, "reason": "cron이 실행하는 파일이 아니에요"}
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        return {"available": False, "lines": [], "path": path, "reason": error.strerror or "읽을 수 없어요"}
    return {"available": True, "lines": text.splitlines(), "path": path, "reason": ""}


@router.get("/cron")
async def cron() -> dict:
    """Root's scheduled jobs, as the machine has them.

    Read-only and root's own, because that is where this building's jobs live —
    the checks that run before a service belong to no login.
    """
    ok, lines, reason = await _run("sudo", "-n", "crontab", "-l")
    if not ok:
        return {"available": False, "jobs": [], "reason": reason}
    jobs = []
    for line in lines:
        if line.lstrip().startswith("#"):
            continue
        # A crontab line is five time fields and then the command; a trailing
        # "# ..." is the author's own note about it, so it is kept as one.
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        command, _, note = parts[5].partition("#")
        jobs.append({"when": " ".join(parts[:5]), "command": command.strip(), "note": note.strip()})
    return {"available": True, "jobs": jobs, "reason": ""}
