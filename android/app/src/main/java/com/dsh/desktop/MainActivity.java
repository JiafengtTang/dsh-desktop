package com.dsh.desktop;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQ_CONNECTIONS = 1001;

    private WebView webView;
    private LinearLayout statusBar;
    private View statusDot;
    private TextView statusText;
    private FrameLayout root;
    private LinearLayout overlay;
    private TextView overlayTitle;
    private TextView overlayDetail;
    private SshManager ssh;
    private ConnectionStore store;
    private String currentName = "";
    private String currentUrl = null;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String injectJs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ssh = new SshManager();
        store = new ConnectionStore(this);
        injectJs = readAsset("inject.js");
        buildUi();

        String active = store.active();
        if (active != null && !active.isEmpty()) {
            connectTo(active);
        } else {
            showOverlay("还没有配置远程服务器", "点击下方按钮添加一个 SSH 连接", "idle");
        }
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b0f14"));

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        root.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        statusBar = new LinearLayout(this);
        statusBar.setOrientation(LinearLayout.HORIZONTAL);
        statusBar.setGravity(Gravity.CENTER_VERTICAL);
        statusBar.setPadding(dp(14), dp(10), dp(10), dp(10));
        statusBar.setBackgroundColor(Color.parseColor("#121823"));
        column.addView(statusBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusDot = new View(this);
        statusDot.setBackgroundColor(Color.parseColor("#6b7a94"));
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(10), dp(10));
        dotLp.setMargins(0, 0, dp(8), 0);
        statusBar.addView(statusDot, dotLp);

        statusText = new TextView(this);
        statusText.setTextColor(Color.parseColor("#e8eefb"));
        statusText.setTextSize(14);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        statusBar.addView(statusText, stLp);

        Button connBtn = new Button(this);
        connBtn.setText("连接管理");
        connBtn.setTextSize(13);
        connBtn.setAllCaps(false);
        connBtn.setOnClickListener(v -> openConnections());
        statusBar.addView(connBtn);

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        webView.setBackgroundColor(Color.parseColor("#0b0f14"));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                showOverlay("正在加载界面…", "", "starting");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                setStatus("ready");
                hideOverlay();
                if (injectJs != null && !injectJs.isEmpty()) {
                    view.evaluateJavascript(injectJs, null);
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showOverlay("加载失败", description, "error");
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        column.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(Gravity.CENTER);
        overlay.setBackgroundColor(Color.parseColor("#0b0f14"));
        overlay.setPadding(dp(28), dp(28), dp(28), dp(28));

        ProgressBar spinner = new ProgressBar(this);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(64), dp(64));
        ((LinearLayout) overlay).addView(spinner, spLp);

        overlayTitle = new TextView(this);
        overlayTitle.setTextColor(Color.parseColor("#e8eefb"));
        overlayTitle.setTextSize(17);
        overlayTitle.setTypeface(Typeface.DEFAULT_BOLD);
        overlayTitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tLp.setMargins(0, dp(20), 0, 0);
        ((LinearLayout) overlay).addView(overlayTitle, tLp);

        overlayDetail = new TextView(this);
        overlayDetail.setTextColor(Color.parseColor("#8b98b3"));
        overlayDetail.setTextSize(13);
        overlayDetail.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dLp.setMargins(0, dp(8), 0, 0);
        ((LinearLayout) overlay).addView(overlayDetail, dLp);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        brLp.setMargins(0, dp(24), 0, 0);
        ((LinearLayout) overlay).addView(btnRow, brLp);

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
        showOverlay("正在连接 " + currentName + " …", "正在建立 SSH 隧道", "starting");
        setStatus("starting");
        ssh.connect(profile, new SshManager.Listener() {
            @Override
            public void onOutput(String line, boolean error) {
                // Remote dsh output; ignored on mobile.
            }

            @Override
            public void onReady(String url) {
                main.post(() -> {
                    currentUrl = url;
                    webView.loadUrl(url);
                });
            }

            @Override
            public void onError(String message) {
                main.post(() -> showOverlay("连接失败", message, "error"));
            }
        });
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
                statusDot.setBackgroundColor(Color.parseColor("#ff6b6b"));
                break;
            case "starting":
                label = "连接中";
                statusDot.setBackgroundColor(Color.parseColor("#e5b93b"));
                break;
            case "idle":
                label = "未连接";
                statusDot.setBackgroundColor(Color.parseColor("#6b7a94"));
                break;
            default:
                label = "未连接";
                statusDot.setBackgroundColor(Color.parseColor("#6b7a94"));
        }
        String mode = currentName == null || currentName.isEmpty() ? "未连接" : currentName;
        statusText.setText(mode + " · " + label);
        if (webView != null) {
            String json = "{state:'" + (state == null ? "" : state) + "',mode:'" + mode.replace("'", "\\'") + "'}";
            webView.evaluateJavascript("window.__dshBackendStatus && window.__dshBackendStatus(" + json + ")", null);
        }
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
            if (active != null && !active.isEmpty()) {
                connectTo(active);
            } else {
                showOverlay("还没有配置远程服务器", "点击下方按钮添加一个 SSH 连接", "idle");
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
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
            int off = 0;
            int n;
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
