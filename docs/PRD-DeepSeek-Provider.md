# Claude Code White：DeepSeek API Key 原生接入 PRD

> 文档状态：待实现  
> 面向对象：接手开发的 AI / 开发者  
> 项目目录：`D:\code\Claude-Code-White`  
> 编写日期：2026-08-21  
> 优先级：P0  
> 目标版本：Claude Code White 1.1

## 0. 接手须知

当前工作区中已经存在一部分**未完成、未测试、未提交**的 DeepSeek 接入试验代码，主要涉及：

- `app/page.tsx`
- `bridge/server.mjs`
- `Start-Claude-Code-White.ps1`

接手者必须先执行：

```powershell
git status --short
git diff --check
git diff
```

这些试验代码只可作为思路参考，不能视为正确实现。接手者应审查后继续补全、重构或删除错误部分，并最终同步更新本地项目、测试、文档和发布包。不要覆盖用户已经提交的其他功能。

特别检查以下风险：

1. 图片缩略图的“移除”按钮是否仍绑定 `removeDraftImage`。
2. `Session`、`Message` 的 provider 字段迁移是否兼容旧 `localStorage` 数据。
3. DeepSeek 配置弹窗是否真正渲染，不能只有 state 和函数。
4. 密钥接口是否拒绝非本机 Origin，而不只是缺少 CORS 响应头。
5. DPAPI 路径、PowerShell 调用和错误处理是否可在 Windows 10/11 正常运行。
6. 原 Claude/Bedrock/Vertex/自定义网关配置不能因 DeepSeek 功能而改变。

---

## 1. 产品背景

Claude Code White（下称 CCW）是本机 Claude Code CLI 的桌面前端。它不应重新实现 Claude Code Agent，而应继续通过本机 `claude -p --input-format stream-json --output-format stream-json --verbose` 驱动真实 Claude Code。

当前 CCW 已能读取 `DEEPSEEK_API_KEY` 查询 DeepSeek 余额，但该密钥尚未作为 Claude Code 推理后端使用，界面也仍只展示 Sonnet / Opus / Haiku。

DeepSeek 现已提供 Anthropic 格式接口，并提供 Claude Code 官方接入说明。因此 CCW 可以不引入 LiteLLM、不自建协议转换服务，直接让用户使用 DeepSeek API Key 驱动本机 Claude Code。

官方依据：

- DeepSeek 接入 Claude Code：https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/
- DeepSeek Anthropic API：https://api-docs.deepseek.com/guides/anthropic_api/
- DeepSeek Thinking Mode：https://api-docs.deepseek.com/guides/thinking_mode
- DeepSeek 模型与价格：https://api-docs.deepseek.com/quick_start/pricing/
- Anthropic LLM Gateway 指南：https://docs.anthropic.com/en/docs/claude-code/llm-gateway

---

## 2. 产品目标

### 2.1 核心目标

让已有 Claude Code 的用户在 CCW 中完成以下流程：

1. 打开底部模型/思考强度控制区。
2. 将 API 提供商切换为 DeepSeek。
3. 首次使用时粘贴 DeepSeek API Key。
4. CCW 在本机验证密钥并安全保存（用户可选择仅本次启动）。
5. 选择 DeepSeek V4 Pro 或 V4 Flash。
6. 使用现有 Claude Code Agent、工具、权限、流程、排队、停止、图片和会话 UI 发起任务。
7. 随时切回原 Claude Code 配置，互不污染。

### 2.2 成功标准

- 已安装 Claude Code 的 Windows 用户，无需手动设置环境变量即可在 2 分钟内完成 DeepSeek 接入。
- DeepSeek Key 不进入浏览器 `localStorage`、会话记录、日志、异常文本、Git 或发布包。
- Claude 与 DeepSeek 可以按会话选择；两个并行窗格允许使用不同提供商。
- 切换 DeepSeek 不修改系统环境变量、不修改用户全局 `~/.claude/settings.json`，只影响对应新启动的 Claude Code 子进程。
- 原有 Claude Code、Anthropic、Bedrock、Vertex 和自定义网关用户无回归。
- 发布包可在全新 Windows 用户账户中完成安装、配置和运行。

### 2.3 非目标

- 不支持把任意 OpenAI 格式 API Key 直接转换为 Claude Code 后端。
- 不在 CCW 内实现完整 LiteLLM 或 Anthropic/OpenAI 协议网关。
- 不自动充值、不代用户购买 DeepSeek 额度。
- 不把 DeepSeek Key 上传至 CCW 自有服务。
- 不修改 Claude Code CLI 本身。
- 本版本不扩展 OpenAI、Gemini、Moonshot 等其他推理提供商。

---

## 3. 用户与场景

### 3.1 目标用户

- 已安装 Claude Code，但希望使用 DeepSeek API 计费的个人开发者。
- 需要在 Claude 与 DeepSeek 之间按任务切换的用户。
- 使用 DeepSeek V4 Pro 处理复杂任务、V4 Flash 处理日常修改的用户。
- 不熟悉 PowerShell 环境变量配置，希望从图形界面完成接入的用户。

### 3.2 关键用户故事

1. 作为新用户，我粘贴一次 DeepSeek Key 后即可开始编码，不需要理解 `ANTHROPIC_BASE_URL`。
2. 作为安全敏感用户，我可以选择“仅本次启动”，关闭 CCW 后不留下密钥。
3. 作为长期用户，我可以用 Windows 当前用户级加密保存 Key。
4. 作为 Claude 订阅用户，我切回 Claude 后仍沿用原登录状态，不受 DeepSeek 配置影响。
5. 作为多会话用户，我可以让左侧窗格使用 Claude、右侧窗格使用 DeepSeek。
6. 作为排错用户，我能看到“Key 无效 / 余额不足 / 网络失败 / 模型不可用”等明确状态，但看不到完整 Key。

---

## 4. 官方兼容基线

### 4.1 DeepSeek 端点

```text
https://api.deepseek.com/anthropic
```

### 4.2 支持模型

本版本只展示并允许：

| UI 名称 | 请求模型 | 用途 |
|---|---|---|
| DeepSeek V4 Pro | `deepseek-v4-pro[1m]` | 复杂编码、深度推理、大型项目 |
| DeepSeek V4 Flash | `deepseek-v4-flash` | 日常编码、快速响应、低成本任务 |

兼容后备值 `deepseek-v4-pro` 可由桥接白名单接受，但默认 UI 使用 `deepseek-v4-pro[1m]`。

不得再把 `deepseek-chat` 或 `deepseek-reasoner` 作为 UI 主选项；官方已在 2026-07-24 停用旧名称。

### 4.3 Claude Code 子进程环境

DeepSeek 会话启动时，对该子进程的独立 `env` 注入：

```text
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_AUTH_TOKEN=<DeepSeek API Key>
ANTHROPIC_MODEL=<当前所选 DeepSeek 模型>
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro[1m]
ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro[1m]
ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
CLAUDE_CODE_EFFORT_LEVEL=<high|max>
```

实现要求：

- 从 `{ ...process.env }` 创建副本，只修改子进程环境。
- DeepSeek 子进程应移除可能冲突的 `CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX` 和 `ANTHROPIC_API_KEY`。
- Claude 会话继续原样使用 `process.env`，不得清理或覆盖用户现有配置。
- 不调用 `setx`，不写注册表环境变量，不永久修改当前 shell。

### 4.4 思考强度映射

CCW 保留五档交互，但 DeepSeek 实际映射如下：

| CCW 档位 | Claude CLI 参数 | DeepSeek 实际档位 |
|---|---|---|
| 快速 | `low` | `high` |
| 标准 | `medium` | `high` |
| 深入 | `high` | `high` |
| 极强 | `xhigh` | `max` |
| 最大 | `max` | `max` |

DeepSeek 模式 UI 必须说明“前三档映射为 high，后两档映射为 max”，避免伪造五种真实能力。

---

## 5. 信息架构与交互

### 5.1 会话数据模型

`Session` 新增：

```ts
type ProviderKind = "claude" | "deepseek";

type Session = {
  provider: ProviderKind;
  model: string;
  // 其余字段保持不变
};
```

规则：

- 新会话默认 `provider: "claude"`，不得默认切换用户后端。
- 旧本地数据没有 provider 时迁移为 `claude`。
- provider 为 Claude 时，仅允许 `sonnet | opus | haiku`。
- provider 为 DeepSeek 时，仅允许本 PRD 4.2 的模型。
- 切换 provider 或模型时清空当前 UI 会话的 `claudeSessionId`，避免用不同后端恢复同一个 Claude 会话。
- “在侧边会话中打开”应复制源会话 provider、model、permissionMode、effort。

### 5.2 消息归属

`Message` 建议新增只读快照：

```ts
provider?: "claude" | "deepseek";
model?: string;
```

创建 assistant 占位消息时写入当前 provider/model。渲染历史消息时依据消息快照显示来源，不能因为用户后来切换提供商而把旧回复全部改标成 DeepSeek。

DeepSeek 回复头建议显示：

```text
DeepSeek · Claude Code
```

含义是“DeepSeek 模型驱动 Claude Code Agent”，不要把产品名称改成 DeepSeek Code。

### 5.3 底部控制区

沿用现有 Codex 式控制区与 Claude 配色，在“高级”页新增第一行：

```text
提供商       Claude / DeepSeek       ›
模型         Sonnet / V4 Pro         ›
思考强度     标准 / 最大              ›
```

提供商页：

- Claude：说明“使用现有 Claude 登录、Anthropic、Bedrock、Vertex 或用户自定义网关配置”。
- DeepSeek：说明“通过 DeepSeek Anthropic API 驱动 Claude Code”。
- 未配置 DeepSeek 时显示“配置”，点击打开 Key 弹窗。
- 已配置时显示“已连接”。

底栏压缩态：

- Claude 示例：`✦ Sonnet 标准`
- DeepSeek 示例：`D V4 Pro 最大`

维持现有控件高度、圆角、溢出层级和浅/深色主题，不扩大底栏整体高度。

### 5.4 DeepSeek Key 弹窗

字段与操作：

- 标题：连接 DeepSeek API
- 说明：密钥只发送到 `127.0.0.1` 本机桥接器。
- 密钥输入框：`type=password`，支持临时显示/隐藏。
- 复选项：使用 Windows 当前账户安全保存（默认开启）。
- 主按钮：验证并连接。
- 次按钮：取消。
- 已连接状态提供：替换密钥、移除配置。
- 链接：打开 DeepSeek Platform 创建 Key。

状态反馈：

- 正在验证
- 已连接，余额可用
- 已连接，但余额不足
- Key 无效
- 网络连接失败
- 本机桥接版本过旧

任何错误信息都不得包含完整 API Key。

### 5.5 用量与额度

现有 DeepSeek 用量面板从“只读余额接口”升级为“推理提供商状态”：

- 摘要状态必须来自实际 provider 数据，不能硬编码“已连接”。
- 未配置：显示“配置 DeepSeek”。
- 已配置：显示凭据来源（环境变量 / Windows 安全存储 / 本次启动）。
- 保留余额、赠金、充值金额查询。
- 保留平台快照解析，但明确它与实时会话账本是不同数据源。
- CCW 本机会话账本应按 provider/model 分组，DeepSeek 请求不得记在 Claude Sonnet 下。

---

## 6. 密钥与安全要求

### 6.1 凭据优先级

建议优先级：

1. 本次 CCW 进程内存中刚配置的 Key。
2. `DEEPSEEK_API_KEY` 环境变量。
3. Windows DPAPI 加密文件。
4. 未配置。

状态接口只返回 `configured` 和 `source`，绝不返回 Key、Key 前缀或后四位。

### 6.2 持久化

- “仅本次启动”：只存在桥接器进程内存。
- “安全保存”：Windows 使用 DPAPI `CurrentUser` 加密。
- 建议路径：`%LOCALAPPDATA%\ClaudeCodeWhite\deepseek-api-key.dpapi`。
- 禁止保存到项目目录、`.env`、`localStorage`、IndexedDB 或会话 JSON。
- 非 Windows 平台若无系统钥匙串实现，应只允许环境变量或本次启动，不得降级为明文保存。

### 6.3 本机接口防护

桥接器虽然只监听 `127.0.0.1`，密钥写接口仍必须防止恶意网页跨站请求：

- 对配置、删除等有状态请求，显式验证 `Origin` 必须匹配 `http://localhost:<port>` 或 `http://127.0.0.1:<port>`。
- 非本机 Origin 必须在读取/处理 body 前返回 `403`。
- 不能只依赖“不返回 CORS 头”；服务器仍可能已经执行请求。
- JSON body 上限建议 10 KB。
- API Key 基础格式校验：`sk-` 开头、无空白、合理长度；最终有效性以 DeepSeek 官方余额接口响应为准。
- 日志脱敏规则至少覆盖 `sk-` 后的所有非空白/引号字符，而不仅是字母数字。

### 6.4 日志要求

允许：

```text
DeepSeek API 已配置（Windows 安全存储）
DeepSeek 会话启动：V4 Pro · max
```

禁止：

- 完整 Key
- Authorization header
- 含 Key 的子进程环境对象
- 把 Key 放进命令行参数（可能被进程列表读取）

---

## 7. 本机桥接 API

桥接协议版本建议从 9 升至 10，并新增 capability：

```json
[
  "deepseek-provider",
  "secure-provider-store"
]
```

### 7.1 GET `/api/status`

新增非敏感字段：

```json
{
  "deepseekConfigured": true,
  "deepseekCredentialSource": "secure-store"
}
```

### 7.2 GET `/api/providers/deepseek`

响应示例：

```json
{
  "configured": true,
  "source": "secure-store",
  "secureStorage": true,
  "baseUrl": "https://api.deepseek.com/anthropic",
  "models": ["deepseek-v4-pro[1m]", "deepseek-v4-flash"]
}
```

不得返回任何可重建 Key 的内容。

### 7.3 POST `/api/providers/deepseek`

请求：

```json
{
  "apiKey": "sk-...",
  "remember": true
}
```

处理顺序：

1. 验证本机 Origin。
2. 校验 body 大小与格式。
3. 调用 DeepSeek `/user/balance` 验证 Key。
4. 验证成功后才写入内存/DPAPI。
5. 返回连接状态与非敏感余额摘要。

验证失败不得覆盖此前可用的已保存 Key。

### 7.4 DELETE `/api/providers/deepseek`

- 清除进程内 Key。
- 删除 CCW 创建的 DPAPI 文件。
- 不删除用户自己设置的 `DEEPSEEK_API_KEY` 环境变量。
- 如果环境变量仍存在，响应应继续报告 `configured: true, source: "environment"`，UI 应解释为什么仍处于连接状态。

### 7.5 POST `/api/run`

请求新增：

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-pro[1m]"
}
```

桥接器必须按 provider 分别执行模型白名单校验。DeepSeek 未配置时在 spawn 之前返回明确错误。

---

## 8. 兼容性与边界行为

### 8.1 会话恢复

- 同一真实 Claude Code session 不得跨 provider 恢复。
- 切换 provider 后 `claudeSessionId = null`。
- 从 Claude Code 原生历史恢复的任务默认 provider 为 Claude，除非历史事件能可靠识别 DeepSeek 模型。
- 若历史模型是 `deepseek-v4-*`，可以推断 provider 为 DeepSeek，但必须保证 Key 已配置，否则以只读历史方式打开并提示配置。

### 8.2 运行中切换

- provider/model/effort 在任务运行中修改，只从下一轮生效。
- 当前运行子进程继续使用启动时快照。
- UI 必须显示“更改将在下一轮生效”。
- 实时“调整方向”沿用当前子进程 provider，不重新读取新选择。

### 8.3 图片能力

不能仅根据 Anthropic 格式兼容就假设所有 DeepSeek 模型接受图片内容。

实现者必须进行 DeepSeek Claude Code 端到端验证：

1. 单张 PNG。
2. 多张图片。
3. 图片 + 文本。
4. 运行中插入图片。

若官方端点或当前模型不支持图片：

- DeepSeek 会话应禁用图片选择、拖拽和粘贴。
- 显示“当前 DeepSeek 模型暂不支持图片输入”。
- Claude 会话图片功能不受影响。
- 不得静默丢弃图片。

### 8.4 权限与工具

- 保持现有 `--permission-mode` 行为。
- DeepSeek 必须通过真实 Claude Code 工具链执行文件、命令、MCP 与流程事件。
- 至少验证 Read、Glob、Edit、命令执行、并行工具、工具失败与中断。
- 不得为了兼容 DeepSeek而绕过权限或使用 `--dangerously-skip-permissions`。

---

## 9. 错误文案

| 场景 | 用户文案 |
|---|---|
| 未配置 Key | 尚未配置 DeepSeek API Key，请先完成连接。 |
| Key 无效 | DeepSeek API Key 无效或已失效。 |
| 余额不足 | DeepSeek API Key 已连接，但账户余额不足。 |
| 网络失败 | 无法连接 DeepSeek，请检查网络后重试。 |
| 模型不可用 | 当前 DeepSeek 模型不可用，请切换模型或稍后重试。 |
| 桥接过旧 | 当前本地桥接不支持 DeepSeek，请重新启动 CCW。 |
| 图片不支持 | 当前 DeepSeek 模型暂不支持图片输入。 |
| 安全存储失败 | 无法使用 Windows 安全存储；可改为仅本次启动。 |

错误详情可以进入本机日志，但必须脱敏。

---

## 10. 测试要求

### 10.1 静态测试

- DeepSeek endpoint 固定为 HTTPS 官方域名。
- provider/model 具有独立白名单。
- Key 不出现在 status/provider GET 响应结构。
- 代码中不存在把 Key 写入 localStorage 的逻辑。
- 不存在 `dangerously-skip-permissions`。
- 启动器与前端要求 bridge protocol ≥ 10。

### 10.2 桥接单元/接口测试

必须覆盖：

1. GET provider status 在无 Key 时返回 missing。
2. POST 拒绝非本机 Origin。
3. POST 拒绝过大 body、空 Key、含空白 Key。
4. POST 验证失败不覆盖旧凭据。
5. 响应和日志不包含测试 Key。
6. DELETE 只删除 CCW 自身凭据。
7. DeepSeek `/api/run` 无凭据时不 spawn。
8. DeepSeek provider 拒绝 Sonnet，Claude provider 拒绝 V4 Pro。
9. `deepSeekChildEnvironment` 不修改原 `process.env`。
10. Claude 会话仍原样继承用户环境。

外部网络请求应通过可注入 fetch/mock 测试，测试套件不得依赖真实 API Key。

### 10.3 DPAPI 测试

Windows 环境验证：

- 加密结果不包含明文 Key。
- 当前用户可解密。
- 删除后无法读取。
- 损坏文件不会导致桥接器崩溃，应记录脱敏警告并回退为 missing。
- PowerShell 子进程隐藏运行，不弹黑框。

### 10.4 UI 测试

- 旧 localStorage 会话正常迁移。
- 未配置时选择 DeepSeek 会打开配置弹窗。
- 配置成功后当前会话自动切换 V4 Pro。
- 并排 Claude/DeepSeek 会话标签、消息归属正确。
- 深浅主题均可读。
- 弹窗和模型菜单不会被 composer 裁切。
- 键盘可访问：Tab、Enter、Esc、焦点回归。
- 断开 DeepSeek 后相关会话安全切回 Claude 或进入明确待配置状态。

### 10.5 端到端验收

使用专门测试 Key（不得提交）完成：

- V4 Pro 简单问答。
- V4 Flash 简单问答。
- 至少一次读取文件和一次编辑文件。
- 思考 high/max。
- 停止任务。
- 排队并调整方向。
- 恢复/新建会话。
- 余额不足和无效 Key 路径。
- 图片能力探测。

---

## 11. 文档与发布要求

需要同步更新：

- `README.md`
- `README.first.md`
- `docs/PRD.md`
- `.env.example`
- `CHANGELOG.md`
- `tests/rendered-html.test.mjs`

README 必须分别说明：

1. 默认 Claude Code 用户无需配置 DeepSeek。
2. DeepSeek 用户可从 UI 配置，也可继续使用 `DEEPSEEK_API_KEY` 环境变量。
3. DeepSeek Key 的保存位置与安全方式。
4. DeepSeek 模型和思考强度映射。
5. 如何断开并恢复 Claude。

完成实现后执行：

```powershell
npm test
npm run release
git diff --check
```

发布包检查：

- `claude-code-white-release.zip` 已重建。
- 不包含 `node_modules`、`dist`、`.git`、`.env`、平台快照、个人路径或本机密钥。
- 对解压目录和 zip 内容执行 `sk-`、`DEEPSEEK_API_KEY=`、用户目录名等敏感信息扫描。
- 在干净临时目录解压并至少运行一次构建/启动检查。

---

## 12. 建议实施顺序

1. 先修复当前工作区未完成试验代码，恢复可构建状态。
2. 抽出 provider/model 类型与纯函数，不要继续把所有逻辑堆在 `page.tsx`。
3. 完成桥接 provider 配置、Origin 防护、Key 验证和环境构造。
4. 完成 Windows DPAPI 存储，加入可测试抽象。
5. 修改 `/api/run`，先用命令行/接口测试验证 DeepSeek 能真实驱动 Claude Code。
6. 完成前端 provider/model UI 和 Key 弹窗。
7. 完成消息归属、旧数据迁移、并行会话及用量中心。
8. 验证工具调用、停止、排队、调整方向和图片。
9. 补齐测试、README、更新日志和发布包。
10. 最后提交并推送 GitHub；提交信息建议：

```text
feat: add native DeepSeek provider for Claude Code
```

---

## 13. Definition of Done

只有同时满足以下条件才能标记完成：

- [ ] DeepSeek V4 Pro/Flash 能通过真实 Claude Code CLI 完成 Agent 任务。
- [ ] Claude 默认路径完全无回归。
- [ ] DeepSeek Key 不进入浏览器存储、日志、Git 或发布包。
- [ ] 非本机网页不能调用凭据写/删接口。
- [ ] Windows 安全保存和仅本次启动均可用。
- [ ] provider 可按会话独立选择。
- [ ] provider/model 切换不会错误恢复旧后端 session。
- [ ] 思考强度映射透明且准确。
- [ ] 图片支持经过真实验证；不支持时有明确降级。
- [ ] 停止、排队、调整方向、工具流程仍正常。
- [ ] 所有自动化测试通过。
- [ ] 本地 UI 已同步更新并完成浅/深主题检查。
- [ ] README、首次安装指南、主 PRD、更新日志已更新。
- [ ] 发布 zip 已重建并通过隐私扫描。
- [ ] GitHub 主分支已提交并推送。

