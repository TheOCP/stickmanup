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
lines = ''.join('            + "' + l.replace('\\', '\\\\').replace('"', '\\"') + '\\n"\n' for l in glsl.split('\n'))
java = java[:start] + '    static final String PATTERN = ""\n' + lines + java[end:]
java = re.sub(r'/\*\* Procedural surface detail;[^*]*\*/', '/** Procedural surface detail; generated from assets/js/pattern.js by dev/sync_pattern.py. */', java)
java_path.write_text(java)
print('NRender PATTERN updated:', glsl.count('\n') + 1, 'lines')
