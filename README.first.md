# Claude Code White 新手安装指南 ｜ First-Time Setup Guide

> 中文：照着这份文档一步步做，不需要任何编程经验也能装好。看不懂的术语会当场解释。全程大约 10 分钟。
> English: Follow this guide step by step — no programming experience needed, every term is explained along the way. About 10 minutes total.

---

## 这个软件是干嘛的？ What does this software do?

一句话：**把 Claude Code 从黑乎乎的终端，变成带窗口的桌面软件。**
In one line: **it turns Claude Code from a plain terminal into a desktop app with windows.**

Claude Code 是 Anthropic 官方的 AI 编程助手（命令行工具）。它本身没有图形界面，本软件给它套了一个外壳，让你可以：

Claude Code is Anthropic's official AI coding assistant (a command-line tool). It has no GUI, so this project wraps it in a shell that lets you:

- 同时开 1~3 个窗口，边写代码边看 AI 干活 — run 1–3 windows at once, watch the AI work while you code
- 实时看到 AI 每一步在做什么（读了什么文件、改了什么、运行了什么）— see every step live (files read, edits made, commands run)
- 左侧边栏查看改动、记忆、用量 — inspect changes, memory and usage in the sidebar
- 浅色 / 深色主题随意切换 — switch between light and dark themes

**重要：** 你的对话、文件、密钥全部留在你自己的电脑里，不会上传到任何服务器。这个软件只是"显示器"，真正的 AI 干活用的是你本机安装的 Claude Code。

**Important:** your conversations, files and keys stay on your own computer — nothing is uploaded anywhere. This app is just the "display"; the real AI work is done by your locally installed Claude Code.

---

## 一、需要准备的环境（先检查，缺什么补什么） Prerequisites (check first, install what's missing)

| 需要的东西 What | 为什么需要 Why | 没有会怎样 Without it |
|---|---|---|
| Windows 电脑 A Windows PC | 一键启动器是 Windows 专属 The one-click launcher is Windows-only | 其他系统能用命令行方式，但不建议新手 Other OSes work via CLI but are not beginner-friendly |
| Node.js（≥ 22.13 版本） Node.js (≥ 22.13) | 运行这个软件的引擎 The engine that runs this app | 双击启动会弹窗提示缺 Node.js A popup says Node.js is missing |
| Claude Code CLI | 真正干活的 AI The AI that actually does the work | 页面能开，但会话都是空的 Pages open but sessions are empty |
| Chrome 浏览器 Chrome browser | 以"应用窗口"方式打开软件 Opens the app as an application window | 没有也能用，会退化成普通浏览器标签页 Falls back to a normal tab |

### 第 1 项检查：Node.js — Step 1: Node.js

打开 PowerShell（开始菜单搜索 "PowerShell"，回车），输入：
Open PowerShell (search "PowerShell" in the Start menu, press Enter) and run:

```powershell
node -v
```

- 输出了 `v22.13.0` 或更高的版本号 → ✅ 合格，跳过 — If it prints `v22.13.0` or higher → ✅ done, skip ahead
- 提示 `node 不是内部或外部命令` → ❌ 需要安装 — If it says "node is not recognized" → ❌ install it:
  1. 打开 Node.js 官网：https://nodejs.org/ （认准 LTS 版）— Open https://nodejs.org/ (pick the LTS version)
  2. 下载 Windows 安装包（.msi），一路「下一步」装完 — Download the Windows installer (.msi) and click Next all the way through
  3. 重新打开 PowerShell，再输入 `node -v` 确认 — Reopen PowerShell and run `node -v` again to confirm

### 第 2 项检查：Claude Code CLI — Step 2: Claude Code CLI

在同一个 PowerShell 里输入 — In the same PowerShell, run:

```powershell
claude --version
```

- 输出了版本号 → ✅ 已安装 — If it prints a version → ✅ installed
- 提示找不到命令 → ❌ 执行安装（需要先完成上面的 Node.js）— If "not recognized" → install (Node.js from Step 1 first):

```powershell
npm install -g @anthropic-ai/claude-code
```

装完后输入 `claude`，按提示完成登录（登录一次即可，以后不用再登）。登录成功会看到 Claude 的欢迎信息。

After installing, run `claude` and complete the sign-in when prompted (once, then never again). You'll see Claude's welcome message on success.

### 第 3 项：Chrome（可选但推荐）— Step 3: Chrome (optional but recommended)

没有就先装一个：https://www.google.com/chrome/。不装也不影响使用。
Install it from https://www.google.com/chrome/ if you don't have it. Everything still works without it.

---

## 二、下载并解压软件 Download & extract

1. 打开本项目的 GitHub 仓库页面 — Open this project's GitHub repository page
2. 点绿色的 **Code** 按钮 → **Download ZIP** — Click the green **Code** button → **Download ZIP**
3. 把 zip 解压到任意位置，比如 `D:\` 或桌面 — Extract the zip anywhere, e.g. `D:\` or your Desktop

> ⚠️ **强烈建议 Strongly recommended**：解压路径**不要包含中文和空格**（比如 `D:\Claude-Code-White` 可以，`D:\我的软件\Claude Code White` 不推荐）。省得后面遇到玄学问题。
> Avoid Chinese characters and spaces in the path (e.g. `D:\Claude-Code-White` is fine, `D:\我的软件\Claude Code White` is not). Saves you from mysterious problems later.

---

## 三、文件夹里都有什么（认识 3 个文件就够） What's in the folder (you only need to know 3 files)

解压后会看到很多文件和文件夹，**99% 你永远不用碰**。只需认识这几个：
There are lots of files and folders — **99% of them you'll never touch**. Only know these:

| 文件 File | 用途 Purpose | 你要对它做什么 What to do |
|---|---|---|
| `打开 Claude Code White.vbs` | **双击它 = 启动软件**（最常用）— **Double-click = start the app** (most common) | 记住它就行 Just remember it |
| `打开 Claude Code White.cmd` | 命令行的备用启动入口 Backup CLI launcher | 基本不用管 Ignore it |
| `scripts\create-shortcut.ps1` | 一键创建桌面快捷方式 Creates desktop shortcuts | 想偷懒再运行一次 Run once if you want shortcuts |

其他都别动 — Don't touch anything else:

| 文件/文件夹 File/Folder | 是什么 What it is | 建议 Advice |
|---|---|---|
| `app\` `bridge\` `public\` | 软件源代码 Source code | ❌ 不要动 Don't touch |
| `node_modules\` | 装好的零件库（首次安装后出现）Installed dependencies (appears after first install) | ❌ 不要动 Don't touch |
| `docs\PRD.md` | 给开发者看的产品文档 Developer docs | 好奇可以翻 Feel free to browse |
| `.env.example` | 可选配置模板（用量中心）Optional config template (usage center) | 不需要就忽略 Ignore if not needed |
| `Start-Claude-Code-White.ps1` / `Launch-Claude-Code-White.vbs` | 内部启动脚本（被 vbs 调用）Internal scripts (called by the .vbs) | ❌ 不要动 Don't touch |

---

## 四、安装流程（一次性，5 分钟） Installation (one-time, ~5 minutes)

### 第 1 步：进入项目文件夹 — Step 1: Open the project folder

在解压出来的文件夹里，**按住 Shift + 右键空白处**，选择「**在此处打开 PowerShell 窗口**」。

Inside the extracted folder, **hold Shift + right-click on empty space**, choose "**Open PowerShell window here**".

> 怎么确认进对了？在 PowerShell 里输入 `dir`，能看到上面表格里的文件名（比如 `打开 Claude Code White.vbs`），就对了。
> How to confirm you're in the right place? Run `dir` — you should see the file names from the table above (e.g. `打开 Claude Code White.vbs`).

### 第 2 步：安装依赖（只做一次）— Step 2: Install dependencies (once)

在 PowerShell 里输入 — In PowerShell, run:

```powershell
npm install
```

- 会滚动一大片英文，**不要关窗口**，等它跑完（1~5 分钟，看网速）— Lots of English text will scroll by — **keep the window open** until it finishes (1–5 min depending on your network)
- 跑完回到可以输入命令的状态，并且没有红色 ERROR 字样 → ✅ 成功 — When it returns to the prompt with no red ERROR lines → ✅ done

### 第 3 步：确认装好了 — Step 3: Verify

```powershell
npm --version
node -v
```

两个都输出版本号 → 安装流程完成，可以进入「打开方式」。
If both print version numbers → installation is complete, jump to "How to open" below.

---

## 五、打开方式（重点，选一种） How to open (pick one)

### 方式一：双击启动（推荐，最省事）— Option 1: Double-click (recommended)

**双击** `打开 Claude Code White.vbs` — **Double-click** `打开 Claude Code White.vbs`

发生什么 — What happens:
1. 没有任何黑窗口弹出（安静后台启动）— No console window pops up (silent background start)
2. 等待约 3~10 秒（首次会久一点，它在默默补装依赖）— Wait ~3–10 seconds (longer on first run while dependencies are quietly prepared)
3. 自动弹出 Chrome 应用窗口，出现 Claude Code White 界面 = **启动成功** ✅ — A Chrome app window opens with the Claude Code White UI = **success** ✅

> 没反应？看文末「常见问题」第 1 条 — Nothing happens? See FAQ #1 at the end.

### 方式二：命令启动（能看到日志，适合好奇宝宝）— Option 2: Command line (shows logs)

在刚才那个 PowerShell 窗口里输入 — In the PowerShell window from before:

```powershell
npm run dev
```

看到 `localhost:3000` 字样后，打开 Chrome 输入 — Once you see `localhost:3000`, open Chrome and go to:

```
http://localhost:3000
```

出现界面 = 成功 ✅。**这个窗口不要关**，关了软件就停了。
UI appears = success ✅. **Don't close this window** — closing it stops the app.

### 方式三：桌面快捷方式（一劳永逸）— Option 3: Desktop shortcuts (one-time setup)

先做一次（在 PowerShell 里）— Run once (in PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

桌面会出现两个图标 — Two icons appear on your desktop:
- **Claude Code White** —— 双击直接进软件 — double-click to launch
- **Claude Code White（管理员）** —— 需要管理员权限时用（双击后点「是」确认 UAC）— for admin rights (click "Yes" on the UAC prompt)

### 方式四：正式版模式（构建产物，嫌慢再研究）— Option 4: Production mode (built artifacts)

```powershell
npm run build
npm run start
```

第一次 build 要一两分钟，之后每次启动都是 `npm run start` 一条命令。页面会自动打开，浏览器访问 `http://localhost:3000` 也行。
The first build takes a minute or two; afterwards `npm run start` is all you need. The page opens automatically (or visit `http://localhost:3000`).

---

## 六、第一次打开后怎么用 Using it for the first time

1. 页面上有「新建任务」按钮 → 点击 → 选择或输入项目目录 — Click "New Task" → choose or type a project directory
2. 选模型（Sonnet 是默认，又快又稳；Opus 最强最贵）— Pick a model (Sonnet is the default — fast and reliable; Opus is the strongest, most expensive)
3. 输入你的需求，回车 → 左边窗口开始实时显示 AI 干活过程 — Type your request, press Enter → the pane starts streaming the AI's work live
4. 想再开一个，点「新建任务」再来一个，窗口可以拖来拖去 — Want another one? Click "New Task" again; panes can be dragged around

**想用 DeepSeek API 计费？（可选）Wanna pay with DeepSeek API? (optional)**
1. 打开任意会话 → 底部设置（✦/D）→「高级」→「提供商」→ DeepSeek →「连接 DeepSeek API」— Open any pane's settings (✦/D) → 高级 → 提供商 → DeepSeek → "连接 DeepSeek API"
2. 粘贴 DeepSeek API Key（在 platform.deepseek.com 创建）。勾选“使用 Windows 当前账户安全保存”则加密存在本机账户下（关电脑也有效）；不勾选则只记到关闭软件为止 — Paste a DeepSeek API key (create one at platform.deepseek.com). Tick "secure-save" to keep it encrypted under your Windows account (survives restarts); untick keeps it only until the app closes
3. 验证成功后该会话自动用 DeepSeek V4 Pro，随时可在“提供商”页换回 Claude — Verified panes switch to DeepSeek V4 Pro; switch back to Claude from the same provider page

密钥只发到 127.0.0.1 本机桥，不会上传、不会写进聊天记录或日志。普通 Claude Code 用户不用管这一节，登录状态完全不受影响。
The key only goes to the 127.0.0.1 local bridge — never uploaded, never written into chats or logs. Regular Claude Code users can skip this section entirely.

---

## 七、常见问题（小白版） FAQ (beginner edition)

**1. 双击 vbs 没反应？ Nothing happens on double-click?**
等 10 秒再双击一次（首次在默默装依赖）。还不行，就换成方式二（`npm run dev`）看窗口里报什么错，把红字截图发给我。
Wait 10 seconds and double-click again (first run installs dependencies silently). Still nothing? Use Option 2 (`npm run dev`) and screenshot the red error text.

**2. 页面打开了，但会话/记忆都是空的？ Page opens but sessions/memory are empty?**
说明 Claude Code CLI 没登录。回到「第 1 项检查」，执行 `claude` 完成登录，关掉页面重新打开。
Claude Code CLI isn't signed in. Go back to Step 2, run `claude` to sign in, close the page and reopen it.

**3. 提示端口被占用？ Port already in use?**
不用担心，软件会自动在 3000~3019 里找空闲端口，页面会打开正确地址。
No worries — the app auto-picks a free port in 3000–3019 and opens the correct address.

**4. 改过代码之后页面没变化？ Changes to the code don't show up?**
开发模式改 `bridge\` 里的文件需要重启：Ctrl+C 停掉，再 `npm run dev`。
In dev mode, changes under `bridge\` need a restart: Ctrl+C, then `npm run dev` again.

**5. 要卸载？ Uninstall?**
直接删掉这个文件夹即可，不留任何系统垃圾（桌面快捷方式右键删除）。
Just delete the folder — nothing is left behind on the system (right-click delete the desktop shortcuts).

---

## 八、安全提醒（必读） Security notes (must read)

- 这个软件**只在本机运行**，请勿把它部署到公网服务器 — This app runs **locally only** — never deploy it to a public server
- 你的 API Key 只放在你自己的环境变量里，软件不保存、不上传 — Your API keys live only in your own environment variables; the app never stores or uploads them
- 对话记录存在你自己电脑的 `~\.claude\` 目录，不会发到任何地方 — Conversation history stays in `~\.claude\` on your machine and goes nowhere else

---

*装好了，恭喜你。有问题去仓库提 issue，带上 PowerShell 里的红字报错。*
*Done? Congrats. Open an issue with the red error text from PowerShell if you run into problems.*
