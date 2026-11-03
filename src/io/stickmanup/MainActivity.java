package io.stickmanup;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;
import android.os.Vibrator;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;
import android.widget.FrameLayout;

import org.json.JSONObject;

import io.stickmanup.gl.GLView;
import io.stickmanup.gl.NRender;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.Locale;

/**
 * Full-screen landscape WebView running the game from assets/, served from a secure https origin so
 * ES modules and WebRTC work. Exposes {@code window.Native} for haptics and the like.
 */
public class MainActivity extends Activity {
    private volatile String guardLast = "{}";
    private volatile long guardAt = 0;

    private static final String ORIGIN = "https://appassets.androidplatform.net/";

    private WebView web;
    /** The app version shown in the game (keep in step with versionName in AndroidManifest.xml). */
    static final String VERSION = "4.10.3";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final StringBuilder jsQueue = new StringBuilder();
    private boolean jsPosted;
    private volatile String insets = "{\"l\":0,\"t\":0,\"r\":0,\"b\":0}";
    private SharedPreferences prefs;
    private boolean restarting;

    // Last game heartbeat, for the developer diagnostics stream only.
    private volatile long lastBeat, pageAt;
    private volatile String lastState = "{}";
    private boolean resumed;
    private GLView glView;
    private int webMajor;
    private volatile boolean booted;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        try {
            // A steady 60 Hz display (LTPO phones otherwise flip between rates) and the cutout area.
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.preferredRefreshRate = 60f;
            lp.getClass().getField("layoutInDisplayCutoutMode").setInt(lp, 1);
            w.setAttributes(lp);
        } catch (Exception ignored) {
        }
        // Crash guard: "booting" stays set until the game reports 20 s of healthy rendering or the user
        // leaves normally. Still set at the next launch means the GPU took the app down, so go one level safer.
        prefs = getSharedPreferences("stickmanup", MODE_PRIVATE);
        Diag.start(Diag.header(prefs.getInt("safe", 0), prefs.getString("why", ""), webViewVersion()), new Diag.Snapshot() {
            @Override
            public JSONObject snap() {
                JSONObject o = new JSONObject();
                try {
                    long now = SystemClock.uptimeMillis();
                    o.put("k", "snap").put("up", now).put("resumed", resumed).put("page", pageAt > 0)
                            .put("beatAgo", lastBeat > 0 ? now - lastBeat : -1).put("gl", glView.scene.renderer)
                            .put("draws", glView.scene.draws).put("perf", glView.perf).put("js", new JSONObject(lastState));
                } catch (Exception ignored) {
                }
                return o;
            }
        });

        // The 3D world is drawn natively behind the page (WebView WebGL breaks on some GPUs, e.g. Pixel 10).
        FrameLayout root = new FrameLayout(this);
        glView = new GLView(this, new NRender.Log() {
            @Override
            public void log(String msg) {
                Log.w("StickManUp", msg);
                Diag.send("gl", "msg", msg);
            }
        });
        root.addView(glView, new FrameLayout.LayoutParams(-1, -1));
        webMajor = majorOf(webViewVersion());
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                onInsets(in);
                return in;
            }
        });
        immersive();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, String url) {
                return url.startsWith(ORIGIN) ? asset(url) : null;
            }

            // API 26+: the web content process died (on some GPUs a driver crash takes it down).
            // Handle it instead of letting Android kill the app, and come back one graphics level safer.
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                Diag.send("renderGone", "crash", detail.didCrash());
                if (!booted) {
                    // Died while still starting, usually out of memory. The next try builds the simple world, and a
                    // phone that can't manage even that gets told so, instead of restarting for ever.
                    int tries = prefs.getInt("bootCrashes", 0) + 1;
                    prefs.edit().putInt("bootCrashes", tries).putInt("safe", Math.max(prefs.getInt("safe", 0), 3)).commit();
                    if (tries >= 3) {
                        prefs.edit().putInt("bootCrashes", 0).commit();
                        tooLittleMemory();
                        return true;
                    }
                }
                restartApp();
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageAt = SystemClock.uptimeMillis();
                Diag.send("page", "url", url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith(ORIGIN)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        // No grey overlay over the whole game while a controller is in use (API 26, not in the jar this builds against).
        try {
            View.class.getMethod("setDefaultFocusHighlightEnabled", boolean.class).invoke(web, false);
        } catch (Exception ignored) {
        }
        web.loadUrl(ORIGIN + "index.html");
        takeSignIn(getIntent());
    }

    /** The one time sign in code the browser sends back. Not trusted: the code is useless without the game's own secret. */
    private volatile String signInCode;

    private void takeSignIn(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"stickmanup".equals(u.getScheme()) || !"auth".equals(u.getHost())) return;
        String code = u.getQueryParameter("code");
        // Only plain characters, because it goes into a line of script.
        if (code == null || !code.matches("[A-Za-z0-9_-]{20,128}")) return;
        signInCode = code;
        if (pageAt > 0) js("window.SMU_authCode&&SMU_authCode('" + code + "')");
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        takeSignIn(i);
    }

    /** Serves files from assets/ for the fake https origin. */
    private WebResourceResponse asset(String url) {
        String path = Uri.parse(url).getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        try {
            InputStream in = getAssets().open(path.substring(1));
            if (webMajor > 0 && webMajor < 89 && path.endsWith(".js") && !path.endsWith("three.module.js")) in = forOldWebView(path, in);
            return new WebResourceResponse(mime(path), "UTF-8", in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
        }
    }

    /**
     * A WebView older than Chrome 89 doesn't know import maps, so "three" means nothing to it: say where it is. The game's
     * files stay as they are, because the server reruns climbs with the same code.
     */
    private InputStream forOldWebView(String path, InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        String s = out.toString("UTF-8").replace("from 'three'", "from '/lib/three.module.js'").replace("'three/addons/", "'/lib/addons/");
        // The one use of ||=, which only arrived in Chrome 85.
        if (path.endsWith("/js/game.js")) s = s.replace("(this.coinB[Math.floor(c.y / 8)] ||= [])", "(this.coinB[Math.floor(c.y / 8)] = this.coinB[Math.floor(c.y / 8)] || [])");
        return new ByteArrayInputStream(s.getBytes("UTF-8"));
    }

    private static int majorOf(String webView) {
        try {
            String v = webView.substring(webView.lastIndexOf(' ') + 1);
            return Integer.parseInt(v.substring(0, v.indexOf('.')));
        } catch (Exception e) {
            return 0;
        }
    }

    /** Started again and again and each time the phone ran out of memory before the game got going. */
    private void tooLittleMemory() {
        String l = Locale.getDefault().getLanguage(), text;
        if ("de".equals(l)) text = "Diesem Handy geht beim Start des Spiels der Speicher aus. Schließe andere Apps und versuche es noch einmal.";
        else if ("es".equals(l)) text = "Este teléfono se queda sin memoria al iniciar el juego. Cierra otras aplicaciones y vuelve a intentarlo.";
        else if ("pt".equals(l)) text = "Este celular fica sem memória ao iniciar o jogo. Feche outros aplicativos e tente de novo.";
        else if ("fr".equals(l)) text = "Ce téléphone manque de mémoire au démarrage du jeu. Ferme les autres applications et réessaie.";
        else if ("ru".equals(l)) text = "Этому телефону не хватает памяти для запуска игры. Закрой другие приложения и попробуй снова.";
        else if ("tr".equals(l)) text = "Bu telefonun belleği oyun başlarken yetmiyor. Diğer uygulamaları kapat ve tekrar dene.";
        else text = "This phone runs out of memory while the game starts. Close other apps and try again.";
        new AlertDialog.Builder(this).setMessage(text).setCancelable(false).setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface d, int which) {
                finish();
            }
        }).show();
    }

    private static String mime(String p) {
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        try {
            // API 30+: WindowInsetsController.hide(systemBars()) with swipe-to-reveal behaviour.
            Object c = Window.class.getMethod("getInsetsController").invoke(getWindow());
            int bars = (Integer) Class.forName("android.view.WindowInsets$Type").getMethod("systemBars").invoke(null);
            c.getClass().getMethod("hide", int.class).invoke(c, bars);
            c.getClass().getMethod("setSystemBarsBehavior", int.class).invoke(c, 2);
        } catch (Exception ignored) {
        }
    }

    /** Safe areas for the camera cutout, in CSS pixels. */
    private void onInsets(WindowInsets in) {
        float dp = getResources().getDisplayMetrics().density;
        int l = 0, t = 0, r = 0, b = 0;
        try {
            Method m = WindowInsets.class.getMethod("getDisplayCutout");
            Object cut = m.invoke(in);
            if (cut != null) {
                Class<?> k = cut.getClass();
                l = (Integer) k.getMethod("getSafeInsetLeft").invoke(cut);
                t = (Integer) k.getMethod("getSafeInsetTop").invoke(cut);
                r = (Integer) k.getMethod("getSafeInsetRight").invoke(cut);
                b = (Integer) k.getMethod("getSafeInsetBottom").invoke(cut);
            }
        } catch (Exception ignored) {
        }
        insets = String.format(Locale.US, "{\"l\":%.1f,\"t\":%.1f,\"r\":%.1f,\"b\":%.1f}", l / dp, t / dp, r / dp, b / dp);
        js("window.SMU_insets&&SMU_insets(" + l / dp + "," + t / dp + "," + r / dp + "," + b / dp + ")");
    }

    /** Queues JavaScript and runs it in batches on the UI thread (network messages arrive in bursts). */
    public void js(String code) {
        synchronized (jsQueue) {
            jsQueue.append(code).append(";\n");
            if (jsPosted) return;
            jsPosted = true;
        }
        ui.post(new Runnable() {
            @Override
            public void run() {
                String s;
                synchronized (jsQueue) {
                    s = jsQueue.toString();
                    jsQueue.setLength(0);
                    jsPosted = false;
                }
                if (web != null) web.evaluateJavascript(s, null);
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) {
            immersive();
            // A controller's buttons and sticks go to the view with focus. On phones nothing has focus until the
            // first touch, so without this the controller would do nothing until the screen had been tapped.
            web.requestFocus();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        js("window.SMU_back&&SMU_back()");
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        js("window.SMU_vis&&SMU_vis(true)");
        glView.onResume();
        resumed = true;
    }

    @Override
    protected void onPause() {
        resumed = false;
        glView.onPause();
        js("window.SMU_vis&&SMU_vis(false)");
        web.onPause();
        super.onPause();
    }

    /** Hands over to the Restart activity, which kills this process and starts a fresh one. */
    private void restartApp() {
        if (restarting) return;
        restarting = true;
        startActivity(new Intent(this, Restart.class).putExtra("pid", Process.myPid()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    private String webViewVersion() {
        try {
            Object pi = WebView.class.getMethod("getCurrentWebViewPackage").invoke(null);
            return pi.getClass().getField("packageName").get(pi) + " " + pi.getClass().getField("versionName").get(pi);
        } catch (Exception e) {
            return "?";
        }
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    final class Bridge {
        @JavascriptInterface
        public String deviceId() {
            return Guard.deviceId(getApplicationContext());
        }

        // The last answer from the checks (Guard.java). Run on their own thread, every couple of minutes.
        @JavascriptInterface
        public String guard() {
            if (guardAt == 0 || System.currentTimeMillis() - guardAt > 110000) {
                guardAt = System.currentTimeMillis();
                final Context c = getApplicationContext();
                new Thread(new Runnable() {
                    @Override public void run() { guardLast = Guard.scan(c); }
                }, "guard").start();
            }
            return guardLast;
        }

        // Asks the secure hardware to vouch for this app. It can take a few seconds, so the answer comes back by itself.
        @JavascriptInterface
        public void attestStart(final String challenge) {
            new Thread(new Runnable() {
                @Override public void run() {
                    final String r = Guard.attest(String.valueOf(challenge));
                    js("window.SMU_attested&&SMU_attested(" + org.json.JSONObject.quote(r) + ")");
                }
            }, "attest").start();
        }

        @JavascriptInterface
        public String version() {
            return VERSION;
        }

        /** The game got as far as its first screen. */
        @JavascriptInterface
        public void booted() {
            booted = true;
            if (prefs.getInt("bootCrashes", 0) != 0) prefs.edit().putInt("bootCrashes", 0).apply();
        }

        @JavascriptInterface
        public void glDef(String json) {
            glView.post("def", json);
        }

        @JavascriptInterface
        public void glFrame(String json) {
            glView.post("frame", json);
        }

        @JavascriptInterface
        public String glInfo() {
            return glView.scene.renderer.isEmpty() ? "native OpenGL" : glView.scene.renderer;
        }

        @JavascriptInterface
        public void glVsync(final boolean on) {
            glView.setVsync(on);
        }

        /** The last second's frame numbers, for the game's automatic graphics. */
        @JavascriptInterface
        public String glPerf() {
            return glView.stats;
        }

        @JavascriptInterface
        public void glCap(int cap) {
            glView.setCap(cap);
        }

        /** Display refresh rate the game asks for (60 normally; 120 on fast phones if the player wants it). */
        @JavascriptInterface
        public void setRefresh(final int hz) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        WindowManager.LayoutParams lp = getWindow().getAttributes();
                        lp.preferredRefreshRate = hz;
                        getWindow().setAttributes(lp);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void glQuality(final float scale) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    glView.setScale(scale);
                }
            });
        }

        @JavascriptInterface
        public void beat(String state) {
            lastBeat = SystemClock.uptimeMillis();
            lastState = state;
        }

        @JavascriptInterface
        public void report(String line) {
            Diag.raw(line);
        }

        @JavascriptInterface
        public int getSafe() {
            return prefs.getInt("safe", 0);
        }

        @JavascriptInterface
        public void setSafe(int level) {
            prefs.edit().putInt("safe", level).commit();
        }

        @JavascriptInterface
        public void restart() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    restartApp();
                }
            });
        }

        @JavascriptInterface
        public String insets() {
            return insets;
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void haptic(final String kind) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if ("heavy".equals(kind)) {
                        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                        if (v != null && v.hasVibrator()) v.vibrate(28);
                    } else {
                        web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                    }
                }
            });
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /** Opens the phone's browser, for signing in. Encrypted addresses only. */
        @JavascriptInterface
        public void openUrl(String url) {
            Uri u = Uri.parse(url);
            if (!"https".equals(u.getScheme())) return;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
            } catch (Exception ignored) {
            }
        }

        /** A sign in code that arrived before the page was ready. Handed over once. */
        @JavascriptInterface
        public String authPending() {
            String c = signInCode;
            signInCode = null;
            return c == null ? "" : c;
        }

        @JavascriptInterface
        public void share(String text) {
            Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(i, "Share room code"));
        }

        @JavascriptInterface
        public void exit() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }
    }
}
