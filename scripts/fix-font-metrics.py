"""Centres Noto Sans KR's line box on its Hangul ink, in every subset file.

Google's files give the line box 1160 above the baseline and 288 below, while
Hangul is drawn from about -87 to +835 and digits from -14 to +732: the ink's
middle sits 61 units under the box's, so anything centred by its box shows its
words a pixel or two low. Chrome rounds each edge of the box to a whole pixel,
so the edges are chosen together with the stylesheet's sizes (11, 13.5, 15.5,
16.5, 25, 36, 44, 70): at each of them 1075 and 352 give a line box an even
number of pixels tall, so it centres on a whole pixel, and put its middle
within 0.35px of the ink. That holds for Chrome on Windows and Mac; Linux and
Android round a descent down differently and can sit up to a pixel off.
All three places a browser may read the box from (hhea for Apple, typo and win
for Windows) say the same thing, so every browser lays the text out alike.

Run by scripts/fetch-font.sh. Needs fontTools and brotli:
  uv venv scripts/.venv && uv pip install --python scripts/.venv/bin/python fonttools brotli
"""
import pathlib
import sys

from fontTools.ttLib import TTFont

ASCENT = 1075
DESCENT = 352
USE_TYPO_METRICS = 1 << 7

fonts = pathlib.Path(sys.argv[1]) / 'frontend/web/fonts/noto-sans-kr'
changed = 0
for path in sorted(fonts.glob('*.woff2')):
    font = TTFont(path)
    hhea, os2 = font['hhea'], font['OS/2']
    wanted = (ASCENT, -DESCENT, 0, ASCENT, -DESCENT, 0, ASCENT, DESCENT)
    if (hhea.ascent, hhea.descent, hhea.lineGap, os2.sTypoAscender, os2.sTypoDescender,
            os2.sTypoLineGap, os2.usWinAscent, os2.usWinDescent) == wanted and os2.fsSelection & USE_TYPO_METRICS:
        continue
    hhea.ascent, hhea.descent, hhea.lineGap = ASCENT, -DESCENT, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ASCENT, -DESCENT, 0
    os2.usWinAscent, os2.usWinDescent = ASCENT, DESCENT
    os2.fsSelection |= USE_TYPO_METRICS
    font.save(path)
    changed += 1
print(f'font metrics: {changed} file(s) centred')
