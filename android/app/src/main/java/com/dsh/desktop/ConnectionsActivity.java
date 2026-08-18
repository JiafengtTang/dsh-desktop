package com.dsh.desktop;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ConnectionsActivity extends Activity {
    private static final int REQ_IMPORT = 2001;

    private ConnectionStore store;
    private List<JSONObject> connections = new ArrayList<>();
    private ListView listView;
    private BaseAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new ConnectionStore(this);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#f7f8fa"));

        TextView header = new TextView(this);
        header.setText("远程连接");
        header.setTextColor(Color.parseColor("#111827"));
        header.setTextSize(20);
        header.setTypeface(Typeface.DEFAULT_BOLD);
        header.setPadding(dp(18), dp(20), dp(18), dp(10));
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button addBtn = new Button(this);
        addBtn.setText("＋ 添加远程服务器");
        addBtn.setTextSize(16);
        addBtn.setAllCaps(false);
        addBtn.setTextColor(Color.WHITE);
        addBtn.setPadding(dp(14), dp(13), dp(14), dp(13));
        addBtn.setBackground(rounded(Color.parseColor("#2563eb")));
        addBtn.setOnClickListener(v -> editDialog(null));
        LinearLayout.LayoutParams abLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        abLp.setMargins(dp(14), 0, dp(14), dp(12));
        root.addView(addBtn, abLp);

        Button importBtn = new Button(this);
        importBtn.setText("导入服务器配置…");
        importBtn.setTextSize(13);
        importBtn.setAllCaps(false);
        importBtn.setTextColor(Color.parseColor("#2563eb"));
        importBtn.setBackground(rounded(Color.parseColor("#e8efff")));
        importBtn.setOnClickListener(v -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            startActivityForResult(i, REQ_IMPORT);
        });
        LinearLayout.LayoutParams ibLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ibLp.setMargins(dp(14), 0, dp(14), dp(12));
        root.addView(importBtn, ibLp);

        listView = new ListView(this);
        listView.setDivider(null);
        listView.setBackgroundColor(Color.parseColor("#f7f8fa"));
        root.addView(listView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(28)));

        setContentView(root);
        reload();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT && resultCode == RESULT_OK && data != null && data.getData() != null) {
            int n = store.importFromUri(this, data.getData());
            android.widget.Toast.makeText(this,
                    n < 0 ? "导入失败：文件格式不正确" : "已导入 " + n + " 个服务器",
                    android.widget.Toast.LENGTH_SHORT).show();
            reload();
        }
    }

    private GradientDrawable rounded(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(14));
        return g;
    }

    private void reload() {
        connections = store.list();
        adapter = new BaseAdapter() {
            @Override
            public int getCount() {
                return connections.size();
            }

            @Override
            public Object getItem(int position) {
                return connections.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                JSONObject c = connections.get(position);
                LinearLayout row = new LinearLayout(ConnectionsActivity.this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(16), dp(12), dp(12), dp(12));
                row.setBackgroundColor(Color.WHITE);

                TextView name = new TextView(ConnectionsActivity.this);
                name.setText(c.optString("name", ""));
                name.setTextColor(Color.parseColor("#111827"));
                name.setTextSize(16);
                name.setTypeface(Typeface.DEFAULT_BOLD);
                row.addView(name);

                TextView sub = new TextView(ConnectionsActivity.this);
                String target = c.optString("user", "") + "@" + c.optString("host", "");
                sub.setText(target + "  ·  " + c.optString("projectDir", "~"));
                sub.setTextColor(Color.parseColor("#9ca3af"));
                sub.setTextSize(12);
                row.addView(sub);

                LinearLayout btnRow = new LinearLayout(ConnectionsActivity.this);
                btnRow.setOrientation(LinearLayout.HORIZONTAL);
                btnRow.setGravity(Gravity.RIGHT);
                row.addView(btnRow);

                Button connect = smallButton("连接");
                connect.setOnClickListener(v -> {
                    store.setActive(c.optString("name"));
                    setResult(RESULT_OK);
                    finish();
                });
                btnRow.addView(connect);

                Button edit = smallButton("编辑");
                edit.setOnClickListener(v -> editDialog(c));
                btnRow.addView(edit);

                Button del = smallButton("删除");
                del.setTextColor(Color.parseColor("#ef4444"));
                del.setOnClickListener(v -> {
                    store.remove(c.optString("name"));
                    reload();
                });
                btnRow.addView(del);

                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.setMargins(dp(10), dp(5), dp(10), dp(5));
                row.setLayoutParams(lp);
                return row;
            }
        };
        listView.setAdapter(adapter);
    }

    private Button smallButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(13);
        b.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(4), dp(10), 0, 0);
        b.setLayoutParams(lp);
        return b;
    }

    private void editDialog(JSONObject existing) {
        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(8), dp(4), dp(8), 0);

        TextView hint = new TextView(this);
        hint.setText("只需填 名称 / 主机 / 用户名，其余有默认值");
        hint.setTextColor(Color.parseColor("#9ca3af"));
        hint.setTextSize(12);
        form.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        EditText name = field(form, "名称 *");
        EditText host = field(form, "主机 / IP *");
        EditText user = field(form, "用户名 *");
        EditText port = field(form, "SSH 端口（默认 22）");
        EditText password = field(form, "密码（可选）");
        EditText keyContent = field(form, "私钥内容（可选，粘贴 PEM）");
        keyContent.setLines(4);
        EditText projectDir = field(form, "远程项目目录（默认 ~）");
        EditText remotePort = field(form, "远程 dsh 端口（0 = 自动）");
        EditText shell = field(form, "远程 shell（默认 bash）");
        EditText dshCommand = field(form, "远程 dsh 命令（默认 npx）");
        EditText url = field(form, "直连地址（可选，跳过 SSH）");
        scroll.addView(form);

        if (existing != null) {
            name.setText(existing.optString("name"));
            host.setText(existing.optString("host"));
            user.setText(existing.optString("user"));
            port.setText(String.valueOf(existing.optInt("port", 22)));
            password.setText(existing.optString("password"));
            keyContent.setText(existing.optString("keyContent"));
            projectDir.setText(existing.optString("projectDir"));
            remotePort.setText(String.valueOf(existing.optInt("remotePort", 0)));
            shell.setText(existing.optString("shell", "bash"));
            dshCommand.setText(existing.optString("dshCommand"));
            url.setText(existing.optString("url"));
        } else {
            port.setText("22");
            remotePort.setText("0");
            shell.setText("bash");
            projectDir.setText("~");
        }

        new AlertDialog.Builder(this)
                .setTitle(existing == null ? "添加连接" : "编辑连接")
                .setView(scroll)
                .setPositiveButton("保存", (dialog, which) -> {
                    String nm = name.getText().toString().trim();
                    String hs = host.getText().toString().trim();
                    String us = user.getText().toString().trim();
                    if (nm.isEmpty() || hs.isEmpty() || us.isEmpty()) {
                        new AlertDialog.Builder(this)
                                .setMessage("名称、主机、用户名不能为空")
                                .setPositiveButton("好", null)
                                .show();
                        return;
                    }
                    JSONObject c = new JSONObject();
                    try {
                        c.put("name", nm);
                        c.put("host", hs);
                        c.put("user", us);
                        c.put("port", parseInt(port.getText().toString(), 22));
                        c.put("password", password.getText().toString());
                        c.put("keyContent", keyContent.getText().toString());
                        c.put("projectDir", projectDir.getText().toString().trim());
                        c.put("remotePort", parseInt(remotePort.getText().toString(), 0));
                        String sh = shell.getText().toString().trim();
                        c.put("shell", sh.isEmpty() ? "bash" : sh);
                        c.put("dshCommand", dshCommand.getText().toString().trim());
                        c.put("url", url.getText().toString().trim());
                    } catch (Exception ignored) {
                    }
                    if (existing == null) {
                        store.add(c);
                    } else {
                        store.update(existing.optString("name"), c);
                    }
                    reload();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private EditText field(LinearLayout form, String label) {
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextColor(Color.parseColor("#6b7280"));
        tv.setTextSize(12);
        LinearLayout.LayoutParams tLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tLp.setMargins(0, dp(10), 0, dp(2));
        form.addView(tv, tLp);

        EditText et = new EditText(this);
        et.setTextColor(Color.parseColor("#111827"));
        et.setHintTextColor(Color.parseColor("#9ca3af"));
        et.setTextSize(14);
        form.addView(et, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return et;
    }

    private static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
