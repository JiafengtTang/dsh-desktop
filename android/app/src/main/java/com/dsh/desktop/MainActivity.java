package com.dsh.desktop;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_CONNECTIONS = 1001;

    private WebView webView;
    private LinearLayout statusBar;
    private Button backBtn;
    private View statusDot;
    private TextView statusText;
    private FrameLayout root;
    private LinearLayout overlay;
    private TextView overlayTitle;
    private TextView overlayDetail;
    private LinearLayout homeView;
    private ListView sessionsList;
    private TextView homeEmpty;

    private SshManager ssh;
    private ConnectionStore store;
    private DshApi api;
    private String currentName = "";
    private String currentUrl = null;
    private boolean inChat = false;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String injectJs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ssh = new SshManager();
        store = new ConnectionStore(this);
        injectJs = readAsset("inject.js");
        buildUi();

        boolean isDebug = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebug && store.list().isEmpty()) {
            JSONObject t = new JSONObject();
            try {
                t.put("name", "local-test");
                t.put("url", "http://10.0.2.2:43991");
                store.add(t);
                store.setActive("local-test");
            } catch (Exception ignored) {
            }
        }

        String active = store.active();
        if (active != null && !active.isEmpty()) {
            connectTo(active);
        } else {
            showOverlay("还没有配置远程服务器", "点击下方按钮添加一个 SSH 连接", "idle");
        }
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#f7f8fa"));

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        root.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        statusBar = new LinearLayout(this);
        statusBar.setOrientation(LinearLayout.HORIZONTAL);
        statusBar.setGravity(Gravity.CENTER_VERTICAL);
        statusBar.setPadding(dp(8), dp(12), dp(10), dp(12));
        statusBar.setBackgroundColor(Color.WHITE);
        column.addView(statusBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        backBtn = new Button(this);
        backBtn.setText("‹");
        backBtn.setTextSize(22);
        backBtn.setAllCaps(false);
        backBtn.setVisibility(View.GONE);
        backBtn.setOnClickListener(v -> showHome());
        statusBar.addView(backBtn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusDot = new View(this);
        statusDot.setBackgroundColor(Color.parseColor("#9ca3af"));
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(9), dp(9));
        dotLp.setMargins(dp(4), 0, dp(8), 0);
        statusBar.addView(statusDot, dotLp);

        statusText = new TextView(this);
        statusText.setTextColor(Color.parseColor("#111827"));
        statusText.setTextSize(15);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        statusBar.addView(statusText, stLp);

        Button wsBtn = new Button(this);
        wsBtn.setText("工作区");
        wsBtn.setTextSize(13);
        wsBtn.setAllCaps(false);
        wsBtn.setOnClickListener(v -> {
            if (webView != null && inChat) {
                webView.evaluateJavascript("var b=document.getElementById('dshd-ws-btn'); if(b) b.click();", null);
            } else {
                showHome();
            }
        });
        statusBar.addView(wsBtn);

        Button connBtn = new Button(this);
        connBtn.setText("连接");
        connBtn.setTextSize(13);
        connBtn.setAllCaps(false);
        connBtn.setOnClickListener(v -> openConnections());
        LinearLayout.LayoutParams cbLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cbLp.setMargins(dp(6), 0, 0, 0);
        statusBar.addView(connBtn, cbLp);

        // ---- Home view: native conversation list ----
        homeView = new LinearLayout(this);
        homeView.setOrientation(LinearLayout.VERTICAL);
        homeView.setBackgroundColor(Color.parseColor("#f7f8fa"));
        column.addView(homeView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        TextView title = new TextView(this);
        title.setText("会话");
        title.setTextColor(Color.parseColor("#111827"));
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(dp(18), dp(18), dp(18), dp(8));
        homeView.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        sessionsList = new ListView(this);
        sessionsList.setDivider(null);
        sessionsList.setBackgroundColor(Color.parseColor("#f7f8fa"));
        homeView.addView(sessionsList, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        homeEmpty = new TextView(this);
        homeEmpty.setText("暂无会话");
        homeEmpty.setTextColor(Color.parseColor("#9ca3af"));
        homeEmpty.setTextSize(14);
        homeEmpty.setGravity(Gravity.CENTER);
        homeEmpty.setPadding(0, dp(60), 0, 0);
        homeView.addView(homeEmpty, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button openWeb = new Button(this);
        openWeb.setText("打开网页界面");
        openWeb.setTextSize(14);
        openWeb.setAllCaps(false);
        openWeb.setOnClickListener(v -> openChat(null, null, null));
        LinearLayout.LayoutParams owLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        owLp.setMargins(dp(18), 0, dp(18), dp(18));
        homeView.addView(openWeb, owLp);

        // ---- WebView (chat) ----
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        webView.setBackgroundColor(Color.parseColor("#ffffff"));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                Log.i("DSH", "page start: " + url);
                showOverlay("正在加载界面…", "", "starting");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.i("DSH", "page finished: " + url);
                setStatus("ready");
                hideOverlay();
                if (injectJs != null && !injectJs.isEmpty()) view.evaluateJavascript(injectJs, null);
                deepLinkSession(view);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.e("DSH", "page error " + errorCode + ": " + description + " @ " + failingUrl);
                showOverlay("加载失败", description, "error");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.i("DSH", "web: " + msg.message());
                return true;
            }
        });
        column.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        webView.setVisibility(View.GONE);

        // ---- Overlay (loading / error) ----
        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(Color.parseColor("#f7f8fa"));
        overlay.setPadding(dp(28), dp(28), dp(28), dp(28));

        ProgressBar spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(56), dp(56));
        overlay.addView(spinner, spLp);

        overlayTitle = new TextView(this);
        overlayTitle.setTextColor(Color.parseColor("#111827"));
        overlayTitle.setTextSize(17);
        overlayTitle.setTypeface(Typeface.DEFAULT_BOLD);
        overlayTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tLp.setMargins(0, dp(20), 0, 0);
        overlay.addView(overlayTitle, tLp);

        overlayDetail = new TextView(this);
        overlayDetail.setTextColor(Color.parseColor("#6b7280"));
        overlayDetail.setTextSize(13);
        overlayDetail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dLp.setMargins(0, dp(8), 0, 0);
        overlay.addView(overlayDetail, dLp);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        brLp.setMargins(0, dp(24), 0, 0);
        overlay.addView(btnRow, brLp);

        Button retryBtn = new Button(this);
        retryBtn.setText("重试");
        retryBtn.setOnClickListener(v -> {
            if (currentName != null && !currentName.isEmpty()) connectTo(currentName);
        });
        btnRow.addView(retryBtn);

        Button manageBtn = new Button(this);
        manageBtn.setText("连接管理");
        manageBtn.setOnClickListener(v -> openConnections());
        LinearLayout.LayoutParams mbLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mbLp.setMargins(dp(12), 0, 0, 0);
        btnRow.addView(manageBtn, mbLp);

        root.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
    }

    public void connectTo(String name) {
        currentName = name == null ? "" : name;
        store.setActive(currentName);
        JSONObject profile = store.get(currentName);
        if (profile == null) {
            showOverlay("找不到该连接", "请在连接管理中添加", "error");
            return;
        }
        currentUrl = null;
        String directUrl = profile.optString("url", "").trim();
        if (!directUrl.isEmpty() && profile.optString("host", "").isEmpty()) {
            currentUrl = directUrl;
            showOverlay("正在连接 " + currentName + " …", "", "starting");
            showHome();
            return;
        }
        showOverlay("正在连接 " + currentName + " …", "正在建立 SSH 隧道", "starting");
        setStatus("starting");
        ssh.connect(profile, new SshManager.Listener() {
            @Override
            public void onOutput(String line, boolean error) {
                main.post(() -> {
                    String shown = line == null ? "" : line.trim();
                    if (shown.length() > 80) shown = shown.substring(0, 80);
                    overlayDetail.setText("SSH 输出：" + shown);
                });
            }

            @Override
            public void onReady(String url) {
                main.post(() -> {
                    currentUrl = url;
                    showHome();
                });
            }

            @Override
            public void onError(String message) {
                main.post(() -> showOverlay("连接失败", message, "error"));
            }
        });
    }

    private void showHome() {
        hideOverlay();
        inChat = false;
        backBtn.setVisibility(View.GONE);
        webView.setVisibility(View.GONE);
        homeView.setVisibility(View.VISIBLE);
        setStatus("ready");
        if (currentUrl != null) loadSessions();
    }

    private void loadSessions() {
        homeEmpty.setVisibility(View.GONE);
        sessionsList.setAdapter(null);
        final String base = currentUrl;
        new Thread(() -> {
            try {
                DshApi d = new DshApi(base);
                JSONArray items = d.listSessions();
                Log.i("DSH", "sessions fetched: " + items.length());
                List<JSONObject> sessions = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                    JSONObject s = items.optJSONObject(i);
                    if (s == null || "subagent".equals(s.optString("origin"))) continue;
                    sessions.add(s);
                }
                main.post(() -> renderSessions(sessions));
            } catch (Exception e) {
                Log.e("DSH", "load sessions error: " + e.getMessage());
                main.post(() -> {
                    homeEmpty.setVisibility(View.VISIBLE);
                    homeEmpty.setText("无法读取会话：" + e.getMessage());
                });
            }
        }, "load-sessions").start();
    }

    private void renderSessions(final List<JSONObject> sessions) {
        Log.i("DSH", "render sessions: " + sessions.size());
        if (sessions.isEmpty()) {
            homeEmpty.setVisibility(View.VISIBLE);
            homeEmpty.setText("暂无会话");
        } else {
            homeEmpty.setVisibility(View.GONE);
        }
        sessionsList.setAdapter(new BaseAdapter() {
            @Override
            public int getCount() {
                return sessions.size();
            }

            @Override
            public Object getItem(int position) {
                return sessions.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                JSONObject s = sessions.get(position);
                LinearLayout row = new LinearLayout(MainActivity.this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(18), dp(14), dp(18), dp(14));
                row.setBackgroundColor(Color.parseColor("#ffffff"));

                LinearLayout top = new LinearLayout(MainActivity.this);
                top.setOrientation(LinearLayout.HORIZONTAL);
                top.setGravity(Gravity.CENTER_VERTICAL);
                row.addView(top);

                boolean running = s.optBoolean("running", false);
                View dot = new View(MainActivity.this);
                dot.setBackgroundColor(running ? Color.parseColor("#34c98e") : Color.parseColor("#d1d5db"));
                LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(8), dp(8));
                dotLp.setMargins(0, 0, dp(8), 0);
                top.addView(dot, dotLp);

                TextView title = new TextView(MainActivity.this);
                String titleText = titleOf(s);
                title.setText(titleText == null || titleText.isEmpty() ? "（新会话）" : titleText);
                title.setTextColor(Color.parseColor("#111827"));
                title.setTextSize(15);
                title.setTypeface(Typeface.DEFAULT_BOLD);
                LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                top.addView(title, tLp);

                TextView time = new TextView(MainActivity.this);
                time.setText(relativeTime(s.optLong("updatedAt", 0)));
                time.setTextColor(Color.parseColor("#9ca3af"));
                time.setTextSize(12);
                top.addView(time);

                TextView sub = new TextView(MainActivity.this);
                String cwd = s.optString("cwd", "");
                String preset = s.optString("agentPreset", "");
                sub.setText((running ? "● 运行中" : "") + (cwd.isEmpty() ? "" : "  " + cwd) + (preset.isEmpty() ? "" : "  · " + preset));
                sub.setTextColor(Color.parseColor("#9ca3af"));
                sub.setTextSize(12);
                LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                sLp.setMargins(dp(16), dp(4), 0, 0);
                row.addView(sub, sLp);

                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.setMargins(dp(10), dp(4), dp(10), dp(4));
                row.setLayoutParams(lp);
                final String sid = s.optString("sessionId");
                final String stitle = titleOf(s);
                row.setOnClickListener(v -> {
                    Intent i = new Intent(MainActivity.this, ChatActivity.class);
                    i.putExtra("baseUrl", currentUrl);
                    i.putExtra("sessionId", sid);
                    i.putExtra("title", stitle);
                    startActivity(i);
                });
                return row;
            }
        });
    }

    private String titleOf(JSONObject s) {
        JSONObject proj = s.optJSONObject("projections");
        if (proj != null) {
            JSONObject values = proj.optJSONObject("values");
            if (values != null) return values.optString("title", "");
        }
        return "";
    }

    private void openChat(String sessionId, String title, String cwd) {
        if (currentUrl == null) return;
        inChat = true;
        backBtn.setVisibility(View.VISIBLE);
        homeView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        pendingSessionTitle = title;
        pendingSessionCwd = cwd;
        webView.loadUrl(currentUrl);
    }

    private String pendingSessionTitle = null;
    private String pendingSessionCwd = null;

    private void deepLinkSession(WebView view) {
        if (pendingSessionTitle == null && pendingSessionCwd == null) return;
        final String title = pendingSessionTitle;
        final String cwd = pendingSessionCwd;
        pendingSessionTitle = null;
        pendingSessionCwd = null;
        final String titleJson = JSONSafe(title);
        final String cwdJson = JSONSafe(cwd);
        String js =
            "(function(){" +
            "try{var t=document.querySelector('[class*=\"toggle\"]');if(t)t.click();}catch(e){}" +
            "setTimeout(function(){" +
            "var cwd=" + cwdJson + ";var target=" + titleJson + ";" +
            "var wsBase=String(cwd).split('/').pop()||cwd;" +
            "var ra=document.querySelector('[class*=\"regionArea\"]');" +
            "var wsEls=ra?ra.querySelectorAll('*'):[];" +
            "for(var i=0;i<wsEls.length;i++){var w=(wsEls[i].textContent||'').trim();" +
            "if(wsBase&&(w.indexOf(wsBase)>=0||(cwd&&w.indexOf(cwd)>=0))){wsEls[i].click();break;}}" +
            "setTimeout(function(){" +
            "var els=document.querySelectorAll('[class*=\"session\"],[class*=\"Session\"],button,li');" +
            "for(var i=0;i<els.length;i++){var txt=(els[i].textContent||'').trim();" +
            "if(txt===target||txt.indexOf(target)===0){els[i].click();console.log('DSHDEEP:clicked:'+txt);return;}}" +
            "console.log('DSHDEEP:notfound2');" +
            "},1000);" +
            "},700);" +
            "})();";
        view.evaluateJavascript(js, null);
    }

    private static String JSONSafe(String s) {
        return org.json.JSONObject.quote(s == null ? "" : s);
    }

    private static String relativeTime(long epochMs) {
        if (epochMs <= 0) return "";
        long diff = System.currentTimeMillis() - epochMs;
        long min = diff / 60000;
        if (min < 1) return "刚刚";
        if (min < 60) return min + " 分钟前";
        long hr = min / 60;
        if (hr < 24) return hr + " 小时前";
        long day = hr / 24;
        if (day < 7) return day + " 天前";
        return new SimpleDateFormat("M月d日", Locale.CHINA).format(new Date(epochMs));
    }

    private void showOverlay(String title, String detail, String state) {
        overlayTitle.setText(title);
        overlayDetail.setText(detail == null ? "" : detail);
        overlay.setVisibility(View.VISIBLE);
        overlayDetail.setVisibility(View.VISIBLE);
        setStatus(state);
    }

    private void hideOverlay() {
        overlay.setVisibility(View.GONE);
    }

    private void setStatus(String state) {
        String label;
        switch (state == null ? "" : state) {
            case "ready":
                label = "运行中";
                statusDot.setBackgroundColor(Color.parseColor("#34c98e"));
                break;
            case "error":
                label = "出错";
                statusDot.setBackgroundColor(Color.parseColor("#ef4444"));
                break;
            case "starting":
                label = "连接中";
                statusDot.setBackgroundColor(Color.parseColor("#e5b93b"));
                break;
            default:
                label = "未连接";
                statusDot.setBackgroundColor(Color.parseColor("#9ca3af"));
        }
        String mode = currentName == null || currentName.isEmpty() ? "未连接" : currentName;
        statusText.setText(mode + " · " + label);
    }

    public void openConnections() {
        Intent intent = new Intent(this, ConnectionsActivity.class);
        startActivityForResult(intent, REQ_CONNECTIONS);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CONNECTIONS) {
            String active = store.active();
            if (active != null && !active.isEmpty()) connectTo(active);
            else showOverlay("还没有配置远程服务器", "点击下方按钮添加一个 SSH 连接", "idle");
        }
    }

    @Override
    public void onBackPressed() {
        if (inChat) {
            showHome();
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        ssh.disconnect();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    public String currentConnectionName() {
        return currentName;
    }

    public String currentUrl() {
        return currentUrl;
    }

    public ConnectionStore store() {
        return store;
    }

    private String readAsset(String name) {
        try {
            InputStream in = getAssets().open(name);
            byte[] buf = new byte[in.available()];
            int off = 0, n;
            while ((n = in.read(buf, off, buf.length - off)) > 0) off += n;
            in.close();
            return new String(buf, 0, off, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
