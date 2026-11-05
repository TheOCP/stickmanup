package io.stickmanup;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Brings in a newer release without going to a web page: downloads the APK of the latest GitHub release and hands it to Android.
 * Android installs it over this one only when it is signed with the same key, and shows its own Update screen for it. The address
 * is fixed here: the page can only say when, never what.
 */
final class Updater {
    static final String ACTION = "io.stickmanup.INSTALLED";
    private static final String APK = "https://github.com/TheOCP/stickmanup/releases/latest/download/StickManUp.apk";
    private static final int USER_ACTION_NOT_REQUIRED = 2;
    private static final int FLAG_MUTABLE = 0x02000000;

    private final MainActivity a;
    private boolean busy;
    private volatile int session = -1;

    Updater(MainActivity a) {
        this.a = a;
    }

    private File file() {
        return new File(a.getCacheDir(), "update.apk");
    }

    private void say(String what, String v) {
        a.js("window.SMU_update&&SMU_update(" + JSONObject.quote(what) + "," + JSONObject.quote(v) + ")");
    }

    private synchronized boolean take() {
        if (busy) return false;
        busy = true;
        return true;
    }

    private synchronized void free() {
        busy = false;
    }

    /** Android 8 and later ask once whether this app may install others. Newer than the SDK this builds against. */
    boolean allowed() {
        try {
            return (Boolean) PackageManager.class.getMethod("canRequestPackageInstalls").invoke(a.getPackageManager());
        } catch (Exception e) {
            return true;
        }
    }

    void askAllow() {
        try {
            a.startActivity(new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:" + a.getPackageName())));
        } catch (Exception e) {
            say("failed", "install");
        }
    }

    void get() {
        if (!take()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    download();
                    say(check() ? "ready" : "failed", "old");
                } catch (Exception e) {
                    say("failed", "net");
                } finally {
                    free();
                }
            }
        }, "update").start();
    }

    private void download() throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(APK).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        InputStream in = null;
        OutputStream out = null;
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            long total = -1;
            try {
                total = Long.parseLong(c.getHeaderField("Content-Length"));
            } catch (Exception ignored) {
            }
            in = c.getInputStream();
            out = new FileOutputStream(file());
            byte[] buf = new byte[65536];
            long got = 0;
            int n, last = -1;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                got += n;
                if (total > 0) {
                    int pct = (int) (got * 100 / total);
                    if (pct != last) {
                        last = pct;
                        say("progress", String.valueOf(pct));
                    }
                }
            }
            if (total > 0 && got != total) throw new IOException("cut short");
        } finally {
            if (out != null) try { out.close(); } catch (IOException ignored) { }
            if (in != null) try { in.close(); } catch (IOException ignored) { }
            c.disconnect();
        }
    }

    /** That it is this game and really a newer one. Whether it is signed by the same hand is Android's to check. */
    private boolean check() {
        try {
            PackageManager pm = a.getPackageManager();
            PackageInfo got = pm.getPackageArchiveInfo(file().getPath(), 0);
            if (got == null || !a.getPackageName().equals(got.packageName)) return false;
            return got.versionCode > pm.getPackageInfo(a.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return false;
        }
    }

    void install() {
        if (!take()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    commit();
                    say("confirm", "");
                } catch (Exception e) {
                    say("failed", "install");
                } finally {
                    free();
                }
            }
        }, "update").start();
    }

    private void commit() throws IOException {
        File f = file();
        PackageInstaller pi = a.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(a.getPackageName());
        sp.setSize(f.length());
        // Android 12 and later: once this app installed the game itself, it may update it without asking. Android decides.
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                PackageInstaller.SessionParams.class.getMethod("setRequireUserAction", int.class).invoke(sp, USER_ACTION_NOT_REQUIRED);
            } catch (Exception ignored) {
            }
        }
        int id = pi.createSession(sp);
        PackageInstaller.Session s = null;
        InputStream in = null;
        OutputStream out = null;
        boolean sent = false;
        try {
            s = pi.openSession(id);
            in = new FileInputStream(f);
            out = s.openWrite("base.apk", 0, f.length());
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            s.fsync(out);
            out.close();
            out = null;
            Intent back = new Intent(a, MainActivity.class).setAction(ACTION);
            PendingIntent pe = PendingIntent.getActivity(a, id, back, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_MUTABLE);
            session = id;
            s.commit(pe.getIntentSender());
            sent = true;
        } finally {
            if (out != null) try { out.close(); } catch (IOException ignored) { }
            if (in != null) try { in.close(); } catch (IOException ignored) { }
            if (s != null) s.close();
            if (!sent) {
                session = -1;
                try { pi.abandonSession(id); } catch (Exception ignored) { }
            }
            f.delete();
        }
    }

    /** What Android says about the install (MainActivity.onNewIntent). Anyone can send this activity an intent, so only the session this started counts. */
    void result(Intent i) {
        int id = session;
        if (id < 0 || i.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1) != id) return;
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent ask = i.getParcelableExtra(Intent.EXTRA_INTENT);
            ComponentName cn = ask == null ? null : ask.getComponent();
            String pkg = cn != null ? cn.getPackageName() : ask == null ? null : ask.getPackage();
            if (ask == null || a.getPackageName().equals(pkg)) {
                session = -1;
                say("failed", "install");
                return;
            }
            try {
                ask.setFlags(ask.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
                a.startActivity(ask);
            } catch (Exception e) {
                session = -1;
                say("failed", "install");
            }
            return;
        }
        session = -1;
        if (st == PackageInstaller.STATUS_SUCCESS) say("done", "");
        else if (st == PackageInstaller.STATUS_FAILURE_ABORTED) say("cancel", "");
        else say("failed", "install");
    }
}
