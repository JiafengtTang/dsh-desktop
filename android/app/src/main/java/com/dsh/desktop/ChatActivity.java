package com.dsh.desktop;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import io.noties.markwon.Markwon;
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin;
import io.noties.markwon.ext.tables.TablePlugin;
import io.noties.markwon.ext.tasklist.TaskListPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ChatActivity extends Activity {
    private static final int TYPE_USER = 0;
    private static final int TYPE_ASSISTANT = 1;

    private String baseUrl;
    private String sessionId;
    private String sessionTitle;
    private DshApi api;
    private final Handler main = new Handler(Looper.getMainLooper());
    private List<Msg> messages = new ArrayList<>();
    private BaseAdapter adapter;
    private ListView listView;
    private EditText input;
    private TextView statusText;
    private volatile boolean running = false;
    private volatile boolean pollActive = false;
    private Thread poller;
    private Markwon markwon;
    private java.util.function.BiConsumer<View, Integer> bindRow;
    private volatile int loadRetries = 0;
    private volatile int tailFailures = 0;

    private static class Msg {
        int type;
        String text;
        String reasoning;
        boolean live;

        Msg(int type, String text, boolean live) {
            this(type, text, null, live);
        }

        Msg(int type, String text, String reasoning, boolean live) {
            this.type = type;
            this.text = text == null ? "" : text;
            this.reasoning = reasoning == null ? "" : reasoning;
            this.live = live;
        }
    }

    private static class RowHolder {
        TextView userText;
        TextView answerText;
        TextView reasoningTitle;
        TextView reasoningText;
        android.widget.ScrollView reasoningScroll;
        boolean reasoningOpen = true;
        int lastTextHash = 0;
        int lastReasoningHash = 0;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        baseUrl = getIntent().getStringExtra("baseUrl");
        sessionId = getIntent().getStringExtra("sessionId");
        sessionTitle = getIntent().getStringExtra("title");
        if (baseUrl == null || sessionId == null) {
            finish();
            return;
        }
        api = new DshApi(baseUrl);
        markwon = Markwon.builder(this)
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(TaskListPlugin.create(this))
                .usePlugin(TablePlugin.create(this))
                .build();
        buildUi();
        setStatus("加载中");
        loadHistory(30, false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        startPolling();
    }

    @Override
    protected void onPause() {
        stopPolling();
        super.onPause();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#f7f8fa"));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(6), dp(10), dp(12), dp(10));
        header.setBackgroundColor(Color.WHITE);
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button back = new Button(this);
        back.setText("‹");
        back.setTextSize(24);
        back.setAllCaps(false);
        back.setOnClickListener(v -> finish());
        header.addView(back);

        statusText = new TextView(this);
        String t = sessionTitle == null || sessionTitle.isEmpty() ? "会话" : sessionTitle;
        statusText.setText(t);
        statusText.setTextColor(Color.parseColor("#111827"));
        statusText.setTextSize(16);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        statusText.setMaxLines(1);
        statusText.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        header.addView(statusText, stLp);

        listView = new ListView(this);
        listView.setDivider(null);
        listView.setStackFromBottom(false);
        listView.setBackgroundColor(Color.parseColor("#f7f8fa"));
        root.addView(listView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        adapter = new BaseAdapter() {
            @Override
            public int getCount() {
                return messages.size();
            }

            @Override
            public Object getItem(int position) {
                return messages.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public int getViewTypeCount() {
                return 2;
            }

            @Override
            public int getItemViewType(int position) {
                return messages.get(position).type;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                View row = convertView;
                RowHolder h = null;
                if (row != null && row.getTag() instanceof RowHolder) {
                    h = (RowHolder) row.getTag();
                } else {
                    row = new LinearLayout(ChatActivity.this);
                    h = new RowHolder();
                    row.setTag(h);
                }
                bindRow.accept(row, position);
                return row;
            }
        };
        listView.setAdapter(adapter);

        // 复用行视图，只更新变化的文本，避免全量重建导致的闪烁。
        // Reuse row views and update only the changed text so streaming
        // refreshes do not rebuild the whole list (no flicker).
        bindRow = (row, position) -> {
            Msg m = messages.get(position);
            RowHolder h = (RowHolder) row.getTag();
            if (h.lastTextHash == m.text.hashCode()
                    && h.lastReasoningHash == m.reasoning.hashCode()) {
                return;
            }
            h.lastTextHash = m.text.hashCode();
            h.lastReasoningHash = m.reasoning.hashCode();

            if (m.type == TYPE_USER) {
                if (h.userText == null) {
                    LinearLayout rowL = (LinearLayout) row;
                    rowL.removeAllViews();
                    rowL.setOrientation(LinearLayout.HORIZONTAL);
                    rowL.setGravity(Gravity.RIGHT);
                    rowL.setPadding(dp(12), dp(5), dp(12), dp(5));
                    TextView tv = new TextView(ChatActivity.this);
                    tv.setTextSize(15);
                    tv.setLineSpacing(0, 1.15f);
                    tv.setPadding(dp(14), dp(10), dp(14), dp(10));
                    tv.setMaxWidth(dp(280));
                    tv.setTextColor(Color.WHITE);
                    tv.setBackground(rounded(Color.parseColor("#2563eb")));
                    rowL.addView(tv);
                    h.userText = tv;
                    h.answerText = null;
                    h.reasoningTitle = null;
                    h.reasoningText = null;
                }
                h.userText.setText(m.text);
                return;
            }

            if (h.answerText == null) {
                LinearLayout rowL = (LinearLayout) row;
                rowL.removeAllViews();
                rowL.setOrientation(LinearLayout.HORIZONTAL);
                rowL.setGravity(Gravity.LEFT);
                rowL.setPadding(dp(12), dp(5), dp(12), dp(5));
                LinearLayout bubble = new LinearLayout(ChatActivity.this);
                bubble.setOrientation(LinearLayout.VERTICAL);
                bubble.setBackground(rounded(Color.parseColor("#ffffff")));
                rowL.addView(bubble, new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

                TextView title = new TextView(ChatActivity.this);
                title.setTextSize(12);
                title.setTextColor(Color.parseColor("#6b7280"));
                title.setTypeface(Typeface.DEFAULT_BOLD);
                title.setPadding(dp(14), dp(10), dp(14), dp(2));
                title.setOnClickListener(v -> {
                    h.reasoningOpen = !h.reasoningOpen;
                    title.setText(h.reasoningOpen ? "💭 思考过程" : "💭 思考过程（点击展开）");
                    if (h.reasoningScroll != null) {
                        h.reasoningScroll.setVisibility(h.reasoningOpen ? View.VISIBLE : View.GONE);
                    }
                });
                bubble.addView(title);

                TextView rt = new TextView(ChatActivity.this);
                rt.setTextSize(13);
                rt.setTextColor(Color.parseColor("#6b7280"));
                rt.setLineSpacing(0, 1.25f);
                rt.setPadding(dp(14), dp(4), dp(14), dp(8));
                android.widget.ScrollView sv = new android.widget.ScrollView(ChatActivity.this);
                sv.setFillViewport(false);
                sv.addView(rt);
                bubble.addView(sv, new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

                TextView tv = new TextView(ChatActivity.this);
                tv.setTextSize(15);
                tv.setLineSpacing(0, 1.15f);
                tv.setPadding(dp(14), dp(10), dp(14), dp(10));
                tv.setTextColor(Color.parseColor("#111827"));
                bubble.addView(tv);
                h.reasoningTitle = title;
                h.reasoningText = rt;
                h.reasoningScroll = sv;
                h.answerText = tv;
            }

            boolean hasReasoning = !m.reasoning.trim().isEmpty();
            if (hasReasoning) {
                h.reasoningTitle.setVisibility(View.VISIBLE);
                h.reasoningTitle.setText(h.reasoningOpen ? "💭 思考过程" : "💭 思考过程（点击展开）");
                h.reasoningScroll.setVisibility(h.reasoningOpen ? View.VISIBLE : View.GONE);
                h.reasoningText.setText(m.reasoning);
                int hh = m.reasoning.length() > 400
                        ? dp(300)
                        : ViewGroup.LayoutParams.WRAP_CONTENT;
                h.reasoningScroll.setLayoutParams(new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, hh));
            } else {
                h.reasoningTitle.setVisibility(View.GONE);
                h.reasoningScroll.setVisibility(View.GONE);
                h.reasoningText.setText("");
            }
            markwon.setMarkdown(h.answerText, m.text + (m.live ? " ▍" : ""));
        };

        LinearLayout inputRow = new LinearLayout(this);
        inputRow.setOrientation(LinearLayout.HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);
        inputRow.setPadding(dp(10), dp(8), dp(10), dp(8));
        inputRow.setBackgroundColor(Color.WHITE);
        root.addView(inputRow, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        input = new EditText(this);
        input.setHint("输入消息…");
        input.setTextSize(15);
        input.setTextColor(Color.parseColor("#111827"));
        input.setHintTextColor(Color.parseColor("#9ca3af"));
        input.setBackground(rounded(Color.parseColor("#f3f4f6")));
        input.setPadding(dp(14), dp(9), dp(14), dp(9));
        input.setSingleLine(false);
        LinearLayout.LayoutParams inLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        inputRow.addView(input, inLp);

        Button send = new Button(this);
        send.setText("发送");
        send.setTextSize(14);
        send.setAllCaps(false);
        send.setTextColor(Color.WHITE);
        send.setBackground(rounded(Color.parseColor("#2563eb")));
        LinearLayout.LayoutParams sendLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sendLp.setMargins(dp(8), 0, 0, 0);
        send.setOnClickListener(v -> sendMessage());
        inputRow.addView(send, sendLp);

        inputRow.setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom = insets.getSystemWindowInsetBottom();
            v.setPadding(dp(10), dp(8), dp(10), dp(8) + bottom);
            return insets;
        });

        setContentView(root);
    }

    private void sendMessage() {
        String text = input.getText().toString().trim();
        if (text.isEmpty() || running) return;
        input.setText("");
        messages.add(new Msg(TYPE_USER, text, false));
        adapter.notifyDataSetChanged();
        scrollToEnd();
        setStatus("发送中");
        final String prompt = text;
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("sessionId", sessionId);
                payload.put("mode", "queue");
                JSONArray content = new JSONArray();
                content.put(new JSONObject().put("type", "text").put("text", prompt));
                payload.put("content", content);
                api.rpc("session.prompt", payload);
                main.post(() -> startPolling());
            } catch (Exception e) {
                main.post(() -> {
                    messages.add(new Msg(TYPE_ASSISTANT, "发送失败：" + e.getMessage(), false));
                    adapter.notifyDataSetChanged();
                    scrollToEnd();
                    setStatus("出错");
                });
            }
        }, "send-prompt").start();
    }

    private void startPolling() {
        if (pollActive) return;
        pollActive = true;
        poller = new Thread(() -> {
            while (pollActive) {
                try {
                    JSONArray items = api.listSessions();
                    boolean isRunning = false;
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject s = items.optJSONObject(i);
                        if (s != null && sessionId.equals(s.optString("sessionId"))) {
                            isRunning = s.optBoolean("running", false);
                            break;
                        }
                    }
                    running = isRunning;
                    main.post(() -> setStatus(running ? "生成中" : "已完成"));
                    updateTail();
                } catch (Exception ignored) {
                }
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException e) {
                    break;
                }
            }
            pollActive = false;
        }, "chat-poller");
        poller.start();
    }

    private void stopPolling() {
        pollActive = false;
        if (poller != null) poller.interrupt();
    }

    private void loadHistory(int maxMessages, final boolean keepPosition) {
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("sessionId", sessionId);
                payload.put("maxMessages", maxMessages);
                JSONObject value = api.rpc("session.history", payload);
                final List<Msg> folded = fold(value == null ? null : value.optJSONArray("events"));
                Log.i("DSH", "chat history folded: " + folded.size() + " msgs, session=" + sessionId);
                main.post(() -> {
                    messages = folded;
                    adapter.notifyDataSetChanged();
                    if (keepPosition) scrollToEnd();
                    else scrollToEnd();
                    if (!running) {
                        setStatus("");
                    }
                });
            } catch (Exception e) {
                main.post(() -> {
                    if (messages.isEmpty()) {
                        if (loadRetries < 60) {
                            loadRetries++;
                            setStatus("连接中断，正在重连…");
                            main.postDelayed(() -> loadHistory(30, false), 5000);
                        } else {
                            messages.add(new Msg(TYPE_ASSISTANT,
                                    "无法读取对话：远程连接已断开，请返回检查网络后重试", false));
                            adapter.notifyDataSetChanged();
                            setStatus("连接中断");
                        }
                    }
                });
            }
        }, "load-history").start();
    }

    private List<Msg> fold(JSONArray events) {
        List<Msg> result = new ArrayList<>();
        if (events == null) return result;
        StringBuilder pendingUser = new StringBuilder();
        Map<Integer, Integer> turnIndex = new HashMap<>();
        for (int i = 0; i < events.length(); i++) {
            try {
                JSONObject ev = events.getJSONObject(i).optJSONObject("event");
                String type = ev == null ? "" : ev.optString("type");
                JSONObject d = ev == null ? null : ev.optJSONObject("data");
                if (d == null) continue;
                int turn = d.optInt("turn", 0);
                if ("user/message".equals(type)) {
                    JSONObject source = d.optJSONObject("source");
                    boolean pluginNotice = source != null
                            && "plugin".equals(source.optString("kind"))
                            && "notice".equals(source.optString("form"));
                    if (pluginNotice) continue;
                    String t = textOf(d.optJSONObject("message"));
                    if (t.isEmpty()) t = textOf(d);
                    if (!t.isEmpty()) {
                        if (pendingUser.length() > 0) pendingUser.append("\n");
                        pendingUser.append(t);
                    }
                } else if ("assistant/message".equals(type)) {
                    flushPendingUser(result, pendingUser);
                    Integer idx = turnIndex.get(turn);
                    if (idx == null) {
                        result.add(new Msg(TYPE_ASSISTANT, "", false));
                        idx = result.size() - 1;
                        turnIndex.put(turn, idx);
                    }
                    String[] parts = textAndReasoning(d.optJSONObject("message"));
                    if (parts[0] != null && !parts[0].isEmpty()) result.get(idx).text = parts[0];
                    if (parts[1] != null && !parts[1].isEmpty()) result.get(idx).reasoning = parts[1];
                } else if ("assistant/chunk".equals(type)) {
                    flushPendingUser(result, pendingUser);
                    JSONObject chunk = d.optJSONObject("chunk");
                    if (chunk != null) {
                        String ctype = chunk.optString("type");
                        Integer idx = turnIndex.get(turn);
                        if (idx == null) {
                            result.add(new Msg(TYPE_ASSISTANT, "", false));
                            idx = result.size() - 1;
                            turnIndex.put(turn, idx);
                        }
                        if ("text-delta".equals(ctype)) {
                            result.get(idx).text += chunk.optString("text", "");
                        } else if ("reasoning-delta".equals(ctype)) {
                            result.get(idx).reasoning += chunk.optString("text", "");
                        } else if ("block-end".equals(ctype)) {
                            JSONObject block = chunk.optJSONObject("block");
                            if (block != null && "reasoning".equals(block.optString("type"))) {
                                String full = block.optString("text", "");
                                if (!full.isEmpty()) result.get(idx).reasoning = full;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        flushPendingUser(result, pendingUser);
        if (running && !result.isEmpty()
                && result.get(result.size() - 1).type == TYPE_ASSISTANT) {
            result.get(result.size() - 1).live = true;
        }
        return result;
    }

    private void flushPendingUser(List<Msg> result, StringBuilder pendingUser) {
        if (pendingUser.length() == 0) return;
        result.add(new Msg(TYPE_USER, pendingUser.toString(), false));
        pendingUser.setLength(0);
    }

    private void updateTail() {
        new Thread(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("sessionId", sessionId);
                payload.put("maxMessages", 2);
                JSONObject value = api.rpc("session.history", payload);
                final List<Msg> tail = fold(value == null ? null : value.optJSONArray("events"));
                main.post(() -> {
                    int change = mergeTail(tail);
                    if (change == 2) {
                        adapter.notifyDataSetChanged();
                        scrollToEnd();
                    } else if (change == 1) {
                        refreshTail();
                    }
                });
            } catch (Exception ignored) {
                tailFailures++;
                if (tailFailures >= 3) {
                    tailFailures = 0;
                    main.post(() -> setStatus("连接中断，正在重连…"));
                }
            }
        }, "update-tail").start();
    }

    // 0 = no change, 1 = last message content changed, 2 = structure changed.
    private int mergeTail(List<Msg> tail) {
        if (tail.isEmpty()) return 0;
        int i = messages.size() - 1;
        int j = tail.size() - 1;
        while (i >= 0 && j >= 0 && sameMsg(messages.get(i), tail.get(j))) {
            i--;
            j--;
        }
        if (j < 0) return 0;
        int oldSize = messages.size();
        while (messages.size() > i + 1) {
            messages.remove(messages.size() - 1);
        }
        int start = 0;
        if (j >= 0 && !messages.isEmpty()
                && sameMsg(messages.get(messages.size() - 1), tail.get(0))) {
            start = 1;
        }
        for (int k = start; k <= j; k++) {
            messages.add(tail.get(k));
        }
        return messages.size() == oldSize ? 1 : 2;
    }

    private boolean sameMsg(Msg a, Msg b) {
        return a.type == b.type
                && a.text.equals(b.text)
                && a.reasoning.equals(b.reasoning);
    }

    private void refreshTail() {
        if (messages.isEmpty()) return;
        int pos = messages.size() - 1;
        int first = listView.getFirstVisiblePosition();
        int last = listView.getLastVisiblePosition();
        if (pos < first || pos > last) {
            maybeScrollToEnd();
            return;
        }
        View row = listView.getChildAt(pos - first);
        if (row != null) {
            bindRow.accept(row, pos);
        }
        maybeScrollToEnd();
    }

    private void maybeScrollToEnd() {
        if (listView.getCount() > 0
                && listView.getLastVisiblePosition() >= listView.getCount() - 2) {
            scrollToEnd();
        }
    }

    private String textOf(JSONObject message) {
        String[] parts = textAndReasoning(message);
        return parts[0] == null ? "" : parts[0];
    }

    private String[] textAndReasoning(JSONObject message) {
        String text = "";
        String reasoning = null;
        if (message == null) return new String[]{text, reasoning};
        JSONArray content = message.optJSONArray("content");
        if (content == null) return new String[]{text, reasoning};
        StringBuilder sb = new StringBuilder();
        StringBuilder rsb = new StringBuilder();
        for (int i = 0; i < content.length(); i++) {
            JSONObject b = content.optJSONObject(i);
            if (b == null) continue;
            String t = b.optString("type");
            if ("text".equals(t)) {
                if (sb.length() > 0) sb.append("\n");
                sb.append(b.optString("text", ""));
            } else if ("reasoning".equals(t)) {
                if (rsb.length() > 0) rsb.append("\n");
                rsb.append(b.optString("text", ""));
            }
        }
        text = sb.toString();
        reasoning = rsb.length() > 0 ? rsb.toString() : null;
        return new String[]{text, reasoning};
    }

    private void setStatus(String s) {
        String t = sessionTitle == null || sessionTitle.isEmpty() ? "会话" : sessionTitle;
        statusText.setText(t + (s == null || s.isEmpty() ? "" : "  ·  " + s));
    }

    private void scrollToEnd() {
        listView.post(() -> listView.setSelection(listView.getCount() - 1));
    }

    private android.graphics.drawable.Drawable rounded(int color) {
        android.graphics.drawable.GradientDrawable g = new android.graphics.drawable.GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(16));
        return g;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        pollActive = false;
        if (poller != null) poller.interrupt();
        super.onDestroy();
    }
}
