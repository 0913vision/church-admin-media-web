# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An admin dashboard for `church-media-server`, reached from outside the church
network. A FastAPI backend bridges the browser to the media server over
Socket.IO; the frontend is plain html/css/ts served as static files.

Both machines sit on the same Pi, but users and admins connect from outside, so
the admin password is shared with the media server rather than kept separate:
one scrypt hash covers both, and the browser never sees the media server.

## Development Commands

- **Backend**: `cd backend && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Frontend**: `cd frontend && npm run build` (tsc only, no bundler) or `npm run watch`
- **Protocol**: `./scripts/sync-protocol.sh [path-to-media-server]` copies the generated bindings in. See below
- **Environment**: `backend/.env`, all values required (fail-fast): `HOST`, `PORT`, `MEDIA_SERVER_URL`, `ADMIN_PASSWORD_HASH` (the **same** scrypt hash as the media server), `SESSION_SECRET`, `SESSION_MAX_AGE`, `COOKIE_SECURE`, `SCHEDULES_FILE_PATH`

## The protocol is not ours

`backend/app/protocol.py` and `frontend/src/protocol.ts` are **generated** by
the media server and copied here by `scripts/sync-protocol.sh`. Never edit them,
and never write a second definition of an event or enum in this repo — the
hand-written mirrors that used to live in `domain/` were deleted precisely
because they drifted.

To change the protocol: edit `protocol/protocol.json` in `church-media-server`,
run `npm run gen-protocol` there, then `./scripts/sync-protocol.sh` here.

`docs/PROTOCOL.md` (generated) and `docs/MIGRATION.md` are the reference.

## Architecture

The media server is modelled as a device with attributes and commands, and this
repo speaks that model end to end rather than translating it.

- **`bridge/media_client.py`** — the only Socket.IO connection, and the only
  layer that knows a wire protocol exists. Says `hello`, relays `write` and
  `invoke`, and forwards `ready` / `state` / `rejected` onto the SSE stream
  unchanged. Attribute values are merged from patches, not rebuilt
- **`bridge/broadcaster.py`** — SSE fan-out, event-name agnostic
- **`api/device.py`** — `POST /api/device/write` and `/invoke`. Deliberately a
  relay: what counts as a valid value is the media server's call, and a refusal
  arrives on the event stream as `rejected`. No second copy of the rules here
- **`api/schedule.py`** — the flows this dashboard offers. **The calendar is
  ours; the run is the server's.** Which flows exist and which day each may run
  is decided here; `startFlow` hands the plan over and the server owns it from
  there, which is what stops a lock outliving this process
- **`schedule/models.py`** — loads `schedules.json` at boot, failing fast, so a
  typo surfaces then rather than at 19:30 on a Wednesday. A flow's `parts` are
  in the protocol's own shape and pass through untouched
- **`system/monitor.py`** — psutil host stats, this machine's business rather
  than the device's
- **`security/`** — Node-compatible scrypt verification and signed session cookies

### Frontend

- `state/store.ts` holds `{ link, device }`. `device` is a **patch merge**, and
  the dashboard only renders once every attribute has arrived — filling gaps
  with defaults would show values the device never reported
- `api/device.ts` writes attributes and invokes commands, mirroring the wire
- Components take the protocol's `State`; catalogues (songs, tracks) come from
  `ready`, so **no display name for a song is written in this repo**

## Conventions

- Clean code: minimal comments, in English, `Note(yoochan.kim): ...` when needed
- PEP8 with a 120-column limit; no function-level imports
- **No `null`.** The protocol has none, and neither should code here: use a
  tagged result (`{ ok: true, ... } | { ok: false, reason }`) rather than
  returning nothing for "fine" or "no"
- **An unknown tag is a fault, not a case.** Where a phase or kind is not
  recognised, say so and point at updating — never render it blank, because
  blank reads as "nothing is happening", which may be false

## Not in the repo

`backend/.env` and `backend/schedules.json` are site-specific and gitignored.
A fresh clone needs both before the backend will start.
