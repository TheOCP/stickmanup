#!/usr/bin/env bash
# Build the native renderer against desktop OpenGL (JOGL) and replay a recording: dev/desk/run.sh REC_DIR OUT.png
set -e
cd "$(dirname "$0")/../.."
CP=/usr/share/java/jogl2.jar:/usr/share/java/gluegen2-rt.jar
mkdir -p /tmp/desk
javac -nowarn -d /tmp/desk -cp $CP $(ls src/io/stickmanup/gl/*.java | grep -v -E "AndroidGL|GLView") dev/desk/DeskGL.java dev/desk/DeskMain.java
[ -e /tmp/.X11-unix/X77 ] || { Xvfb :77 -screen 0 1024x768x24 >/dev/null 2>&1 & sleep_wait=1; }
for i in $(seq 20); do [ -e /tmp/.X11-unix/X77 ] && break; python3 -c "import time; time.sleep(0.3)"; done
DISPLAY=:77 java -Djava.library.path=/usr/lib/jni -cp $CP:/tmp/desk DeskMain "$1" "$2" 2>&1 | grep -v WARNING
