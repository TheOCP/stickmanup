"""Draws the StickManUp launcher icon and writes it as Android vector drawables (adaptive icon background,
foreground and monochrome layers) plus an SVG preview: a stickman from the game leaping onto a glowing
platform at night, with the storm tower, lightning and the cord behind it.
Run: python3 dev/icon/make_icon.py"""
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INK, TEAL, HEAD, WHITE, GOLD = '#FF0A0F1C', '#FF3FF0D0', '#FF6CF5DF', '#FFFFFFFF', '#FFFFE15A'

def circle(cx, cy, r):
    return f'M{cx - r:.2f},{cy:.2f} a{r:.2f},{r:.2f} 0 1,0 {2 * r:.2f},0 a{r:.2f},{r:.2f} 0 1,0 {-2 * r:.2f},0 z'

def ellipse(cx, cy, rx, ry):
    return f'M{cx - rx:.2f},{cy:.2f} a{rx:.2f},{ry:.2f} 0 1,0 {2 * rx:.2f},0 a{rx:.2f},{ry:.2f} 0 1,0 {-2 * rx:.2f},0 z'

def poly(*pts):
    return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pts) + ' z'

# ---- background: storm night, the neon tower on the left, a lightning bolt and rain
bg = [
    {'d': 'M0,0 h108 v108 h-108 z', 'fill': '#FF0C1530'},
    {'d': circle(66, 30, 34), 'fill': '#3326407A'},
    {'d': circle(66, 30, 20), 'fill': '#2E3A5AAA'},
    # Tower: dark core with glowing rings and lit windows.
    {'d': 'M8,0 h24 v108 h-24 z', 'fill': '#FF151C2A'},
    {'d': 'M28,0 h4 v108 h-4 z', 'fill': '#FF0E141F'},
]
for y in (22, 52, 82):
    bg.append({'d': f'M8,{y} L32,{y}', 'stroke': '#FF3FF0D0', 'w': 1.6})
for i, (x, y) in enumerate([(12, 12), (19, 16), (24, 30), (14, 36), (21, 43), (12, 60), (25, 64), (17, 72), (23, 92), (13, 98), (20, 104)]):
    bg.append({'d': f'M{x},{y} h2.6 v3.2 h-2.6 z', 'fill': '#FF7FD8FF' if i % 3 else '#FFFFC266'})
bg.append({'d': poly((86, 38), (78, 51), (82.5, 51), (76, 64), (89, 46.5), (84.5, 46.5), (89.5, 38)), 'fill': '#FFFFF6C8'})
for x, y in [(44, 10), (58, 6), (90, 40), (40, 26), (86, 58), (36, 60)]:
    bg.append({'d': f'M{x},{y} L{x - 2.4},{y + 7}', 'stroke': '#557FAFFF', 'w': 0.9})

# ---- foreground: platform with neon trim, the stickman landing on it, the cord trailing back
top = [(34, 76), (70, 71), (77, 80), (41, 86)]
fg = [
    {'d': poly((41, 86), (77, 80), (77, 87), (41, 93)), 'fill': '#FF1A2232'},
    {'d': poly((34, 76), (41, 86), (41, 93), (34, 83)), 'fill': '#FF121826'},
    {'d': poly(*top), 'fill': '#FF2B3446'},
    {'d': 'M' + ' L'.join(f'{x},{y}' for x, y in top + [top[0]]), 'stroke': '#FF3FF0D0', 'w': 1.8},
    {'d': ellipse(55, 79.5, 9, 2.2), 'fill': '#88000000'},
]
cord = 'M51,57 C40,62 30,52 24,44 S14,30 6,26'
fg += [{'d': cord, 'stroke': INK, 'w': 4.6}, {'d': cord, 'stroke': GOLD, 'w': 2.4}]
limbs = [
    'M56,44 L52,58',               # torso, leaning into the jump
    'M55,47 L46,44 L40,35',        # arm swung back and up
    'M56,47 L65,45 L72,37',        # arm reaching forward
    'M52,58 L61,62 L64,71',        # front leg, about to land
    'M52,58 L45,64 L43,72',        # back leg
]
for l in limbs: fg.append({'d': l, 'stroke': INK, 'w': 7.6})
for l in limbs: fg.append({'d': l, 'stroke': TEAL, 'w': 4.8})
for x, y in [(40, 35), (72, 37)]: fg += [{'d': circle(x, y, 3.4), 'fill': INK}, {'d': circle(x, y, 2.3), 'fill': TEAL}]
for x, y in [(65, 72.2), (44, 73.2)]: fg += [{'d': ellipse(x, y, 4.0, 2.6), 'fill': INK}, {'d': ellipse(x, y, 2.9, 1.6), 'fill': TEAL}]
# Head in the body colour with the game's face: dark eyes and a big excited open smile.
fg += [
    {'d': circle(59, 33, 11.2), 'fill': INK}, {'d': circle(59, 33, 9.8), 'fill': HEAD},
    {'d': ellipse(55.2, 31, 1.7, 2.4), 'fill': INK}, {'d': ellipse(62.6, 30.4, 1.7, 2.4), 'fill': INK},
    {'d': circle(55.7, 30.1, 0.55), 'fill': WHITE}, {'d': circle(63.1, 29.5, 0.55), 'fill': WHITE},
    {'d': 'M53.2,35.6 Q59,38.4 65,34.6 Q63.6,41.6 58.8,41.4 Q54.2,41 53.2,35.6 z', 'fill': INK},
    {'d': 'M56.4,39.4 Q59,37.8 61.6,39.4 Q60.2,41 58.9,41 Q57.4,40.9 56.4,39.4 z', 'fill': '#FFFF6B8A'},
    # Speed lines behind the leap.
    {'d': 'M30,66 L37,64', 'stroke': WHITE, 'w': 1.6}, {'d': 'M28,72 L35,70', 'stroke': WHITE, 'w': 1.6},
]
mono = [dict(s, fill=WHITE if s.get('fill') else None, stroke=WHITE if s.get('stroke') else None)
        for s in fg if s.get('fill') not in (HEAD, WHITE, '#FFFF6B8A', '#88000000', '#FF1A2232', '#FF121826')]

def vector(shapes):
    out = ['<?xml version="1.0" encoding="utf-8"?>',
           '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
           '    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">']
    for s in shapes:
        if s.get('stroke'):
            out.append(f'    <path android:pathData="{s["d"]}" android:fillColor="#00000000" android:strokeColor="{s["stroke"]}" '
                       f'android:strokeWidth="{s["w"]}" android:strokeLineCap="round" android:strokeLineJoin="round" />')
        else:
            out.append(f'    <path android:pathData="{s["d"]}" android:fillColor="{s["fill"]}" />')
    out.append('</vector>')
    return '\n'.join(out) + '\n'

def css(c):  # #AARRGGBB to rgba()
    a, r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5, 7))
    return f'rgba({r},{g},{b},{a / 255:.3f})'

def svg(layers, size=512):
    body = []
    for shapes in layers:
        for s in shapes:
            if s.get('stroke'):
                body.append(f'<path d="{s["d"]}" fill="none" stroke="{css(s["stroke"])}" stroke-width="{s["w"]}" stroke-linecap="round" stroke-linejoin="round"/>')
            else:
                body.append(f'<path d="{s["d"]}" fill="{css(s["fill"])}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 72 72"><defs>'
            '<clipPath id="m"><circle cx="54" cy="54" r="36"/></clipPath></defs>'
            f'<g clip-path="url(#m)" transform="translate(-18,-18)">{"".join(body)}</g></svg>')

(ROOT / 'res/drawable/ic_launcher_bg.xml').write_text(vector(bg))
(ROOT / 'res/drawable/ic_launcher_fg.xml').write_text(vector(fg))
(ROOT / 'res/drawable/ic_launcher_mono.xml').write_text(vector(mono))
(ROOT / 'dev/icon/preview.svg').write_text(svg([bg, fg]))
print('wrote icon layers and dev/icon/preview.svg')
