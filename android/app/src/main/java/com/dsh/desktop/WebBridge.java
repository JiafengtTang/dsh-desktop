package com.dsh.desktop;

import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

public class WebBridge {
    private final MainActivity activity;

    public WebBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("version", "0.2.3");
            String mode = activity.currentConnectionName();
            o.put("mode", mode == null || mode.isEmpty() ? "未连接" : mode);
            String url = activity.currentUrl();
            o.put("url", url == null ? "" : url);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    @JavascriptInterface
    public String connectionsList() {
        JSONObject o = new JSONObject();
        try {
            JSONArray arr = new JSONArray();
            for (JSONObject c : activity.store().list()) arr.put(c);
            o.put("connections", arr);
            String active = activity.currentConnectionName();
            o.put("active", active == null ? "" : active);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    @JavascriptInterface
    public String activate(String name) {
        JSONObject o = new JSONObject();
        try {
            activity.connectTo(name);
            o.put("ok", true);
            o.put("active", name);
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
            }
        }
        return o.toString();
    }

    @JavascriptInterface
    public void openConnections() {
        activity.openConnections();
    }
}
