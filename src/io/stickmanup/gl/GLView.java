package io.stickmanup.gl;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.EGL14;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLSurfaceView;
import android.view.Choreographer;
import android.view.Display;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * The native 3D view. Sits behind the transparent WebView (menus and HUD) and draws whatever the game
 * mirrors to it, one frame per game frame.
 *
 * Resolution: the window surface is set once to the player's chosen resolution (and only changes when they
 * change that setting). The game's automatic graphics (assets/js/autoq.js) then draws the 3D scene smaller or
 * larger inside that fixed-size buffer. The surface itself never resizes during play, because a resize can
 * flash a stale frame.
 *
 * Pacing: every picture is handed to the display with the exact screen refresh it should appear on. Without
 * that, a picture finished a moment too late shows a refresh later and queues up behind the next one, so the
 * motion stutters even though the frame counter still says 60.
 */
public final class GLView extends GLSurfaceView implements GLSurfaceView.Renderer, Choreographer.FrameCallback {
    public final NRender scene;
    private static final float MIN = 0.5f;
    private volatile float target = 0.75f;
    private int appliedW, appliedH;
    private int vw, vh;
    private long tick;
    public volatile String perf = "";
    /** Last second as numbers for the game: frames, late, GPU average ms, GPU worst ms, slow frames. */
    public volatile String stats = "0,0,0,0,0";

    // Screen timing, from the UI thread's vsync callback.
    private volatile long vsyncNs, periodNs = 16_666_667L, frameNs = 16_666_667L, vsyncOffsetNs;
    private volatile boolean ticking;
    private int rateAt;
    private long lastTarget, lastEnd;
    private int slowSec;
    private float gpuMs;
    private boolean canPace;
    private EGLDisplay eglDisplay;
    private EGLSurface eglSurface;

    public GLView(Context ctx, NRender.Log log) {
        super(ctx);
        setEGLContextClientVersion(3);
        setEGLConfigChooser(8, 8, 8, 8, 24, 0);
        setPreserveEGLContextOnPause(true);
        scene = new NRender(new AndroidGL(), new NRender.Images() {
            @Override
            public int[] decode(byte[] png, int[] wh) {
                Bitmap b = BitmapFactory.decodeByteArray(png, 0, png.length);
                wh[0] = b.getWidth();
                wh[1] = b.getHeight();
                int[] px = new int[wh[0] * wh[1]];
                b.getPixels(px, 0, wh[0], 0, 0, wh[0], wh[1]);
                b.recycle();
                return px;
            }
        }, log);
        setRenderer(this);
        setRenderMode(RENDERMODE_WHEN_DIRTY);
    }

    public void post(String kind, String data) {
        scene.post(kind, data);
        if ("frame".equals(kind)) requestRender();
    }

    /** The quality the player picked, as a share of screen resolution. */
    public void setScale(float s) {
        float t = Math.max(MIN, Math.min(1f, s));
        if (Math.abs(t - target) < 0.001f && appliedW > 0) return;
        target = t;
        applyScale();
    }

    /** The frame rate the game runs at, so pictures can be spaced evenly on any screen. */
    public void setCap(int cap) {
        if (cap > 0) frameNs = 1_000_000_000L / cap;
    }

    private volatile boolean vsync = true;

    /**
     * VSync on: each frame waits for the screen refresh before it is shown (smooth, never torn).
     * Off: the renderer hands frames over without waiting, which can shave a little input lag.
     */
    public void setVsync(final boolean on) {
        vsync = on;
        queueEvent(new Runnable() {
            @Override
            public void run() {
                applyVsync();
            }
        });
    }

    private void applyVsync() {
        try {
            android.opengl.EGL14.eglSwapInterval(android.opengl.EGL14.eglGetCurrentDisplay(), vsync ? 1 : 0);
        } catch (Throwable ignored) {
        }
    }

    private void applyScale() {
        if (vw <= 0 || vh <= 0) return;
        int w = Math.round(vw * target), h = Math.round(vh * target);
        if (w == appliedW && h == appliedH) return;
        appliedW = w;
        appliedH = h;
        getHolder().setFixedSize(w, h);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        vw = w;
        vh = h;
        applyScale();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!ticking) {
            ticking = true;
            Choreographer.getInstance().postFrameCallback(this);
        }
    }

    @Override
    public void onPause() {
        ticking = false;
        Choreographer.getInstance().removeFrameCallback(this);
        vsyncNs = 0;
        super.onPause();
    }

    /** UI thread, once per screen refresh: when it happened, and now and then how fast the screen is running. */
    @Override
    public void doFrame(long frameTimeNanos) {
        vsyncNs = frameTimeNanos;
        if (--rateAt <= 0) {
            rateAt = 60;
            Display d = getDisplay();
            float hz = d != null ? d.getRefreshRate() : 0;
            if (hz > 10) periodNs = (long) (1e9f / hz);
            // The callback's time is this much after the display's real refresh.
            if (d != null) vsyncOffsetNs = d.getAppVsyncOffsetNanos();
        }
        if (ticking) Choreographer.getInstance().postFrameCallback(this);
    }

    private void findSurface() {
        try {
            eglDisplay = EGL14.eglGetCurrentDisplay();
            eglSurface = EGL14.eglGetCurrentSurface(EGL14.EGL_DRAW);
            String ext = EGL14.eglQueryString(eglDisplay, EGL14.EGL_EXTENSIONS);
            canPace = ext != null && ext.contains("EGL_ANDROID_presentation_time");
        } catch (Throwable t) {
            canPace = false;
        }
        lastTarget = 0;
    }

    /**
     * Picks the screen refresh this picture is shown on: the first one it can surely make, but never closer to
     * the last picture than one frame. A frame that comes out late moves to the next refresh; the frames after it
     * then keep that rhythm, so the next small delay costs nothing instead of showing as another stutter.
     */
    private void pace(long now) {
        if (!canPace || !vsync) return;
        long vs = vsyncNs, p = periodNs, fp = frameNs;
        if (vs == 0) return;
        vs -= vsyncOffsetNs;
        // Still to do: the GPU's work on this frame, and the compositor needs its share before each refresh.
        long ready = now + (long) (gpuMs * 500_000f) + p * 3 / 10;
        long natural = vs + Math.max(0, (ready - vs + p - 1) / p) * p;
        long t = natural;
        long min = lastTarget + fp - p / 2;
        if (t < min) t += (min - t + p - 1) / p * p;
        // More than one frame queued is only lag: start again from the earliest refresh.
        if (t > natural + fp + p / 2) t = natural;
        lastTarget = t;
        try {
            // Half a refresh early: the middle of the gap before the wanted refresh, so timing noise can't push the
            // picture over to the next one. It is shown on the first refresh at or after this time.
            if (!EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, t - p / 2)) canPace = false;
        } catch (Throwable e) {
            canPace = false;
        }
    }

    @Override
    public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        // The picture is what the player is waiting for: this thread comes before background work.
        try {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_DISPLAY);
        } catch (Throwable ignored) {
        }
        scene.contextCreated();
        applyVsync();
        findSurface();
    }

    @Override
    public void onSurfaceChanged(GL10 unused, int w, int h) {
        scene.resize(w, h);
        applyVsync();
        findSurface();
    }

    @Override
    public void onDrawFrame(GL10 unused) {
        scene.draw();
        long now = System.nanoTime();
        pace(now);
        if (lastEnd != 0 && now - lastEnd > frameNs + frameNs / 2) slowSec++;
        lastEnd = now;
        if (tick == 0) tick = now;
        if (now - tick < 1_000_000_000L) return;
        tick = now;
        int frames = Math.max(1, scene.framesSec), late = scene.lateSec, samples = scene.gpuSamples;
        float avgMs = scene.drawNsSec / 1e6f / frames, maxMs = scene.drawNsMax / 1e6f;
        // The middle sample, not the average: one frame held up by a map load says nothing about the phone.
        float gpuAvg = 0, gpuMax = 0;
        if (samples > 0) {
            java.util.Arrays.sort(scene.gpuMs, 0, samples);
            gpuAvg = scene.gpuMs[samples / 2];
            gpuMax = scene.gpuMs[samples - 1];
            gpuMs = gpuAvg;
        }
        perf = String.format(java.util.Locale.US, "%dfps late %d slow %d cpu %.1f/%.1fms gpu %.1f/%.1fms res %.2f draws %d tris %d pace %s",
                frames, late, slowSec, avgMs, maxMs, gpuAvg, gpuMax, target, scene.draws, scene.tris, canPace && vsync ? "on" : "off");
        stats = frames + "," + late + "," + gpuAvg + "," + gpuMax + "," + slowSec;
        scene.framesSec = 0;
        scene.lateSec = 0;
        scene.drawNsSec = 0;
        scene.drawNsMax = 0;
        scene.gpuSamples = 0;
        slowSec = 0;
    }
}
