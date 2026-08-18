# DSH Desktop（Android）

DeepSeek Harness 桌面端的安卓版本，与桌面端同名、同图标，核心功能一致：

- 通过 SSH 连接远程服务器，自动建立隧道并打开 DeepSeek Harness 网页界面
- 连接管理：名称 / 主机 / 用户 / 端口 / 密码或私钥 / 远程项目目录 / 远程 dsh 端口
- 原生「会话」主页：展示服务器上的全部对话（标题 / 最近时间 / 运行状态圆点 / 工作区路径），点开即可进入该对话
- 原生聊天页：DeepSeek 手机版风格的气泡对话，直接续聊已有会话；发送后实时显示生成内容（轮询增量文本）
- 界面内置状态灯、连接名和「工作区」面板（读取当前服务器的 workspace 列表）
- 支持从「连接管理」随时切换远程服务器
- 手机端界面：隐藏桌面侧栏，聊天区全屏适配，顶部连接状态栏 + 底部输入区，参考 DeepSeek 手机版风格
- 支持「直连地址」：已有一个 dsh 网页服务时，可直接填 URL 跳过 SSH 打开

> 说明：手机端无法运行桌面端那种本地 Node 后端，所以本应用定位为**远程开发客户端**——SSH 到你的服务器（例如 Ubuntu 开发机）后在 WebView 中打开 dsh，项目目录、会话都跑在服务器上，和桌面端的远程开发体验一致。

## 在 Android Studio 中打开

1. 用 Android Studio 打开本目录（`android/`）。
2. 等待 Gradle 同步完成（需要联网下载依赖）。
3. 连接手机（开启 USB 调试），或启动模拟器，点 Run。

## 直接安装 APK

已构建好的安装包在桌面工程 `dist/` 下：

- `DSH Desktop-0.2.3-android.apk`（正式签名包，推荐）
- `DSH Desktop-0.2.3-android-debug.apk`（调试包）

安装方式：把 APK 传到手机（微信/网盘/`adb install` 均可），点击安装；若提示「未知来源」，在系统设置里允许安装即可。

也可以用命令安装：

```sh
~/Library/Android/sdk/platform-tools/adb install -r "dist/DSH Desktop-0.2.3-android.apk"
```

## 使用

1. 打开 App，点「连接管理」→「添加远程服务器」。
2. 填写名称、主机 IP、用户名；密码或私钥内容二选一（私钥需粘贴 PEM 内容，例如 `-----BEGIN OPENSSH PRIVATE KEY-----` 开头）。
3. 填远程项目目录（默认 `~`）和远程 dsh 命令（默认 `npx -y @deepseek-ai/dsh@0.1.0-rc.6`）。
4. 保存并点「连接」。连接成功后会自动建立 SSH 隧道并打开 dsh 网页。
5. 界面右下角有状态条：点它可以展开当前服务器的「工作区」列表。

## 构建

```sh
cd android
./gradlew assembleRelease
```

产物在 `app/build/outputs/apk/release/app-release.apk`。签名用的本地 keystore 在 `keystore/`（已加入 .gitignore，不随仓库提交）。

## 技术栈

- Kotlin-free 纯 Java + Android WebView
- SSH：`com.github.mwiede:jsch`（支持端口转发与远程命令）
- minSdk 26 / targetSdk 36 / compileSdk 37
