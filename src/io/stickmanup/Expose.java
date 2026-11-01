package io.stickmanup;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.SecureRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Direct internet hosting, without any game server: asks the home router to forward the game's TCP port to
 * this phone (UPnP), and learns the public internet address with one STUN request (a standard address
 * lookup, the same one WebRTC uses). Friends then connect straight to that address.
 *
 * Works when the host is on a home Wi-Fi whose router allows UPnP. Most mobile networks put phones behind
 * carrier NAT, which no app can open; that case is detected and reported.
 */
final class Expose {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String[] SERVICES = {
            "urn:schemas-upnp-org:service:WANIPConnection:2",
            "urn:schemas-upnp-org:service:WANIPConnection:1",
            "urn:schemas-upnp-org:service:WANPPPConnection:1"};

    private String control, service;
    private int mapped = -1;

    /** Opens the port (best effort) and returns a JSON report: {ok, ip, port, upnp, cgnat, err}. */
    synchronized String open(int localPort) {
        JSONObject r = new JSONObject();
        String upnpIp = null, err = null;
        boolean upnp = false;
        try {
            if (discover()) {
                String local = localAddressTowards(new URL(control).getHost());
                for (int p = localPort; p < localPort + 10 && !upnp; p++) {
                    upnp = addMapping(p, localPort, local);
                    if (upnp) mapped = p;
                }
                upnpIp = externalIp();
            } else err = "No UPnP router found";
        } catch (Exception e) {
            err = "UPnP: " + e.getMessage();
        }
        String stunIp = stun();
        try {
            String ip = stunIp != null ? stunIp : upnpIp;
            r.put("ok", ip != null);
            r.put("ip", ip == null ? "" : ip);
            r.put("port", upnp ? mapped : localPort);
            r.put("upnp", upnp);
            // Carrier NAT: the router's "external" address is itself private, or differs from what the
            // internet sees. Nobody outside can reach this phone then.
            boolean cg = upnpIp != null && (isPrivate(upnpIp) || (stunIp != null && !stunIp.equals(upnpIp)));
            r.put("cgnat", cg);
            if (err != null) r.put("err", err);
        } catch (Exception ignored) {
        }
        return r.toString();
    }

    /** Removes the router port forward again (when the game ends). */
    synchronized void close() {
        if (mapped < 0 || control == null) return;
        final int p = mapped;
        mapped = -1;
        try {
            soap("DeletePortMapping", "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + p + "</NewExternalPort><NewProtocol>TCP</NewProtocol>");
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ UPnP

    private boolean discover() throws Exception {
        DatagramSocket s = new DatagramSocket();
        try {
            s.setSoTimeout(1500);
            InetSocketAddress group = new InetSocketAddress("239.255.255.250", 1900);
            for (String st : new String[]{"urn:schemas-upnp-org:device:InternetGatewayDevice:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:2"}) {
                byte[] q = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n").getBytes(UTF8);
                s.send(new DatagramPacket(q, q.length, group));
            }
            byte[] buf = new byte[2048];
            long end = System.currentTimeMillis() + 3000;
            while (System.currentTimeMillis() < end) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (java.net.SocketTimeoutException e) {
                    continue;
                }
                Matcher m = Pattern.compile("(?im)^LOCATION:\\s*(\\S+)").matcher(new String(buf, 0, p.getLength(), UTF8));
                if (m.find() && describe(m.group(1))) return true;
            }
            return false;
        } finally {
            s.close();
        }
    }

    /** Reads the router's description and finds its WAN connection service. */
    private boolean describe(String location) {
        try {
            String xml = http(location, null, null);
            for (String svc : SERVICES) {
                int i = xml.indexOf(svc);
                if (i < 0) continue;
                Matcher m = Pattern.compile("<controlURL>\\s*([^<]+?)\\s*</controlURL>").matcher(xml);
                if (!m.find(i)) continue;
                control = new URL(new URL(location), m.group(1)).toString();
                service = svc;
                return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private boolean addMapping(int external, int internal, String local) {
        try {
            soap("AddPortMapping", "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + external + "</NewExternalPort><NewProtocol>TCP</NewProtocol>"
                    + "<NewInternalPort>" + internal + "</NewInternalPort><NewInternalClient>" + local + "</NewInternalClient><NewEnabled>1</NewEnabled>"
                    + "<NewPortMappingDescription>StickManUp</NewPortMappingDescription><NewLeaseDuration>7200</NewLeaseDuration>");
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String externalIp() {
        try {
            Matcher m = Pattern.compile("<NewExternalIPAddress>\\s*([0-9.]+)\\s*<").matcher(soap("GetExternalIPAddress", ""));
            return m.find() ? m.group(1) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String soap(String action, String args) throws Exception {
        String body = "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body><u:" + action + " xmlns:u=\"" + service + "\">" + args + "</u:" + action + "></s:Body></s:Envelope>";
        return http(control, body, "\"" + service + "#" + action + "\"");
    }

    private static String http(String url, String body, String soapAction) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(2500);
        c.setReadTimeout(3000);
        if (body != null) {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
            c.setRequestProperty("SOAPAction", soapAction);
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes(UTF8));
            os.close();
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while (in != null && (n = in.read(buf)) > 0) b.write(buf, 0, n);
        c.disconnect();
        if (code >= 400) throw new Exception("router said " + code);
        return new String(b.toByteArray(), UTF8);
    }

    private static String localAddressTowards(String host) throws Exception {
        DatagramSocket s = new DatagramSocket();
        try {
            s.connect(InetAddress.getByName(host), 1900);
            return s.getLocalAddress().getHostAddress();
        } finally {
            s.close();
        }
    }

    // ------------------------------------------------------------------ STUN

    /** Public IPv4 address as the internet sees it (RFC 5389 binding request), or null. */
    private static String stun() {
        String[][] servers = {{"stun.l.google.com", "19302"}, {"stun.cloudflare.com", "3478"}, {"stun1.l.google.com", "19302"}};
        for (String[] sv : servers) {
            DatagramSocket s = null;
            try {
                InetAddress addr = null;
                for (InetAddress a : InetAddress.getAllByName(sv[0])) if (a instanceof Inet4Address) { addr = a; break; }
                if (addr == null) continue;
                s = new DatagramSocket();
                s.setSoTimeout(1500);
                byte[] req = new byte[20];
                req[1] = 0x01; // binding request
                req[4] = 0x21; req[5] = 0x12; req[6] = (byte) 0xA4; req[7] = 0x42;
                byte[] tid = new byte[12];
                new SecureRandom().nextBytes(tid);
                System.arraycopy(tid, 0, req, 8, 12);
                for (int tries = 0; tries < 2; tries++) {
                    s.send(new DatagramPacket(req, req.length, addr, Integer.parseInt(sv[1])));
                    byte[] buf = new byte[512];
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try {
                        s.receive(p);
                    } catch (java.net.SocketTimeoutException e) {
                        continue;
                    }
                    int len = ((buf[2] & 0xff) << 8) | (buf[3] & 0xff), i = 20;
                    while (i + 4 <= 20 + len && i + 4 <= p.getLength()) {
                        int t = ((buf[i] & 0xff) << 8) | (buf[i + 1] & 0xff), l = ((buf[i + 2] & 0xff) << 8) | (buf[i + 3] & 0xff);
                        if ((t == 0x0020 || t == 0x0001) && l >= 8 && buf[i + 5] == 0x01) {
                            byte[] ip = new byte[4];
                            for (int k = 0; k < 4; k++) ip[k] = (byte) (buf[i + 8 + k] ^ (t == 0x0020 ? req[4 + k] : 0));
                            return InetAddress.getByAddress(ip).getHostAddress();
                        }
                        i += 4 + l + ((4 - l % 4) % 4);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (s != null) s.close();
            }
        }
        return null;
    }

    private static boolean isPrivate(String ip) {
        try {
            String[] p = ip.split("\\.");
            int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
            return a == 10 || (a == 172 && b >= 16 && b < 32) || (a == 192 && b == 168) || (a == 100 && b >= 64 && b < 128) || a == 127;
        } catch (Exception e) {
            return true;
        }
    }
}
