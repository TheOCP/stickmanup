package io.stickmanup;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.net.wifi.WifiManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Local multiplayer transport. WiFi uses TCP with UDP broadcast discovery, Bluetooth uses RFCOMM.
 * Both carry newline-separated JSON messages and report to JavaScript through NET_* callbacks.
 */
final class Net {

    interface Out {
        void js(String code);
    }

    static final int TCP_PORT = 47800, UDP_PORT = 47801;
    private static final UUID BT_UUID = UUID.fromString("ef736845-41ad-40e2-8761-a3d156e0faa9");
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String POISON = "\u0000close";

    private final Context ctx;
    private final Out out;
    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    private final AtomicInteger ids = new AtomicInteger(1);
    private volatile ServerSocket server;
    private volatile BluetoothServerSocket btServer;
    private volatile DatagramSocket discSock;
    private volatile boolean discovering;
    private volatile String hostName = "";
    private volatile int players = 1, port;
    private WifiManager.MulticastLock lock;

    Net(Context ctx, Out out) {
        this.ctx = ctx.getApplicationContext();
        this.out = out;
    }

    private static String q(String s) {
        return JSONObject.quote(s);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
        }
    }

    private static Thread run(String name, Runnable r) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        t.start();
        return t;
    }

    private static String err(String msg) {
        return "{\"ok\":false,\"err\":" + q(msg) + "}";
    }

    /** One open connection with a reader thread and a batching writer thread. */
    private final class Conn {
        final String id;
        final Closeable sock;
        final InputStream in;
        final OutputStream os;
        final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<>();

        Conn(String id, Closeable sock, InputStream in, OutputStream os) {
            this.id = id;
            this.sock = sock;
            this.in = in;
            this.os = os;
        }

        void start() {
            run("smu-read-" + id, new Runnable() {
                @Override
                public void run() {
                    String why = "left";
                    try {
                        BufferedReader r = new BufferedReader(new InputStreamReader(in, UTF8), 16384);
                        String line;
                        while ((line = r.readLine()) != null) {
                            if (!line.isEmpty()) out.js("NET_msg(" + q(id) + "," + q(line) + ")");
                        }
                    } catch (IOException e) {
                        why = "Connection lost";
                    }
                    close(id, why, false);
                }
            });
            run("smu-write-" + id, new Runnable() {
                @Override
                public void run() {
                    try {
                        while (true) {
                            String m = queue.take();
                            if (m == POISON) break;
                            StringBuilder sb = new StringBuilder(m).append('\n');
                            while ((m = queue.poll()) != null && m != POISON) sb.append(m).append('\n');
                            os.write(sb.toString().getBytes(UTF8));
                            os.flush();
                            if (m == POISON) break;
                        }
                    } catch (Exception e) {
                        close(id, "Connection lost", false);
                    }
                }
            });
        }
    }

    private void register(String prefix, Closeable sock, InputStream in, OutputStream os) {
        String id = prefix + ids.getAndIncrement();
        Conn c = new Conn(id, sock, in, os);
        conns.put(id, c);
        c.start();
        out.js("NET_open(" + q(id) + ")");
    }

    void send(String id, String msg) {
        Conn c = conns.get(id);
        if (c != null) c.queue.offer(msg);
    }

    void close(String id, String why, boolean quiet) {
        Conn c = conns.remove(id);
        if (c == null) return;
        c.queue.offer(POISON);
        try {
            c.sock.close();
        } catch (IOException ignored) {
        }
        if (!quiet) out.js("NET_close(" + q(id) + "," + q(why) + ")");
    }

    synchronized void stopAll() {
        discover(false);
        ServerSocket s = server;
        server = null;
        if (s != null) try {
            s.close();
        } catch (IOException ignored) {
        }
        BluetoothServerSocket b = btServer;
        btServer = null;
        if (b != null) try {
            b.close();
        } catch (IOException ignored) {
        }
        for (String id : new ArrayList<>(conns.keySet())) close(id, "", true);
    }

    void info(String name, int n) {
        hostName = name;
        players = n;
    }

    // ---------- WiFi ----------

    JSONArray addrs() {
        JSONArray a = new JSONArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress ad : Collections.list(ni.getInetAddresses())) {
                    if (ad instanceof Inet4Address) a.put(ad.getHostAddress());
                }
            }
        } catch (Exception ignored) {
        }
        return a;
    }

    private List<InetAddress> broadcasts() {
        List<InetAddress> l = new ArrayList<>();
        try {
            l.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getBroadcast() != null) l.add(ia.getBroadcast());
                }
            }
        } catch (Exception ignored) {
        }
        return l;
    }

    synchronized String hostLan(String name) {
        stopAll();
        hostName = name;
        players = 1;
        ServerSocket s = null;
        int p = TCP_PORT;
        for (; p < TCP_PORT + 10; p++) {
            try {
                s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p));
                break;
            } catch (IOException e) {
                s = null;
            }
        }
        if (s == null) return err("Could not open a network port.");
        final ServerSocket srv = s;
        server = srv;
        port = p;
        run("smu-accept", new Runnable() {
            @Override
            public void run() {
                while (server == srv) {
                    try {
                        Socket c = srv.accept();
                        c.setTcpNoDelay(true);
                        c.setKeepAlive(true);
                        register("w", c, c.getInputStream(), c.getOutputStream());
                    } catch (IOException e) {
                        if (server != srv) return;
                    }
                }
            }
        });
        run("smu-beacon", new Runnable() {
            @Override
            public void run() {
                DatagramSocket ds = null;
                try {
                    ds = new DatagramSocket();
                    ds.setBroadcast(true);
                    while (server == srv) {
                        byte[] b = ("SLINK1|" + port + "|" + players + "|" + hostName).getBytes(UTF8);
                        for (InetAddress a : broadcasts()) {
                            try {
                                ds.send(new DatagramPacket(b, b.length, a, UDP_PORT));
                            } catch (IOException ignored) {
                            }
                        }
                        sleep(1000);
                    }
                } catch (IOException ignored) {
                } finally {
                    if (ds != null) ds.close();
                }
            }
        });
        return "{\"ok\":true,\"port\":" + p + ",\"ips\":" + addrs() + "}";
    }

    synchronized void discover(boolean on) {
        if (!on) {
            discovering = false;
            DatagramSocket d = discSock;
            if (d != null) d.close();
            if (lock != null && lock.isHeld()) lock.release();
            return;
        }
        if (discovering) return;
        discovering = true;
        try {
            WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                lock = wm.createMulticastLock("stickmanup");
                lock.acquire();
            }
        } catch (Exception ignored) {
        }
        run("smu-discover", new Runnable() {
            @Override
            public void run() {
                Map<String, JSONObject> seen = new LinkedHashMap<>();
                String last = "";
                try {
                    DatagramSocket ds = new DatagramSocket(null);
                    ds.setReuseAddress(true);
                    ds.setBroadcast(true);
                    ds.bind(new InetSocketAddress(UDP_PORT));
                    ds.setSoTimeout(1000);
                    discSock = ds;
                    byte[] buf = new byte[512];
                    while (discovering) {
                        try {
                            DatagramPacket pk = new DatagramPacket(buf, buf.length);
                            ds.receive(pk);
                            String[] f = new String(pk.getData(), 0, pk.getLength(), UTF8).split("\\|", 4);
                            if (f.length == 4 && "SLINK1".equals(f[0])) {
                                String ip = pk.getAddress().getHostAddress();
                                JSONObject o = new JSONObject();
                                o.put("ip", ip).put("port", Integer.parseInt(f[1])).put("n", Integer.parseInt(f[2]))
                                        .put("name", f[3]).put("t", System.currentTimeMillis());
                                seen.put(ip, o);
                            }
                        } catch (SocketTimeoutException ignored) {
                        }
                        JSONArray a = new JSONArray();
                        for (Iterator<JSONObject> it = seen.values().iterator(); it.hasNext(); ) {
                            JSONObject o = it.next();
                            if (System.currentTimeMillis() - o.getLong("t") > 3500) it.remove();
                            else a.put(new JSONObject().put("ip", o.get("ip")).put("port", o.get("port")).put("n", o.get("n")).put("name", o.get("name")));
                        }
                        String s = a.toString();
                        if (!s.equals(last)) {
                            last = s;
                            out.js("NET_found(" + s + ")");
                        }
                    }
                    ds.close();
                } catch (Exception e) {
                    if (discovering) out.js("NET_found([])");
                }
            }
        });
    }

    void joinLan(final String ip, final int p) {
        run("smu-join", new Runnable() {
            @Override
            public void run() {
                try {
                    Socket c = new Socket();
                    c.connect(new InetSocketAddress(ip, p > 0 ? p : TCP_PORT), 9000);
                    c.setTcpNoDelay(true);
                    c.setKeepAlive(true);
                    register("h", c, c.getInputStream(), c.getOutputStream());
                } catch (Exception e) {
                    out.js("NET_fail(" + q("Could not reach " + ip + ". On WiFi: are you on the same network or hotspot? Direct: the host's router has to let you in (see the host's lobby).") + ")");
                }
            }
        });
    }

    // ---------- Bluetooth ----------

    String btDevices() {
        JSONArray a = new JSONArray();
        try {
            BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
            if (ad != null) {
                for (BluetoothDevice d : ad.getBondedDevices()) {
                    a.put(new JSONObject().put("name", d.getName() == null ? "" : d.getName()).put("addr", d.getAddress()));
                }
            }
        } catch (Exception ignored) {
        }
        return a.toString();
    }

    synchronized String hostBt(String name) {
        stopAll();
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad == null) return err("This phone has no Bluetooth.");
        final BluetoothServerSocket srv;
        String devName = "";
        try {
            srv = ad.listenUsingInsecureRfcommWithServiceRecord("StickManUp", BT_UUID);
            devName = ad.getName();
        } catch (Exception e) {
            return err("Could not start Bluetooth hosting. Is Bluetooth on?");
        }
        btServer = srv;
        run("smu-bt-accept", new Runnable() {
            @Override
            public void run() {
                while (btServer == srv) {
                    try {
                        BluetoothSocket s = srv.accept();
                        register("b", s, s.getInputStream(), s.getOutputStream());
                    } catch (IOException e) {
                        if (btServer != srv) return;
                        sleep(300);
                    }
                }
            }
        });
        return "{\"ok\":true,\"name\":" + q(devName == null ? "" : devName) + "}";
    }

    void joinBt(final String addr) {
        run("smu-bt-join", new Runnable() {
            @Override
            public void run() {
                BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                try {
                    try {
                        ad.cancelDiscovery();
                    } catch (Exception ignored) {
                    }
                    BluetoothDevice d = ad.getRemoteDevice(addr);
                    BluetoothSocket s;
                    try {
                        s = d.createInsecureRfcommSocketToServiceRecord(BT_UUID);
                        s.connect();
                    } catch (IOException first) {
                        s = d.createRfcommSocketToServiceRecord(BT_UUID);
                        s.connect();
                    }
                    register("h", s, s.getInputStream(), s.getOutputStream());
                } catch (Exception e) {
                    out.js("NET_fail(" + q("Could not connect over Bluetooth. Is the host phone waiting in its lobby?") + ")");
                }
            }
        });
    }
}
