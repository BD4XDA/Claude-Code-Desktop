# Claude Code Desktop ｜ Claude Code White

Claude Code Desktop 是一个面向本地 Claude Code CLI 的双主题桌面前端。浅色版使用更清透的中性纸白，深色版使用中性炭黑，并以 Claude 的珊瑚橙保留品牌温度；交互参考 Claude Desktop 的并行会话设计，同时保留 Codex 式项目、工具、终端、变更和权限工作流。

Claude Code White is a dual-theme desktop frontend for your local Claude Code CLI — light paper-white and dark carbon-black, with Claude coral as the brand accent. It borrows the parallel-session design of Claude Desktop while keeping the Codex-style project, tool, terminal, change and permission workflows.

界面针对高分辨率桌面显示器优化阅读尺度，品牌标题采用具有人文编辑感的衬线字体，正文与代码分别使用清晰的无衬线和等宽字体。
Typography is tuned for high-resolution desktop displays: a humanist serif for the brand title, clear sans-serif for body text and monospace for code.

---

## 当前能力 Features

- 自动检测本机 `claude` 命令与版本（PATH / npm 全局 / 原生安装 / WinGet 均支持）
- 通过官方 headless 模式调用：`claude -p --output-format stream-json --verbose`
- 1–3 个 Claude Code 会话并排流式运行，可拖拽重排、独立停止
- 对话框支持一次上传多张图片：点击“＋”多选、批量拖拽或从剪贴板粘贴；发送前可预览、移除和放大查看
- 每个窗格独立保存会话 ID、项目目录、模型和权限模式；会话可重命名、删除，新任务自动生成标题
- 可搜索并恢复本机 Claude Code 历史任务，继续原始 session 上下文、项目目录和模型
- `Ctrl+Shift+P` 快捷操作面板：新建/恢复任务、打开变更/文件/日志/记忆、切换检查面板与主题
- 浅色 / 深色主题与设备本地会话恢复
- Sonnet / Opus / Haiku 模型切换；**DeepSeek V4 Pro / V4 Flash 原生提供商**——在会话设置中粘贴一次 API Key（可选 Windows 当前账户安全保存或仅本次启动），由本机桥接通过 DeepSeek Anthropic 兼容端点驱动真实 Claude Code，无需手动设置 `ANTHROPIC_BASE_URL` 等环境变量
- Codex 式批准策略：仅规划 / 操作前批准 / 自动批准编辑 / 智能批准 / 不询问（受限），每个会话独立保存
- 思考强度可随时切换：快速 / 标准 / 深入 / 极强 / 最大，真实传入 Claude Code `--effort`，运行中调整从下一轮推理生效；DeepSeek 模式下五档映射为 high / max 两档并明确提示
- Codex 式流程展示：运行时显示当前步骤；结果输出后自动折叠为轻量摘要，可按回答点击「查看流程详情」展开步骤、工具输入与结果
- 右侧检查面板：真实 Git 变更、可点击的单文件 Diff（新增/删除行着色）、可展开的文件树与文件预览、桥接器实时日志、本机记忆
- 记忆面板按工作区分区、按类型（用户 / 反馈 / 项目 / 参考）分类，可新建、编辑、删除记忆，直接写入 `~/.claude/projects/<工作区>/memory/` 并维护索引
- 桥接未就绪时顶栏「一键桥接」可直接拉起本地桥接进程
- 左下角“用量与额度”中心：Claude 本机会话统计、DeepSeek 余额、Anthropic / OpenAI 组织成本、Gemini 官方控制台入口

- Auto-detects your local `claude` binary and version (PATH / npm global / native install / WinGet)
- Drives the official headless mode: `claude -p --output-format stream-json --verbose`
- 1–3 Claude Code sessions streaming side by side; drag to reorder, stop independently
- Multi-image input in every composer: multi-select from “＋”, batch drag-and-drop or clipboard paste, with preview/removal/lightbox before sending
- Each pane keeps its own session ID, project directory, model and permission mode; rename, delete, auto-title
- Search and resume local Claude Code history — original session context, directory and model
- `Ctrl+Shift+P` command palette: new/resume tasks, open changes/files/logs/memory, toggle inspector & theme
- Light/dark theme with per-device session restore
- Sonnet / Opus / Haiku model switching, plus a **native DeepSeek provider (V4 Pro / V4 Flash)**: paste an API key once in session settings (optionally secured via Windows DPAPI for your account, or session-only), and the local bridge drives the real Claude Code through DeepSeek's Anthropic-compatible endpoint — no need to hand-set `ANTHROPIC_BASE_URL`
- Thinking levels: quick / normal / deep / extreme / max — passed as real `--effort`; changes apply from the next reasoning turn; under DeepSeek the five levels map to high/max and the UI says so
- Codex-style approval policies: plan-only / ask / auto-edit edits / smart / never (limited), saved per session
- Codex-style flow view: shows the current step live; results collapse into lightweight summaries, expandable per answer (steps, tool inputs, outputs)
- Inspector panel: real Git changes, clickable per-file diffs (added/removed lines colored), expandable file tree with preview, live bridge logs, local memory
- Memory panel grouped by workspace and type (user / feedback / project / reference); create, edit, delete directly under `~/.claude/projects/<workspace>/memory/` with auto-maintained index
- One-click bridge in the top bar when the bridge is not ready
- Usage & quota center (bottom-left): local Claude session stats, DeepSeek balance, Anthropic / OpenAI org costs, Gemini console entry

---

## 启动 Getting Started

桥接器已内置在开发服务器中（`bridge/vite-plugin.mjs`），一条命令即同时提供前端与本地桥接 API：
The bridge is built into the dev server (`bridge/vite-plugin.mjs`) — one command serves both the frontend and the local bridge API:

```powershell
npm run dev
```

推荐直接双击桌面的「Claude Code White」快捷方式，或项目里的「打开 Claude Code White.vbs」：无控制台启动器会静默复用健康实例，或自动寻找可用端口、启动本地服务、等待连接成功，再以 Chrome 应用窗口打开。整个过程不会弹出黑色命令窗口；第一次运行若缺少依赖，会自动准备。

Or just double-click the desktop shortcut or `打开 Claude Code White.vbs` in the project: the silent launcher reuses a healthy instance, or starts one on a free port, waits until ready, then opens a Chrome app window — no console window, auto-installs missing dependencies on first run.

要重新创建桌面的一键启动快捷方式：
To (re)create the one-click desktop shortcuts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

也可以在 PowerShell 中直接运行同一个一键启动器：
Or run the same launcher directly from PowerShell:

```powershell
& '.\Start-Claude-Code-White.ps1'
```

### 管理员模式 Admin mode

需要以管理员身份运行时（dev server、本地桥接与所有 Claude Code CLI 子进程都获得管理员权限），在项目目录执行：
If you need admin rights (dev server, local bridge and every spawned Claude Code CLI child inherit them), run from the project directory:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

会在桌面创建「Claude Code White（管理员）」快捷方式（带 UAC 提权标志）：双击后确认 UAC，自动以管理员身份运行 `npm run dev`。桌面上已有的同款快捷方式可直接双击使用。
This creates a 「Claude Code White (Admin)」 shortcut with a UAC elevation flag: double-click, confirm UAC, and it runs `npm run dev` as administrator. Existing shortcuts keep working.

如果本机尚未安装 Claude Code，先按照 Anthropic 官方说明安装并完成登录（支持 npm 全局、原生安装与 WinGet 三种安装位置）。前端不会收集或保存 API Key，认证完全交给 Claude Code 自身管理。
If Claude Code is not installed yet, install and sign in per Anthropic's official docs (npm global, native install or WinGet all supported). The frontend never collects or stores API keys — authentication is entirely managed by Claude Code itself.

生产模式（构建产物）：`npm run start` 会自动拉起本地桥接（监听 127.0.0.1:4318），一条命令即可使用；页面左上角也有「一键桥接」按钮，桥接未就绪时点击即可拉起：
Production mode (built artifacts): `npm run start` automatically starts the local bridge (listening on 127.0.0.1:4318). There's also a one-click bridge button in the top-left of the page:

```powershell
npm run build
npm run start    # frontend + auto-start local bridge; page falls back to the standalone bridge port
```

---

## 用量供应商（可选）Usage providers (optional)

在启动 PowerShell 的用户环境中设置下列变量即可启用对应检测器；密钥只由监听 `127.0.0.1` 的本地桥读取，不会返回给网页。`DEEPSEEK_API_KEY` 同时可作为 DeepSeek 推理提供商的密钥来源（优先级低于本次会话在 UI 中粘贴的 Key、高于 Windows 安全存储）：
Set these variables in the environment of the launching PowerShell to enable the corresponding detectors; keys are read only by the local bridge on `127.0.0.1` and never returned to the page:

```powershell
$env:DEEPSEEK_API_KEY = '...'
$env:ANTHROPIC_ADMIN_KEY = '...'
$env:OPENAI_ADMIN_KEY = '...'
$env:GEMINI_API_KEY = '...'
& '.\Start-Claude-Code-White.ps1'
```

Anthropic 的 Usage & Cost API 只适用于组织 Admin API key，不能查询个人 Claude Pro / Max 订阅剩余额度。Gemini 普通 API key 也没有余额查询接口，因此界面会跳转到官方 AI Studio 用量页。
Anthropic's Usage & Cost API only works with organization Admin API keys — it cannot query personal Claude Pro/Max plan quotas. Gemini API keys have no balance endpoint either, so the UI links to the official AI Studio usage page instead.

---

## DeepSeek 提供商（可选）DeepSeek provider (optional)

默认的 Claude Code 用户**不需要任何 DeepSeek 配置**——登录状态、Anthropic、Bedrock、Vertex 和自定义网关全部原样保留。只有希望用 DeepSeek API 计费驱动 Claude Code 时才需要：

1. 在一个会话窗格底部点开「✦/D 设置」→「高级」→「提供商」→「DeepSeek」→「连接 DeepSeek API」。
2. 粘贴一次 API Key；勾选“使用 Windows 当前账户安全保存”（默认开启）则经 DPAPI 加密存入 `%LOCALAPPDATA%\ClaudeCodeWhite\deepseek-api-key.dpapi`（仅当前用户可解密，Windows 若不可用会提示改回仅本次启动），取消勾选则只存在桥接器内存、关闭即失效。
3. 验证成功后该会话自动切换到 DeepSeek V4 Pro；也可以在设置里改回 Claude。

要点：Key 连接时只发给 `127.0.0.1` 本机桥接器并直接调用 DeepSeek 官方余额接口验证（失败不会覆盖旧密钥）；Key 永不写入浏览器存储、会话记录、日志或发布包，状态接口只返回配置来源（本次启动 / 环境变量 / Windows 安全存储）。DeepSeek 仍通过本机 `claude` CLI 驱动（发起请求的还是 Claude Code），因此权限、工具、停止、排队、调整方向、历史与恢复行为完全一致；未做端到端验证前，DeepSeek 会话会禁用图片输入并明确提示。

模型与思考强度：UI 只提供 DeepSeek V4 Pro（`deepseek-v4-pro[1m]`）与 V4 Flash（`deepseek-v4-flash`）。五档思考强度在 DeepSeek 侧映射为两档——快速 / 标准 / 深入 → `high`，极强 / 最大 → `max`，界面会明文说明。

断开与恢复：在提供商页或“用量与额度”中心移除配置即可（同时删除 DPAPI 文件）；若系统中还设置了 `DEEPSEEK_API_KEY` 环境变量，桥接器会继续报告 environment 来源并解释原因。环境变量不会被删除，也不会被修改。

For default Claude Code users nothing changes — Claude login, Anthropic, Bedrock, Vertex and custom gateways are untouched. If you want DeepSeek API billing instead: open the settings under the composer → 「高级」 → 「提供商」 → DeepSeek, paste the API key once. With “secure save” ticked it is encrypted via Windows DPAPI under `%LOCALAPPDATA%\ClaudeCodeWhite\deepseek-api-key.dpapi` (your Windows account only); unticked keeps it in bridge memory for this session only. Verified keys switch that pane to DeepSeek V4 Pro; switching back to Claude is one click. The key is sent to the local bridge on `127.0.0.1` only, never stored in browser storage, session files, logs or the release zip, and state endpoints only report its source. DeepSeek is still driven through the local `claude` CLI, so permissions, tools, stop, queueing, steering and history behave identically; until real end-to-end verification, DeepSeek panes disable image input with a clear message. Effort levels map to high/max as shown in the UI. To disconnect, remove the config in the provider page — your `DEEPSEEK_API_KEY` environment variable (if any) is left untouched.

The same key can also be provided as before via `DEEPSEEK_API_KEY` (see below) — precedence: this-session key, then environment, then Windows store.

---

## 结构 Structure

- `app/`：浅色 / 深色双主题、多会话工作区与用量中心 — dual-theme, multi-session workspace & usage center
- `bridge/server.mjs`：仅监听 `127.0.0.1` 的本地 CLI 适配器 — local CLI adapter bound to `127.0.0.1` only
- `scripts/run-vinext.mjs`：跨平台开发与构建入口 — cross-platform dev & build entry

本项目默认仅供本机使用，不应将本地桥暴露到公网。
This project is meant for local use only — never expose the local bridge to the public internet.
