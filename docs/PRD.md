# Claude Code White — 产品需求与接手指南（给其他 AI）

> 本文档写给接手本项目的 AI 与开发者。描述了项目定位、架构、全部已实现能力、关键技术决策、API 契约、开发流程与未完成事项。当前工作树基于提交 `ef57760`，**有大量未提交改动**（见「提交状态」）。

---

## 1. 项目定位

**Claude Code Desktop**（npm 包名 `claude-code-white`）是一个面向本机 Claude Code CLI 的**本地桌面前端**（网页应用）：

- 双主题（浅色中性纸白 / 深色中性炭黑，保留珊瑚橙强调色），多会话并行工作区
- 通过官方 headless 模式 `claude -p --output-format stream-json --verbose` 驱动真实 Claude Code 会话
- 桥接器（bridge）仅监听 `127.0.0.1`，**只为本机服务，禁止暴露公网**
- 认证完全交给 Claude Code 自身（前端不持有 API Key；用量供应商密钥只由本地桥读取）
- 用户以中文交流；界面文案中文

**与终端 Claude Code 的关系**：前端能做的操作边界 ≈ 终端里配置了对应权限模式运行 `claude -p`。headless 模式下工具调用自动执行，不逐工具弹窗（权限由 `--permission-mode` 统一约束）。"完整操纵"体现在**完整可视化 + 全程掌控**（每个工具调用的输入/输出/错误、随时停止、折叠只看结果）。

---

## 2. 技术栈与架构

| 层 | 技术 |
|---|---|
| 前端 | React 19 + Next-on-Vite（`vinext`，Vite 8 驱动的 RSC/SSR），单页 `app/page.tsx`（~1400 行） |
| 样式 | `app/globals.css`（Tailwind 4 引入但主要手写 CSS 变量双主题） |
| 桥接 | `bridge/server.mjs`——纯 Node（`node:http`），无框架 |
| 构建 | `npm run build`（vinext build → `dist/`）；测试 `node --test tests/rendered-html.test.mjs` |

### 双进程模型

1. **开发模式（默认）**：`npm run dev` → vite dev server（默认 3000，占用则顺延）+ `bridge/vite-plugin.mjs` 把桥接 handler 挂载到**同源** `/api/*`。一个进程同时提供前端与 API。
2. **生产模式**：`npm run build` + `npm run start`。`scripts/run-vinext.mjs start` 会**自动拉起独立桥接进程**（127.0.0.1:4318，带 ≤3 次重试看门狗）。前端探测顺序：同源 `/api/status` → 回退 `http://127.0.0.1:4318`。

> ⚠️ **关键架构事实**：`vinext start` 使用自建 `node:http` server（`node_modules/vinext/dist/server/prod-server.js`），**没有 Vite 插件钩子**，无法在生产服务上挂载桥接 handler。因此生产模式只能靠 run-vinext.mjs 自动拉起子进程，或页面里"一键桥接"按钮（依赖同源端点，dev 下有效）。

### 会话语义（重要）

- **窗格（UI 会话）= 前端概念**；`claudeSessionId` = 真实 Claude Code 会话 ID。
- 新建窗格（`newSession`）`claudeSessionId: null` → 发送时不带 `--resume` → **全新独立会话，上下文零继承**（只继承工作目录；模型/权限默认 Sonnet/计划模式）。
- 同一窗格内连续发送：第一次运行后从流中 `system/init` 或 `result` 事件取到 session_id 存为 `claudeSessionId`，后续发送带 `--resume <id>` → **上下文延续**。
- 删除窗格只丢前端 ID，真实会话文件仍在 `~/.claude/projects/`（终端 `claude --resume` 可找回）。

---

## 3. 已实现能力（截至 2026-08-11）

### 会话工作区
- 1–3 个窗格并排流式运行，拖拽重排、独立停止（AbortController + bridge `/api/cancel`）
- 会话重命名 / 删除 / 搜索（侧栏搜索框过滤标题+路径）/ Ctrl+K 新建 / 自动标题（首条 prompt 截断 22 字）
- 快捷操作面板（Ctrl+Shift+P）：新建/恢复任务、打开变更/文件/日志/记忆、切换检查面板与主题；支持搜索和 Enter 执行
- 历史任务恢复：读取本机 `~/.claude/projects/*/*.jsonl` 的最近任务，支持搜索、预览并恢复原始 session ID、项目目录、模型与最近 60 条对话；大记录按头尾窗口读取
- 模型切换：Sonnet / Opus / **Haiku**（server `ALLOWED_MODELS` 与前端 select 同步）
- Codex 式批准策略：仅规划（plan）/ 操作前批准（manual）/ 自动批准编辑（acceptEdits）/ 智能批准（auto）/ 不询问受限（dontAsk）；逐窗格持久化并真实传入 `--permission-mode`
- 思考强度：快速 / 标准 / 深入 / 极强 / 最大（low / medium / high / xhigh / max）；逐窗格持久化并真实传入 `--effort`，运行中更改从下一轮推理生效
- 会话持久化 localStorage（`claude-code-sessions`）+ 主题（`claude-code-theme`）；恢复时清 `sending`

### 消息流（终端级可视化）
- Codex 式流程区：跟随回答显示，运行时展开实时步骤，结果输出后自动折叠为一行摘要；每条回答可通过「查看流程详情」独立展开完整时间线与工具调用
- **工具卡片**：解析 stream-json 的 `tool_use`/`tool_result` 事件 → 每轮调用渲染为可展开卡片（名称 / 输入 JSON / 结果输出 / 失败红字 / 执行中脉冲；结果按 `tool_use_id` 关联）；中断/结束时收尾运行中卡片
- **按回答查看流程**：流程运行时自动展开实时步骤；结果输出后自动折叠为轻量摘要。点击当前回答下方的「查看流程详情」可独立展开完整时间线、工具输入与结果，不再使用影响整扇窗格的全局折叠开关
- **实时 tokens**：消息 meta 行 `▲输入 ▼输出 tok` 随流累加（assistant usage 事件），悬停显示输入/输出/缓存/成本明细
- **耗时**：任务完成/中断后 meta 行 `⏱ 12.3s`（≥60s 显示 `1m5s`）
- **自动滚动**：每窗格独立贴底状态（onScroll 判定 80px 内=贴底），流更新贴底则跟随，向上翻历史暂停
- 失速警告类 HUD 不在本项目（那是另一个项目）

### 右侧检查面板（4 页）
- **变更**：真实 `git status`（`/api/workspace/changes`）——分支、条目列表（含状态码着色）、`git diff --stat`；点击单个文件可读取带新增/删除行着色的 Diff（含未跟踪文件、重命名路径与 512KB 截断）；非 Git 目录 / 干净 / 未连接空态
- **文件**：真实文件树（懒加载 `/api/workspace/tree`，跳过 node_modules 等，上限 300 项/目录带截断提示）+ 文件预览（`/api/workspace/file`，≤128KB，前端截断 20k 字符）
- **终端**：桥接器日志实时轮询 2.5s（`/api/logs`，内存环形 400 条，密钥正则脱敏）
- **记忆**：读取 `~/.claude/projects/*/memory/` 全部记忆（frontmatter 解析：name/description/type；body 截断 900 字符展示）；**新建/编辑/删除**——分区=工作区下拉、分类=用户/反馈/项目/参考，写入 frontmatter + 自动维护该工作区 `MEMORY.md` 索引（删除同步移除索引行）

### 用量与额度中心（左下角弹窗）
- Claude 本机会话 token/成本账本（前端累计）
- DeepSeek 余额（`DEEPSEEK_API_KEY` 环境变量）+ 平台快照解析（`DeepSeek 开放平台.html` 本机文件，gitignore）
- Anthropic / OpenAI 组织成本（Admin key 可选）、Gemini 官方用量页入口
- 模型↔API Key 分组切换（可拖拽的玻璃分段控件）

### 可靠性 / 工具
- **一键桥接**：桥接未就绪时顶栏按钮 → 同源 `POST /api/bridge/start` 拉起独立桥接进程 → 前端轮询 4318 直到就绪（≤8s）
- **管理员桌面快捷方式**：`scripts/create-shortcut.ps1` 生成桌面「Claude Code White（管理员）.lnk」（RunAsUser 标志，字节 0x15 置 0x20）；`scripts/start-admin.ps1` UAC 自举后管理员运行 `npm run dev`（自动找空闲端口 + 自动开浏览器）→ dev server、bridge、Claude CLI 子进程全部管理员
- **GitHub 发布包**：`npm run release` → `scripts/make-release.mjs` → 同级目录 `claude-code-white-release/` + `.zip`，排除 node_modules/dist/.git/DeepSeek 快照/.env/tsbuildinfo（隐私保护，已反复验证无密钥无个人路径）

---

## 4. Bridge API 契约（`bridge/server.mjs`）

同一 handler 两种形态：独立进程监听 4318；被 vite 插件 import 时只导出 `createBridgeHandler()` 挂同源。**CORS 只回显 localhost 任意端口源**（`LOCAL_ORIGIN` 正则），外部源一律不回（浏览器拦截读取，仍可发送但被 preflight 拦截）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | bridge/claude 检测（PATH/npm 全局/原生/WinGet 四路）、`cwd`（会话默认项目路径来源） |
| POST | `/api/run` | body `{prompt, cwd, model, permissionMode, sessionId?, requestId}` → 200 NDJSON 流（claude stdout 直通）；模型/权限白名单校验；cwd 必须存在 |
| POST | `/api/cancel` | 按 requestId 杀子进程 |
| GET | `/api/logs` | 桥接内存日志（密钥脱敏 `sk-...`） |
| GET | `/api/memory` | 全部工作区记忆（含 MEMORY.md 索引行，≤30） |
| GET | `/api/memory/workspaces` | 全部项目目录（含无记忆的，供新建下拉） |
| GET | `/api/memory/file?workspaceId&file` | 记忆完整正文（编辑用，列表里的是截断预览） |
| POST | `/api/memory` | 新建/更新：`{workspaceId, name, description, type, body, file?}`；slug 生成保留中文；`MEMORY.md` 索引行 `- [name](file.md) — desc` 去重更新 |
| DELETE | `/api/memory?workspaceId&file` | 删文件 + 索引行；禁删 MEMORY.md |
| POST | `/api/bridge/start` | 一键桥接：同源宿主 spawn 独立桥接（detached），独立进程自身返回 no-op |
| GET | `/api/workspace/changes?path` | git status（spawnSync git，2MB buffer） |
| GET | `/api/workspace/diff?path&file&status` | 单文件 Git Diff；`--no-ext-diff`、路径范围校验、未跟踪文件安全生成 unified diff、512KB 截断 |
| GET | `/api/workspace/tree?path&dir` | 目录列表（跳过黑名单目录，300 上限，`truncated` 标志） |
| GET | `/api/workspace/file?path&file` | 文件预览（路径越界防护 `insideDirectory`，≤128KB） |
| GET | `/api/sessions` / `/api/sessions/detail` | 本机 Claude Code 历史摘要与会话详情；限定项目/UUID 文件名并排除 subagents |
| GET | `/api/usage` / `/api/usage/deepseek` | 供应商余额/成本/平台快照 |

**安全要点**：所有工作区路径参数做 `resolve` + `insideDirectory` 校验；workspaceId 白名单字符 `[A-Za-z0-9_-]`；记忆文件白名单 `*.md`；日志与错误信息 `sk-` 密钥正则脱敏；`--dangerously-skip-permissions` 禁止出现（有测试把关）。

---

## 5. stream-json 事件解析（前端 `normalizeEvent`）

`claude -p --output-format stream-json --verbose` 关键事件（实测确认）：

| 事件 | 处理 |
|---|---|
| `system` + `subtype:"init"` | 记 `session_id` → claudeSessionId；timeline"会话已连接" |
| `assistant` | content 数组：`text` 拼接进 body；`tool_use`（id/name/input）→ 工具卡片；`usage`（input/output/cache tokens）→ 实时累加 |
| `user` | content 数组：`tool_result`（tool_use_id/content/is_error）→ 按 id 关联到卡片，失败标红 |
| `result` | 记 session_id；`total_cost_usd` → cost（取 max）；timeline"任务完成" |
| `bridge_error` | 桥接层错误（启动失败/非零退出 stderr）→ body 追加 |

工具 id → 下标映射用 `Map` 存活于一次 submit 闭包内；流结束后收尾 running 卡片（正常=done、中断=error"任务已停止"）。

---

## 6. 开发流程

```powershell
npm run dev          # 开发（同源 /api，默认 3000，占用顺延）
npm run build        # 构建到 dist/
npm test             # build + node --test（2 个测试：SSR 渲染 + 桥接"窄且专注"审计）
npm run release      # 干净 GitHub 发布包（见上）
npm run start        # 生产：自动拉起桥接 + 页面（PORT=xxxx 可指定端口）
```

测试要点（`tests/rendered-html.test.mjs`）：SSR 输出断言（标题/工作区变更/计划模式/终端/用量与额度/并行会话、无 codex 残留）；桥接审计（HOST 127.0.0.1、`--output-format stream-json`、`--permission-mode`、无 dangerously-skip-permissions、无 react-loading-skeleton、`_sites-preview` 不存在）。

**Windows 特别提示**：
- PowerShell 5.1 读取脚本按 ANSI/GBK，**含中文的 .ps1 必须存 UTF-8 BOM**（已对 start-admin.ps1 / create-shortcut.ps1 处理，编辑后需复查 BOM 是否保留）
- Git Bash 传中文 argv 给 curl 会被 ANSI 转换损坏 → 测试带中文的 POST 用 `--data-binary @file`（UTF-8 文件）或 node fetch
- `taskkill //F //PID`（Git Bash 下双斜杠）；查端口占用用 `Get-NetTCPConnection`
- 机器本身：Windows 11 中文版，PowerShell 路径 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`，本机会话可能以管理员运行

---

## 7. 未完成 / 下一步候选

- **逐工具交互式批准/拒绝**（TUI 式 permission prompt）：需要 `claude` 交互模式 + pty/WebSocket 架构，当前 headless 模式做不到（权限由 permission-mode 统一约束）
- 文件预览语法高亮
- `npm run start` 时页面自动打开浏览器（当前 dev 模式才自动开）
- 记忆面板支持正文 markdown 渲染（当前 `<pre>` 纯文本）
- 旧 dev server 实例（vite 插件内桥接不热更新）——**改动 bridge/server.mjs 后必须重启 dev server**，用户机器上曾长期残留旧实例导致"修复不生效"

## 8. 提交状态（重要）

- 最近提交：`ef57760 feat: build Claude Code desktop workspace`（2026-08-11 之前）
- 工作树：**大量未提交改动**（30+ 文件：bridge 重构、检查面板、记忆读写、一键桥接、工具可视化、按回答自动折叠流程、实时 tokens、自动滚动、管理员快捷方式、本地化清理删除 Cloudflare/D1/worker/drizzle/DeepSeek 快照等）
- 用户 2026-08-11 晚暂定"明天再说"，**接手时先与用户确认是否提交**；建议一次性 commit（改动相互依赖）
- 发布包：由 `npm run release`（scripts/make-release.mjs）生成，已排除全部本机隐私与构建产物

## 9. 给接手 AI 的注意事项

1. 桥接改动（server.mjs / vite-plugin.mjs）不热更新——改完必重启 dev server 再验证
2. 先读本文件 + `README.md`，再动代码；与用户中文交流
3. 不要引入需要公网/云托管的架构（本地专属工具）
4. 不要破坏测试里的桥接安全断言（窄且专注 = 只做 Claude Code 相关、不出网暴露）
5. 涉及删除文件操作前先 `ls` 确认目标（本机有过误删全部记忆文件的教训）
6. 记忆系统：本机 `~/.claude/projects/*/memory/`，删除/覆盖前查看，误删可尝试从 `~/.claude/file-history/`（按内容哈希分文件、@vN 版本递增）恢复
