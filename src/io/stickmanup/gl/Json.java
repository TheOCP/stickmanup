package io.stickmanup.gl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Tiny JSON reader (objects to Map, arrays to List, numbers to Double). Works the same on Android and desktop. */
final class Json {
    private final String s;
    private int i;

    private Json(String s) {
        this.s = s;
    }

    static Object parse(String s) {
        Json j = new Json(s);
        j.ws();
        return j.value();
    }

    private void ws() {
        while (i < s.length() && s.charAt(i) <= ' ') i++;
    }

    private Object value() {
        char c = s.charAt(i);
        if (c == '{') {
            Map<String, Object> m = new HashMap<>();
            i++;
            ws();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws();
                String k = str();
                ws();
                i++; // ':'
                ws();
                m.put(k, value());
                ws();
                if (s.charAt(i++) == '}') return m;
            }
        }
        if (c == '[') {
            List<Object> l = new ArrayList<>();
            i++;
            ws();
            if (s.charAt(i) == ']') { i++; return l; }
            while (true) {
                ws();
                l.add(value());
                ws();
                if (s.charAt(i++) == ']') return l;
            }
        }
        if (c == '"') return str();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int st = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        return Double.parseDouble(s.substring(st, i));
    }

    private String str() {
        StringBuilder b = new StringBuilder();
        i++;
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                default: b.append(e);
            }
        }
    }

    /** Fast comma-separated float list. */
    static float[] floats(String csv) {
        if (csv == null || csv.isEmpty()) return new float[0];
        int n = 1;
        for (int k = 0; k < csv.length(); k++) if (csv.charAt(k) == ',') n++;
        float[] out = new float[n];
        int st = 0, j = 0;
        for (int k = 0; k <= csv.length(); k++) {
            if (k == csv.length() || csv.charAt(k) == ',') {
                out[j++] = Float.parseFloat(csv.substring(st, k));
                st = k + 1;
            }
        }
        return out;
    }

    private static final int[] B64 = new int[128];

    static {
        String a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int k = 0; k < a.length(); k++) B64[a.charAt(k)] = k;
    }

    /** Standard base64 to bytes (java.util.Base64 isn't in the API level this builds against). */
    static byte[] b64(String s) {
        int len = s.length(), pad = len > 0 && s.charAt(len - 1) == '=' ? (len > 1 && s.charAt(len - 2) == '=' ? 2 : 1) : 0;
        byte[] out = new byte[len / 4 * 3 - pad];
        int o = 0;
        for (int k = 0; k < len; k += 4) {
            int v = (B64[s.charAt(k)] << 18) | (B64[s.charAt(k + 1)] << 12) | (B64[s.charAt(k + 2) & 127] << 6) | B64[s.charAt(k + 3) & 127];
            if (o < out.length) out[o++] = (byte) (v >> 16);
            if (o < out.length) out[o++] = (byte) (v >> 8);
            if (o < out.length) out[o++] = (byte) v;
        }
        return out;
    }
}
