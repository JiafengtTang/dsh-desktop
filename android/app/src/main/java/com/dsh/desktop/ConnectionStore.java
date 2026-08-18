package com.dsh.desktop;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class ConnectionStore {
    private static final String PREFS = "dsh_desktop";
    private static final String KEY_CONNECTIONS = "connections";
    private static final String KEY_ACTIVE = "active";

    private final SharedPreferences prefs;

    public ConnectionStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        seedIfEmpty(context);
    }

    // Seed connections from a local server-presets.json when the store is empty.
    // The file lives in the app's private files dir and is NOT part of the repo,
    // so no real server or API-key data is ever committed to GitHub.
    private void seedIfEmpty(Context context) {
        if (!list().isEmpty()) return;
        String json = null;
        try {
            File f = new File(context.getFilesDir(), "server-presets.json");
            if (f.exists()) {
                FileInputStream in = new FileInputStream(f);
                json = new String(readAll(in), StandardCharsets.UTF_8);
                in.close();
            }
        } catch (Exception ignored) {
        }
        if (json == null) return;
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String name = o.optString("name", "").trim();
                String host = o.optString("host", "").trim();
                if (name.isEmpty() || host.isEmpty()) continue;
                add(o);
            }
        } catch (Exception ignored) {
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    public List<JSONObject> list() {
        List<JSONObject> result = new ArrayList<>();
        String raw = prefs.getString(KEY_CONNECTIONS, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) result.add(arr.getJSONObject(i));
        } catch (JSONException ignored) {
        }
        return result;
    }

    private void save(List<JSONObject> list) {
        JSONArray arr = new JSONArray();
        for (JSONObject o : list) arr.put(o);
        prefs.edit().putString(KEY_CONNECTIONS, arr.toString()).apply();
    }

    public JSONObject get(String name) {
        for (JSONObject o : list()) {
            if (name != null && name.equals(o.optString("name"))) return o;
        }
        return null;
    }

    public void add(JSONObject c) {
        List<JSONObject> list = list();
        String name = c.optString("name");
        for (JSONObject o : list) {
            if (name.equals(o.optString("name"))) return;
        }
        list.add(c);
        save(list);
    }

    public void update(String oldName, JSONObject c) {
        List<JSONObject> list = list();
        for (int i = 0; i < list.size(); i++) {
            if (oldName != null && oldName.equals(list.get(i).optString("name"))) {
                list.set(i, c);
                if (oldName.equals(active())) setActive(c.optString("name"));
                break;
            }
        }
        save(list);
    }

    public void remove(String name) {
        List<JSONObject> next = new ArrayList<>();
        for (JSONObject o : list()) {
            if (name == null || !name.equals(o.optString("name"))) next.add(o);
        }
        save(next);
        if (name != null && name.equals(active())) setActive("");
    }

    public String active() {
        String a = prefs.getString(KEY_ACTIVE, "");
        return get(a) != null ? a : "";
    }

    public void setActive(String name) {
        prefs.edit().putString(KEY_ACTIVE, name == null ? "" : name).apply();
    }
}
