"""Draws the StickManUp launcher icon once and writes it as Android vector drawables (adaptive icon
background, foreground and monochrome layers) plus an SVG preview. Run: python3 dev/icon/make_icon.py"""
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
C = 54  # centre of the 108 x 108 adaptive-icon canvas
INK, TEAL, WHITE, PINK, TONGUE = '#FF12091C', '#FF3FF0D0', '#FFFFFFFF', '#FFFF3E9E', '#FFFF5A7A'

def circle(cx, cy, r):
    return f'M{cx - r:.2f},{cy:.2f} a{r:.2f},{r:.2f} 0 1,0 {2 * r:.2f},0 a{r:.2f},{r:.2f} 0 1,0 {-2 * r:.2f},0 z'

def ellipse(cx, cy, rx, ry):
    return f'M{cx - rx:.2f},{cy:.2f} a{rx:.2f},{ry:.2f} 0 1,0 {2 * rx:.2f},0 a{rx:.2f},{ry:.2f} 0 1,0 {-2 * rx:.2f},0 z'

# Background: hot pink with a crazy sunburst of orange and yellow rays.
bg = [{'d': 'M0,0 h108 v108 h-108 z', 'fill': PINK}]
for k in range(14):
    a0, a1 = (k / 14) * 2 * math.pi + 0.1, ((k + 0.5) / 14) * 2 * math.pi + 0.1
    p = [(C, C), (C + 90 * math.cos(a0), C + 90 * math.sin(a0)), (C + 90 * math.cos(a1), C + 90 * math.sin(a1))]
    bg.append({'d': 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in p) + ' z', 'fill': '#FFFF8A3D' if k % 2 else '#FFFFC93C'})
bg.append({'d': circle(C, C, 30), 'fill': '#33FFFFFF'})

# Foreground: the stickman mid-flail. Limbs are drawn twice: a dark outline, then teal on top.
limbs = [
    'M55,57 L52,71',                      # torso
    'M54,61 L42,64 L33,53',               # left arm, flailing up
    'M55,60 L68,58 L77,47',               # right arm, waving
    'M52,71 L44,79 L36,85',               # left leg, flung back
    'M52,71 L62,77 L71,72',               # right leg, kicking
]
cord = 'M52,72 C60,86 72,78 78,92 S90,98 96,104'
fg = [{'d': cord, 'stroke': INK, 'w': 5.2}, {'d': cord, 'stroke': '#FFFFE15A', 'w': 2.6}]
for l in limbs: fg.append({'d': l, 'stroke': INK, 'w': 8.4})
for l in limbs: fg.append({'d': l, 'stroke': TEAL, 'w': 5.2})
for x, y in [(33, 53), (77, 47)]: fg += [{'d': circle(x, y, 3.9), 'fill': INK}, {'d': circle(x, y, 2.6), 'fill': TEAL}]
for x, y in [(36, 85), (71, 72)]: fg += [{'d': ellipse(x, y, 4.6, 3.2), 'fill': INK}, {'d': ellipse(x, y, 3.3, 2.0), 'fill': TEAL}]
# Head: big, teal, with mismatched googly eyes looking two ways, a huge grin and the tongue out.
fg += [
    {'d': circle(56, 40, 17.6), 'fill': INK}, {'d': circle(56, 40, 16.0), 'fill': TEAL},
    {'d': circle(48.5, 36.5, 8.2), 'fill': INK}, {'d': circle(48.5, 36.5, 7.0), 'fill': WHITE},
    {'d': circle(64.0, 34.0, 6.0), 'fill': INK}, {'d': circle(64.0, 34.0, 4.9), 'fill': WHITE},
    {'d': circle(45.6, 39.4, 3.3), 'fill': INK}, {'d': circle(66.2, 32.0, 2.4), 'fill': INK},
    {'d': circle(44.6, 38.3, 1.0), 'fill': WHITE}, {'d': circle(65.6, 31.3, 0.7), 'fill': WHITE},
    {'d': 'M44,45 Q56,51 69,43 Q66,57 55,56 Q46,55 44,45 z', 'fill': INK},
    {'d': 'M47,47 Q56,50.5 66,46 L65.5,48 Q56,52 47.5,49 z', 'fill': WHITE},
    {'d': 'M55,53 Q60,50 64,53 Q66,60 60,61 Q55,60 55,53 z', 'fill': TONGUE},
    {'d': 'M59.6,53.2 L60.2,58.6', 'stroke': '#FFC23A5A', 'w': 0.9},
    # Sweat drop and motion lines: it is having the time of its life.
    {'d': 'M74,23.5 Q76.8,28 75.5,30.3 Q73.2,31.7 71.9,29.7 Q71.3,27.6 74,23.5 z', 'fill': '#FF9BE7FF'},
    {'d': 'M24,62 L30,62', 'stroke': WHITE, 'w': 2.2}, {'d': 'M22,68 L29,68', 'stroke': WHITE, 'w': 2.2},
    {'d': 'M25,74 L30,74', 'stroke': WHITE, 'w': 2.2},
]
mono = [dict(s, fill=WHITE if s.get('fill') else None, stroke=WHITE if s.get('stroke') else None) for s in fg
        if not (s.get('fill') in (WHITE,) or s.get('fill') == TONGUE)]

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

def css(c):  # #AARRGGBB -> rgba()
    a, r, g, b = (int(c[i:i + 2], 16) for i in (1, 3, 5, 7))
    return f'rgba({r},{g},{b},{a / 255:.3f})'

def svg(layers, size=512, mask=True):
    body = []
    for shapes in layers:
        for s in shapes:
            if s.get('stroke'):
                body.append(f'<path d="{s["d"]}" fill="none" stroke="{css(s["stroke"])}" stroke-width="{s["w"]}" stroke-linecap="round" stroke-linejoin="round"/>')
            else:
                body.append(f'<path d="{s["d"]}" fill="{css(s["fill"])}"/>')
    clip = '<clipPath id="m"><circle cx="54" cy="54" r="36"/></clipPath>' if mask else ''
    g = f'<g clip-path="url(#m)" transform="translate(-18,-18)">' if mask else '<g>'
    vb = '0 0 72 72' if mask else '0 0 108 108'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{vb}"><defs>{clip}</defs>{g}{"".join(body)}</g></svg>'

(ROOT / 'res/drawable/ic_launcher_bg.xml').write_text(vector(bg))
(ROOT / 'res/drawable/ic_launcher_fg.xml').write_text(vector(fg))
(ROOT / 'res/drawable/ic_launcher_mono.xml').write_text(vector(mono))
(ROOT / 'dev/icon/preview.svg').write_text(svg([bg, fg]))
print('wrote icon layers and dev/icon/preview.svg')
