#!/usr/bin/env bash
# Copies the generated protocol bindings in from the media server, which owns
# them. Nothing here is edited by hand: change protocol/protocol.json in
# church-media-server, run `npm run gen-protocol` there, then run this.
#
# Usage: scripts/sync-protocol.sh [path-to-media-server]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${1:-$ROOT/../church-media-server}"
SOURCE="$SERVER/protocol/generated"

if [[ ! -d "$SOURCE" ]]; then
  echo "protocol: $SOURCE not found — pass the media server path as an argument" >&2
  exit 1
fi

install -d "$ROOT/docs"
cp "$SOURCE/protocol.py" "$ROOT/backend/app/protocol.py"
cp "$SOURCE/protocol.ts" "$ROOT/frontend/src/protocol.ts"
cp "$SOURCE/PROTOCOL.md" "$ROOT/docs/PROTOCOL.md"

echo "protocol: synced from $SOURCE"
