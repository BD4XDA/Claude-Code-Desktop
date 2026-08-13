# Claude Code Desktop

Claude Code Desktop 是一个面向本地 Claude Code CLI 的双主题桌面前端。浅色版使用更清透的中性纸白，深色版使用中性炭黑，并以 Claude 的珊瑚橙保留品牌温度；交互参考 Claude Desktop 的并行会话设计，同时保留 Codex 式项目、工具、终端、变更和权限工作流。

界面针对高分辨率桌面显示器优化阅读尺度，品牌标题采用具有人文编辑感的衬线字体，正文与代码分别使用清晰的无衬线和等宽字体。

## 当前能力

- 自动检测本机 `claude` 命令与版本（PATH / npm 全局 / 原生安装 / WinGet 均支持）
- 通过官方 headless 模式调用：`claude -p --output-format stream-json --verbose`
- 1–3 个 Claude Code 会话并排流式运行，可拖拽重排、独立停止
- 每个窗格独立保存会话 ID、项目目录、模型和权限模式；会话可重命名、删除，新任务自动生成标题
- 可搜索并恢复本机 Claude Code 历史任务，继续原始 session 上下文、项目目录和模型
- `Ctrl+Shift+P` 快捷操作面板：新建/恢复任务、打开变更/文件/日志/记忆、切换检查面板与主题
- 浅色 / 深色主题与设备本地会话恢复
- Sonnet / Opus / Haiku 模型切换
- Codex 式批准策略：仅规划 / 操作前批准 / 自动批准编辑 / 智能批准 / 不询问（受限），每个会话独立保存
- 思考强度可随时切换：快速 / 标准 / 深入 / 极强 / 最大，真实传入 Claude Code `--effort`，运行中调整从下一轮推理生效
- Codex 式流程展示：运行时显示当前步骤；结果输出后自动折叠为轻量摘要，可按回答点击「查看流程详情」展开步骤、工具输入与结果
- 右侧检查面板：真实 Git 变更、可点击的单文件 Diff（新增/删除行着色）、可展开的文件树与文件预览、桥接器实时日志、本机记忆
- 记忆面板按工作区分区、按类型（用户 / 反馈 / 项目 / 参考）分类，可新建、编辑、删除记忆，直接写入 `~/.claude/projects/<工作区>/memory/` 并维护索引
- 桥接未就绪时顶栏「一键桥接」可直接拉起本地桥接进程
- 左下角“用量与额度”中心：Claude 本机会话统计、DeepSeek 余额、Anthropic / OpenAI 组织成本、Gemini 官方控制台入口

## 启动

桥接器已内置在开发服务器中（`bridge/vite-plugin.mjs`），一条命令即同时提供前端与本地桥接 API：

```powershell
npm run dev
```

推荐直接双击桌面的「Claude Code White」快捷方式，或项目里的「打开 Claude Code White.vbs」：无控制台启动器会静默复用健康实例，或自动寻找可用端口、启动本地服务、等待连接成功，再以 Chrome 应用窗口打开。整个过程不会弹出黑色命令窗口；第一次运行若缺少依赖，会自动准备。

要重新创建桌面的一键启动快捷方式：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

也可以在 PowerShell 中直接运行同一个一键启动器：

```powershell
& '.\Start-Claude-Code-White.ps1'
```

### 管理员模式（桌面快捷方式）

需要以管理员身份运行时（dev server、本地桥接与所有 Claude Code CLI 子进程都获得管理员权限），在项目目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
```

会在桌面创建「Claude Code White（管理员）」快捷方式（带 UAC 提权标志）：双击后确认 UAC，自动以管理员身份运行 `npm run dev`。桌面上已有的同款快捷方式可直接双击使用。

如果本机尚未安装 Claude Code，先按照 Anthropic 官方说明安装并完成登录（支持 npm 全局、原生安装与 WinGet 三种安装位置）。前端不会收集或保存 API Key，认证完全交给 Claude Code 自身管理。

生产模式（构建产物）：`npm run start` 会自动拉起本地桥接（监听 127.0.0.1:4318），
一条命令即可使用；页面左上角也有「一键桥接」按钮，桥接未就绪时点击即可拉起：

```powershell
npm run build
npm run start    # 前端页面 + 自动启动本地桥接；页面回退到独立桥接端口
```

## 用量供应商（可选）

在启动 PowerShell 的用户环境中设置下列变量即可启用对应检测器；密钥只由监听 `127.0.0.1` 的本地桥读取，不会返回给网页：

```powershell
$env:DEEPSEEK_API_KEY = '...'
$env:ANTHROPIC_ADMIN_KEY = '...'
$env:OPENAI_ADMIN_KEY = '...'
$env:GEMINI_API_KEY = '...'
& '.\Start-Claude-Code-White.ps1'
```

Anthropic 的 Usage & Cost API 只适用于组织 Admin API key，不能查询个人 Claude Pro / Max 订阅剩余额度。Gemini 普通 API key 也没有余额查询接口，因此界面会跳转到官方 AI Studio 用量页。

## 结构

- `app/`：浅色 / 深色双主题、多会话工作区与用量中心
- `bridge/server.mjs`：仅监听 `127.0.0.1` 的本地 CLI 适配器
- `scripts/run-vinext.mjs`：跨平台开发与构建入口

本项目默认仅供本机使用，不应将本地桥暴露到公网。
