#!/usr/bin/env bash
# Re-fetches Noto Sans KR from Google and rewrites frontend/web/css/noto-sans-kr.css
# to point at the copies in frontend/web/fonts/noto-sans-kr/.
#
# The face is served from this repo rather than named in a font stack: a stack
# resolves to a different face on every machine, and the same screen then has a
# different shape on the Pi, on a phone, and in the headless browser these are
# checked in.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -s -H "User-Agent: $UA" \
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap" -o /tmp/noto.css
python3 - "$ROOT" <<'PY'
import re, sys, urllib.request, pathlib, concurrent.futures
root = pathlib.Path(sys.argv[1])
css = pathlib.Path('/tmp/noto.css').read_text(encoding='utf-8')
out = root / 'frontend/web/fonts/noto-sans-kr'
out.mkdir(parents=True, exist_ok=True)
def get(u):
    dest = out / u.rsplit('/', 1)[-1]
    if not dest.exists():
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
        dest.write_bytes(urllib.request.urlopen(req, timeout=30).read())
with concurrent.futures.ThreadPoolExecutor(12) as ex:
    list(ex.map(get, sorted(set(re.findall(r'https://[^)]*\.woff2', css)))))
local = re.sub(r'https://[^)]*/([^/)]+\.woff2)', r'../fonts/noto-sans-kr/\1', css)
(root / 'frontend/web/css/noto-sans-kr.css').write_text(
    "/* Noto Sans KR, served from here. Google's own subsets, so a browser fetches\n"
    "   only the ranges a page uses. Regenerate with scripts/fetch-font.sh. */\n" + local,
    encoding='utf-8')
print('font refreshed')
PY
