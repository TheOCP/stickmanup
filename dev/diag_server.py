"""Receives StickManUp diagnostic reports on 127.0.0.1:47999 (the app connects only if this is running)."""
import socketserver, time, sys
LOG = sys.argv[1] if len(sys.argv) > 1 else "/root/stickmanup/dev/diag.log"

class H(socketserver.StreamRequestHandler):
    def handle(self):
        with open(LOG, "a", buffering=1) as f:
            f.write(f"=== connection {time.strftime('%H:%M:%S')} from {self.client_address}\n")
            for line in self.rfile:
                f.write(time.strftime("%H:%M:%S ") + line.decode("utf-8", "replace"))

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

S(("127.0.0.1", 47999), H).serve_forever()
