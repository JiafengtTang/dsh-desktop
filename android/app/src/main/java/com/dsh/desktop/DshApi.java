package com.dsh.desktop;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class DshApi {
    private final String base;

    public DshApi(String baseUrl) {
        base = String.valueOf(baseUrl).replaceAll("/+$", "");
    }

    public JSONObject rpc(String method, JSONObject payload) throws Exception {
        JSONObject body = new JSONObject();
        body.put("type", "client-request");
        body.put("rpcId", "android-" + System.currentTimeMillis() + "-" + (int) (Math.random() * 1e6));
        body.put("method", method);
        body.put("payload", payload == null ? new JSONObject() : payload);

        HttpURLConnection conn = (HttpURLConnection) new URL(base + "/api/" + method).openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("content-type", "application/json");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int code = conn.getResponseCode();
        InputStream in = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
        String text = new String(readAll(in), StandardCharsets.UTF_8);
        in.close();
        conn.disconnect();
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code + ": " + text);

        JSONObject res = new JSONObject(text);
        JSONObject result = res.optJSONObject("result");
        if (result == null || !result.optBoolean("ok", false)) {
            JSONObject err = result == null ? null : result.optJSONObject("error");
            throw new Exception(err == null ? "rpc failed" : err.optString("message", err.optString("code", "rpc failed")));
        }
        return result.optJSONObject("value");
    }

    public JSONArray listSessions() throws Exception {
        JSONObject value = rpc("session.list", new JSONObject());
        return value == null ? new JSONArray() : value.optJSONArray("items");
    }

    public JSONArray listWorkspaces() throws Exception {
        JSONObject value = rpc("workspace.list", new JSONObject());
        return value == null ? new JSONArray() : value.optJSONArray("items");
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
