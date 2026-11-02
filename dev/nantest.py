"""Reproduce the phone 'white screen': put one tiny NaN-producing quad in the scene and compare the old
bloom high-pass shader (no sanitizing) with the fixed one."""
import functools, http.server, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "assets"
OUT = Path(__file__).resolve().parent / "out"
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
OLD_HP = """uniform sampler2D tDiffuse; uniform vec3 defaultColor; uniform float defaultOpacity; uniform float luminosityThreshold; uniform float smoothWidth; varying vec2 vUv;
void main() { vec4 texel = texture2D( tDiffuse, vUv ); float v = luminance( texel.xyz ); vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );
float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v ); gl_FragColor = mix( outputColor, texel, alpha ); }"""
INJECT = """async (old) => {
  const THREE = await import('./lib/three.module.js');
  const R = SMU.renderer;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.ShaderMaterial({
    uniforms: { uZero: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uZero; void main(){ float n = uZero / uZero; gl_FragColor = vec4(n, n, n, 1.0); }' }));
  m.frustumCulled = false; m.renderOrder = 99;
  R.camera.add(m); m.position.set(0, 0, -5); R.scene.add(R.camera);
  if (old) { const f = R.bloom.materialHighPassFilter; f.fragmentShader = old; f.needsUpdate = true; }
  return true; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=native", "--disable-vulkan-surface", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
                          env={**os.environ, "VK_ICD_FILENAMES": "/usr/share/vulkan/icd.d/lvp_icd.json"})
    for name, old in (("old-bloom", OLD_HP), ("fixed-bloom", None)):
        pg = b.new_page(bypass_csp=True, viewport={"width": 640, "height": 300})
        pg.add_init_script("localStorage.setItem('smu.settings', JSON.stringify({quality:'high'}))")
        pg.goto(f"http://127.0.0.1:{srv.server_port}/index.html")
        pg.wait_for_function("window.SMU && SMU.renderer", timeout=60000)
        pg.evaluate("document.getElementById('menu').style.display='none'")
        pg.evaluate(INJECT, old)
        pg.wait_for_timeout(2500 if not old else 16000)
        pg.screenshot(path=str(OUT / f"nan-{name}.png"))
        print(name, "safe level now:", pg.evaluate("SMU.renderer.safe"))
        pg.close()
    b.close()
srv.shutdown()
