package com.dsh.desktop;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

public class SshManager {
    public interface Listener {
        void onOutput(String line, boolean error);

        void onReady(String url);

        void onError(String message);

        void onDisconnected(String message);
    }

    private Session session;
    private ChannelExec channel;
    private Thread reader;
    private volatile boolean stopping = false;
    private volatile boolean established = false;
    private final Object lock = new Object();
    private Listener listener;
    private final java.util.concurrent.atomic.AtomicBoolean reported =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    public boolean isConnected() {
        synchronized (lock) {
            return session != null && session.isConnected();
        }
    }

    public void connect(JSONObject profile, Listener listener) {
        disconnect();
        this.listener = listener;
        reported.set(false);
        final java.util.concurrent.atomic.AtomicBoolean done = new java.util.concurrent.atomic.AtomicBoolean(false);
        new Thread(() -> {
            try {
                String host = profile.optString("host", "").trim();
                String user = profile.optString("user", "").trim();
                int port = profile.optInt("port", 22);
                String password = profile.optString("password", "");
                String keyContent = profile.optString("keyContent", "");
                String projectDir = profile.optString("projectDir", "").trim();
                int remotePort = profile.optInt("remotePort", 0);
                String shell = profile.optString("shell", "bash");
                String dshCommand = profile.optString("dshCommand", "").trim();

                if (host.isEmpty() || user.isEmpty()) {
                    if (done.compareAndSet(false, true) && listener != null) listener.onError("主机和用户名不能为空");
                    return;
                }
                if (dshCommand.isEmpty()) dshCommand = "npx -y @deepseek-ai/dsh@0.1.0-rc.6";
                if (remotePort <= 0) remotePort = 30000 + (int) (Math.random() * 20000);
                if (projectDir.isEmpty()) projectDir = "~";

                JSch jsch = new JSch();
                if (!keyContent.isEmpty()) {
                    jsch.addIdentity("dsh-key", keyContent.getBytes(StandardCharsets.UTF_8), null, null);
                }

                Session s = jsch.getSession(user, host, port);
                if (!password.isEmpty()) s.setPassword(password);
                Properties cfg = new Properties();
                cfg.put("StrictHostKeyChecking", "no");
                cfg.put("PreferredAuthentications", "publickey,password,keyboard-interactive");
                s.setConfig(cfg);
                s.setServerAliveInterval(15000);
                s.setServerAliveCountMax(3);
                s.connect(20000);
                synchronized (lock) {
                    session = s;
                }

                int localPort = profile.optInt("localPort", 0);
                if (localPort <= 0) {
                    localPort = 37000 + Math.floorMod((host + ":" + user + ":" + port).hashCode(), 3000);
                }
                try {
                    s.setPortForwardingL(localPort, "127.0.0.1", remotePort);
                } catch (Exception portBusy) {
                    // Fixed port is taken: fall back to a dynamic one. The URL
                    // will change, but this is rare and still works for this run.
                    localPort = findFreePort();
                    s.setPortForwardingL(localPort, "127.0.0.1", remotePort);
                }
                profile.put("localPort", localPort);
                final String url = "http://127.0.0.1:" + localPort;

                String cdPath;
                if (projectDir.equals("~")) {
                    cdPath = "\"$HOME\"";
                } else if (projectDir.startsWith("~/")) {
                    cdPath = "\"$HOME\"/" + quote(projectDir.substring(2));
                } else {
                    cdPath = quote(projectDir);
                }
                String inner = "cd " + cdPath + " && " + dshCommand + " web --port " + remotePort;
                String command = shell + " -lc " + quote(inner);
                ChannelExec exec = (ChannelExec) s.openChannel("exec");
                exec.setCommand(command);
                exec.setPty(true);
                InputStream in = exec.getInputStream();
                exec.connect(20000);
                synchronized (lock) {
                    channel = exec;
                }

                stopping = false;
                established = false;
                reader = new Thread(() -> {
                    try {
                        byte[] buf = new byte[4096];
                        StringBuilder pending = new StringBuilder();
                        StringBuilder outLog = new StringBuilder();
                        long deadline = System.currentTimeMillis() + 150000; // 150s to become ready
                        int n;
                        while (!stopping && (n = in.read(buf)) > 0) {
                            pending.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                            int idx;
                            while ((idx = pending.indexOf("\n")) >= 0) {
                                String line = pending.substring(0, idx).trim();
                                pending.delete(0, idx + 1);
                                if (line.isEmpty()) continue;
                                if (outLog.length() > 4000) outLog.delete(0, outLog.length() - 3000);
                                outLog.append(line).append('\n');
                                if (listener != null) listener.onOutput(line, false);
                                if (line.contains("dsh web:")) {
                                    established = true;
                                    if (done.compareAndSet(false, true) && listener != null) listener.onReady(url);
                                    return;
                                }
                                if (System.currentTimeMillis() > deadline) {
                                    if (done.compareAndSet(false, true) && listener != null) {
                                        listener.onError("连接超时（远程 dsh 未就绪）\n最近输出：\n" + tail(outLog));
                                    }
                                    return;
                                }
                            }
                        }
                        if (!stopping && done.compareAndSet(false, true) && listener != null) {
                            listener.onError("远程命令已退出，未检测到 dsh 就绪\n最近输出：\n" + tail(outLog));
                        }
                    } catch (Exception ignored) {
                        if (established && !stopping) notifyDisconnected("远程连接已断开");
                    }
                    if (established && !stopping) notifyDisconnected("远程连接已断开");
                }, "ssh-reader");
                reader.start();

                Thread monitor = new Thread(() -> {
                    while (!stopping) {
                        try {
                            Thread.sleep(10000);
                        } catch (InterruptedException e) {
                            return;
                        }
                        synchronized (lock) {
                            if (established && !stopping && (session == null || !session.isConnected())) {
                                notifyDisconnected("远程连接已断开");
                                return;
                            }
                        }
                    }
                }, "ssh-monitor");
                monitor.setDaemon(true);
                monitor.start();
            } catch (Exception e) {
                if (done.compareAndSet(false, true) && listener != null) {
                    listener.onError(e.getMessage() == null ? String.valueOf(e) : e.getMessage());
                }
            }
        }, "ssh-connect").start();
        Thread watchdog = new Thread(() -> {
            try {
                Thread.sleep(60000);
            } catch (InterruptedException e) {
                return;
            }
            if (done.compareAndSet(false, true)) {
                if (listener != null) listener.onError("连接超时（60 秒），请检查网络 / SSH 端口 / 用户名密码");
                disconnect();
            }
        }, "ssh-watchdog");
        watchdog.setDaemon(true);
        watchdog.start();
    }

    public void disconnect() {
        stopping = true;
        established = false;
        try {
            if (reader != null) reader.interrupt();
        } catch (Exception ignored) {
        }
        synchronized (lock) {
            try {
                if (channel != null) channel.disconnect();
            } catch (Exception ignored) {
            }
            channel = null;
            try {
                if (session != null) session.disconnect();
            } catch (Exception ignored) {
            }
            session = null;
        }
    }

    private void notifyDisconnected(String message) {
        if (reported.compareAndSet(false, true) && listener != null) {
            listener.onDisconnected(message);
        }
        disconnect();
    }

    private static int findFreePort() throws Exception {
        try (ServerSocket ss = new ServerSocket(0)) {
            return ss.getLocalPort();
        }
    }

    private static String quote(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    private static String tail(StringBuilder sb) {
        String s = sb.toString();
        String[] lines = s.split("\n");
        int from = Math.max(0, lines.length - 12);
        StringBuilder out = new StringBuilder();
        for (int i = from; i < lines.length; i++) out.append(lines[i]).append('\n');
        return out.toString().trim();
    }
}
