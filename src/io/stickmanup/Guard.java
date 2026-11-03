package io.stickmanup;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.Debug;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;

// What this phone can say about itself, for the anticheat. Nothing here stops anyone playing, and nothing leaves the phone
// except the answers to these questions: is the app ours, is something tampering with it, are cheat tools installed. A
// determined person can make a phone lie, so only what looks wrong counts, and never just being rooted. The real proof that a
// climb was honest is the server replaying it (server/lib/verify-worker.mjs). This catches people before and around that.
final class Guard {
    // Well known apps for changing other apps' memory or patching them.
    private static final String[] TOOLS = {
        "catch_.me_.if_.you_.can_", "com.cih.game_cih", "cn.mc.sq", "org.sbtools.gamehack", "com.luckypatchers.luckypatcherinstaller", "com.android.vending.billing.InAppBillingService.LUCK",
        "com.android.vending.billing.InAppBillingService.CLON", "com.chelpus.lackypatch", "com.dimonvideo.luckypatcher", "com.forpda.lp", "ru.aaaaaaac.installer", "ru.gameguardian", "com.xmodgame", "com.gamecih.cheat", "com.sbgamehacker.pro",
        "com.saitesoft.gamecheater",
    };
    private static final String[] SU = { "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su", "/vendor/bin/su", "/data/adb/magisk", "/data/adb/ksu", "/data/adb/ap", "/system/app/Superuser.apk" };
    private static final String[] ROOT_APPS = { "com.topjohnwu.magisk", "me.weishu.kernelsu", "me.bmax.apatch", "eu.chainfire.supersu" };
    private static final String[] HOOK_APPS = { "de.robv.android.xposed.installer", "org.lsposed.manager", "org.meowcat.edxposed.manager", "com.solohsu.android.edxp.manager" };
    private static final int FRIDA_PORT = 27042;

    private Guard() {}

    // A number that belongs to this phone and this app, and means nothing to anyone else.
    @SuppressLint("HardwareIds")
    static String deviceId(Context c) {
        try {
            String id = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ANDROID_ID);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(("stickmanup:" + id).getBytes("UTF-8"));
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 16; i++) s.append(String.format("%02x", h[i] & 0xff));
            return s.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // The whole check. Takes a moment, so it runs off the main thread (see MainActivity) and the game reads the last answer.
    static String scan(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("version", appVersion(c));
            o.put("model", (Build.MANUFACTURER + " " + Build.MODEL));
            o.put("sdk", String.valueOf(Build.VERSION.SDK_INT));
            o.put("sig", signatureOk(c));
            o.put("assets", assetsOk(c));
            o.put("dbg", Debug.isDebuggerConnected() || Debug.waitingForDebugger() || tracerPid() > 0);
            String maps = readMaps();
            o.put("frida", maps.contains("frida") || maps.contains("gum-js") || maps.contains("linjector") || threadNamed() || portOpen(FRIDA_PORT));
            o.put("hook", maps.contains("xposed") || maps.contains("lspd") || maps.contains("edxp") || maps.contains("substrate") || xposedClass() || installedAny(c, HOOK_APPS));
            o.put("root", isRooted(c));
            o.put("emu", isEmulator());
            JSONArray apps = new JSONArray();
            for (String t : TOOLS) if (installed(c, t)) apps.put(t);
            o.put("apps", apps);
        } catch (Exception e) {
            // Whatever could be found out is what gets reported.
        }
        return o.toString();
    }

    private static String appVersion(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    // Our signing key, hashed. A changed copy of the app can't be signed with it. This is the same value as server/lib/app-signature.txt.
    private static final String OFFICIAL = "790b431750556cdd38cf1156414bfae2c9f33076ca1b25778a74ab4ce49bf0aa";

    @SuppressWarnings("deprecation")
    private static boolean signatureOk(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNATURES);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(pi.signatures[0].toByteArray());
            StringBuilder s = new StringBuilder();
            for (byte b : h) s.append(String.format("%02x", b & 0xff));
            return OFFICIAL.equals(s.toString());
        } catch (Exception e) {
            return true;
        }
    }

    // The game's code, against the list of hashes made at build time (build.sh writes assets/guard.txt: "hash file" per line).
    private static boolean assetsOk(Context c) {
        AssetManager am = c.getAssets();
        try (BufferedReader r = new BufferedReader(new java.io.InputStreamReader(am.open("guard.txt")))) {
            String line;
            while ((line = r.readLine()) != null) {
                int sp = line.indexOf(' ');
                if (sp < 0) continue;
                String want = line.substring(0, sp), file = line.substring(sp + 1);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = am.open(file)) {
                    byte[] b = new byte[16384];
                    int n;
                    while ((n = in.read(b)) > 0) md.update(b, 0, n);
                }
                StringBuilder s = new StringBuilder();
                for (byte x : md.digest()) s.append(String.format("%02x", x & 0xff));
                if (!want.equals(s.toString())) return false;
            }
            return true;
        } catch (Exception e) {
            return true;
        }
    }

    private static int tracerPid() {
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/status"))) {
            String l;
            while ((l = r.readLine()) != null) if (l.startsWith("TracerPid:")) return Integer.parseInt(l.substring(10).trim());
        } catch (Exception e) {
            // Not readable: nothing to report.
        }
        return 0;
    }

    private static String readMaps() {
        StringBuilder s = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/maps"))) {
            String l;
            while ((l = r.readLine()) != null) {
                int i = l.indexOf('/');
                if (i >= 0) { String p = l.substring(i).toLowerCase(java.util.Locale.ROOT); if (p.endsWith(".so") || p.contains("frida") || p.contains("xposed") || p.contains("lspd")) s.append(p).append('\n'); }
            }
        } catch (Exception e) {
            // Not readable: nothing to report.
        }
        return s.toString();
    }

    private static boolean threadNamed() {
        try {
            File[] tasks = new File("/proc/self/task").listFiles();
            if (tasks == null) return false;
            boolean gmain = false, gdbus = false;
            for (File t : tasks) {
                try (BufferedReader r = new BufferedReader(new FileReader(new File(t, "comm")))) {
                    String n = r.readLine();
                    if (n == null) continue;
                    if (n.contains("gum-js-loop") || n.contains("pool-frida")) return true;
                    // These two names alone mean little. Frida brings both.
                    if (n.contains("gmain")) gmain = true;
                    if (n.contains("gdbus")) gdbus = true;
                } catch (Exception e) {
                    // That thread just ended.
                }
            }
            return gmain && gdbus;
        } catch (Exception e) {
            // Not readable: nothing to report.
        }
        return false;
    }

    private static boolean portOpen(int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", port), 60);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean xposedClass() {
        try {
            ClassLoader.getSystemClassLoader().loadClass("de.robv.android.xposed.XposedBridge");
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    private static boolean installed(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
    private static boolean installedAny(Context c, String[] pkgs) {
        for (String p : pkgs) if (installed(c, p)) return true;
        return false;
    }

    private static boolean isRooted(Context c) {
        if (Build.TAGS != null && Build.TAGS.contains("test-keys")) return true;
        for (String p : SU) if (new File(p).exists()) return true;
        return installedAny(c, ROOT_APPS);
    }

    private static boolean isEmulator() {
        String f = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT, m = Build.MODEL == null ? "" : Build.MODEL, h = Build.HARDWARE == null ? "" : Build.HARDWARE;
        return f.startsWith("generic") || f.contains("emulator") || f.contains("sdk_gphone") || m.contains("Emulator") || m.contains("Android SDK") || h.contains("goldfish") || h.contains("ranchu") || h.contains("vbox");
    }

    // ------------------------------------------------------------------ the hardware's own word
    // The phone's secure chip signs a statement about this app and this question from the server, with a key it never lets
    // out, on a certificate chain back to Google. Modified apps and rooted phones can't make this up.
    static String attest(String challenge) {
        JSONObject o = new JSONObject();
        final String alias = "stickmanup.attest";
        try {
            o.put("challenge", challenge);
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN).setDigests(KeyProperties.DIGEST_SHA256);
            // Newer than what this is compiled against, and always there on the phones the game runs on.
            KeyGenParameterSpec.Builder.class.getMethod("setAttestationChallenge", byte[].class).invoke(b, (Object) challenge.getBytes("UTF-8"));
            g.initialize(b.build());
            g.generateKeyPair();
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            Certificate[] chain = ks.getCertificateChain(alias);
            JSONArray list = new JSONArray();
            if (chain != null) for (Certificate x : chain) list.put(Base64.encodeToString(x.getEncoded(), Base64.NO_WRAP));
            o.put("chain", list);
            if (list.length() == 0) o.put("err", "no certificates");
            ks.deleteEntry(alias);
        } catch (Throwable e) {
            try {
                o.put("err", String.valueOf(e.getClass().getSimpleName()));
            } catch (Exception x) {
                return "{\"err\":\"failed\"}";
            }
        }
        return o.toString();
    }
}
