package io.stickmanup.gl;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLSurfaceView;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * The native 3D view. Sits behind the transparent WebView (menus and HUD) and draws whatever the game
 * mirrors to it, one frame per game frame.
 *
 * Resolution: the window surface is set once to the player's chosen resolution (and only changes when they
 * change that setting). Auto resolution then works inside the renderer: once a second it checks whether
 * the GPU kept up (game frames piling up) and draws the 3D scene a little smaller or larger inside a
 * fixed-size buffer, scaled to the screen in the final pass. The surface itself never resizes during
 * play, because a resize can flash a stale frame.
 */
public final class GLView extends GLSurfaceView implements GLSurfaceView.Renderer {
    public final NRender scene;
    private static final float MIN = 0.5f;
    private volatile float target = 0.75f, dyn = 1f;
    private volatile boolean auto = true;
    private int appliedW, appliedH;
    private int vw, vh, calm;
    private long tick;
    public volatile String perf = "";

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

    /** The quality the player picked, as a share of screen resolution. Auto resolution never goes above it. */
    public void setScale(float s) {
        float t = Math.max(MIN, Math.min(1f, s));
        if (Math.abs(t - target) < 0.001f && appliedW > 0) return;
        target = t;
        applyScale();
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

    /** Automatic resolution on (drops below the chosen resolution when the phone can't keep up) or off. */
    public void setAuto(boolean on) {
        auto = on;
        if (!on) { dyn = 1f; scene.renderScale = 1f; }
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
    public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        scene.contextCreated();
        applyVsync();
    }

    @Override
    public void onSurfaceChanged(GL10 unused, int w, int h) {
        scene.resize(w, h);
        applyVsync();
    }

    @Override
    public void onDrawFrame(GL10 unused) {
        scene.draw();
        long now = System.nanoTime();
        if (tick == 0) tick = now;
        if (now - tick < 1_000_000_000L) return;
        tick = now;
        int frames = Math.max(1, scene.framesSec), late = scene.lateSec;
        float avgMs = scene.drawNsSec / 1e6f / frames, maxMs = scene.drawNsMax / 1e6f;
        perf = String.format(java.util.Locale.US, "%dfps late %d cpu %.1f/%.1fms res %.2f x %.2f", frames, late, avgMs, maxMs, target, dyn);
        scene.framesSec = 0;
        scene.lateSec = 0;
        scene.drawNsSec = 0;
        scene.drawNsMax = 0;
        if (!auto) return;
        // Behind: draw the scene a bit smaller. Three calm seconds in a row: a bit sharper again.
        if (late > frames / 10) { dyn = Math.max(0.6f, dyn * 0.9f); calm = 0; }
        else if (late == 0 && ++calm >= 3 && dyn < 1f) { dyn = Math.min(1f, dyn * 1.06f); calm = 0; }
        scene.renderScale = dyn;
    }
}
