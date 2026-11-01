package io.stickmanup.gl;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Native renderer for the scene the game builds in JavaScript (see assets/js/mirror.js). The game never
 * touches WebGL on Android: it sends scene definitions once and compact per-frame changes, and this class
 * draws them with OpenGL ES 3.0. Pure Java so the same code runs in the desktop test harness (dev/desk).
 *
 * The per-frame path allocates nothing (frames are parsed in place, buffers are reused), so the Java
 * garbage collector never has a reason to pause the game. A lost GL context rebuilds from CPU copies.
 */
public final class NRender {

    public interface Images {
        /** Decodes PNG bytes to ARGB pixels; wh receives width and height. */
        int[] decode(byte[] png, int[] wh);
    }

    public interface Log {
        void log(String msg);
    }

    private static final class Attr {
        String name;
        int n, vbo;
        ByteBuffer bytes;
        boolean dirty = true;
    }

    private static final class Geo {
        Attr[] attrs = new Attr[0];
        ByteBuffer idx;
        int idxType, idxCount, ibo, vertCount;
        float[] bs;
        int drStart, drCount = -1;
        boolean hasNormal, hasUv, hasGlow;
    }

    private static final class Tex {
        byte[] png;
        int gl;
        boolean repS, repT, flip;
        float[] uv = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    }

    private static final class Mat {
        boolean lit, custom, sprite;
        float[] st;
        float op;
        boolean tr, dw, dt, fog;
        int side, blend, map, em, panel;
        float rough, metal;
        String vs, fs;
        String[] uNames;
        int[] uSizes;
        Prog prog;
    }

    private static final class Obj {
        int id, kind, g, m, ro, inst, vao, imVbo, icVbo;
        boolean fc, vis, imDirty = true;
        Prog vaoProg;
        ByteBuffer im, ic;
        float[] bs;
        final float[] mw = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
        float dist;
    }

    private static final class Prog {
        int id;
        final Map<String, Integer> u = new HashMap<>();
        boolean custom;
    }

    private final GLApi gl;
    private final Images images;
    private final Log log;
    private final ConcurrentLinkedQueue<String[]> inbox = new ConcurrentLinkedQueue<>();
    private Geo[] geos = new Geo[256];
    private Mat[] mats = new Mat[256];
    private Obj[] byId = new Obj[256];
    private final List<Obj> objs = new ArrayList<>();
    private final Map<Integer, Tex> texs = new HashMap<>();
    private final float[] env = new float[32], view = new float[16], proj = new float[16], vp = new float[16], cam = new float[3];
    private final float[] camIn = new float[35], trs = new float[10], tmp = new float[16], mulTmp = new float[16];
    private static final float[] IDENT3 = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    private final float[][] planes = new float[6][4];
    private Obj[] opaque = new Obj[512], transparent = new Obj[256];
    private int nOpaque, nTransparent;
    private Prog lit, basic, sprite, bright, blur, comp;
    private final Map<String, Prog> customCache = new HashMap<>();
    private int quadVbo, quadVao, spriteVbo;
    private int w, h, fboW, fboH, sceneFbo, sceneTex, sceneDepth;
    private final int[] bloomFbo = new int[4], bloomTex = new int[4];
    private boolean framed, failed;
    public String renderer = "";
    public int draws;

    // Performance counters, read once a second by GLView (auto resolution) and diagnostics.
    public int framesSec, lateSec;
    /**
     * Dynamic resolution, as a share of the surface size. The scene is drawn into a sub-rectangle of the
     * full-size offscreen buffer and the final pass scales it up to the screen, so changing it never resizes
     * the window surface (which briefly showed a stale frame on some phones).
     */
    public volatile float renderScale = 1f;
    private int rw, rh;
    public long drawNsSec, drawNsMax;
    private int cur;

    public NRender(GLApi gl, Images images, Log log) {
        this.gl = gl;
        this.images = images;
        this.log = log;
    }

    // ---------------------------------------------------------------- messages (any thread)

    public void post(String kind, String data) {
        inbox.add(new String[]{kind, data});
    }

    private void drain() {
        String[] m;
        int frames = 0;
        while ((m = inbox.poll()) != null) {
            try {
                if ("def".equals(m[0])) define(m[1]);
                else if ("forget".equals(m[0])) forget();
                else { frame(m[1]); frames++; }
            } catch (Exception e) {
                log.log("message failed: " + e);
            }
        }
        // More than one game frame waiting means the GPU fell behind.
        if (frames > 1) lateSec += frames - 1;
    }

    /** A new map replaces the whole scene: drop every object (GPU buffers of old ones are simply unused). */
    private void forget() {
        for (Obj o : objs) o.vis = false;
    }

    private static float f(Object o) {
        return o == null ? 0f : ((Double) o).floatValue();
    }

    private static int i(Object o) {
        return o == null ? 0 : ((Double) o).intValue();
    }

    private static final int[] B64 = new int[128];

    static {
        String a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int k = 0; k < a.length(); k++) B64[a.charAt(k)] = k;
    }

    private static int b64Len(String s, int st, int en) {
        int len = en - st, pad = 0;
        if (len > 0 && s.charAt(en - 1) == '=') pad++;
        if (len > 1 && s.charAt(en - 2) == '=') pad++;
        return len / 4 * 3 - pad;
    }

    /** Decodes base64 from s[st, en) straight into dst (reused when the size matches). Little-endian data. */
    private static ByteBuffer b64Into(String s, int st, int en, ByteBuffer dst) {
        int n = b64Len(s, st, en);
        if (dst == null || dst.capacity() != n) dst = ByteBuffer.allocateDirect(n).order(ByteOrder.LITTLE_ENDIAN);
        int o = 0;
        for (int k = st; k + 3 < en; k += 4) {
            int c2 = s.charAt(k + 2), c3 = s.charAt(k + 3);
            int v = (B64[s.charAt(k)] << 18) | (B64[s.charAt(k + 1)] << 12) | (B64[c2 & 127] << 6) | B64[c3 & 127];
            dst.put(o++, (byte) (v >> 16));
            if (c2 != '=' && o < n) dst.put(o++, (byte) (v >> 8));
            if (c3 != '=' && o < n) dst.put(o++, (byte) v);
        }
        return dst;
    }

    private static ByteBuffer b64(String s) {
        return b64Into(s, 0, s.length(), null);
    }

    private static <T> T[] grow(T[] a, int id) {
        if (id < a.length) return a;
        return java.util.Arrays.copyOf(a, Math.max(id + 1, a.length * 2));
    }

    @SuppressWarnings("unchecked")
    private void define(String json) {
        Map<String, Object> d = (Map<String, Object>) Json.parse(json);
        for (Object go : (List<Object>) d.get("g")) {
            Map<String, Object> g = (Map<String, Object>) go;
            Geo geo = new Geo();
            Map<String, Object> attrs = (Map<String, Object>) g.get("attrs");
            List<Attr> list = new ArrayList<>();
            for (Map.Entry<String, Object> e : attrs.entrySet()) {
                Map<String, Object> a = (Map<String, Object>) e.getValue();
                Attr at = new Attr();
                at.name = e.getKey();
                at.n = i(a.get("n"));
                at.bytes = b64((String) a.get("d"));
                list.add(at);
                if (at.name.equals("position")) geo.vertCount = at.bytes.capacity() / 4 / at.n;
                if (at.name.equals("normal")) geo.hasNormal = true;
                if (at.name.equals("uv")) geo.hasUv = true;
                if (at.name.equals("aGlow")) geo.hasGlow = true;
            }
            geo.attrs = list.toArray(new Attr[0]);
            if (g.get("idx") != null) {
                boolean big = i(g.get("it")) == 32;
                geo.idx = b64((String) g.get("idx"));
                geo.idxType = big ? GLC.UNSIGNED_INT : GLC.UNSIGNED_SHORT;
                geo.idxCount = geo.idx.capacity() / (big ? 4 : 2);
            }
            List<Object> bs = (List<Object>) g.get("bs");
            geo.bs = new float[]{f(bs.get(0)), f(bs.get(1)), f(bs.get(2)), f(bs.get(3))};
            List<Object> dr = (List<Object>) g.get("dr");
            geo.drStart = i(dr.get(0));
            geo.drCount = dr.get(1) == null ? -1 : i(dr.get(1));
            int id = i(g.get("id"));
            geos = grow(geos, id);
            geos[id] = geo;
        }
        for (Object to : (List<Object>) d.get("t")) {
            Map<String, Object> t = (Map<String, Object>) to;
            Tex tx = new Tex();
            String url = (String) t.get("url");
            int comma = url.indexOf(',');
            ByteBuffer png = comma > 0 ? b64Into(url, comma + 1, url.length(), null) : ByteBuffer.allocate(0);
            tx.png = new byte[png.capacity()];
            png.position(0);
            png.get(tx.png);
            tx.repS = i(t.get("rs")) == 1;
            tx.repT = i(t.get("rt")) == 1;
            tx.flip = i(t.get("flip")) == 1;
            List<Object> rep = (List<Object>) t.get("rep"), off = (List<Object>) t.get("off");
            tx.uv = new float[]{f(rep.get(0)), 0, 0, 0, f(rep.get(1)), 0, f(off.get(0)), f(off.get(1)), 1};
            texs.put(i(t.get("id")), tx);
        }
        for (Object mo : (List<Object>) d.get("m")) {
            Map<String, Object> m = (Map<String, Object>) mo;
            Mat mt = new Mat();
            String type = (String) m.get("type");
            mt.lit = "lit".equals(type);
            mt.custom = "custom".equals(type);
            mt.sprite = "sprite".equals(type);
            List<Object> st = (List<Object>) m.get("st");
            mt.st = new float[st.size()];
            for (int k = 0; k < st.size(); k++) mt.st[k] = f(st.get(k));
            mt.op = f(m.get("op"));
            mt.tr = i(m.get("tr")) == 1;
            mt.dw = i(m.get("dw")) == 1;
            mt.dt = i(m.get("dt")) == 1;
            mt.fog = i(m.get("fog")) == 1;
            mt.side = i(m.get("side"));
            mt.blend = i(m.get("blend"));
            mt.panel = m.get("panel") == null ? 0 : i(m.get("panel"));
            mt.rough = m.get("rough") == null ? 1 : f(m.get("rough"));
            mt.metal = f(m.get("metal"));
            mt.map = i(m.get("map"));
            mt.em = i(m.get("em"));
            mt.vs = (String) m.get("vs");
            mt.fs = (String) m.get("fs");
            if (m.get("un") != null) {
                List<Object> un = (List<Object>) m.get("un");
                mt.uNames = new String[un.size()];
                mt.uSizes = new int[un.size()];
                for (int k = 0; k < un.size(); k++) {
                    List<Object> p = (List<Object>) un.get(k);
                    mt.uNames[k] = (String) p.get(0);
                    String ty = (String) p.get(1);
                    mt.uSizes[k] = ty.equals("f") ? 1 : ty.equals("v2") ? 2 : ty.equals("c") || ty.equals("v3") ? 3 : ty.equals("v4") ? 4 : 0;
                }
            }
            int id = i(m.get("id"));
            mats = grow(mats, id);
            mats[id] = mt;
        }
        for (Object oo : (List<Object>) d.get("o")) {
            Map<String, Object> o = (Map<String, Object>) oo;
            Obj ob = new Obj();
            ob.id = i(o.get("id"));
            String kind = (String) o.get("kind");
            ob.kind = "sprite".equals(kind) ? 2 : "lines".equals(kind) ? 1 : 0;
            ob.g = i(o.get("g"));
            ob.m = i(o.get("m"));
            ob.ro = i(o.get("ro"));
            ob.fc = i(o.get("fc")) == 1;
            ob.inst = i(o.get("inst"));
            if (o.get("im") != null) ob.im = b64((String) o.get("im"));
            if (o.get("ic") != null) ob.ic = b64((String) o.get("ic"));
            if (o.get("bs") != null) {
                List<Object> bs = (List<Object>) o.get("bs");
                ob.bs = new float[]{f(bs.get(0)), f(bs.get(1)), f(bs.get(2)), f(bs.get(3))};
            } else if (ob.g < geos.length && geos[ob.g] != null) ob.bs = geos[ob.g].bs;
            byId = grow(byId, ob.id);
            if (byId[ob.id] == null) objs.add(ob);
            else objs.set(objs.indexOf(byId[ob.id]), ob);
            byId[ob.id] = ob;
        }
        if (objs.size() > opaque.length) opaque = new Obj[objs.size()];
        if (objs.size() > transparent.length) transparent = new Obj[objs.size()];
    }

    // ---------------------------------------------------------------- frame parsing (no allocation)

    /** Reads the number at cur in s (up to en) and steps over the following separator. */
    private float num(String s, int en) {
        int k = cur;
        boolean neg = false;
        char c = s.charAt(k);
        if (c == '-') { neg = true; k++; }
        long ip = 0;
        while (k < en && (c = s.charAt(k)) >= '0' && c <= '9') { ip = ip * 10 + (c - '0'); k++; }
        double v = ip;
        if (k < en && s.charAt(k) == '.') {
            k++;
            long fr = 0, div = 1;
            while (k < en && (c = s.charAt(k)) >= '0' && c <= '9') { if (div < 1000000000000L) { fr = fr * 10 + (c - '0'); div *= 10; } k++; }
            v += (double) fr / div;
        }
        if (k < en && ((c = s.charAt(k)) == 'e' || c == 'E')) {
            k++;
            boolean en2 = false;
            if (s.charAt(k) == '-') { en2 = true; k++; } else if (s.charAt(k) == '+') k++;
            int e = 0;
            while (k < en && (c = s.charAt(k)) >= '0' && c <= '9') { e = e * 10 + (c - '0'); k++; }
            v *= Math.pow(10, en2 ? -e : e);
        }
        while (k < en && s.charAt(k) != ',') k++;
        if (k < en) k++;
        cur = k;
        return (float) (neg ? -v : v);
    }

    private void frame(String s) {
        int n = s.length(), at = 0;
        while (at < n) {
            int eol = s.indexOf('\n', at);
            if (eol < 0) eol = n;
            if (eol - at > 2) {
                char k = s.charAt(at);
                cur = at + 2;
                if (k == 'h') { int j = 0; while (cur < eol && j < env.length) env[j++] = num(s, eol); }
                else if (k == 'c') {
                    int j = 0;
                    while (cur < eol && j < camIn.length) camIn[j++] = num(s, eol);
                    System.arraycopy(camIn, 0, view, 0, 16);
                    System.arraycopy(camIn, 16, proj, 0, 16);
                    System.arraycopy(camIn, 32, cam, 0, 3);
                } else if (k == 'o') objects(s, eol);
                else if (k == 'u') materials(s, eol);
                else if (k == 'a') buffers(s, at + 2, eol);
            }
            at = eol + 1;
        }
        framed = true;
    }

    private void objects(String s, int en) {
        while (cur < en) {
            int id = (int) num(s, en);
            boolean vis = num(s, en) == 1;
            Obj o = id < byId.length ? byId[id] : null;
            if (o != null) o.vis = vis;
            if (!vis) continue;
            for (int j = 0; j < 10; j++) trs[j] = num(s, en);
            if (o != null) compose(o.mw, trs);
        }
    }

    /** Translation, quaternion and scale to a column-major matrix (same as three.js Matrix4.compose). */
    private static void compose(float[] m, float[] t) {
        float x = t[3], y = t[4], z = t[5], w = t[6], sx = t[7], sy = t[8], sz = t[9];
        float x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
        float wx = w * x2, wy = w * y2, wz = w * z2;
        m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
        m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
        m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
        m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    }

    private void materials(String s, int en) {
        while (cur < en) {
            int id = (int) num(s, en), n = (int) num(s, en);
            Mat m = id < mats.length ? mats[id] : null;
            if (m != null && m.st.length != n) m.st = new float[n];
            for (int j = 0; j < n; j++) {
                float v = num(s, en);
                if (m != null) m.st[j] = v;
            }
        }
    }

    // Entries "g,id,name,b64" (geometry attribute), "o,id,im,b64" (instance matrices), "r,id,start,count".
    private void buffers(String s, int st, int en) {
        int k = st;
        while (k < en) {
            int end = s.indexOf(';', k);
            if (end < 0 || end > en) end = en;
            char type = s.charAt(k);
            int c1 = s.indexOf(',', k + 2);
            cur = k + 2;
            int id = (int) num(s, c1 + 1);
            if (type == 'r') {
                Geo g = id < geos.length ? geos[id] : null;
                int a = (int) num(s, end), c = (int) num(s, end);
                if (g != null) { g.drStart = a; g.drCount = c; }
            } else {
                int nameSt = c1 + 1, nameEnd = s.indexOf(',', nameSt), ds = nameEnd + 1;
                if (type == 'o') {
                    Obj o = id < byId.length ? byId[id] : null;
                    if (o != null) { o.im = b64Into(s, ds, end, o.im); o.imDirty = true; }
                } else {
                    Geo g = id < geos.length ? geos[id] : null;
                    if (g != null) {
                        for (Attr a : g.attrs) {
                            if (a.name.length() == nameEnd - nameSt && s.regionMatches(nameSt, a.name, 0, a.name.length())) {
                                a.bytes = b64Into(s, ds, end, a.bytes);
                                a.dirty = true;
                            }
                        }
                    }
                }
            }
            k = end + 1;
        }
    }

    // ---------------------------------------------------------------- GL thread

    /** New GL context (first start or after a loss): forget handles, everything is rebuilt lazily. */
    public void contextCreated() {
        for (Geo g : geos) {
            if (g == null) continue;
            g.ibo = 0;
            for (Attr a : g.attrs) { a.vbo = 0; a.dirty = true; }
        }
        for (Obj o : objs) { o.vao = 0; o.imVbo = 0; o.icVbo = 0; o.imDirty = true; o.vaoProg = null; }
        for (Tex t : texs.values()) t.gl = 0;
        for (Mat m : mats) if (m != null) m.prog = null;
        customCache.clear();
        lit = basic = sprite = bright = blur = comp = null;
        quadVbo = quadVao = spriteVbo = 0;
        sceneFbo = 0;
        fboW = fboH = 0;
        failed = false;
        renderer = gl.getString(GLC.RENDERER) + " | " + gl.getString(GLC.VERSION);
        log.log("GL " + renderer);
    }

    public void resize(int width, int height) {
        w = width;
        h = height;
    }

    public void draw() {
        long t0 = System.nanoTime();
        drain();
        if (!framed || w == 0) {
            gl.bindFramebuffer(GLC.FRAMEBUFFER, 0);
            gl.clearColor(0.02f, 0.03f, 0.05f, 1);
            gl.clear(GLC.COLOR_BUFFER_BIT | GLC.DEPTH_BUFFER_BIT);
            return;
        }
        try {
            if (lit == null) buildPrograms();
            // The scene always goes through the offscreen buffer (dynamic resolution, glow, sharpening, edge AA).
            boolean bloom = env[19] > 0.5f && !failed, postOn = !failed;
            float rs = Math.max(0.5f, Math.min(1f, renderScale));
            rw = postOn ? Math.max(16, Math.round(w * rs)) : w;
            rh = postOn ? Math.max(16, Math.round(h * rs)) : h;
            if (postOn) ensureFbos();
            gl.bindFramebuffer(GLC.FRAMEBUFFER, postOn ? sceneFbo : 0);
            gl.viewport(0, 0, rw, rh);
            gl.clearColor(out(env[0]), out(env[1]), out(env[2]), 1);
            gl.depthMask(true);
            gl.clear(GLC.COLOR_BUFFER_BIT | GLC.DEPTH_BUFFER_BIT);
            mul(vp, proj, view);
            frustum();
            collect();
            draws = 0;
            for (int k = 0; k < nOpaque; k++) drawObj(opaque[k]);
            for (int k = 0; k < nTransparent; k++) drawObj(transparent[k]);
            gl.bindVertexArray(0);
            if (postOn) post(bloom);
        } catch (Exception e) {
            if (!failed) log.log("draw failed: " + e);
            failed = true;
        }
        long dt = System.nanoTime() - t0;
        framesSec++;
        drawNsSec += dt;
        if (dt > drawNsMax) drawNsMax = dt;
    }

    // ---------------------------------------------------------------- scene

    private void frustum() {
        float[] m = vp;
        float[][] p = planes;
        set(p[0], m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
        set(p[1], m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
        set(p[2], m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
        set(p[3], m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
        set(p[4], m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
        set(p[5], m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    }

    private static void set(float[] p, float a, float b, float c, float d) {
        float l = (float) Math.sqrt(a * a + b * b + c * c);
        p[0] = a / l; p[1] = b / l; p[2] = c / l; p[3] = d / l;
    }

    private void collect() {
        nOpaque = nTransparent = 0;
        for (int k = 0, n = objs.size(); k < n; k++) {
            Obj o = objs.get(k);
            if (!o.vis) continue;
            Mat m = o.m < mats.length ? mats[o.m] : null;
            if (m == null || (m.st.length > 8 && m.st[8] == 0)) continue;
            if (o.kind != 2 && (o.g >= geos.length || geos[o.g] == null)) continue;
            float[] mw = o.mw;
            float cx = mw[12], cy = mw[13], cz = mw[14];
            if (o.bs != null && o.kind != 2) {
                float x = o.bs[0], y = o.bs[1], z = o.bs[2];
                cx = mw[0] * x + mw[4] * y + mw[8] * z + mw[12];
                cy = mw[1] * x + mw[5] * y + mw[9] * z + mw[13];
                cz = mw[2] * x + mw[6] * y + mw[10] * z + mw[14];
                if (o.fc) {
                    float s = Math.max(len(mw[0], mw[1], mw[2]), Math.max(len(mw[4], mw[5], mw[6]), len(mw[8], mw[9], mw[10])));
                    float r = o.bs[3] * s;
                    boolean in = true;
                    for (int j = 0; j < 6; j++) {
                        float[] p = planes[j];
                        if (p[0] * cx + p[1] * cy + p[2] * cz + p[3] < -r) { in = false; break; }
                    }
                    if (!in) continue;
                }
            }
            o.dist = (cx - cam[0]) * (cx - cam[0]) + (cy - cam[1]) * (cy - cam[1]) + (cz - cam[2]) * (cz - cam[2]);
            if (m.tr) transparent[nTransparent++] = o;
            else opaque[nOpaque++] = o;
        }
        // Insertion sort: the order barely changes between frames, so this is close to linear and allocation-free.
        for (int a = 1; a < nOpaque; a++) {
            Obj o = opaque[a];
            int b = a - 1;
            while (b >= 0 && (opaque[b].ro > o.ro || (opaque[b].ro == o.ro && opaque[b].dist > o.dist))) { opaque[b + 1] = opaque[b]; b--; }
            opaque[b + 1] = o;
        }
        for (int a = 1; a < nTransparent; a++) {
            Obj o = transparent[a];
            int b = a - 1;
            while (b >= 0 && (transparent[b].ro > o.ro || (transparent[b].ro == o.ro && transparent[b].dist < o.dist))) { transparent[b + 1] = transparent[b]; b--; }
            transparent[b + 1] = o;
        }
    }

    private static float len(float x, float y, float z) {
        return (float) Math.sqrt(x * x + y * y + z * z);
    }

    private void upload(Geo g) {
        for (Attr a : g.attrs) {
            if (a.vbo == 0) a.vbo = gl.genBuffer();
            if (a.dirty) {
                gl.bindBuffer(GLC.ARRAY_BUFFER, a.vbo);
                a.bytes.position(0);
                gl.bufferData(GLC.ARRAY_BUFFER, a.bytes.capacity(), a.bytes, GLC.DYNAMIC_DRAW);
                a.dirty = false;
            }
        }
        if (g.idx != null && g.ibo == 0) {
            g.ibo = gl.genBuffer();
            gl.bindVertexArray(0);
            gl.bindBuffer(GLC.ELEMENT_ARRAY_BUFFER, g.ibo);
            g.idx.position(0);
            gl.bufferData(GLC.ELEMENT_ARRAY_BUFFER, g.idx.capacity(), g.idx, GLC.STATIC_DRAW);
        }
    }

    private static final String[] STD = {"position", "normal", "uv", "aGlow", "instanceColor"};

    private int attrLoc(Prog p, String name) {
        if (!p.custom) {
            for (int k = 0; k < STD.length; k++) if (STD[k].equals(name)) return k;
            return -1;
        }
        return gl.getAttribLocation(p.id, name);
    }

    private void buildVao(Obj o, Geo g, Prog p) {
        if (o.vao == 0) o.vao = gl.genVertexArray();
        gl.bindVertexArray(o.vao);
        for (int k = 0; k < 9; k++) gl.disableVertexAttribArray(k);
        if (g != null) {
            for (Attr a : g.attrs) {
                int loc = attrLoc(p, a.name);
                if (loc < 0) continue;
                gl.bindBuffer(GLC.ARRAY_BUFFER, a.vbo);
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, a.n, GLC.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(loc, 0);
            }
            if (g.ibo != 0) gl.bindBuffer(GLC.ELEMENT_ARRAY_BUFFER, g.ibo);
        } else {
            gl.bindBuffer(GLC.ARRAY_BUFFER, spriteVbo);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, GLC.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 2, GLC.FLOAT, false, 20, 12);
        }
        if (o.inst > 0 && !p.custom) {
            gl.bindBuffer(GLC.ARRAY_BUFFER, o.imVbo);
            for (int k = 0; k < 4; k++) {
                gl.enableVertexAttribArray(5 + k);
                gl.vertexAttribPointer(5 + k, 4, GLC.FLOAT, false, 64, k * 16);
                gl.vertexAttribDivisor(5 + k, 1);
            }
            if (o.ic != null) {
                gl.bindBuffer(GLC.ARRAY_BUFFER, o.icVbo);
                gl.enableVertexAttribArray(4);
                gl.vertexAttribPointer(4, 3, GLC.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(4, 1);
            }
        }
        o.vaoProg = p;
    }

    private void drawObj(Obj o) {
        Mat m = mats[o.m];
        Geo g = o.kind == 2 ? null : geos[o.g];
        Prog p = progFor(m, o);
        if (p == null || p.id == 0) return;
        if (g != null) upload(g);
        if (o.inst > 0) {
            if (o.imVbo == 0) { o.imVbo = gl.genBuffer(); o.imDirty = true; }
            if (o.imDirty) {
                gl.bindBuffer(GLC.ARRAY_BUFFER, o.imVbo);
                o.im.position(0);
                gl.bufferData(GLC.ARRAY_BUFFER, o.im.capacity(), o.im, GLC.DYNAMIC_DRAW);
                o.imDirty = false;
            }
            if (o.ic != null && o.icVbo == 0) {
                o.icVbo = gl.genBuffer();
                gl.bindBuffer(GLC.ARRAY_BUFFER, o.icVbo);
                o.ic.position(0);
                gl.bufferData(GLC.ARRAY_BUFFER, o.ic.capacity(), o.ic, GLC.STATIC_DRAW);
            }
        }
        if (o.vao == 0 || o.vaoProg != p) buildVao(o, g, p);
        gl.bindVertexArray(o.vao);
        gl.useProgram(p.id);
        if (!p.custom) {
            if (g == null || !g.hasNormal) gl.vertexAttrib4f(1, 0, 1, 0, 0);
            if (g == null || !g.hasUv) gl.vertexAttrib4f(2, 0, 0, 0, 0);
            if (g == null || !g.hasGlow) gl.vertexAttrib4f(3, 0, 0, 0, 0);
            if (o.ic == null) gl.vertexAttrib4f(4, 1, 1, 1, 1);
        }
        setUniforms(p, m, o);
        if (m.dt) gl.enable(GLC.DEPTH_TEST); else gl.disable(GLC.DEPTH_TEST);
        gl.depthFunc(GLC.LEQUAL);
        gl.depthMask(m.dw);
        if (m.tr) {
            gl.enable(GLC.BLEND);
            gl.blendFunc(GLC.SRC_ALPHA, m.blend == 1 ? GLC.ONE : GLC.ONE_MINUS_SRC_ALPHA);
        } else gl.disable(GLC.BLEND);
        if (m.side == 2 || o.kind == 2) gl.disable(GLC.CULL_FACE);
        else {
            gl.enable(GLC.CULL_FACE);
            gl.cullFace(m.side == 1 ? GLC.FRONT : GLC.BACK);
        }
        draws++;
        if (o.kind == 2) { gl.drawArrays(GLC.TRIANGLES, 0, 6); return; }
        int mode = o.kind == 1 ? GLC.LINES : GLC.TRIANGLES;
        int total = g.ibo != 0 ? g.idxCount : g.vertCount;
        int start = Math.max(0, g.drStart), count = g.drCount < 0 ? total - start : Math.min(g.drCount, total - start);
        if (count <= 0) return;
        if (g.ibo != 0) {
            int bytes = g.idxType == GLC.UNSIGNED_INT ? 4 : 2;
            if (o.inst > 0) gl.drawElementsInstanced(mode, count, g.idxType, start * bytes, o.inst);
            else gl.drawElements(mode, count, g.idxType, start * bytes);
        } else {
            if (o.inst > 0) gl.drawArraysInstanced(mode, start, count, o.inst);
            else gl.drawArrays(mode, start, count);
        }
    }

    private void u(Prog p, String name, float v) {
        Integer l = p.u.get(name);
        if (l != null) gl.uniform1f(l, v);
    }

    private void u3(Prog p, String name, float x, float y, float z) {
        Integer l = p.u.get(name);
        if (l != null) gl.uniform3f(l, x, y, z);
    }

    private void ui(Prog p, String name, int v) {
        Integer l = p.u.get(name);
        if (l != null) gl.uniform1i(l, v);
    }

    private void um(Prog p, String name, float[] m) {
        Integer l = p.u.get(name);
        if (l != null) gl.uniformMatrix4fv(l, m);
    }

    private void setUniforms(Prog p, Mat m, Obj o) {
        um(p, "uModel", o.mw);
        um(p, "uView", view);
        um(p, "uProj", proj);
        u3(p, "cameraPosition", cam[0], cam[1], cam[2]);
        u3(p, "uFogColor", env[0], env[1], env[2]);
        u(p, "uFogDensity", env[3]);
        u(p, "smuExposure", env[18]);
        if (p.custom) {
            um(p, "modelMatrix", o.mw);
            um(p, "viewMatrix", view);
            um(p, "projectionMatrix", proj);
            mul(tmp, view, o.mw);
            um(p, "modelViewMatrix", tmp);
            u3(p, "fogColor", env[0], env[1], env[2]);
            u(p, "fogDensity", env[3]);
            int k = 9;
            for (int j = 0; j < m.uNames.length; j++) {
                int n = m.uSizes[j];
                // Fog comes from the live scene (set above); the material's copies are never refreshed in JS.
                Integer l = m.uNames[j].startsWith("fog") ? null : p.u.get(m.uNames[j]);
                if (l != null && k + n <= m.st.length) {
                    if (n == 1) gl.uniform1f(l, m.st[k]);
                    else if (n == 2) gl.uniform2f(l, m.st[k], m.st[k + 1]);
                    else if (n == 3) gl.uniform3f(l, m.st[k], m.st[k + 1], m.st[k + 2]);
                    else if (n == 4) gl.uniform4f(l, m.st[k], m.st[k + 1], m.st[k + 2], m.st[k + 3]);
                }
                k += n;
            }
            return;
        }
        float[] s = m.st;
        u3(p, "uColor", s[0], s[1], s[2]);
        float ei = s.length > 6 ? s[6] : 1;
        u3(p, "uEmissive", s[3] * ei, s[4] * ei, s[5] * ei);
        u(p, "uOpacity", s.length > 7 ? s[7] : m.op);
        ui(p, "uInst", o.inst > 0 ? 1 : 0);
        ui(p, "uFog", m.fog ? 1 : 0);
        u(p, "uRough", m.rough);
        u(p, "uMetal", m.metal);
        ui(p, "uPanel", m.panel);
        u3(p, "uHemiSky", env[4], env[5], env[6]);
        u3(p, "uHemiGround", env[7], env[8], env[9]);
        u(p, "uHemiI", env[10]);
        u3(p, "uMoonColor", env[11], env[12], env[13]);
        u(p, "uMoonI", env[14]);
        u3(p, "uMoonDir", env[15], env[16], env[17]);
        // Lit materials: an albedo map (2) or an emissive map (1). Basic and sprites: the colour map (1).
        boolean albedo = m.lit && m.map != 0;
        int texId = m.lit ? (albedo ? m.map : m.em) : m.map;
        Tex t = texId != 0 ? texs.get(texId) : null;
        ui(p, "uHasTex", t == null ? 0 : albedo ? 2 : 1);
        Integer l = p.u.get("uUv");
        if (t != null) {
            if (t.gl == 0) uploadTex(t);
            gl.activeTexture(GLC.TEXTURE0);
            gl.bindTexture(GLC.TEXTURE_2D, t.gl);
            ui(p, "uTex", 0);
            if (l != null) gl.uniformMatrix3fv(l, t.uv);
        } else if (l != null) gl.uniformMatrix3fv(l, IDENT3);
    }

    private void uploadTex(Tex t) {
        int[] wh = new int[2];
        int[] px = images.decode(t.png, wh);
        int tw = wh[0], th = wh[1];
        ByteBuffer b = ByteBuffer.allocateDirect(tw * th * 4).order(ByteOrder.nativeOrder());
        for (int y = 0; y < th; y++) {
            int sy = t.flip ? th - 1 - y : y;
            for (int x = 0; x < tw; x++) {
                int c = px[sy * tw + x];
                b.put((byte) (c >> 16)).put((byte) (c >> 8)).put((byte) c).put((byte) (c >>> 24));
            }
        }
        b.position(0);
        t.gl = gl.genTexture();
        gl.bindTexture(GLC.TEXTURE_2D, t.gl);
        gl.texImage2D(GLC.TEXTURE_2D, 0, GLC.RGBA8, tw, th, GLC.RGBA, GLC.UNSIGNED_BYTE, b);
        gl.generateMipmap(GLC.TEXTURE_2D);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MIN_FILTER, GLC.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MAG_FILTER, GLC.LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_S, t.repS ? GLC.REPEAT : GLC.CLAMP_TO_EDGE);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_T, t.repT ? GLC.REPEAT : GLC.CLAMP_TO_EDGE);
    }

    // ---------------------------------------------------------------- shaders

    private Prog progFor(Mat m, Obj o) {
        if (m == null) return null;
        if (m.custom) {
            if (m.prog == null) m.prog = custom(m);
            return m.prog;
        }
        if (o.kind == 2 || m.sprite) return sprite;
        return m.lit ? lit : basic;
    }

    private static final String COMMON = "#version 300 es\nprecision highp float;\nprecision highp int;\n";

    // three.js ACESFilmicToneMapping and sRGB output, so colours match the WebGL version.
    private static final String TONE = ""
            + "uniform float smuExposure;\n"
            + "vec3 smuRRT(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }\n"
            + "vec3 smuTone(vec3 c){ const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));\n"
            + "  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));\n"
            + "  c *= smuExposure / 0.6; c = I * c; c = smuRRT(c); c = O * c; return clamp(c, 0.0, 1.0); }\n"
            + "vec3 smuSRGB(vec3 c){ c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c)); }\n"
            + "vec3 smuLin(vec3 c){ return pow(c, vec3(2.2)); }\n";

    private static final String STD_VS = COMMON
            + "layout(location=0) in vec3 position; layout(location=1) in vec3 normal; layout(location=2) in vec2 uv;\n"
            + "layout(location=3) in vec3 aGlow; layout(location=4) in vec3 instanceColor;\n"
            + "layout(location=5) in vec4 im0; layout(location=6) in vec4 im1; layout(location=7) in vec4 im2; layout(location=8) in vec4 im3;\n"
            + "uniform mat4 uModel, uView, uProj; uniform mat3 uUv; uniform int uInst;\n"
            + "out vec3 vW; out vec3 vN; out vec3 vGlow; out vec3 vIC; out vec2 vUv; out float vDepth;\n"
            + "void main(){ mat4 m = uInst == 1 ? uModel * mat4(im0, im1, im2, im3) : uModel;\n"
            + "  vec4 w = m * vec4(position, 1.0); vW = w.xyz;\n"
            // Scale-correct normals without a per-vertex matrix inverse (cheaper on phone GPUs).
            + "  mat3 r = mat3(m); vec3 s2 = vec3(dot(r[0], r[0]), dot(r[1], r[1]), dot(r[2], r[2]));\n"
            + "  vN = r * (normal / max(s2, vec3(1e-8)));\n"
            + "  vGlow = aGlow; vIC = instanceColor; vUv = (uUv * vec3(uv, 1.0)).xy;\n"
            + "  vec4 mv = uView * w; vDepth = -mv.z; gl_Position = uProj * mv; }\n";

    private static final String FOG = ""
            + "uniform vec3 uFogColor; uniform float uFogDensity; uniform int uFog; in float vDepth;\n"
            + "vec3 smuFog(vec3 c){ if (uFog == 0) return c; float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth); return mix(c, uFogColor, f); }\n";

    /** Procedural surface detail; a copy of assets/js/pattern.js (1 metal panels, 2 stone, 3 wood). */
    static final String PATTERN = ""
            + "float smuHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n"
            + "float smuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n"
            + "  return mix(mix(smuHash(i), smuHash(i + vec2(1.0, 0.0)), f.x), mix(smuHash(i + vec2(0.0, 1.0)), smuHash(i + vec2(1.0, 1.0)), f.x), f.y); }\n"
            + "float smuPattern(int pat, vec3 w, vec3 n){\n"
            + "  vec3 an = abs(n);\n"
            + "  vec2 uv = an.y > 0.6 ? w.xz : (an.x > an.z ? w.zy : w.xy);\n"
            + "  if (pat == 1) {\n"
            + "    vec2 g = uv * 0.5, d = abs(fract(g - 0.5) - 0.5);\n"
            + "    vec2 ln = 1.0 - smoothstep(vec2(0.0), fwidth(g) * 1.5 + 0.012, d);\n"
            + "    return (0.84 + 0.24 * smuHash(floor(g))) * (1.0 - 0.5 * max(ln.x, ln.y)) * (0.9 + 0.2 * smuNoise(uv * 3.0));\n"
            + "  }\n"
            + "  if (pat == 2) {\n"
            + "    vec2 g = uv * vec2(0.8, 1.5); g.x += floor(g.y) * 0.5;\n"
            + "    vec2 d = abs(fract(g) - 0.5), fw = fwidth(g) * 1.5;\n"
            + "    float m = max(smoothstep(0.46 - fw.x, 0.46, d.x), smoothstep(0.44 - fw.y, 0.44, d.y));\n"
            + "    float nz = smuNoise(uv * 3.0) * 0.6 + smuNoise(uv * 9.0) * 0.4;\n"
            + "    return (0.82 + 0.22 * smuHash(floor(g))) * (0.82 + 0.3 * nz) * (1.0 - 0.45 * m);\n"
            + "  }\n"
            + "  if (pat == 3) {\n"
            + "    vec2 g = vec2(uv.x * 0.7, uv.y * 3.0);\n"
            + "    float pl = floor(g.y), pn = smuHash(vec2(pl, 7.0));\n"
            + "    float grain = smuNoise(vec2(g.x * 3.0 + pn * 17.0, fract(g.y) * 6.0)) * 0.5 + smuNoise(vec2(g.x * 14.0, g.y * 2.0 + pn)) * 0.5;\n"
            + "    float gap = smoothstep(0.43, 0.5, abs(fract(g.y) - 0.5));\n"
            + "    return (0.72 + 0.36 * pn) * (0.78 + 0.4 * grain) * (1.0 - 0.6 * gap);\n"
            + "  }\n"
            + "  return 1.0;\n"
            + "}\n"
;

    private static final String LIT_FS = COMMON + TONE + FOG + PATTERN
            + "in vec3 vW; in vec3 vN; in vec3 vGlow; in vec3 vIC; in vec2 vUv; out vec4 outColor;\n"
            + "uniform vec3 uColor, uEmissive, cameraPosition, uHemiSky, uHemiGround, uMoonColor, uMoonDir;\n"
            + "uniform float uOpacity, uRough, uMetal, uHemiI, uMoonI; uniform int uPanel, uHasTex; uniform sampler2D uTex;\n"
            + "vec3 Fs(vec3 f0, float vh){ float fr = exp2((-5.55473 * vh - 6.98316) * vh); return f0 * (1.0 - fr) + fr; }\n"
            + "float Vg(float a, float nl, float nv){ float a2 = a * a; float gv = nl * sqrt(a2 + (1.0 - a2) * nv * nv); float gl = nv * sqrt(a2 + (1.0 - a2) * nl * nl); return 0.5 / max(gv + gl, 1e-6); }\n"
            + "float Dg(float a, float nh){ float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return 0.3183099 * a2 / (d * d); }\n"
            + "void main(){\n"
            + "  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;\n"
            + "  vec3 base = uColor * vIC;\n"
            + "  if (uPanel > 0) base *= smuPattern(uPanel, vW, n);\n"
            + "  if (uHasTex == 2) base *= smuLin(texture(uTex, vUv).rgb);\n"
            + "  vec3 v = normalize(cameraPosition - vW);\n"
            + "  float r = clamp(max(uRough, 0.0525), 0.0, 1.0), a = r * r;\n"
            + "  vec3 diff = base * (1.0 - uMetal), f0 = mix(vec3(0.04), base, uMetal);\n"
            + "  vec3 col = mix(uHemiGround, uHemiSky, 0.5 * n.y + 0.5) * uHemiI * diff * 0.3183099;\n"
            + "  float nl = dot(n, uMoonDir);\n"
            + "  if (nl > 0.0) { vec3 h = normalize(uMoonDir + v); float nv = max(dot(n, v), 1e-4);\n"
            + "    col += uMoonColor * uMoonI * nl * (diff * 0.3183099 + Fs(f0, max(dot(v, h), 0.0)) * Vg(a, nl, nv) * Dg(a, max(dot(n, h), 0.0))); }\n"
            + "  vec3 em = uEmissive; if (uHasTex == 1) em *= smuLin(texture(uTex, vUv).rgb);\n"
            + "  col += em + vGlow;\n"
            + "  col = smuFog(col);\n"
            + "  outColor = vec4(smuSRGB(smuTone(min(col, vec3(40.0)))), uOpacity);\n"
            + "}\n";

    private static final String BASIC_FS = COMMON + TONE + FOG
            + "in vec3 vW; in vec3 vN; in vec3 vGlow; in vec3 vIC; in vec2 vUv; out vec4 outColor;\n"
            + "uniform vec3 uColor; uniform float uOpacity; uniform int uHasTex; uniform sampler2D uTex;\n"
            + "void main(){ vec4 c = vec4(uColor * vIC, uOpacity);\n"
            + "  if (uHasTex == 1) { vec4 t = texture(uTex, vUv); c *= vec4(smuLin(t.rgb), t.a); }\n"
            + "  outColor = vec4(smuSRGB(smuTone(min(smuFog(c.rgb), vec3(40.0)))), c.a); }\n";

    private static final String SPRITE_VS = COMMON
            + "layout(location=0) in vec3 position; layout(location=2) in vec2 uv;\n"
            + "uniform mat4 uModel, uView, uProj; out vec2 vUv; out float vDepth;\n"
            + "void main(){ vec4 c = uView * vec4(uModel[3].xyz, 1.0);\n"
            + "  c.xy += position.xy * vec2(length(uModel[0].xyz), length(uModel[1].xyz));\n"
            + "  vUv = uv; vDepth = -c.z; gl_Position = uProj * c; }\n";

    private static final String SPRITE_FS = COMMON + TONE + FOG
            + "in vec2 vUv; out vec4 outColor; uniform vec3 uColor; uniform float uOpacity; uniform int uHasTex; uniform sampler2D uTex;\n"
            + "void main(){ vec4 t = uHasTex == 1 ? texture(uTex, vUv) : vec4(1.0); vec3 c = smuLin(t.rgb) * uColor;\n"
            + "  if (t.a * uOpacity < 0.01) discard;\n"
            + "  outColor = vec4(smuSRGB(smuTone(smuFog(c))), t.a * uOpacity); }\n";

    private static final String POST_VS = COMMON
            + "layout(location=0) in vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }\n";

    private static final String BRIGHT_FS = COMMON
            + "in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uThr; uniform vec2 uUvScale;\n"
            + "void main(){ vec3 c = texture(uSrc, vUv * uUvScale).rgb; float l = max(c.r, max(c.g, c.b));\n"
            + "  o = vec4(c * smoothstep(uThr, uThr + 0.2, l), 1.0); }\n";

    private static final String BLUR_FS = COMMON
            + "in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uDir;\n"
            + "void main(){ vec3 c = texture(uSrc, vUv).rgb * 0.227027;\n"
            + "  c += (texture(uSrc, vUv + uDir * 1.3846).rgb + texture(uSrc, vUv - uDir * 1.3846).rgb) * 0.316216;\n"
            + "  c += (texture(uSrc, vUv + uDir * 3.2308).rgb + texture(uSrc, vUv - uDir * 3.2308).rgb) * 0.070270;\n"
            + "  o = vec4(c, 1.0); }\n";

    // Final pass: optional edge anti-aliasing (luma-guided blur along edges), optional sharpening
    // (unsharp mask against the 4 neighbours), then the glow on top.
    private static final String COMP_FS = COMMON
            + "in vec2 vUv; out vec4 o; uniform sampler2D uScene, uB1, uB2; uniform float uStr, uSharp, uAA; uniform vec2 uTexel, uUvScale;\n"
            // The scene fills the lower-left uUvScale part of its texture; never read outside that part.
            + "vec3 S(vec2 p){ return texture(uScene, min(p, uUvScale - uTexel * 0.5)).rgb; }\n"
            + "float Lu(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }\n"
            + "vec3 edgeAA(vec2 uv){\n"
            + "  vec3 m = S(uv); float lm = Lu(m);\n"
            + "  float a = Lu(S(uv + vec2(-1.0, -1.0) * uTexel)), b = Lu(S(uv + vec2(1.0, -1.0) * uTexel));\n"
            + "  float c = Lu(S(uv + vec2(-1.0, 1.0) * uTexel)), d = Lu(S(uv + vec2(1.0, 1.0) * uTexel));\n"
            + "  float lo = min(lm, min(min(a, b), min(c, d))), hi = max(lm, max(max(a, b), max(c, d)));\n"
            + "  if (hi - lo < max(0.04, hi * 0.12)) return m;\n"
            + "  vec2 dir = vec2(-((a + b) - (c + d)), (a + c) - (b + d));\n"
            + "  float k = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((a + b + c + d) * 0.03125, 0.0078));\n"
            + "  dir = clamp(dir * k, vec2(-6.0), vec2(6.0)) * uTexel;\n"
            + "  vec3 n1 = 0.5 * (S(uv - dir * 0.1667) + S(uv + dir * 0.1667));\n"
            + "  vec3 n2 = 0.5 * n1 + 0.25 * (S(uv - dir * 0.5) + S(uv + dir * 0.5));\n"
            + "  float l2 = Lu(n2);\n"
            + "  return (l2 < lo || l2 > hi) ? n1 : n2; }\n"
            + "void main(){\n"
            + "  vec2 uv = vUv * uUvScale;\n"
            + "  vec3 c = uAA > 0.5 ? edgeAA(uv) : S(uv);\n"
            + "  if (uSharp > 0.01) {\n"
            + "    vec3 nb = (S(uv + vec2(uTexel.x, 0.0)) + S(uv - vec2(uTexel.x, 0.0)) + S(uv + vec2(0.0, uTexel.y)) + S(uv - vec2(0.0, uTexel.y))) * 0.25;\n"
            + "    c = max(c + (c - nb) * uSharp * 1.6, vec3(0.0)); }\n"
            + "  c += (texture(uB1, vUv).rgb * 0.45 + texture(uB2, vUv).rgb * 0.65) * uStr;\n"
            + "  o = vec4(min(c, vec3(1.0)), 1.0); }\n";

    private int shader(int type, String src, String what) {
        int s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (gl.getShaderi(s, GLC.COMPILE_STATUS) == 0) {
            log.log("shader " + what + " failed: " + gl.getShaderInfoLog(s));
            return 0;
        }
        return s;
    }

    private Prog program(String vs, String fs, String what, boolean custom, String... uniforms) {
        Prog p = new Prog();
        p.custom = custom;
        int v = shader(GLC.VERTEX_SHADER, vs, what + ".vs"), f = shader(GLC.FRAGMENT_SHADER, fs, what + ".fs");
        if (v == 0 || f == 0) return p;
        int id = gl.createProgram();
        gl.attachShader(id, v);
        gl.attachShader(id, f);
        gl.linkProgram(id);
        if (gl.getProgrami(id, GLC.LINK_STATUS) == 0) {
            log.log("program " + what + " failed: " + gl.getProgramInfoLog(id));
            return p;
        }
        p.id = id;
        for (String u : uniforms) {
            int l = gl.getUniformLocation(id, u);
            if (l >= 0) p.u.put(u, l);
        }
        return p;
    }

    private static final String[] STD_U = {"uModel", "uView", "uProj", "uUv", "uInst", "uColor", "uEmissive", "uOpacity", "uRough", "uMetal",
            "uPanel", "uHasTex", "uTex", "cameraPosition", "uHemiSky", "uHemiGround", "uHemiI", "uMoonColor", "uMoonI", "uMoonDir",
            "uFogColor", "uFogDensity", "uFog", "smuExposure"};

    private void buildPrograms() {
        lit = program(STD_VS, LIT_FS, "lit", false, STD_U);
        basic = program(STD_VS, BASIC_FS, "basic", false, STD_U);
        sprite = program(SPRITE_VS, SPRITE_FS, "sprite", false, STD_U);
        bright = program(POST_VS, BRIGHT_FS, "bright", false, "uSrc", "uThr", "uUvScale");
        blur = program(POST_VS, BLUR_FS, "blur", false, "uSrc", "uDir");
        comp = program(POST_VS, COMP_FS, "comp", false, "uScene", "uB1", "uB2", "uStr", "uSharp", "uAA", "uTexel", "uUvScale");
        // Fullscreen triangle for post passes, and a unit quad for sprites (x, y, z, u, v).
        quadVbo = gl.genBuffer();
        gl.bindBuffer(GLC.ARRAY_BUFFER, quadVbo);
        gl.bufferData(GLC.ARRAY_BUFFER, 24, fb(-1, -1, 3, -1, -1, 3), GLC.STATIC_DRAW);
        quadVao = gl.genVertexArray();
        gl.bindVertexArray(quadVao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, GLC.FLOAT, false, 0, 0);
        spriteVbo = gl.genBuffer();
        gl.bindBuffer(GLC.ARRAY_BUFFER, spriteVbo);
        gl.bufferData(GLC.ARRAY_BUFFER, 120, fb(-0.5f, -0.5f, 0, 0, 0, 0.5f, -0.5f, 0, 1, 0, 0.5f, 0.5f, 0, 1, 1,
                -0.5f, -0.5f, 0, 0, 0, 0.5f, 0.5f, 0, 1, 1, -0.5f, 0.5f, 0, 0, 1), GLC.STATIC_DRAW);
        gl.bindVertexArray(0);
    }

    private static FloatBuffer fb(float... v) {
        FloatBuffer b = ByteBuffer.allocateDirect(v.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        b.put(v).position(0);
        return b;
    }

    /** Every shader source this renderer builds (built-ins plus custom materials), for offline validation. */
    public List<String[]> allSources() {
        List<String[]> out = new ArrayList<>();
        out.add(new String[]{"lit", STD_VS, LIT_FS});
        out.add(new String[]{"basic", STD_VS, BASIC_FS});
        out.add(new String[]{"sprite", SPRITE_VS, SPRITE_FS});
        out.add(new String[]{"bright", POST_VS, BRIGHT_FS});
        out.add(new String[]{"blur", POST_VS, BLUR_FS});
        out.add(new String[]{"comp", POST_VS, COMP_FS});
        drain();
        for (int id = 0; id < mats.length; id++) {
            Mat m = mats[id];
            if (m == null || !m.custom) continue;
            String[] vf = customSources(m);
            out.add(new String[]{"custom" + id, vf[0], vf[1]});
        }
        return out;
    }

    private String[] customSources(Mat m) {
        String vpre = COMMON + "#define attribute in\n#define varying out\n#define texture2D texture\n"
                + "uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix; uniform vec3 cameraPosition;\n"
                + "in vec3 position; in vec3 normal; in vec2 uv;\n";
        String fpre = COMMON + "#define varying in\n#define texture2D texture\nout vec4 smuFrag;\n#define gl_FragColor smuFrag\n"
                + "uniform vec3 cameraPosition;\n" + TONE;
        return new String[]{vpre + chunks(m.vs), fpre + chunks(m.fs)};
    }

    /** three.js ShaderMaterial sources, given the built-ins three would normally prepend. */
    private Prog custom(Mat m) {
        String[] src = customSources(m);
        String vs = src[0], fs = src[1];
        // Materials with identical shaders (all the light beams, all the cords) share one program.
        Prog cached = customCache.get(vs + "\u0000" + fs);
        if (cached != null) return cached;
        List<String> names = new ArrayList<>();
        Collections.addAll(names, "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix", "cameraPosition", "fogColor", "fogDensity", "smuExposure");
        if (m.uNames != null) Collections.addAll(names, m.uNames);
        Prog p = program(vs, fs, "custom", true, names.toArray(new String[0]));
        customCache.put(vs + "\u0000" + fs, p);
        return p;
    }

    private static String chunks(String s) {
        return s.replace("#include <fog_pars_vertex>", "varying float vFogDepth;")
                .replace("#include <fog_vertex>", "vFogDepth = - mvPosition.z;")
                .replace("#include <fog_pars_fragment>", "uniform vec3 fogColor; uniform float fogDensity; varying float vFogDepth;")
                .replace("#include <fog_fragment>", "gl_FragColor.rgb = mix(gl_FragColor.rgb, smuSRGB(smuTone(fogColor)), 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth));")
                .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = smuTone(gl_FragColor.rgb);")
                .replace("#include <colorspace_fragment>", "gl_FragColor.rgb = smuSRGB(gl_FragColor.rgb);");
    }

    // ---------------------------------------------------------------- bloom

    private int colorTex(int tw, int th) {
        int t = gl.genTexture();
        gl.bindTexture(GLC.TEXTURE_2D, t);
        gl.texImage2D(GLC.TEXTURE_2D, 0, GLC.RGBA8, tw, th, GLC.RGBA, GLC.UNSIGNED_BYTE, null);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MIN_FILTER, GLC.LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MAG_FILTER, GLC.LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_S, GLC.CLAMP_TO_EDGE);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_T, GLC.CLAMP_TO_EDGE);
        return t;
    }

    private int fbo(int tex, int depth) {
        int f = gl.genFramebuffer();
        gl.bindFramebuffer(GLC.FRAMEBUFFER, f);
        gl.framebufferTexture2D(GLC.FRAMEBUFFER, GLC.COLOR_ATTACHMENT0, GLC.TEXTURE_2D, tex, 0);
        if (depth != 0) gl.framebufferRenderbuffer(GLC.FRAMEBUFFER, GLC.DEPTH_ATTACHMENT, GLC.RENDERBUFFER, depth);
        if (gl.checkFramebufferStatus(GLC.FRAMEBUFFER) != GLC.FRAMEBUFFER_COMPLETE) throw new IllegalStateException("framebuffer incomplete");
        return f;
    }

    // Offscreen targets follow the surface size (auto resolution changes it); old ones are freed.
    private void ensureFbos() {
        if (sceneFbo != 0 && fboW == w && fboH == h) return;
        if (sceneFbo != 0) {
            gl.deleteFramebuffer(sceneFbo);
            gl.deleteTexture(sceneTex);
            gl.deleteRenderbuffer(sceneDepth);
            for (int k = 0; k < 4; k++) { gl.deleteFramebuffer(bloomFbo[k]); gl.deleteTexture(bloomTex[k]); }
        }
        fboW = w;
        fboH = h;
        sceneTex = colorTex(w, h);
        sceneDepth = gl.genRenderbuffer();
        gl.bindRenderbuffer(GLC.RENDERBUFFER, sceneDepth);
        gl.renderbufferStorage(GLC.RENDERBUFFER, GLC.DEPTH_COMPONENT24, w, h);
        sceneFbo = fbo(sceneTex, sceneDepth);
        int[][] sz = {{w / 2, h / 2}, {w / 2, h / 2}, {w / 4, h / 4}, {w / 4, h / 4}};
        for (int k = 0; k < 4; k++) {
            bloomTex[k] = colorTex(Math.max(1, sz[k][0]), Math.max(1, sz[k][1]));
            bloomFbo[k] = fbo(bloomTex[k], 0);
        }
    }

    private void pass(Prog p, int dst, int dw, int dh, int src) {
        gl.bindFramebuffer(GLC.FRAMEBUFFER, dst);
        gl.viewport(0, 0, dw, dh);
        gl.useProgram(p.id);
        gl.activeTexture(GLC.TEXTURE0);
        gl.bindTexture(GLC.TEXTURE_2D, src);
        gl.drawArrays(GLC.TRIANGLES, 0, 3);
    }

    private void post(boolean bloom) {
        gl.disable(GLC.DEPTH_TEST);
        gl.disable(GLC.BLEND);
        gl.disable(GLC.CULL_FACE);
        gl.depthMask(false);
        gl.bindVertexArray(quadVao);
        if (bloom) bloomPasses();
        gl.bindFramebuffer(GLC.FRAMEBUFFER, 0);
        gl.viewport(0, 0, w, h);
        gl.useProgram(comp.id);
        ui(comp, "uScene", 0);
        ui(comp, "uB1", 1);
        ui(comp, "uB2", 2);
        u(comp, "uStr", bloom ? env[20] : 0);
        u(comp, "uSharp", env[23]);
        u(comp, "uAA", env[24]);
        Integer tl = comp.u.get("uTexel");
        if (tl != null) gl.uniform2f(tl, 1f / w, 1f / h);
        Integer us = comp.u.get("uUvScale");
        if (us != null) gl.uniform2f(us, (float) rw / w, (float) rh / h);
        gl.activeTexture(GLC.TEXTURE0 + 2);
        gl.bindTexture(GLC.TEXTURE_2D, bloom ? bloomTex[2] : sceneTex);
        gl.activeTexture(GLC.TEXTURE0 + 1);
        gl.bindTexture(GLC.TEXTURE_2D, bloom ? bloomTex[0] : sceneTex);
        gl.activeTexture(GLC.TEXTURE0);
        gl.bindTexture(GLC.TEXTURE_2D, sceneTex);
        gl.drawArrays(GLC.TRIANGLES, 0, 3);
        gl.depthMask(true);
    }

    private void bloomPasses() {
        int hw = Math.max(1, w / 2), hh = Math.max(1, h / 2), qw = Math.max(1, w / 4), qh = Math.max(1, h / 4);
        gl.useProgram(bright.id);
        ui(bright, "uSrc", 0);
        u(bright, "uThr", env[22]);
        Integer us = bright.u.get("uUvScale");
        if (us != null) gl.uniform2f(us, (float) rw / w, (float) rh / h);
        pass(bright, bloomFbo[0], hw, hh, sceneTex);
        gl.useProgram(blur.id);
        ui(blur, "uSrc", 0);
        float rad = 1 + env[21] * 2;
        Integer dir = blur.u.get("uDir");
        gl.uniform2f(dir, rad / hw, 0);
        pass(blur, bloomFbo[1], hw, hh, bloomTex[0]);
        gl.uniform2f(dir, 0, rad / hh);
        pass(blur, bloomFbo[0], hw, hh, bloomTex[1]);
        gl.uniform2f(dir, rad / qw, 0);
        pass(blur, bloomFbo[3], qw, qh, bloomTex[0]);
        gl.uniform2f(dir, 0, rad / qh);
        pass(blur, bloomFbo[2], qw, qh, bloomTex[3]);
    }

    /** Background clear colour through the same tone curve and sRGB encoding as the shaders. */
    private static float out(float c) {
        float v = Math.max(0, c * 1.1f / 0.6f);
        v = (v * (v + 0.0245786f) - 0.000090537f) / (v * (0.983729f * v + 0.4329510f) + 0.238081f);
        v = Math.min(1, Math.max(0, v));
        return v <= 0.0031308f ? v * 12.92f : (float) (1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    }

    /** Column-major 4x4 multiply (same layout as three.js and GL), no allocation. */
    private void mul(float[] out, float[] a, float[] b) {
        float[] r = mulTmp;
        for (int c = 0; c < 4; c++) {
            for (int rr = 0; rr < 4; rr++) {
                r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
            }
        }
        System.arraycopy(r, 0, out, 0, 16);
    }
}
