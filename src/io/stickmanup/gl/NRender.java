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
        int[] uLoc;
        Prog prog;
        boolean fresh = true;
        int spec = 1;
        Tex tex;
        /** A glow texture of its own, next to the colour map (suits whose lights glow more than the cloth). */
        Tex emTex;
    }

    private static final class Obj {
        int id, kind, g, m, ro, inst, vao, imVbo, icVbo;
        boolean fc, vis, imDirty = true;
        /** Held in front of the eyes (viewgun.js): mw is its place from the camera, not in the world. */
        boolean eye;
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
        // Looked up once at link time; the frame path never touches the map.
        int lModel = -1, lView = -1, lProj = -1, lUv = -1, lInst = -1, lColor = -1, lEmis = -1, lOp = -1, lRough = -1, lMetal = -1, lPanel = -1,
                lHasTex = -1, lCam = -1, lHemiS = -1, lHemiG = -1, lHemiI = -1, lMoonC = -1, lMoonI = -1, lMoonD = -1, lFogC = -1, lFogD = -1, lFog = -1,
                lExp = -1, lSpec = -1, lKind = -1, lMV = -1, lMM = -1, lFC = -1, lFD = -1, lFogOut = -1;
        /** Whether this program holds the view for what is in front of the eyes right now. */
        boolean eyeNow;
        /** The frame this program last got the camera and lights, and the material it holds. */
        int frame = -1, inst = -1;
        Mat lastMat;
        /** Which ways of blending have been drawn with once, so the driver has finished preparing them. */
        int warm;
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
    private final float[] env = new float[32], view = new float[16], proj = new float[16], vp = new float[16], cam = new float[3], viewEye = new float[16];
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
    public int draws, tris;

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
    /** How long the GPU really takes: start of the frame to the glow done, sampled every few frames. */
    public final float[] gpuMs = new float[32];
    public volatile int gpuSamples;
    private int gpuEvery;
    private long frameStart;
    private int cur, frameId, warmAt;
    private boolean liteOn;
    private Prog lite;
    // What is already set, so the same GL state is not sent again for every object.
    private int sProg, sVao, sDepthTest, sDepthMask, sBlend, sBlendDst, sCull, sCullFace, sTex, sEmTex;

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
            } catch (Throwable e) {
                // Out of memory included: that message is lost, the app goes on.
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
    private static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : java.util.Collections.emptyList();
    }

    /**
     * What the game no longer has in its scene (an old map, mostly): the objects, and the geometry, materials and
     * textures nothing else uses, freed here and on the GPU. Without it every map ever loaded stayed in memory.
     */
    @SuppressWarnings("unchecked")
    private void drop(Map<String, Object> d) {
        java.util.Set<Obj> gone = new java.util.HashSet<>();
        for (Object x : list(d.get("o"))) {
            int id = i(x);
            Obj o = id >= 0 && id < byId.length ? byId[id] : null;
            if (o == null) continue;
            byId[id] = null;
            gone.add(o);
            doom(1, o.vao);
            doom(0, o.imVbo);
            doom(0, o.icVbo);
            o.vao = o.imVbo = o.icVbo = 0;
        }
        if (!gone.isEmpty()) {
            List<Obj> keep = new ArrayList<>(objs.size());
            for (Obj o : objs) if (!gone.contains(o)) keep.add(o);
            objs.clear();
            objs.addAll(keep);
        }
        for (Object x : list(d.get("g"))) {
            int id = i(x);
            Geo g = id >= 0 && id < geos.length ? geos[id] : null;
            if (g == null) continue;
            geos[id] = null;
            for (Attr a : g.attrs) doom(0, a.vbo);
            doom(0, g.ibo);
        }
        for (Object x : list(d.get("m"))) {
            int id = i(x);
            if (id >= 0 && id < mats.length) mats[id] = null;
        }
        for (Object x : list(d.get("t"))) {
            Tex t = texs.remove(i(x));
            if (t != null) doom(2, t.gl);
        }
        sVao = sTex = sEmTex = -1;
    }

    /**
     * GPU objects to delete, as {kind (0 buffer, 1 vertex array, 2 texture), handle, frame}. Deleted a few frames after
     * they were last used, never while a frame that drew with them may still be on its way: some phone drivers crash on that.
     */
    private final java.util.ArrayDeque<int[]> doomed = new java.util.ArrayDeque<>();

    private void doom(int kind, int handle) {
        if (handle != 0) doomed.add(new int[]{kind, handle, frameId + 4});
    }

    private void reap() {
        int[] d;
        while ((d = doomed.peek()) != null && d[2] <= frameId) {
            doomed.poll();
            if (d[0] == 0) gl.deleteBuffer(d[1]);
            else if (d[0] == 1) gl.deleteVertexArray(d[1]);
            else gl.deleteTexture(d[1]);
        }
    }

    @SuppressWarnings("unchecked")
    private void define(String json) {
        Map<String, Object> d = (Map<String, Object>) Json.parse(json);
        if (d.get("drop") instanceof Map) drop((Map<String, Object>) d.get("drop"));
        for (Object go : list(d.get("g"))) {
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
        for (Object to : list(d.get("t"))) {
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
        for (Object mo : list(d.get("m"))) {
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
            // Rough, non metal surfaces have almost no highlight: skip the sums for it.
            mt.spec = mt.rough < 0.85f || mt.metal > 0.05f ? 1 : 0;
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
        for (Object oo : list(d.get("o"))) {
            Map<String, Object> o = (Map<String, Object>) oo;
            Obj ob = new Obj();
            ob.id = i(o.get("id"));
            String kind = (String) o.get("kind");
            ob.kind = "sprite".equals(kind) ? 2 : "lines".equals(kind) ? 1 : 0;
            ob.g = i(o.get("g"));
            ob.m = i(o.get("m"));
            ob.ro = i(o.get("ro"));
            ob.fc = i(o.get("fc")) == 1;
            ob.eye = i(o.get("eye")) == 1;
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
        warmAt = 0;
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
            if (m != null) m.fresh = true;
            // A negative count: that many single values as index, value (mostly a shader's time).
            if (n < 0) {
                for (int j = 0; j < -n; j++) {
                    int at = (int) num(s, en);
                    float v = num(s, en);
                    if (m != null && at < m.st.length) m.st[at] = v;
                }
                continue;
            }
            if (m != null && m.st.length != n) m.st = new float[n];
            for (int j = 0; j < n; j++) {
                float v = num(s, en);
                if (m != null) m.st[j] = v;
            }
        }
    }

    // Entries "g,id,name,b64" (geometry attribute), "o,id,im,b64" (instance matrices), "r,id,start,count",
    // "m,id,material" (an object changes material: a climber changing skins).
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
            } else if (type == 'm') {
                Obj o = id < byId.length ? byId[id] : null;
                int mat = (int) num(s, end);
                if (o != null) o.m = mat;
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
        // Handles of the old context mean nothing now.
        doomed.clear();
        for (Geo g : geos) {
            if (g == null) continue;
            g.ibo = 0;
            for (Attr a : g.attrs) { a.vbo = 0; a.dirty = true; }
        }
        for (Obj o : objs) { o.vao = 0; o.imVbo = 0; o.icVbo = 0; o.imDirty = true; o.vaoProg = null; }
        for (Tex t : texs.values()) t.gl = 0;
        for (Mat m : mats) if (m != null) m.prog = null;
        customCache.clear();
        lit = basic = sprite = bright = blur = comp = lite = null;
        for (Mat m : mats) if (m != null) { m.uLoc = null; m.fresh = true; }
        warmAt = 0;
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
        reap();
        if (!framed || w == 0) {
            gl.bindFramebuffer(GLC.FRAMEBUFFER, 0);
            gl.clearColor(0.02f, 0.03f, 0.05f, 1);
            gl.clear(GLC.COLOR_BUFFER_BIT | GLC.DEPTH_BUFFER_BIT);
            return;
        }
        try {
            if (lit == null) buildPrograms();
            frameId++;
            resetState();
            liteOn = env[26] > 0.5f;
            // The scene always goes through the offscreen buffer (dynamic resolution, glow, sharpening, edge AA).
            boolean bloom = env[19] > 0.5f && !failed, postOn = !failed;
            float rs = Math.max(0.3f, Math.min(1f, renderScale * (env[25] > 0 ? env[25] : 1f)));
            rw = postOn ? Math.max(16, Math.round(w * rs)) : w;
            rh = postOn ? Math.max(16, Math.round(h * rs)) : h;
            if (postOn) ensureFbos();
            gl.bindFramebuffer(GLC.FRAMEBUFFER, postOn ? sceneFbo : 0);
            prewarm();
            frameStart = System.nanoTime();
            gl.viewport(0, 0, rw, rh);
            gl.clearColor(out(env[0]), out(env[1]), out(env[2]), 1);
            depthMask(true);
            gl.depthFunc(GLC.LEQUAL);
            gl.clear(GLC.COLOR_BUFFER_BIT | GLC.DEPTH_BUFFER_BIT);
            mul(vp, proj, view);
            // The same view from the camera's own spot, for what is held in front of the eyes (Obj.eye).
            System.arraycopy(view, 0, viewEye, 0, 16);
            viewEye[12] = viewEye[13] = viewEye[14] = 0;
            frustum();
            collect();
            draws = 0;
            tris = 0;
            for (int k = 0; k < nOpaque; k++) drawObj(opaque[k]);
            for (int k = 0; k < nTransparent; k++) drawObj(transparent[k]);
            gl.bindVertexArray(0);
            if (postOn) post(bloom);
        } catch (Throwable e) {
            if (!failed) log.log("draw failed: " + e);
            failed = true;
        }
        long dt = System.nanoTime() - t0;
        framesSec++;
        drawNsSec += dt;
        if (dt > drawNsMax) drawNsMax = dt;
    }

    private void resetState() {
        sProg = sVao = sDepthTest = sDepthMask = sBlend = sBlendDst = sCull = sCullFace = sTex = sEmTex = -1;
    }

    private void useProgram(int id) {
        if (id != sProg) { sProg = id; gl.useProgram(id); }
    }

    private void bindVao(int vao) {
        if (vao != sVao) { sVao = vao; gl.bindVertexArray(vao); }
    }

    private void depthMask(boolean on) {
        int v = on ? 1 : 0;
        if (v != sDepthMask) { sDepthMask = v; gl.depthMask(on); }
    }

    private void depthTest(boolean on) {
        int v = on ? 1 : 0;
        if (v != sDepthTest) { sDepthTest = v; if (on) gl.enable(GLC.DEPTH_TEST); else gl.disable(GLC.DEPTH_TEST); }
    }

    private void blend(boolean on, int dst) {
        int v = on ? 1 : 0;
        if (v != sBlend) { sBlend = v; if (on) gl.enable(GLC.BLEND); else gl.disable(GLC.BLEND); }
        if (on && dst != sBlendDst) { sBlendDst = dst; gl.blendFunc(GLC.SRC_ALPHA, dst); }
    }

    private void cull(boolean on, int face) {
        int v = on ? 1 : 0;
        if (v != sCull) { sCull = v; if (on) gl.enable(GLC.CULL_FACE); else gl.disable(GLC.CULL_FACE); }
        if (on && face != sCullFace) { sCullFace = face; gl.cullFace(face); }
    }

    /**
     * Gets everything ready before it is first seen: shaders built, models on the GPU, textures decoded. Without
     * this each of those happens the moment something first comes into view, in the middle of the climb, and the
     * game hitches. A few milliseconds a frame, so even a new map's load behind the menus stays smooth.
     * One object per shader is also drawn into a single pixel (wiped by the clear right after this), because many
     * phone drivers only finish preparing a shader the first time it really draws.
     */
    private void prewarm() {
        if (warmAt >= objs.size()) return;
        long t0 = System.nanoTime();
        gl.viewport(0, 0, 1, 1);
        while (warmAt < objs.size()) {
            Obj o = objs.get(warmAt++);
            Mat m = o.m < mats.length ? mats[o.m] : null;
            if (m == null) continue;
            Geo g = o.kind == 2 ? null : o.g < geos.length ? geos[o.g] : null;
            if (o.kind != 2 && g == null) continue;
            Prog p = progFor(m, o);
            if (p == null || p.id == 0) continue;
            prepare(o, g, p);
            warmTex(m.map);
            warmTex(m.em);
            int way = !m.tr ? 1 : m.blend == 1 ? 4 : 2;
            if ((p.warm & way) == 0) {
                p.warm |= way;
                drawObj(o);
            }
            if (System.nanoTime() - t0 > 4_000_000L) break;
        }
        bindVao(0);
    }

    private void warmTex(int id) {
        Tex t = id != 0 ? texs.get(id) : null;
        if (t != null && t.gl == 0) uploadTex(t);
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
        // How far the picture reaches (see render.js): what lies wholly beyond that is not drawn at all.
        float see = env[27];
        for (int k = 0, n = objs.size(); k < n; k++) {
            Obj o = objs.get(k);
            if (!o.vis) continue;
            Mat m = o.m < mats.length ? mats[o.m] : null;
            if (m == null || (m.st.length > 8 && m.st[8] == 0)) continue;
            if (o.kind != 2 && (o.g >= geos.length || geos[o.g] == null)) continue;
            float[] mw = o.mw;
            float cx = mw[12], cy = mw[13], cz = mw[14];
            float reach = o.kind == 2 ? 3f : -1f;
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
                    reach = r;
                }
            }
            if (o.eye) o.dist = cx * cx + cy * cy + cz * cz;
            else o.dist = (cx - cam[0]) * (cx - cam[0]) + (cy - cam[1]) * (cy - cam[1]) + (cz - cam[2]) * (cz - cam[2]);
            // Things that don't fade in fog (sky, lightning, beams) and never-culled things stay.
            if (see > 0 && reach >= 0 && m.fog && o.dist > (see + reach) * (see + reach)) continue;
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
            sVao = 0;
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

    /** Models and instance lists on the GPU, and the vertex setup for this program. */
    private void prepare(Obj o, Geo g, Prog p) {
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
        // The built-in programs all use the same attribute slots, so they can share a setup.
        boolean same = o.vaoProg == p || (!p.custom && o.vaoProg != null && !o.vaoProg.custom);
        if (o.vao == 0 || !same) { buildVao(o, g, p); sVao = o.vao; }
    }

    private void drawObj(Obj o) {
        Mat m = mats[o.m];
        Geo g = o.kind == 2 ? null : geos[o.g];
        Prog p = progFor(m, o);
        if (p == null || p.id == 0) return;
        prepare(o, g, p);
        bindVao(o.vao);
        useProgram(p.id);
        if (!p.custom) {
            if (g == null || !g.hasNormal) gl.vertexAttrib4f(1, 0, 1, 0, 0);
            if (g == null || !g.hasUv) gl.vertexAttrib4f(2, 0, 0, 0, 0);
            if (g == null || !g.hasGlow) gl.vertexAttrib4f(3, 0, 0, 0, 0);
            if (o.ic == null) gl.vertexAttrib4f(4, 1, 1, 1, 1);
        }
        setUniforms(p, m, o);
        depthTest(m.dt);
        depthMask(m.dw);
        blend(m.tr, m.blend == 1 ? GLC.ONE : GLC.ONE_MINUS_SRC_ALPHA);
        if (m.side == 2 || o.kind == 2) cull(false, 0);
        else cull(true, m.side == 1 ? GLC.FRONT : GLC.BACK);
        draws++;
        if (o.kind == 2) { tris += 2; gl.drawArrays(GLC.TRIANGLES, 0, 6); return; }
        int mode = o.kind == 1 ? GLC.LINES : GLC.TRIANGLES;
        int total = g.ibo != 0 ? g.idxCount : g.vertCount;
        int start = Math.max(0, g.drStart), count = g.drCount < 0 ? total - start : Math.min(g.drCount, total - start);
        if (count <= 0) return;
        if (o.kind == 0) tris += count / 3 * Math.max(1, o.inst);
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

    private void ui(Prog p, String name, int v) {
        Integer l = p.u.get(name);
        if (l != null) gl.uniform1i(l, v);
    }

    /** Sky and water and everything else with its own shader. */
    private void customUniforms(Prog p, Mat m, Obj o) {
        if (p.frame != frameId) {
            p.frame = frameId;
            p.lastMat = null;
            p.eyeNow = false;
            if (p.lView >= 0) gl.uniformMatrix4fv(p.lView, view);
            if (p.lProj >= 0) gl.uniformMatrix4fv(p.lProj, proj);
            if (p.lCam >= 0) gl.uniform3f(p.lCam, cam[0], cam[1], cam[2]);
            if (p.lFC >= 0) gl.uniform3f(p.lFC, env[0], env[1], env[2]);
            if (p.lFD >= 0) gl.uniform1f(p.lFD, env[3]);
            if (p.lExp >= 0) gl.uniform1f(p.lExp, env[18]);
        }
        eyeView(p, o);
        if (p.lMM >= 0) gl.uniformMatrix4fv(p.lMM, o.mw);
        if (p.lMV >= 0) { mul(tmp, o.eye ? viewEye : view, o.mw); gl.uniformMatrix4fv(p.lMV, tmp); }
        // Many materials share a program; their values only go over when they change or another one was on.
        if (p.lastMat == m && !m.fresh) return;
        p.lastMat = m;
        m.fresh = false;
        int n = m.uNames.length;
        if (m.uLoc == null) {
            m.uLoc = new int[n];
            for (int j = 0; j < n; j++) {
                // Fog comes from the live scene (set above); the material's copies are never refreshed in JS.
                Integer l = m.uNames[j].startsWith("fog") ? null : p.u.get(m.uNames[j]);
                m.uLoc[j] = l == null ? -1 : l;
            }
        }
        float[] st = m.st;
        int k = 9;
        for (int j = 0; j < n; j++) {
            int c = m.uSizes[j], l = m.uLoc[j];
            if (l >= 0 && k + c <= st.length) {
                if (c == 1) gl.uniform1f(l, st[k]);
                else if (c == 2) gl.uniform2f(l, st[k], st[k + 1]);
                else if (c == 3) gl.uniform3f(l, st[k], st[k + 1], st[k + 2]);
                else if (c == 4) gl.uniform4f(l, st[k], st[k + 1], st[k + 2], st[k + 3]);
            }
            k += c;
        }
    }

    /** What is held in front of the eyes has its place from the camera, so for those the view stands at nought. */
    private void eyeView(Prog p, Obj o) {
        if (p.eyeNow == o.eye) return;
        p.eyeNow = o.eye;
        if (p.lView >= 0) gl.uniformMatrix4fv(p.lView, o.eye ? viewEye : view);
        if (p.lCam >= 0) {
            if (o.eye) gl.uniform3f(p.lCam, 0, 0, 0);
            else gl.uniform3f(p.lCam, cam[0], cam[1], cam[2]);
        }
    }

    private void setUniforms(Prog p, Mat m, Obj o) {
        if (p.custom) { customUniforms(p, m, o); return; }
        if (p.frame != frameId) {
            p.frame = frameId;
            p.lastMat = null;
            p.inst = -1;
            p.eyeNow = false;
            gl.uniformMatrix4fv(p.lView, view);
            gl.uniformMatrix4fv(p.lProj, proj);
            if (p.lCam >= 0) gl.uniform3f(p.lCam, cam[0], cam[1], cam[2]);
            if (p.lFogC >= 0) gl.uniform3f(p.lFogC, env[0], env[1], env[2]);
            if (p.lFogD >= 0) gl.uniform1f(p.lFogD, env[3]);
            if (p.lFogOut >= 0) gl.uniform3f(p.lFogOut, out(env[0]), out(env[1]), out(env[2]));
            if (p.lExp >= 0) gl.uniform1f(p.lExp, env[18]);
            if (p.lHemiS >= 0) gl.uniform3f(p.lHemiS, env[4], env[5], env[6]);
            if (p.lHemiG >= 0) gl.uniform3f(p.lHemiG, env[7], env[8], env[9]);
            if (p.lHemiI >= 0) gl.uniform1f(p.lHemiI, env[10]);
            if (p.lMoonC >= 0) gl.uniform3f(p.lMoonC, env[11], env[12], env[13]);
            if (p.lMoonI >= 0) gl.uniform1f(p.lMoonI, env[14]);
            if (p.lMoonD >= 0) gl.uniform3f(p.lMoonD, env[15], env[16], env[17]);
        }
        eyeView(p, o);
        gl.uniformMatrix4fv(p.lModel, o.mw);
        if (p.lInst >= 0) {
            int i = o.inst > 0 ? 1 : 0;
            if (i != p.inst) { p.inst = i; gl.uniform1i(p.lInst, i); }
        }
        if (p.lastMat != m || m.fresh) applyMat(p, m);
        // Another program may have used the slot in between, so this one is checked on every draw.
        Tex t = m.tex, e = m.emTex;
        // Uploading binds on unit 0, so the glow map goes up before the colour map is bound.
        if (e != null && e.gl == 0) uploadTex(e);
        if (t != null) {
            if (t.gl == 0) uploadTex(t);
            if (t.gl != sTex) {
                sTex = t.gl;
                gl.activeTexture(GLC.TEXTURE0);
                gl.bindTexture(GLC.TEXTURE_2D, t.gl);
            }
        }
        if (e != null) {
            if (e.gl != sEmTex) {
                sEmTex = e.gl;
                gl.activeTexture(GLC.TEXTURE0 + EM_UNIT);
                gl.bindTexture(GLC.TEXTURE_2D, e.gl);
                gl.activeTexture(GLC.TEXTURE0);
            }
        }
    }

    private void applyMat(Prog p, Mat m) {
        p.lastMat = m;
        m.fresh = false;
        float[] s = m.st;
        if (p.lColor >= 0) gl.uniform3f(p.lColor, s[0], s[1], s[2]);
        float ei = s.length > 6 ? s[6] : 1;
        if (p.lEmis >= 0) gl.uniform3f(p.lEmis, s[3] * ei, s[4] * ei, s[5] * ei);
        if (p.lOp >= 0) gl.uniform1f(p.lOp, s.length > 7 ? s[7] : m.op);
        if (p.lFog >= 0) gl.uniform1i(p.lFog, m.fog ? 1 : 0);
        if (p.lRough >= 0) gl.uniform1f(p.lRough, m.rough);
        if (p.lMetal >= 0) gl.uniform1f(p.lMetal, m.metal);
        if (p.lPanel >= 0) gl.uniform1i(p.lPanel, m.panel);
        if (p.lSpec >= 0) gl.uniform1i(p.lSpec, m.spec);
        if (p.lKind >= 0) gl.uniform1i(p.lKind, m.lit ? 0 : 1);
        // Lit materials: an albedo map (2) or an emissive map (1). Basic and sprites: the colour map (1).
        boolean albedo = m.lit && m.map != 0;
        int texId = m.lit ? (albedo ? m.map : m.em) : m.map;
        Tex t = texId != 0 ? texs.get(texId) : null;
        // 3: the same map colours the surface and makes it glow (skins that stay readable in the dark).
        // 4: one map colours it and a second one, on its own unit, says where it glows.
        Tex et = albedo && m.em != 0 && m.em != m.map ? texs.get(m.em) : null;
        if (p.lHasTex >= 0) gl.uniform1i(p.lHasTex, t == null ? 0 : albedo ? (m.em == m.map ? 3 : et != null ? 4 : 2) : 1);
        m.tex = t;
        m.emTex = t != null ? et : null;
        if (p.lUv >= 0) gl.uniformMatrix3fv(p.lUv, t != null ? t.uv : IDENT3);
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
        gl.activeTexture(GLC.TEXTURE0);
        gl.bindTexture(GLC.TEXTURE_2D, t.gl);
        sTex = t.gl;
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
        if (liteOn) return lite;
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
            // The sRGB curve and its inverse as fits (under 1% off) without pow(), which is slow on phone GPUs.
            + "vec3 smuSRGB(vec3 c){ c = max(c, vec3(0.0)); vec3 a = sqrt(c), b = sqrt(a), d = sqrt(b); return max(0.585122381 * a + 0.783140355 * b - 0.368262736 * d, vec3(0.0)); }\n"
            + "vec3 smuLin(vec3 c){ return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }\n";

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

    /** Procedural surface detail; generated from assets/js/pattern.js by dev/sync_pattern.py. */
    static final String PATTERN = ""
            + "uniform sampler2D uNoise;\n"
            + "float smuHash(vec2 p){ return textureLod(uNoise, (floor(p) + 0.5) / 512.0, 0.0).g; }\n"
            + "float smuNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return textureLod(uNoise, (i + f + 0.5) / 512.0, 0.0).r; }\n"
            + "float smuFbm(vec2 p){ return smuNoise(p) * 0.65 + smuNoise(p * 2.3 + 7.1) * 0.35; }\n"
            + "float smuHex(vec2 p){\n"
            + "  vec2 r = vec2(1.0, 1.732), h = r * 0.5, a = mod(p, r) - h, b = mod(p - h, r) - h, g = dot(a, a) < dot(b, b) ? a : b;\n"
            + "  return max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));\n"
            + "}\n"
            + "vec3 smuPattern(int pat, vec3 w, vec3 n){\n"
            + "  vec3 an = abs(n);\n"
            + "  vec2 uv = an.y > 0.6 ? w.xz : (an.x > an.z ? w.zy : w.xy);\n"
            + "  if (pat == 1) {\n"
            + "    vec2 g = uv * 0.5, d = abs(fract(g - 0.5) - 0.5);\n"
            + "    vec2 ln = 1.0 - smoothstep(vec2(0.0), fwidth(g) * 1.5 + 0.012, d);\n"
            + "    return vec3((0.84 + 0.24 * smuHash(floor(g))) * (1.0 - 0.5 * max(ln.x, ln.y)) * (0.9 + 0.2 * smuNoise(uv * 3.0)));\n"
            + "  }\n"
            + "  if (pat == 2) {\n"
            + "    vec2 g = uv * vec2(0.8, 1.5); g.x += floor(g.y) * 0.5;\n"
            + "    vec2 d = abs(fract(g) - 0.5), fw = fwidth(g) * 1.5;\n"
            + "    float m = max(smoothstep(0.46 - fw.x, 0.46, d.x), smoothstep(0.44 - fw.y, 0.44, d.y));\n"
            + "    float nz = smuNoise(uv * 3.0) * 0.6 + smuNoise(uv * 9.0) * 0.4;\n"
            + "    return vec3((0.82 + 0.22 * smuHash(floor(g))) * (0.82 + 0.3 * nz) * (1.0 - 0.45 * m));\n"
            + "  }\n"
            + "  if (pat == 3) {\n"
            + "    vec2 g = vec2(uv.x * 0.7, uv.y * 3.0);\n"
            + "    float pl = floor(g.y), pn = smuHash(vec2(pl, 7.0));\n"
            + "    float grain = smuNoise(vec2(g.x * 3.0 + pn * 17.0, fract(g.y) * 6.0)) * 0.5 + smuNoise(vec2(g.x * 14.0, g.y * 2.0 + pn)) * 0.5;\n"
            + "    float gap = smoothstep(0.43, 0.5, abs(fract(g.y) - 0.5));\n"
            + "    return vec3((0.72 + 0.36 * pn) * (0.78 + 0.4 * grain) * (1.0 - 0.6 * gap));\n"
            + "  }\n"
            + "  if (pat == 4) {\n"
            + "    vec2 p = uv * 1.4;\n"
            + "    float e = smuHex(p), line = smoothstep(0.4, 0.47, e);\n"
            + "    return vec3((0.84 + 0.16 * smuNoise(uv * 5.0)) * (1.0 - 0.45 * line));\n"
            + "  }\n"
            + "  if (pat == 5 || pat == 6 || pat == 13 || pat == 14) {\n"
            + "    // Only work out the part this pixel shows: the rock on the sides, the coat on top (both near the edge).\n"
            + "    float k = smoothstep(0.35, 0.75, n.y);\n"
            + "    vec3 rock = vec3(0.0), coat = vec3(0.0);\n"
            + "    if (k < 0.999) {\n"
            + "      float nz = smuFbm(uv * 1.3);\n"
            + "      rock = (pat == 14 ? vec3(0.6, 0.66, 0.76) : pat == 6 ? vec3(0.88, 0.72, 0.52) : vec3(0.58, 0.54, 0.48)) * (0.72 + 0.42 * nz) * (0.86 + 0.14 * sin(w.y * 3.0 + nz * 4.0));\n"
            + "      if (pat == 13) rock = mix(rock, vec3(0.28, 0.52, 0.24), smoothstep(0.5, 0.72, smuNoise(uv * 0.9 + 5.0)) * 0.75);\n"
            + "    }\n"
            + "    if (k > 0.001) {\n"
            + "      float cn = smuNoise(uv * (pat == 6 ? 6.0 : 3.0));\n"
            + "      // Grass: patches of lighter and darker green, and a fine grain of blades.\n"
            + "      float bl = pat == 5 || pat == 13 ? smuNoise(uv * 24.0) * 0.6 + smuNoise(uv * 9.0 + 3.0) * 0.4 : 0.5;\n"
            + "      coat = pat == 5 ? mix(vec3(0.24, 0.48, 0.14), vec3(0.46, 0.74, 0.25), cn) * (0.72 + 0.56 * bl)\n"
            + "           : pat == 6 ? vec3(0.96, 0.87, 0.62) * (0.88 + 0.2 * cn)\n"
            + "           : pat == 13 ? mix(vec3(0.18, 0.4, 0.14), vec3(0.4, 0.66, 0.25), cn) * (0.72 + 0.56 * bl)\n"
            + "           : vec3(0.95, 0.97, 1.0) * (0.92 + 0.1 * cn);\n"
            + "    }\n"
            + "    return mix(rock, coat, k);\n"
            + "  }\n"
            + "  if (pat == 7) {\n"
            + "    float nz = smuNoise(uv * 4.0);\n"
            + "    vec3 c = vec3(0.5, 0.45, 0.44) * (0.78 + 0.38 * nz);\n"
            + "    if (an.y > 0.6) c *= 1.0 - 0.5 * smoothstep(0.38, 0.46, smuHex(uv * 2.2));\n"
            + "    else c *= 1.0 - 0.35 * smoothstep(0.44, 0.5, abs(fract(uv.x * 2.3) - 0.5));\n"
            + "    return c;\n"
            + "  }\n"
            + "  if (pat == 8) {\n"
            + "    vec2 g = uv * 3.5, f = fract(g) - 0.5;\n"
            + "    vec2 d = mod(floor(g.x) + floor(g.y), 2.0) > 0.5 ? f : f.yx;\n"
            + "    float dash = (1.0 - smoothstep(0.06, 0.12, abs(d.x))) * (1.0 - smoothstep(0.26, 0.32, abs(d.y)));\n"
            + "    vec2 seam = abs(fract(uv * 0.5 - 0.5) - 0.5);\n"
            + "    float s = 1.0 - smoothstep(0.0, 0.02, min(seam.x, seam.y));\n"
            + "    return vec3((0.76 + 0.14 * smuNoise(uv * 6.0)) * (1.0 + 0.35 * dash) * (1.0 - 0.4 * s));\n"
            + "  }\n"
            + "  if (pat == 9) {\n"
            + "    float g = uv.x * 4.0, s = abs(fract(g) - 0.5) * 2.0;\n"
            + "    float node = smoothstep(0.92, 0.98, abs(fract(uv.y * 0.9 + smuHash(vec2(floor(g), 2.0))) - 0.5) * 2.0);\n"
            + "    return vec3(0.9, 0.82, 0.55) * (1.0 - 0.35 * s * s) * (1.0 - 0.35 * node) * (0.9 + 0.15 * smuNoise(vec2(g * 2.0, uv.y * 6.0)));\n"
            + "  }\n"
            + "  if (pat == 10) {\n"
            + "    float v = abs(sin(uv.x * 1.1 + uv.y * 0.6 + smuFbm(uv * 1.4) * 5.0));\n"
            + "    float vein = 1.0 - smoothstep(0.0, 0.07, v);\n"
            + "    vec2 t = abs(fract(uv * 0.45) - 0.5);\n"
            + "    float seam = 1.0 - smoothstep(0.0, 0.015, 0.5 - max(t.x, t.y));\n"
            + "    return mix(vec3(0.96, 0.95, 0.93) * (0.94 + 0.08 * smuNoise(uv * 3.0)), vec3(0.62, 0.66, 0.72), vein * 0.7) * (1.0 - 0.35 * seam);\n"
            + "  }\n"
            + "  if (pat == 11) {\n"
            + "    vec2 g = uv * 4.5, f = fract(g) - 0.5;\n"
            + "    float pore = (1.0 - smoothstep(0.12, 0.2, length(f))) * step(0.45, smuHash(floor(g)));\n"
            + "    return vec3(1.0, 0.64, 0.56) * (0.78 + 0.32 * smuFbm(uv * 2.0)) * (1.0 - 0.45 * pore);\n"
            + "  }\n"
            + "  if (pat == 12) {\n"
            + "    vec2 t = abs(fract(uv * 0.5) - 0.5);\n"
            + "    float seam = 1.0 - smoothstep(0.0, 0.012, 0.5 - max(t.x, t.y));\n"
            + "    float stain = smoothstep(0.55, 0.8, smuFbm(uv * 0.7 + 3.0));\n"
            + "    return vec3((0.82 + 0.16 * smuNoise(uv * 5.0)) * (1.0 - 0.25 * stain) * (1.0 - 0.4 * seam));\n"
            + "  }\n"
            + "  if (pat == 17) {\n"
            + "    // A clipped hedge: small leaves on every side, darker hollows, here and there a lighter tip.\n"
            + "    vec2 g = uv * 4.0;\n"
            + "    float l = smuNoise(g) * 0.5 + smuNoise(g * 2.6 + 3.1) * 0.3 + smuNoise(g * 6.3 + 1.7) * 0.2;\n"
            + "    float hollow = smoothstep(0.5, 0.8, smuNoise(uv * 1.3 + 9.0));\n"
            + "    float tip = step(0.9, smuHash(floor(g * 3.0)));\n"
            + "    return mix(vec3(0.2, 0.42, 0.16), vec3(0.42, 0.72, 0.3), l) * (1.0 - 0.38 * hollow) + tip * vec3(0.1, 0.12, 0.04);\n"
            + "  }\n"
            + "  if (pat == 18) {\n"
            + "    // Upright logs side by side (the walls of a wall jump shaft): each log rounder in the middle, bark fibres along it,\n"
            + "    // dark cracks between the logs, and moss growing in the cracks and in patches. On top the cut ends with their rings.\n"
            + "    if (an.y > 0.6) {\n"
            + "      vec2 g = uv * 2.2, f = fract(g) - 0.5;\n"
            + "      float ring = 0.5 + 0.5 * sin(length(f) * 70.0 + smuNoise(g * 3.0) * 3.0);\n"
            + "      return vec3(0.86, 0.68, 0.46) * (0.8 + 0.2 * ring) * (1.0 - 0.6 * smoothstep(0.36, 0.5, length(f)));\n"
            + "    }\n"
            + "    float g = uv.x * 2.2, id = floor(g), f = fract(g) - 0.5;\n"
            + "    float rnd = sqrt(max(0.0, 1.0 - 3.4 * f * f));\n"
            + "    float fib = smuNoise(vec2(g * 9.0, uv.y * 0.8 + id * 3.1)) * 0.6 + smuNoise(vec2(g * 24.0, uv.y * 2.6 + id)) * 0.4;\n"
            + "    float crack = smoothstep(0.6, 0.78, smuNoise(vec2(g * 4.0 + id * 1.3, uv.y * 0.5)));\n"
            + "    vec3 bark = vec3(0.6, 0.45, 0.3) * (0.62 + 0.42 * rnd) * (0.7 + 0.5 * fib) * (1.0 - 0.4 * crack) * (0.9 + 0.2 * smuHash(vec2(id, 4.0)));\n"
            + "    float gap = smoothstep(0.4, 0.5, abs(f));\n"
            + "    float moss = max(smoothstep(0.52, 0.74, smuFbm(vec2(g * 0.8, uv.y * 0.55) + id * 1.7)), gap * 0.9);\n"
            + "    vec3 mc = vec3(0.3, 0.55, 0.2) * (0.7 + 0.55 * smuNoise(uv * 8.0));\n"
            + "    return mix(bark, mc, moss * 0.8) * (1.0 - 0.5 * gap);\n"
            + "  }\n"
            + "  if (pat == 19) {\n"
            + "    // The forest floor: grass in big soft patches, bare earth and fallen needles between them (more of it round the\n"
            + "    // giant trunk), moss in the damp spots. Large and small noise, so it doesn't repeat across the island.\n"
            + "    float big = smuFbm(uv * 0.05), mid = smuFbm(uv * 0.32 + 3.0), fine = smuNoise(uv * 3.5) * 0.6 + smuNoise(uv * 10.0) * 0.4;\n"
            + "    vec3 grass = mix(vec3(0.07, 0.15, 0.03), vec3(0.14, 0.25, 0.05), mid) * (0.78 + 0.4 * fine);\n"
            + "    vec3 earth = mix(vec3(0.11, 0.075, 0.04), vec3(0.17, 0.11, 0.055), fine);\n"
            + "    float e = smoothstep(0.58, 0.78, big * 0.65 + mid * 0.5 - 0.06);\n"
            + "    e = max(e, 1.0 - smoothstep(21.0, 31.0, length(w.xz) + (mid - 0.5) * 8.0));\n"
            + "    vec3 c = mix(grass, earth, e * 0.9);\n"
            + "    c = mix(c, vec3(0.05, 0.13, 0.03) * (0.85 + 0.3 * fine), smoothstep(0.6, 0.8, smuNoise(uv * 0.14 + 9.0)) * 0.55 * (1.0 - e));\n"
            + "    if (an.y < 0.6) c = vec3(0.16, 0.12, 0.08) * (0.7 + 0.5 * smuFbm(uv * 1.3));\n"
            + "    // A factor on the material's own colour (0x47732f, what the plain renderer shows instead).\n"
            + "    return c / vec3(0.0612, 0.1714, 0.0284);\n"
            + "  }\n"
            + "  if (pat == 15) return mix(vec3(0.86, 0.9, 1.0), vec3(1.0), smoothstep(-0.3, 0.6, n.y)) * (0.93 + 0.08 * smuNoise(uv * 2.0));\n"
            + "  if (pat == 16) {\n"
            + "    vec2 g = vec2(uv.x * 7.0, uv.y * 0.7);\n"
            + "    float fib = smuNoise(g) * 0.6 + smuNoise(g * vec2(1.0, 3.0) + 5.0) * 0.4;\n"
            + "    float crack = smoothstep(0.62, 0.7, smuNoise(vec2(uv.x * 3.0, uv.y * 0.3)));\n"
            + "    return vec3(1.0, 0.88, 0.74) * (0.66 + 0.42 * fib) * (1.0 - 0.4 * crack);\n"
            + "  }\n"
            + "  return vec3(1.0);\n"
            + "}\n"
;

    private static final String LIT_FS = COMMON + TONE + FOG + PATTERN
            + "in vec3 vW; in vec3 vN; in vec3 vGlow; in vec3 vIC; in vec2 vUv; out vec4 outColor;\n"
            + "uniform vec3 uColor, uEmissive, cameraPosition, uHemiSky, uHemiGround, uMoonColor, uMoonDir;\n"
            + "uniform float uOpacity, uRough, uMetal, uHemiI, uMoonI; uniform int uPanel, uHasTex, uSpec; uniform sampler2D uTex, uEmTex;\n"
            + "vec3 Fs(vec3 f0, float vh){ float fr = exp2((-5.55473 * vh - 6.98316) * vh); return f0 * (1.0 - fr) + fr; }\n"
            // The usual visibility term without its two square roots (nearly the same, much cheaper).
            + "float Vg(float a, float nl, float nv){ return 0.5 / max(mix(2.0 * nl * nv, nl + nv, a), 1e-4); }\n"
            + "float Dg(float a, float nh){ float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return 0.3183099 * a2 / (d * d); }\n"
            + "void main(){\n"
            + "  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;\n"
            + "  vec3 base = uColor * vIC;\n"
            + "  if (uPanel > 0) base *= smuPattern(uPanel, vW, n);\n"
            + "  vec3 texc = uHasTex > 0 ? smuLin(texture(uTex, vUv).rgb) : vec3(1.0);\n"
            + "  if (uHasTex >= 2) base *= texc;\n"
            + "  vec3 v = normalize(cameraPosition - vW);\n"
            + "  float r = clamp(max(uRough, 0.0525), 0.0, 1.0), a = r * r;\n"
            + "  vec3 diff = base * (1.0 - uMetal), f0 = mix(vec3(0.04), base, uMetal);\n"
            + "  vec3 col = mix(uHemiGround, uHemiSky, 0.5 * n.y + 0.5) * uHemiI * diff * 0.3183099;\n"
            + "  float nl = dot(n, uMoonDir);\n"
            + "  if (nl > 0.0) { vec3 lit = diff * 0.3183099;\n"
            + "    if (uSpec > 0) { vec3 h = normalize(uMoonDir + v); float nv = max(dot(n, v), 1e-4); lit += Fs(f0, max(dot(v, h), 0.0)) * Vg(a, nl, nv) * Dg(a, max(dot(n, h), 0.0)); }\n"
            + "    col += uMoonColor * uMoonI * nl * lit; }\n"
            + "  vec3 em = uEmissive; if (uHasTex == 1 || uHasTex == 3) em *= texc; else if (uHasTex == 4) em *= smuLin(texture(uEmTex, vUv).rgb);\n"
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

    // Simple lighting for weak phones: everything is worked out per corner instead of per pixel. The shapes are
    // flat sided, so it looks nearly the same without highlights and surface detail, at a fraction of the cost.
    private static final String LITE_VS = COMMON + TONE
            + "layout(location=0) in vec3 position; layout(location=1) in vec3 normal; layout(location=2) in vec2 uv;\n"
            + "layout(location=3) in vec3 aGlow; layout(location=4) in vec3 instanceColor;\n"
            + "layout(location=5) in vec4 im0; layout(location=6) in vec4 im1; layout(location=7) in vec4 im2; layout(location=8) in vec4 im3;\n"
            + "uniform mat4 uModel, uView, uProj; uniform mat3 uUv; uniform int uInst, uKind, uFog;\n"
            + "uniform vec3 uColor, uEmissive, uHemiSky, uHemiGround, uMoonColor, uMoonDir, uFogColor; uniform float uHemiI, uMoonI, uMetal, uFogDensity;\n"
            + "uniform int uHasTex; out vec3 vOut, vEm; out vec2 vUv; out float vF;\n"
            + "void main(){ mat4 m = uInst == 1 ? uModel * mat4(im0, im1, im2, im3) : uModel;\n"
            + "  vec4 w = m * vec4(position, 1.0), mv = uView * w; gl_Position = uProj * mv;\n"
            + "  vUv = (uUv * vec3(uv, 1.0)).xy; vec3 col;\n"
            + "  if (uKind == 0) { mat3 r = mat3(m); vec3 s2 = vec3(dot(r[0], r[0]), dot(r[1], r[1]), dot(r[2], r[2]));\n"
            + "    vec3 n = normalize(r * (normal / max(s2, vec3(1e-8)))), diff = uColor * instanceColor * (1.0 - 0.5 * uMetal) * 0.3183099;\n"
            // A glow map (window lights) can't be mixed in until its pixels are read: passed along on its own.
            + "    bool em = uHasTex == 1 || uHasTex == 4;\n"
            + "    col = mix(uHemiGround, uHemiSky, 0.5 * n.y + 0.5) * uHemiI * diff + uMoonColor * uMoonI * max(dot(n, uMoonDir), 0.0) * diff + (em ? vec3(0.0) : uEmissive) + aGlow;\n"
            + "    vEm = em ? smuSRGB(smuTone(uEmissive)) : vec3(0.0);\n"
            + "  } else { col = uColor * instanceColor; vEm = vec3(0.0); }\n"
            // Fog goes on last, in the pixel shader: a texture must not darken what is already fog.
            + "  float d = uFogDensity * mv.z; vF = uFog == 1 ? 1.0 - exp(-d * d) : 0.0;\n"
            + "  vOut = smuSRGB(smuTone(min(col, vec3(40.0)))); }\n";

    private static final String LITE_FS = "#version 300 es\nprecision mediump float;\nprecision highp int;\n"
            + "in vec3 vOut, vEm; in float vF; in highp vec2 vUv; out vec4 outColor; uniform float uOpacity; uniform vec3 uFogOut; uniform int uHasTex, uKind; uniform sampler2D uTex, uEmTex;\n"
            + "void main(){ vec4 c = vec4(vOut, uOpacity);\n"
            + "  if (uHasTex > 0) { vec4 t = texture(uTex, vUv);\n"
            + "    if (uKind == 0 && uHasTex == 1) c.rgb += vEm * t.rgb;\n"
            + "    else if (uKind == 0 && uHasTex == 4) c.rgb = c.rgb * t.rgb + vEm * texture(uEmTex, vUv).rgb;\n"
            + "    else { c.rgb *= t.rgb; if (uKind == 1) c.a *= t.a; } }\n"
            + "  c.rgb = mix(c.rgb, uFogOut, vF);\n"
            + "  outColor = c; }\n";

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

    // Picture passes work on 8 bit colours: medium precision is plenty and much cheaper on phones. Positions in
    // the picture stay high precision, or the image would break up at phone resolutions.
    private static final String POST_FS = "#version 300 es\nprecision mediump float;\nprecision mediump sampler2D;\n";

    // Picks out what glows, a quarter of the size. Four samples so thin neon lines don't flicker as they move.
    private static final String BRIGHT_FS = POST_FS
            + "in highp vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uThr; uniform highp vec2 uUvScale, uTexel;\n"
            + "void main(){ highp vec2 uv = vUv * uUvScale;\n"
            + "  vec3 c = (texture(uSrc, uv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, uv + uTexel * vec2(1.0, -1.0)).rgb\n"
            + "    + texture(uSrc, uv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, uv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;\n"
            + "  float l = max(c.r, max(c.g, c.b));\n"
            + "  o = vec4(c * smoothstep(uThr, uThr + 0.2, l), 1.0); }\n";

    private static final String BLUR_FS = POST_FS
            + "in highp vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform highp vec2 uDir;\n"
            + "void main(){ vec3 c = texture(uSrc, vUv).rgb * 0.227027;\n"
            + "  c += (texture(uSrc, vUv + uDir * 1.3846).rgb + texture(uSrc, vUv - uDir * 1.3846).rgb) * 0.316216;\n"
            + "  c += (texture(uSrc, vUv + uDir * 3.2308).rgb + texture(uSrc, vUv - uDir * 3.2308).rgb) * 0.070270;\n"
            + "  o = vec4(c, 1.0); }\n";

    // Final pass: optional edge anti-aliasing (luma-guided blur along edges), optional sharpening
    // (unsharp mask), then the glow on top. Both use the same four corner samples, so together they cost
    // little more than one of them alone.
    private static final String COMP_FS = POST_FS
            + "in highp vec2 vUv; out vec4 o; uniform sampler2D uScene, uB1, uB2; uniform float uStr, uSharp, uAA; uniform highp vec2 uTexel, uUvScale;\n"
            // The scene fills the lower-left uUvScale part of its texture; never read outside that part.
            + "vec3 S(highp vec2 p){ return texture(uScene, min(p, uUvScale - uTexel * 0.5)).rgb; }\n"
            + "float Lu(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }\n"
            + "void main(){\n"
            + "  highp vec2 uv = vUv * uUvScale;\n"
            + "  vec3 c = S(uv);\n"
            + "  if (uAA > 0.5 || uSharp > 0.01) {\n"
            + "    vec3 A = S(uv + vec2(-1.0, -1.0) * uTexel), B = S(uv + vec2(1.0, -1.0) * uTexel), C = S(uv + vec2(-1.0, 1.0) * uTexel), D = S(uv + vec2(1.0, 1.0) * uTexel);\n"
            + "    if (uSharp > 0.01) c = max(c + (c - (A + B + C + D) * 0.25) * uSharp * 1.3, vec3(0.0));\n"
            + "    if (uAA > 0.5) {\n"
            + "      float lm = Lu(c), a = Lu(A), b = Lu(B), e = Lu(C), d = Lu(D);\n"
            + "      float lo = min(lm, min(min(a, b), min(e, d))), hi = max(lm, max(max(a, b), max(e, d)));\n"
            + "      if (hi - lo >= max(0.04, hi * 0.12)) {\n"
            + "        vec2 dir = vec2(-((a + b) - (e + d)), (a + e) - (b + d));\n"
            + "        float k = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((a + b + e + d) * 0.03125, 0.0078));\n"
            + "        highp vec2 st = clamp(dir * k, vec2(-6.0), vec2(6.0)) * uTexel;\n"
            + "        vec3 n1 = 0.5 * (S(uv - st * 0.1667) + S(uv + st * 0.1667));\n"
            + "        vec3 n2 = 0.5 * n1 + 0.25 * (S(uv - st * 0.5) + S(uv + st * 0.5));\n"
            + "        float l2 = Lu(n2);\n"
            + "        c = (l2 < lo || l2 > hi) ? n1 : n2;\n"
            + "      }\n"
            + "    }\n"
            + "  }\n"
            + "  if (uStr > 0.0) c += (texture(uB1, vUv).rgb * 0.45 + texture(uB2, vUv).rgb * 0.65) * uStr;\n"
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
        p.lModel = loc(p, "uModel"); p.lView = loc(p, "uView"); p.lProj = loc(p, "uProj"); p.lUv = loc(p, "uUv"); p.lInst = loc(p, "uInst");
        p.lColor = loc(p, "uColor"); p.lEmis = loc(p, "uEmissive"); p.lOp = loc(p, "uOpacity"); p.lRough = loc(p, "uRough"); p.lMetal = loc(p, "uMetal");
        p.lPanel = loc(p, "uPanel"); p.lHasTex = loc(p, "uHasTex"); p.lCam = loc(p, "cameraPosition"); p.lHemiS = loc(p, "uHemiSky"); p.lHemiG = loc(p, "uHemiGround");
        p.lHemiI = loc(p, "uHemiI"); p.lMoonC = loc(p, "uMoonColor"); p.lMoonI = loc(p, "uMoonI"); p.lMoonD = loc(p, "uMoonDir"); p.lFogC = loc(p, "uFogColor");
        p.lFogD = loc(p, "uFogDensity"); p.lFog = loc(p, "uFog"); p.lExp = loc(p, "smuExposure"); p.lSpec = loc(p, "uSpec"); p.lKind = loc(p, "uKind"); p.lFogOut = loc(p, "uFogOut");
        if (custom) {
            p.lMM = loc(p, "modelMatrix"); p.lMV = loc(p, "modelViewMatrix"); p.lView = loc(p, "viewMatrix"); p.lProj = loc(p, "projectionMatrix");
            p.lFC = loc(p, "fogColor"); p.lFD = loc(p, "fogDensity");
        }
        // Samplers never change: the material's map on unit 0, the baked noise on its own unit.
        gl.useProgram(id);
        sProg = id;
        Integer tx = p.u.get("uTex"), nz = p.u.get("uNoise"), et = p.u.get("uEmTex");
        if (tx != null) gl.uniform1i(tx, 0);
        if (et != null) gl.uniform1i(et, EM_UNIT);
        if (nz != null) gl.uniform1i(nz, NOISE_UNIT);
        return p;
    }

    private static int loc(Prog p, String name) {
        Integer l = p.u.get(name);
        return l == null ? -1 : l;
    }

    private static final int NOISE_UNIT = 5, NOISE_N = 512, EM_UNIT = 6;

    /**
     * Noise baked once at startup, so shaders read it instead of working it out for every pixel every frame
     * (that sum was by far the most expensive thing in the whole picture). Repeats seamlessly.
     * Red and green: separate random values per texel. Blue and alpha: layered soft noise for clouds and water.
     */
    private void makeNoise() {
        int n = NOISE_N;
        byte[] px = new byte[n * n * 4];
        long r = 0x2545F4914F6CDD1DL;
        for (int k = 0; k < n * n; k++) {
            r ^= r << 13; r ^= r >>> 7; r ^= r << 17;
            px[k * 4] = (byte) r;
            px[k * 4 + 1] = (byte) (r >>> 16);
        }
        // Five layers, each with twice the detail and half the strength. 16 cells of the first across the texture.
        float[] sum = new float[n * n];
        for (int ch = 2; ch < 4; ch++) {
            java.util.Arrays.fill(sum, 0);
            float amp = 0.5f;
            for (int cells = 16; cells <= 256; cells *= 2, amp *= 0.5f) {
                float[] lat = new float[cells * cells];
                for (int k = 0; k < lat.length; k++) {
                    r ^= r << 13; r ^= r >>> 7; r ^= r << 17;
                    lat[k] = (r & 0xFFFF) / 65535f;
                }
                float per = (float) cells / n;
                for (int y = 0; y < n; y++) {
                    float fy = y * per;
                    int y0 = (int) fy, y1 = (y0 + 1) % cells;
                    float ty = fy - y0;
                    ty = ty * ty * (3 - 2 * ty);
                    for (int x = 0; x < n; x++) {
                        float fx = x * per;
                        int x0 = (int) fx, x1 = (x0 + 1) % cells;
                        float tx = fx - x0;
                        tx = tx * tx * (3 - 2 * tx);
                        float a = lat[y0 * cells + x0] + (lat[y0 * cells + x1] - lat[y0 * cells + x0]) * tx;
                        float b = lat[y1 * cells + x0] + (lat[y1 * cells + x1] - lat[y1 * cells + x0]) * tx;
                        sum[y * n + x] += (a + (b - a) * ty) * amp;
                    }
                }
            }
            for (int k = 0; k < n * n; k++) px[k * 4 + ch] = (byte) Math.min(255, Math.round(sum[k] * 255));
        }
        ByteBuffer b = ByteBuffer.allocateDirect(px.length).order(ByteOrder.nativeOrder());
        b.put(px).position(0);
        int t = gl.genTexture();
        gl.activeTexture(GLC.TEXTURE0 + NOISE_UNIT);
        gl.bindTexture(GLC.TEXTURE_2D, t);
        gl.texImage2D(GLC.TEXTURE_2D, 0, GLC.RGBA8, n, n, GLC.RGBA, GLC.UNSIGNED_BYTE, b);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MIN_FILTER, GLC.LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_MAG_FILTER, GLC.LINEAR);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_S, GLC.REPEAT);
        gl.texParameteri(GLC.TEXTURE_2D, GLC.TEXTURE_WRAP_T, GLC.REPEAT);
        gl.activeTexture(GLC.TEXTURE0);
    }

    private static final String[] STD_U = {"uModel", "uView", "uProj", "uUv", "uInst", "uColor", "uEmissive", "uOpacity", "uRough", "uMetal",
            "uPanel", "uHasTex", "uTex", "cameraPosition", "uHemiSky", "uHemiGround", "uHemiI", "uMoonColor", "uMoonI", "uMoonDir",
            "uFogColor", "uFogDensity", "uFog", "smuExposure", "uNoise", "uSpec", "uKind", "uFogOut", "uEmTex"};

    private void buildPrograms() {
        makeNoise();
        lit = program(STD_VS, LIT_FS, "lit", false, STD_U);
        lite = program(LITE_VS, LITE_FS, "lite", false, STD_U);
        basic = program(STD_VS, BASIC_FS, "basic", false, STD_U);
        sprite = program(SPRITE_VS, SPRITE_FS, "sprite", false, STD_U);
        bright = program(POST_VS, BRIGHT_FS, "bright", false, "uSrc", "uThr", "uUvScale", "uTexel");
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
        out.add(new String[]{"lite", LITE_VS, LITE_FS});
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
        Collections.addAll(names, "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix", "cameraPosition", "fogColor", "fogDensity", "smuExposure", "uNoise");
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
        int[][] sz = {{w / 4, h / 4}, {w / 4, h / 4}, {w / 8, h / 8}, {w / 8, h / 8}};
        for (int k = 0; k < 4; k++) {
            bloomTex[k] = colorTex(Math.max(1, sz[k][0]), Math.max(1, sz[k][1]));
            bloomFbo[k] = fbo(bloomTex[k], 0);
        }
    }

    private void pass(Prog p, int dst, int dw, int dh, int src) {
        gl.bindFramebuffer(GLC.FRAMEBUFFER, dst);
        gl.viewport(0, 0, dw, dh);
        // Every pixel gets redrawn: clearing tells a phone GPU not to load the old picture into memory first.
        gl.clear(GLC.COLOR_BUFFER_BIT);
        gl.useProgram(p.id);
        gl.activeTexture(GLC.TEXTURE0);
        gl.bindTexture(GLC.TEXTURE_2D, src);
        gl.drawArrays(GLC.TRIANGLES, 0, 3);
    }

    private void post(boolean bloom) {
        // The scene's depth is finished with: no need for the GPU to write it back to memory.
        gl.invalidateDepth();
        gl.disable(GLC.DEPTH_TEST);
        gl.disable(GLC.BLEND);
        gl.disable(GLC.CULL_FACE);
        gl.depthMask(false);
        gl.bindVertexArray(quadVao);
        if (bloom) bloomPasses();
        measureGpu();
        gl.bindFramebuffer(GLC.FRAMEBUFFER, 0);
        gl.viewport(0, 0, w, h);
        gl.depthMask(true);
        gl.clear(GLC.COLOR_BUFFER_BIT | GLC.DEPTH_BUFFER_BIT);
        gl.depthMask(false);
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

    /**
     * Every twelfth frame, waits for the GPU to catch up and notes how long the frame has taken so far. That is the
     * true load, on any phone, and it shows trouble coming before frames actually drop. The wait costs nothing:
     * the screen's picture is only started afterwards, and the GPU would be busy until then anyway.
     */
    private void measureGpu() {
        if (++gpuEvery < 12) return;
        gpuEvery = 0;
        long f = gl.fenceSync();
        if (f == 0) return;
        gl.clientWaitSync(f, 50_000_000L);
        gl.deleteSync(f);
        if (gpuSamples < gpuMs.length) gpuMs[gpuSamples++] = (System.nanoTime() - frameStart) / 1e6f;
    }

    private void bloomPasses() {
        int qw = Math.max(1, w / 4), qh = Math.max(1, h / 4), ew = Math.max(1, w / 8), eh = Math.max(1, h / 8);
        gl.useProgram(bright.id);
        ui(bright, "uSrc", 0);
        u(bright, "uThr", env[22]);
        Integer us = bright.u.get("uUvScale");
        if (us != null) gl.uniform2f(us, (float) rw / w, (float) rh / h);
        Integer tx = bright.u.get("uTexel");
        if (tx != null) gl.uniform2f(tx, 1f / w, 1f / h);
        gl.clearColor(0, 0, 0, 1);
        pass(bright, bloomFbo[0], qw, qh, sceneTex);
        gl.useProgram(blur.id);
        ui(blur, "uSrc", 0);
        // A quarter and an eighth of the size with half the step: the same width of glow as before for a
        // quarter of the pixels.
        float rad = Math.max(0.75f, (1 + env[21] * 2) * 0.5f);
        Integer dir = blur.u.get("uDir");
        gl.uniform2f(dir, rad / qw, 0);
        pass(blur, bloomFbo[1], qw, qh, bloomTex[0]);
        gl.uniform2f(dir, 0, rad / qh);
        pass(blur, bloomFbo[0], qw, qh, bloomTex[1]);
        gl.uniform2f(dir, rad / ew, 0);
        pass(blur, bloomFbo[3], ew, eh, bloomTex[0]);
        gl.uniform2f(dir, 0, rad / eh);
        pass(blur, bloomFbo[2], ew, eh, bloomTex[3]);
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
