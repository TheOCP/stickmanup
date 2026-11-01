package io.stickmanup;

import android.os.Build;
import android.os.Process;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Developer diagnostics. If a receiver listens on 127.0.0.1:47999 on the same phone (dev/diag_server.py run
 * from Termux), this streams game state, screen probes and this app's own log lines to it. With no receiver
 * it just retries quietly for a few minutes and stops. Nothing leaves the phone.
 */
final class Diag {

    interface Snapshot {
        JSONObject snap();
    }

    private static final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<>(400);

    static void send(String kind, Object... kv) {
        try {
            JSONObject o = new JSONObject().put("k", kind).put("up", SystemClock.uptimeMillis());
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
            queue.offer(o.toString());
        } catch (Exception ignored) {
        }
    }

    static void raw(String line) {
        queue.offer(line);
    }

    static void start(final String header, final Snapshot snapshot) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                long until = SystemClock.uptimeMillis() + 15 * 60 * 1000;
                Socket s = null;
                PrintWriter w = null;
                int n = 0;
                while (SystemClock.uptimeMillis() < until) {
                    try {
                        if (s == null) {
                            s = new Socket();
                            s.connect(new InetSocketAddress("127.0.0.1", 47999), 300);
                            w = new PrintWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"), true);
                            w.println(header);
                        }
                        String line;
                        while ((line = queue.poll()) != null) w.println(line);
                        w.println(snapshot.snap().toString());
                        if (n++ % 4 == 0) w.println(new JSONObject().put("k", "logcat").put("text", logcat()).toString());
                        if (w.checkError()) throw new Exception("closed");
                    } catch (Exception e) {
                        try {
                            if (s != null) s.close();
                        } catch (Exception ignored) {
                        }
                        s = null;
                    }
                    SystemClock.sleep(2000);
                }
            }
        }, "smu-diag");
        t.setDaemon(true);
        t.start();
    }

    /** The last lines this app process logged (WebView console, GPU and driver messages land here). */
    private static String logcat() {
        StringBuilder sb = new StringBuilder();
        try {
            java.lang.Process p = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-v", "time", "-t", "150", "--pid=" + Process.myPid()});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), "UTF-8"));
            String l;
            while ((l = r.readLine()) != null && sb.length() < 24000) sb.append(l).append('\n');
            p.destroy();
        } catch (Exception e) {
            sb.append("logcat failed: ").append(e);
        }
        return sb.toString();
    }

    static String header(int safe, String why, String webview) {
        try {
            return new JSONObject().put("k", "hello").put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT)
                    .put("safe", safe).put("lastWhy", why).put("webview", webview).put("app", MainActivity.VERSION).toString();
        } catch (Exception e) {
            return "{\"k\":\"hello\"}";
        }
    }
}
