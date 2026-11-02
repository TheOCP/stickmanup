"""Copies the GLSL in assets/js/pattern.js into NRender.java's PATTERN string (keep both renderers identical).
Usage: python3 dev/sync_pattern.py"""
import re
from pathlib import Path
root = Path(__file__).resolve().parent.parent
js = (root / 'assets/js/pattern.js').read_text()
glsl = js[js.index('`') + 1:js.rindex('`')].strip('\n')
java_path = root / 'src/io/stickmanup/gl/NRender.java'
java = java_path.read_text()
start = java.index('    static final String PATTERN = ""')
# The statement ends with a line holding only ';' (semicolons inside the GLSL don't count).
end = java.index('\n;\n', start) + 1
# On Android the noise is read from a texture baked once at startup (see NRender.makeNoise), not worked out per pixel.
PROC_HASH = glsl[glsl.index('float smuHash'):glsl.index('float smuNoise')]
PROC_NOISE = glsl[glsl.index('float smuNoise'):glsl.index('float smuFbm')]
glsl = glsl.replace(PROC_HASH, 'uniform sampler2D uNoise;\nfloat smuHash(vec2 p){ return textureLod(uNoise, (floor(p) + 0.5) / 512.0, 0.0).g; }\n')
glsl = glsl.replace(PROC_NOISE, 'float smuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoise, (i + f + 0.5) / 512.0, 0.0).r; }\n')
lines = ''.join('            + "' + l.replace('\\', '\\\\').replace('"', '\\"') + '\\n"\n' for l in glsl.split('\n'))
java = java[:start] + '    static final String PATTERN = ""\n' + lines + java[end:]
java = re.sub(r'/\*\* Procedural surface detail;[^*]*\*/', '/** Procedural surface detail; generated from assets/js/pattern.js by dev/sync_pattern.py. */', java)
java_path.write_text(java)
print('NRender PATTERN updated:', glsl.count('\n') + 1, 'lines')
