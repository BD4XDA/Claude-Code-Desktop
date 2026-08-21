import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 4318;
const BRIDGE_PROTOCOL = 10;
const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku"]);
// DeepSeek Anthropic 兼容端点；deepseek-v4-pro 为兼容后备值，默认 UI 使用带 [1m] 的模型。
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEEPSEEK_MODELS = new Set(["deepseek-v4-pro[1m]", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp[1m]"]);
const DEEPSEEK_UI_MODELS = ["deepseek-v4-pro[1m]", "deepseek-v4-flash-vision-exp[1m]", "deepseek-v4-flash"];
// 多模态按模型判定：vision-exp 为官方图片实验模型；其余 DeepSeek 模型在端到端验证前不启用图片。
const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp[1m]";

function deepSeekModelSupportsImages(model) {
  return model === DEEPSEEK_VISION_MODEL;
}
const PROVIDER_KINDS = new Set(["claude", "deepseek"]);
const DEEPSEEK_EFFORT_MAP = { low: "high", medium: "high", high: "high", xhigh: "max", max: "max" };

function modelAllowed(provider, model) {
  return provider === "deepseek" ? DEEPSEEK_MODELS.has(model) : ALLOWED_MODELS.has(model);
}

function defaultModelFor(provider) {
  return provider === "deepseek" ? "deepseek-v4-pro[1m]" : "sonnet";
}
const ALLOWED_PERMISSION_MODES = new Set(["plan", "manual", "acceptEdits", "auto", "dontAsk"]);
const ALLOWED_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const ALLOWED_IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_RUN_REQUEST_CHARS = 33_000_000;
// 本机专属桥接：任何 localhost 端口的前端页面都可读取（开发 3000 / 生产任意端口）。
// 写接口（POST/DELETE 等）除 CORS 外还必须显式拒绝非本机 Origin（在读取 body 之前 403），
// 避免恶意网页即使拿到响应头也能触发本机状态变更（如写入/删除 DeepSeek 密钥）。
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const STATE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isLocalOrigin(origin) {
  return typeof origin === "string" && origin.length <= 512 && LOCAL_ORIGIN.test(origin);
}
const running = new Map();
const runStates = new WeakMap();
const pendingControlResponses = new Map();
const DEEPSEEK_SNAPSHOT_GLOB = /^DeepSeek.*\.html$/i;

function findDeepSeekSnapshot() {
  try {
    const files = readdirSync(process.cwd()).filter((name) => DEEPSEEK_SNAPSHOT_GLOB.test(name));
    if (!files.length) return null;
    files.sort((a, b) => statSync(join(process.cwd(), b)).mtimeMs - statSync(join(process.cwd(), a)).mtimeMs);
    return join(process.cwd(), files[0]);
  } catch { return null; }
}
const logEntries = [];
// 脱敏覆盖 sk- 后的所有非空白/引号字符（包括 URL 编码、颜色代码等），而不只是字母数字。
const KEY_PATTERN = /sk-[^\s"'<>|\\]+/g;

function appendLog(message, level = "info") {
  const entry = { t: Date.now(), level, message: String(message).replace(KEY_PATTERN, "[hidden]").slice(0, 600) };
  logEntries.push(entry);
  if (logEntries.length > 400) logEntries.splice(0, logEntries.length - 400);
}

function terminateProcessTree(child) {
  if (!child) return false;
  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    const result = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    if (result.status === 0) return true;
  }
  if (child.killed) return true;
  try { return child.kill("SIGTERM"); } catch { return false; }
}

function maybeEndRunInput(child) {
  const state = runStates.get(child);
  if (!state || state.pendingRedirects > 0 || state.messagesSent === 0 || state.resultsSeen < state.messagesSent) return;
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
}

function settleControlResponse(child, event) {
  const response = event?.response;
  const requestId = typeof response?.request_id === "string" ? response.request_id : null;
  const pending = requestId ? pendingControlResponses.get(requestId) : null;
  if (!pending || pending.child !== child) return;
  clearTimeout(pending.timer);
  pendingControlResponses.delete(requestId);
  if (response.subtype === "error") pending.reject(new Error(response.error || "Claude Code 拒绝了控制请求"));
  else pending.resolve(response.response || {});
}

function rejectPendingControls(child, error) {
  for (const [requestId, pending] of pendingControlResponses) {
    if (pending.child !== child) continue;
    clearTimeout(pending.timer);
    pendingControlResponses.delete(requestId);
    pending.reject(error);
  }
}

function sendClaudeControlRequest(child, request, timeoutMs = 10_000) {
  if (!child || child.killed || child.stdin.destroyed || child.stdin.writableEnded) return Promise.reject(new Error("Claude Code 输入通道已经关闭"));
  const requestId = `req_${randomUUID()}`;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pendingControlResponses.delete(requestId);
      reject(new Error(`${request.subtype || "control"} 请求等待 Claude Code 确认超时`));
    }, timeoutMs);
    pendingControlResponses.set(requestId, { child, timer, resolve: resolvePromise, reject });
    try {
      child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`);
    } catch (error) {
      clearTimeout(timer);
      pendingControlResponses.delete(requestId);
      reject(error);
    }
  });
}

function writeRunUserMessage(child, message) {
  const state = runStates.get(child);
  if (!state || child.killed || child.stdin.destroyed || child.stdin.writableEnded) throw new Error("Claude Code 已结束，无法插入新消息");
  state.messagesSent += 1;
  try { child.stdin.write(`${JSON.stringify(message)}\n`); }
  catch (error) { state.messagesSent -= 1; throw error; }
}

/* ---------- 一键桥接：由同源宿主（dev server 插件）拉起独立桥接进程 ---------- */

let spawnedBridgePid = null;
let activeDirectoryPicker = null;

function probeStandaloneBridge(timeoutMs = 1200) {
  return new Promise((resolvePromise) => {
    const request = http.get(`http://${HOST}:${PORT}/api/status`, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolvePromise(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolvePromise(false));
  });
}

function startStandaloneBridge() {
  // 独立进程自身无需自启；同源宿主（vite 插件 / dev server）调用此端点时才会拉进程
  const self = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  if (self) return { started: false, note: "standalone" };
  const script = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  spawnedBridgePid = child.pid;
  appendLog(`一键桥接：已启动独立桥接进程（pid ${child.pid}，端口 ${PORT}）`);
  return { started: true, pid: child.pid };
}

function findClaude() {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, ["claude"], { encoding: "utf8", windowsHide: true });
  const matches = result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  if (process.platform === "win32") {
    const candidates = [
      ...matches.filter((line) => /\.(exe|cmd|bat)$/i.test(line)),
      process.env.APPDATA ? join(process.env.APPDATA, "npm", "claude.cmd") : "",
      join(homedir(), ".local", "bin", "claude.exe"),
      join(homedir(), ".claude", "local", "claude.exe"),
    ];
    if (process.env.LOCALAPPDATA) {
      const winGet = join(process.env.LOCALAPPDATA, "Microsoft", "WinGet");
      candidates.push(join(winGet, "Links", "claude.exe"));
      try {
        for (const pkg of readdirSync(join(winGet, "Packages"))) {
          if (pkg.toLowerCase().startsWith("anthropic.claudecode")) candidates.push(join(winGet, "Packages", pkg, "claude.exe"));
        }
      } catch { /* WinGet Packages 目录不存在时忽略 */ }
    }
    return candidates.find((line) => line && existsSync(line)) || matches[0] || null;
  }
  return matches[0] || [join(homedir(), ".local", "bin", "claude")].find(existsSync) || null;
}

function claudeVersion(command) {
  if (!command) return null;
  const isCmd = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, shell: isCmd });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function corsHeaders(origin) {
  const allowed = origin && LOCAL_ORIGIN.test(origin) ? origin : "http://localhost:3000";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function sendJson(response, status, payload, origin = "") {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  response.end(JSON.stringify(payload));
}

function readJson(request, maxChars = 1_100_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxChars) reject(new Error("请求内容过大"));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("请求不是有效 JSON")); }
    });
    request.on("error", reject);
  });
}

function parseRunImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("图片数据格式不正确");
  if (value.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`每次最多上传 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
  let totalBytes = 0;
  return value.map((image, index) => {
    const mediaType = typeof image?.mediaType === "string" ? image.mediaType : "";
    const data = typeof image?.data === "string" ? image.data : "";
    if (!ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error(`第 ${index + 1} 张图片格式不受支持`);
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`第 ${index + 1} 张图片数据无效`);
    const decoded = Buffer.from(data, "base64");
    const normalizedInput = data.replace(/=+$/, "");
    const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
    if (!decoded.length || normalizedDecoded !== normalizedInput) throw new Error(`第 ${index + 1} 张图片数据无效`);
    if (decoded.length > MAX_IMAGE_BYTES) throw new Error(`第 ${index + 1} 张图片超过 5 MB`);
    totalBytes += decoded.length;
    if (totalBytes > MAX_IMAGE_TOTAL_BYTES) throw new Error("本次图片总大小不能超过 20 MB");
    return { mediaType, data };
  });
}

function validDirectory(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return existsSync(value) && statSync(value).isDirectory(); } catch { return false; }
}

function selectWorkspaceDirectory(initialPath = "") {
  return new Promise((resolvePromise, reject) => {
    if (process.platform !== "win32") { reject(new Error("当前版本的目录选择器仅支持 Windows")); return; }
    if (activeDirectoryPicker?.child && !activeDirectoryPicker.child.killed) activeDirectoryPicker.child.kill();
    if (activeDirectoryPicker?.resultPath) rmSync(activeDirectoryPicker.resultPath, { force: true });
    const helperPath = fileURLToPath(new URL("../scripts/select-workspace-folder.vbs", import.meta.url));
    if (!existsSync(helperPath)) { reject(new Error("目录选择器组件缺失，请重新安装应用")); return; }
    const resultPath = join(tmpdir(), `claude-code-white-folder-${randomUUID()}.txt`);
    const pickerTitle = validDirectory(initialPath) ? `选择 Claude Code 工作区（当前：${resolve(initialPath)}）` : "选择 Claude Code 工作区";
    // wscript 是 GUI 子系统进程：不会出现黑色控制台，同时允许 Shell 原生目录窗口正常置前。
    const child = spawn("wscript.exe", ["//nologo", helperPath, resultPath, pickerTitle], {
      stdio: "ignore",
    });
    activeDirectoryPicker = { child, resultPath };
    let finished = false;
    const cleanup = () => {
      rmSync(resultPath, { force: true });
      if (activeDirectoryPicker?.child === child) activeDirectoryPicker = null;
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      cleanup();
      reject(new Error("目录选择器等待超时"));
    }, 10 * 60 * 1000);
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      let selected = "";
      try {
        if (existsSync(resultPath)) selected = readFileSync(resultPath, "utf16le").replace(/^\uFEFF/, "").trim();
      } finally { cleanup(); }
      if (code !== 0) { reject(new Error("无法打开目录选择器")); return; }
      if (!selected) { resolvePromise(null); return; }
      if (!validDirectory(selected)) { reject(new Error("选择的目录不可用")); return; }
      resolvePromise(resolve(selected));
    });
  });
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 240) }; }
    if (!response.ok) throw new Error(`${response.status} ${payload?.error?.message || payload?.message || response.statusText}`);
    return payload;
  } finally { clearTimeout(timeout); }
}

function safeError(error) {
  if (error instanceof Error && error.name === "AbortError") return "检测超时，请稍后重试";
  return (error instanceof Error ? error.message : String(error)).replace(KEY_PATTERN, "[hidden]").slice(0, 180);
}

function sumAnthropicCost(payload) {
  let cents = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "amount") && typeof value.amount === "string") cents += Number(value.amount) || 0;
    for (const child of Object.values(value)) visit(child);
  };
  visit(payload);
  return cents / 100;
}

function sumOpenAICost(payload) {
  let total = 0;
  for (const bucket of payload?.data || []) {
    for (const result of bucket?.results || []) total += Number(result?.amount?.value || 0);
  }
  return total;
}

function numericText(value) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseDeepSeekSnapshot() {
  const snapshot = findDeepSeekSnapshot();
  if (!snapshot) return null;
  const html = readFileSync(snapshot, "utf8");
  const boardStart = html.indexOf('id="usage-board"');
  if (boardStart < 0) return null;
  const board = html.slice(boardStart);
  const summary = board.match(/消费金额[\s\S]{0,2600}?data-usage-layout-font="value">([^<]+)[\s\S]{0,2600}?API 请求次数[\s\S]{0,1600}?data-usage-layout-font="value">([^<]+)[\s\S]{0,1600}?Tokens[\s\S]{0,1600}?data-usage-layout-font="value">([^<]+)/);
  const models = [];
  const modelPattern = /class="ce40a39d">([^<]+)[\s\S]{0,4200}?API 请求次数[\s\S]{0,1400}?class="_6ba2836">([^<]+)[\s\S]{0,12000}?Tokens[\s\S]{0,1400}?class="_6ba2836">([^<]+)/g;
  for (const match of board.matchAll(modelPattern)) {
    const model = match[1].trim();
    if (!model || models.some((item) => item.model === model)) continue;
    models.push({
      model,
      requests: numericText(match[2]),
      tokens: numericText(match[3]),
      promptCacheHitToken: null,
      promptCacheMissToken: null,
      responseToken: null,
      cost: null,
    });
  }
  const file = statSync(snapshot);
  const ending = file.mtime;
  const starting = new Date(ending.getTime() - 29 * 864e5);
  return {
    source: "platform-snapshot",
    sourceLabel: "DeepSeek 平台快照",
    updatedAt: ending.toISOString(),
    range: { label: "近 30 天", start: starting.toISOString(), end: ending.toISOString() },
    summary: {
      currency: "CNY",
      cost: summary ? numericText(summary[1]) : 0,
      requests: summary ? numericText(summary[2]) : models.reduce((sum, item) => sum + item.requests, 0),
      tokens: summary ? numericText(summary[3]) : models.reduce((sum, item) => sum + item.tokens, 0),
    },
    models,
    precision: {
      requests: "exact",
      tokens: "exact",
      totalCost: "exact",
      modelCost: "unavailable",
      dailySeries: "unavailable",
    },
    note: "模型请求数、Tokens 与总消费来自保存的官方平台页面；快照未包含逐日原始值和按模型成本，因此不进行插值。",
  };
}

/* ---------- DeepSeek 提供商：凭据、密钥验证与子进程环境 ---------- */

const SOURCE_LABELS = { memory: "本次启动", environment: "环境变量", "secure-store": "Windows 安全存储" };

let deepSeekMemoryKey = null; // 进程内密钥（仅本次启动），绝不写入磁盘
let deepSeekDpapiCache = null; // { value, at }：dpapi 读取短期缓存，避免重复拉起 PowerShell
const DEEPSEEK_DPAPI_CACHE_TTL = 15_000;
let fetchImpl = globalThis.fetch; // 可注入，便于接口测试 mock 外部网络

// 测试与特殊部署可把密钥文件重定向到其他目录（普通用户路径：%LOCALAPPDATA%\ClaudeCodeWhite\）。
function deepSeekDpapiPath() {
  const override = process.env.CCW_DPAPI_DIR;
  if (override) return join(override, "deepseek-api-key.dpapi");
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "ClaudeCodeWhite", "deepseek-api-key.dpapi");
}

// 老版 Windows PowerShell 不一定在 PATH 里（尤其从 Git Bash 等环境启动时），
// 优先用 SystemRoot 下的绝对路径；hk 包装所有内部错误为 null，调用方自行判断。
function powerShellCommand() {
  if (process.platform !== "win32") return "pwsh";
  const candidates = [
    process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "powershell.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "powershell.exe" || existsSync(candidate)) || "powershell.exe";
}

function runPowerShell(script) {
  const command = Buffer.from(script, "utf16le").toString("base64");
  return spawnSync(powerShellCommand(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", command], {
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readDpapiKey() {
  const path = deepSeekDpapiPath();
  if (!existsSync(path)) return null;
  const now = Date.now();
  if (deepSeekDpapiCache && now - deepSeekDpapiCache.at < DEEPSEEK_DPAPI_CACHE_TTL) return deepSeekDpapiCache.value;
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$bytes = [IO.File]::ReadAllBytes(${psQuote(path)})`,
    "$data = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Text.Encoding]::UTF8.GetString($data)",
  ].join("; ");
  try {
    const result = runPowerShell(script);
    if (result.status !== 0 || result.status === null || !result.stdout.trim()) {
      // 损坏文件 / 权限失败不崩溃桥接器：记录脱敏警告并回退为未配置
      appendLog("Windows 安全存储读取失败，DeepSeek 凭据回退为未配置", "warn");
      return null;
    }
    const value = result.stdout.trim();
    deepSeekDpapiCache = { value, at: now };
    return value;
  } catch (error) {
    appendLog(`Windows 安全存储读取失败：${safeError(error)}`, "warn");
    return null;
  }
}

function writeDpapiKey(apiKey) {
  const path = deepSeekDpapiPath();
  const script = [
    "Add-Type -AssemblyName System.Security",
    `New-Item -ItemType Directory -Force -Path ${psQuote(dirname(path))} | Out-Null`,
    `$bytes = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes(${psQuote(apiKey)}), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    `[IO.File]::WriteAllBytes(${psQuote(path)}, $bytes)`,
    "Write-Output 'ok'",
  ].join("; ");
  const result = runPowerShell(script);
  if (result.status !== 0 || result.status === null) {
    throw new Error("无法使用 Windows 安全存储保存密钥；可取消勾选“安全保存”后改为仅本次启动。");
  }
  deepSeekDpapiCache = { value: apiKey, at: Date.now() };
}

// 只删除 CCW 自己写入的文件，绝不触碰用户的环境变量。
function deleteDpapiKey() {
  const path = deepSeekDpapiPath();
  const result = runPowerShell(`if (Test-Path -LiteralPath ${psQuote(path)}) { Remove-Item -LiteralPath ${psQuote(path)} -Force }`);
  deepSeekDpapiCache = null;
  if (result.status !== 0 && result.status !== null) appendLog("Windows 安全存储删除失败，请手动检查密钥文件", "warn");
}

/** 凭据优先级：进程内存 > DEEPSEEK_API_KEY 环境变量 > Windows DPAPI 文件。 */
function deepSeekCredential() {
  if (deepSeekMemoryKey) return { key: deepSeekMemoryKey, source: "memory" };
  const envKey = typeof process.env.DEEPSEEK_API_KEY === "string" ? process.env.DEEPSEEK_API_KEY.trim() : "";
  if (envKey) return { key: envKey, source: "environment" };
  const stored = readDpapiKey();
  if (stored) return { key: stored, source: "secure-store" };
  return null;
}

/** 状态接口只返回 configured/source，绝不返回 Key、前缀或后四位。 */
function deepSeekConfiguration() {
  const credential = deepSeekCredential();
  return credential
    ? { configured: true, source: credential.source, sourceLabel: SOURCE_LABELS[credential.source] || credential.source, secureStorage: credential.source === "secure-store" }
    : { configured: false, source: null, sourceLabel: null, secureStorage: false };
}

async function fetchDeepSeekBalance(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(DEEPSEEK_BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error("DeepSeek API Key 无效或已失效。"), { code: "deepseek-invalid-key" });
    }
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* 非 JSON 响应按失败处理 */ }
    if (!response.ok) throw Object.assign(new Error("无法连接 DeepSeek，请检查网络后重试。"), { code: "deepseek-network" });
    return payload || {};
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("连接 DeepSeek 检测超时，请稍后重试。"), { code: "deepseek-network" });
    }
    throw error;
  } finally { clearTimeout(timer); }
}

/**
 * 构造 DeepSeek 子进程环境：从 { ...baseEnv } 副本出发，只修改子进程环境；
 * 不调用 setx、不写注册表、不永久修改当前 shell，也不改变原 process.env。
 */
function deepSeekChildEnvironment(baseEnv, model, effort, apiKey) {
  const env = { ...baseEnv };
  delete env.CLAUDE_CODE_USE_BEDROCK;
  delete env.CLAUDE_CODE_USE_VERTEX;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.ANTHROPIC_BASE_URL = DEEPSEEK_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  env.ANTHROPIC_MODEL = model;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = "deepseek-v4-pro[1m]";
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = "deepseek-v4-pro[1m]";
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = "deepseek-v4-flash";
  env.CLAUDE_CODE_SUBAGENT_MODEL = "deepseek-v4-flash";
  env.CLAUDE_CODE_EFFORT_LEVEL = DEEPSEEK_EFFORT_MAP[effort] || "high";
  return env;
}

/* ---------- 工作区：Git 变更、文件树、文件预览 ---------- */

const SKIPPED_DIR_NAMES = new Set(["node_modules", ".git", ".vinext", "dist", ".next", ".wrangler", ".vite", ".openai", ".cache", "build", "__pycache__", ".venv", "coverage", "logs", "drizzle"]);
const MAX_TREE_ENTRIES = 300;

function listDirectory(dir) {
  const entries = [];
  try {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED_DIR_NAMES.has(item.name)) continue;
      entries.push({ name: item.name, type: item.isDirectory() ? "dir" : "file" });
      if (entries.length >= MAX_TREE_ENTRIES) break;
    }
  } catch { return null; }
  entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, "zh") : a.type === "dir" ? -1 : 1);
  return entries;
}

function insideDirectory(root, target) {
  const base = resolve(root);
  return target === base || target.startsWith(`${base}${sep}`);
}

function gitStatus(dir) {
  const runFrom = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 2 ** 20 });
  const rootResult = runFrom(dir, ["rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0) return { isGit: false };
  const root = rootResult.stdout.trim();
  const run = (args) => runFrom(root, args);
  const branchResult = run(["branch", "--show-current"]);
  const statusResult = run(["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "-uall"]);
  const statResult = run(["diff", "--stat", "--no-color"]);
  const entries = [];
  const records = statusResult.stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const codes = record.slice(0, 2).trim() || "??";
    const path = record.slice(3);
    if (/[RC]/.test(record.slice(0, 2)) && records[index + 1]) {
      const previousPath = records[index + 1];
      entries.push({ status: codes, file: `${previousPath} → ${path}`, path, previousPath });
      index += 1;
    } else {
      entries.push({ status: codes, file: path, path });
    }
  }
  return {
    isGit: true,
    root,
    branch: branchResult.stdout.trim() || "detached",
    entries,
    stat: statResult.stdout.trim(),
  };
}

function gitFileDiff(dir, file, status = "") {
  const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", windowsHide: true, maxBuffer: 2 ** 20 });
  if (rootResult.status !== 0) throw new Error("当前目录不是 Git 仓库");
  const root = rootResult.stdout.trim();
  const target = resolve(root, file);
  if (!insideDirectory(root, target)) throw new Error("文件路径超出工作区范围");
  const repoFile = relativePath(root, target).replace(/\\/g, "/");
  if (!repoFile || repoFile.startsWith("../")) throw new Error("无效的文件路径");

  let diff = "";
  let binary = false;
  if (status.includes("?")) {
    if (!existsSync(target) || statSync(target).isDirectory()) throw new Error("文件不存在");
    const size = statSync(target).size;
    if (size > 1024 * 1024) throw new Error("文件超过 1MB Diff 预览上限");
    const content = readFileSync(target);
    binary = content.includes(0);
    if (!binary) {
      const text = content.toString("utf8").replace(/\r\n/g, "\n");
      const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
      diff = [`diff --git a/${repoFile} b/${repoFile}`, "new file mode 100644", "--- /dev/null", `+++ b/${repoFile}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
    }
  } else {
    const options = { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 2 ** 21 };
    const combined = spawnSync("git", ["-c", "core.quotepath=false", "diff", "--no-color", "--no-ext-diff", "HEAD", "--", repoFile], options);
    if (combined.status === 0) diff = combined.stdout;
    else {
      const staged = spawnSync("git", ["-c", "core.quotepath=false", "diff", "--cached", "--no-color", "--no-ext-diff", "--", repoFile], options);
      const unstaged = spawnSync("git", ["-c", "core.quotepath=false", "diff", "--no-color", "--no-ext-diff", "--", repoFile], options);
      diff = [staged.stdout, unstaged.stdout].filter(Boolean).join("\n");
    }
    binary = /Binary files .* differ|GIT binary patch/.test(diff);
  }

  const additions = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deletions = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  const limit = 512 * 1024;
  return { file: repoFile, diff: diff.slice(0, limit), additions, deletions, binary, truncated: diff.length > limit };
}

function readWorkspaceFile(dir, relative) {
  const target = resolve(dir, relative);
  if (!insideDirectory(dir, target)) throw new Error("路径超出工作区范围");
  if (!existsSync(target) || statSync(target).isDirectory()) throw new Error("文件不存在");
  const size = statSync(target).size;
  if (size > 128 * 1024) throw new Error(`文件 ${size} 字节，超过 128KB 预览上限`);
  const content = readFileSync(target, "utf8");
  return { name: relative, size, lines: content.split(/\r?\n/).length, content };
}

/* ---------- Claude Code 本机会话历史 ---------- */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^[A-Za-z0-9_-]+$/;

function readTextWindow(file, maxBytes = 4 * 1024 * 1024) {
  const size = statSync(file).size;
  if (size <= maxBytes) return { text: readFileSync(file, "utf8"), truncated: false };
  const handle = openSync(file, "r");
  try {
    const headSize = Math.min(384 * 1024, Math.floor(maxBytes / 3));
    const tailSize = maxBytes - headSize;
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    readSync(handle, head, 0, headSize, 0);
    readSync(handle, tail, 0, tailSize, Math.max(0, size - tailSize));
    const tailText = tail.toString("utf8");
    const firstLineEnd = tailText.indexOf("\n");
    return { text: `${head.toString("utf8")}\n${firstLineEnd >= 0 ? tailText.slice(firstLineEnd + 1) : tailText}`, truncated: true };
  } finally { closeSync(handle); }
}

function sessionText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text.trim()).filter(Boolean).join("\n\n");
}

function parseSessionLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try { events.push(JSON.parse(line)); } catch { /* 截断窗口边界或损坏行直接跳过 */ }
  }
  return events;
}

function sessionSummary(projectId, file) {
  const info = statSync(file);
  const { text } = readTextWindow(file, 320 * 1024);
  const events = parseSessionLines(text);
  let cwd = "";
  let title = "";
  let preview = "";
  let model = "sonnet";
  let slug = "";
  for (const event of events) {
    if (event?.isSidechain) continue;
    if (!cwd && typeof event?.cwd === "string") cwd = event.cwd;
    if (!slug && typeof event?.slug === "string") slug = event.slug;
    if (event?.type === "custom-title" && typeof event?.customTitle === "string") title = event.customTitle.trim();
    const role = event?.message?.role;
    const body = sessionText(event?.message?.content);
    if (role === "user" && body && !body.startsWith("<task-notification>")) {
      if (!title) title = body;
      preview = body;
    }
    if (role === "assistant" && typeof event?.message?.model === "string") model = event.message.model;
  }
  return {
    id: file.slice(file.lastIndexOf(sep) + 1, -6), projectId, cwd, slug,
    title: (title || slug || "未命名任务").replace(/\s+/g, " ").slice(0, 64),
    preview: preview.replace(/\s+/g, " ").slice(0, 140), model,
    updatedAt: info.mtime.toISOString(), size: info.size,
  };
}

function claudeSessionHistory() {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const files = [];
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory() || !PROJECT_ID.test(project.name)) continue;
    const dir = join(root, project.name);
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (!item.isFile() || !SESSION_ID.test(item.name.replace(/\.jsonl$/i, "")) || !item.name.endsWith(".jsonl")) continue;
      const file = join(dir, item.name);
      files.push({ projectId: project.name, file, mtime: statSync(file).mtimeMs });
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, 60).map(({ projectId, file }) => sessionSummary(projectId, file));
}

function claudeSessionDetail(projectId, sessionId) {
  if (!PROJECT_ID.test(projectId) || !SESSION_ID.test(sessionId)) throw new Error("无效的会话标识");
  const root = join(homedir(), ".claude", "projects");
  const file = resolve(root, projectId, `${sessionId}.jsonl`);
  if (!insideDirectory(root, file) || !existsSync(file)) throw new Error("会话记录不存在");
  const { text, truncated } = readTextWindow(file);
  const events = parseSessionLines(text);
  const messages = [];
  let cwd = "";
  let model = "sonnet";
  let title = "";
  for (const event of events) {
    if (event?.isSidechain) continue;
    if (!cwd && typeof event?.cwd === "string") cwd = event.cwd;
    if (event?.type === "custom-title" && typeof event?.customTitle === "string") title = event.customTitle.trim();
    const role = event?.message?.role;
    const body = sessionText(event?.message?.content);
    if ((role === "user" || role === "assistant") && body && !body.startsWith("<task-notification>")) {
      messages.push({ role, body: body.slice(0, 12000), timestamp: event.timestamp || null });
      if (!title && role === "user") title = body;
    }
    if (role === "assistant" && typeof event?.message?.model === "string") model = event.message.model;
  }
  return { id: sessionId, projectId, cwd, model, title: (title || "恢复的任务").replace(/\s+/g, " ").slice(0, 64), messages: messages.slice(-60), truncated };
}

/* ---------- 记忆：按工作区与类型导入 ---------- */

const MEMORY_TYPES = new Set(["user", "feedback", "project", "reference"]);

function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (match) {
    let current = "";
    for (const line of match[1].split(/\r?\n/)) {
      const top = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
      if (top) {
        current = top[1];
        meta[current] = top[2].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      const nested = line.trim().match(/^([a-zA-Z-]+):\s*(.*)$/);
      if (nested && current) meta[`${current}.${nested[1]}`] = nested[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return meta;
}

function memoryRootDir() {
  return join(homedir(), ".claude", "projects");
}

function memoryDirFor(workspaceId) {
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) return null;
  const dir = join(memoryRootDir(), workspaceId, "memory");
  return insideDirectory(memoryRootDir(), dir) ? dir : null;
}

function memoryWorkspaces() {
  const workspaces = [];
  try {
    for (const projectId of readdirSync(memoryRootDir())) {
      const memoryDir = memoryDirFor(projectId);
      if (!memoryDir || !existsSync(memoryDir) || !statSync(memoryDir).isDirectory()) continue;
      const entries = [];
      for (const file of readdirSync(memoryDir).filter((name) => name !== "MEMORY.md" && name.endsWith(".md")).sort()) {
        const content = readFileSync(join(memoryDir, file), "utf8");
        const meta = parseFrontMatter(content);
        const bodyStart = content.indexOf("\n---\n");
        entries.push({
          file,
          name: meta.name || file.replace(/\.md$/, ""),
          description: meta.description || "",
          type: MEMORY_TYPES.has(meta.type) ? meta.type : (MEMORY_TYPES.has(meta["metadata.type"]) ? meta["metadata.type"] : "reference"),
          body: (bodyStart >= 0 ? content.slice(bodyStart + 5) : content).trim().slice(0, 900),
        });
      }
      if (!entries.length) continue;
      const indexPath = join(memoryDir, "MEMORY.md");
      let index = null;
      if (existsSync(indexPath)) {
        const lines = readFileSync(indexPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        index = lines.slice(0, 30);
      }
      workspaces.push({ id: projectId, label: projectId, index, entries });
    }
  } catch { return []; }
  workspaces.sort((a, b) => b.entries.length - a.entries.length || a.id.localeCompare(b.id));
  return workspaces;
}

/* ---------- 记忆写入：前端管理（分区 = 工作区，分类 = 类型） ---------- */

const MEMORY_FILE = /^[A-Za-z0-9_-]+\.md$/;

function memorySlug(name) {
  const slug = String(name || "memory").trim().toLowerCase()
    .replace(/[^\w一-龥-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "memory";
}

function memoryIndexLine(entry) {
  return `- [${entry.name}](${entry.file}) — ${entry.description || ""}`.trim().replace(/\s*—\s*$/, "");
}

function syncMemoryIndex(memoryDir, entry) {
  const indexPath = join(memoryDir, "MEMORY.md");
  const raw = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  // 只保留索引条目行（去掉标题与 frontmatter，避免重复标题）
  const lines = raw.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("---"));
  const marker = `(${entry.file})`;
  const replaced = lines.some((line) => line.includes(marker));
  const updated = replaced
    ? lines.map((line) => line.includes(marker) ? memoryIndexLine(entry) : line)
    : [...lines, memoryIndexLine(entry)];
  writeFileSync(indexPath, `# 记忆索引\n\n${updated.join("\n")}\n`, "utf8");
}

function writeMemory(workspaceId, payload) {
  const { name, description = "", type = "project", body = "", file } = payload;
  const memoryDir = memoryDirFor(workspaceId);
  if (!memoryDir) throw new Error("无效的工作区标识");
  if (!MEMORY_TYPES.has(type)) throw new Error("无效的记忆类型");
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const slug = memorySlug(name);
  let target = file;
  if (target) {
    if (!MEMORY_FILE.test(target)) throw new Error("无效的记忆文件");
    const resolved = resolve(memoryDir, target);
    if (!insideDirectory(memoryDir, resolved)) throw new Error("文件路径超出记忆目录");
  } else {
    // 新建：避免覆盖已有文件，追加 -1/-2 后缀
    let candidate = `${slug}.md`;
    for (let index = 1; existsSync(join(memoryDir, candidate)); index += 1) candidate = `${slug}-${index}.md`;
    target = candidate;
  }
  const content = `---\nname: ${slug}\ndescription: ${description.replace(/[\r\n]+/g, " ")}\nmetadata:\n  type: ${type}\n---\n\n${body.trim()}\n`;
  writeFileSync(join(memoryDir, target), content, "utf8");
  syncMemoryIndex(memoryDir, { name, description, file: target });
  appendLog(`记忆已写入 ${workspaceId}/${target}（${type}）`);
  return { file: target };
}

function deleteMemory(workspaceId, file) {
  const memoryDir = memoryDirFor(workspaceId);
  if (!memoryDir) throw new Error("无效的工作区标识");
  if (!MEMORY_FILE.test(file)) throw new Error("无效的记忆文件");
  const target = resolve(memoryDir, file);
  if (!insideDirectory(memoryDir, target) || file === "MEMORY.md") throw new Error("不允许删除的文件");
  if (!existsSync(target)) throw new Error("记忆文件不存在");
  rmSync(target, { force: true });
  // 从 MEMORY.md 移除对应行
  const indexPath = join(memoryDir, "MEMORY.md");
  if (existsSync(indexPath)) {
    const lines = readFileSync(indexPath, "utf8").split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.includes(`(${file})`));
    writeFileSync(indexPath, `# 记忆索引\n\n${lines.join("\n")}\n`, "utf8");
  }
  appendLog(`记忆已删除 ${workspaceId}/${file}`, "warn");
  return { deleted: true };
}

async function usageProviders() {
  const claudePath = findClaude();
  const providers = [{
    id: "claude", name: "Claude Code", configured: Boolean(claudePath), state: claudePath ? "ready" : "missing",
    summary: claudePath ? "本机 CLI 已连接；会话 token 与 API 返回成本由前端累计" : "未检测到 Claude Code CLI",
    detail: claudePath ? claudeVersion(claudePath) : "请先安装并登录 Claude Code",
    href: "https://claude.ai/settings/usage",
  }];

  const deepSeekCreds = deepSeekCredential();
  if (deepSeekCreds) {
    try {
      const payload = await fetchDeepSeekBalance(deepSeekCreds.key);
      providers.push({
        id: "deepseek", name: "DeepSeek", configured: true, state: payload.is_available ? "ready" : "limited",
        summary: `${SOURCE_LABELS[deepSeekCreds.source]} · ${payload.is_available ? "官方余额接口已连接" : "账户当前没有可用余额"}`,
        detail: `凭据来源：${SOURCE_LABELS[deepSeekCreds.source]}`,
        balances: (payload.balance_infos || []).map((item) => ({ currency: item.currency, total: item.total_balance, granted: item.granted_balance, toppedUp: item.topped_up_balance })),
        href: "https://platform.deepseek.com/usage",
      });
    } catch (error) {
      providers.push({
        id: "deepseek", name: "DeepSeek", configured: true,
        state: "error", summary: error?.code === "deepseek-invalid-key" ? "DeepSeek API Key 无效或已失效" : "余额检测失败",
        detail: safeError(error), href: "https://platform.deepseek.com/usage",
      });
    }
  } else providers.push({ id: "deepseek", name: "DeepSeek", configured: false, state: "missing", summary: "未配置 DeepSeek API Key；可在会话设置中连接，或设置 DEEPSEEK_API_KEY 环境变量", href: "https://platform.deepseek.com/usage" });

  if (process.env.ANTHROPIC_ADMIN_KEY) {
    try {
      const ending = new Date();
      const starting = new Date(ending.getTime() - 30 * 864e5);
      const query = new URLSearchParams({ starting_at: starting.toISOString(), ending_at: ending.toISOString(), "group_by[]": "description" });
      const payload = await fetchJson(`https://api.anthropic.com/v1/organizations/cost_report?${query}`, { "x-api-key": process.env.ANTHROPIC_ADMIN_KEY, "anthropic-version": "2023-06-01", "User-Agent": "Claude-Code-White/0.2" });
      const cost = sumAnthropicCost(payload);
      providers.push({ id: "anthropic", name: "Anthropic API", configured: true, state: "ready", summary: `近 30 天组织成本约 $${cost.toFixed(2)}`, detail: "需要组织 Admin API key；不等同于 Pro / Max 订阅额度", href: "https://console.anthropic.com/settings/usage" });
    } catch (error) {
      providers.push({ id: "anthropic", name: "Anthropic API", configured: true, state: "error", summary: "组织用量检测失败", detail: safeError(error), href: "https://console.anthropic.com/settings/usage" });
    }
  } else providers.push({ id: "anthropic", name: "Anthropic API", configured: false, state: "missing", summary: "设置 ANTHROPIC_ADMIN_KEY 后可读取组织用量与成本", detail: "个人 Claude 账户不提供 Admin Usage API", href: "https://console.anthropic.com/settings/usage" });

  if (process.env.OPENAI_ADMIN_KEY) {
    try {
      const start = Math.floor((Date.now() - 30 * 864e5) / 1000);
      const payload = await fetchJson(`https://api.openai.com/v1/organization/costs?start_time=${start}&limit=31`, { Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}` });
      const cost = sumOpenAICost(payload);
      providers.push({ id: "openai", name: "OpenAI API", configured: true, state: "ready", summary: `近 30 天组织成本约 $${cost.toFixed(2)}`, detail: "读取 Organization Costs API", href: "https://platform.openai.com/usage" });
    } catch (error) {
      providers.push({ id: "openai", name: "OpenAI API", configured: true, state: "error", summary: "组织成本检测失败", detail: safeError(error), href: "https://platform.openai.com/usage" });
    }
  } else providers.push({ id: "openai", name: "OpenAI API", configured: false, state: "missing", summary: "设置 OPENAI_ADMIN_KEY 后可读取组织成本", href: "https://platform.openai.com/usage" });

  providers.push({
    id: "gemini", name: "Gemini API", configured: Boolean(process.env.GEMINI_API_KEY), state: "limited",
    summary: process.env.GEMINI_API_KEY ? "已检测到 API key；余额仍需在 AI Studio 查看" : "官方未提供用普通 API key 查询余额的接口",
    detail: "用量、预付余额与项目配额由 Google AI Studio / Cloud Billing 展示",
    href: "https://aistudio.google.com/usage",
  });
  return providers;
}

/** 请求处理核心：可直接挂载到 Vite dev server（同源 /api/*），也可独立监听 4318。 */
async function handleRequest(request, response) {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") { response.writeHead(204, corsHeaders(origin)); response.end(); return; }
  // 有状态接口必须防御恶意网页跨站请求：非本机 Origin 在读取 body 前直接 403（不依赖 CORS 响应头拦截）。
  if (STATE_METHODS.has(request.method) && origin && !isLocalOrigin(origin)) {
    response.writeHead(403, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders("") });
    response.end(JSON.stringify({ error: "仅允许本机页面访问本机桥接器" }));
    return;
  }
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/api/status") {
    const claudePath = findClaude();
    const deepSeek = deepSeekConfiguration();
    sendJson(response, 200, { bridge: true, bridgeProtocol: BRIDGE_PROTOCOL, capabilities: ["approval-strategies", "effort-levels", "multi-image-input", "native-folder-picker", "live-steering", "deepseek-provider", "secure-provider-store"], claudeInstalled: Boolean(claudePath), claudePath, claudeVersion: claudeVersion(claudePath), pathEntries: (process.env.PATH || "").split(delimiter).length, cwd: process.cwd(), deepseekConfigured: deepSeek.configured, deepseekCredentialSource: deepSeek.source }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage") {
    try { sendJson(response, 200, { providers: await usageProviders(), checkedAt: new Date().toISOString() }, origin); }
    catch (error) { sendJson(response, 500, { error: safeError(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/providers/deepseek") {
    try {
      const config = deepSeekConfiguration();
      sendJson(response, 200, {
        configured: config.configured,
        source: config.source,
        sourceLabel: config.sourceLabel,
        secureStorage: config.secureStorage,
        baseUrl: DEEPSEEK_BASE_URL,
        models: DEEPSEEK_UI_MODELS,
        // 已连接时附带余额可用性（只读状态，非敏感余额数值由 /api/usage 提供）
        balanceAvailable: config.configured ? await fetchDeepSeekBalance(deepSeekCredential().key).then((payload) => payload.is_available !== false).catch(() => null) : null,
      }, origin);
    } catch (error) {
      sendJson(response, 500, { error: safeError(error) }, origin);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/providers/deepseek") {
    try {
      const body = await readJson(request, 10 * 1024);
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey) throw new Error("请粘贴 DeepSeek API Key。");
      if (!/^sk-[A-Za-z0-9]/i.test(apiKey)) throw new Error("API Key 应以 sk- 开头。");
      if (/\s/.test(apiKey) || apiKey.length < 30 || apiKey.length > 200) throw new Error("API Key 格式不正确（含空白或长度异常）。");
      const payload = await fetchDeepSeekBalance(apiKey);
      // 验证成功后才写入；验证失败绝不覆盖此前可用的已保存 Key。
      let source = "memory";
      if (body.remember) {
        writeDpapiKey(apiKey);
        source = "secure-store";
      }
      deepSeekMemoryKey = apiKey;
      deepSeekDpapiCache = null;
      const isAvailable = payload.is_available !== false;
      appendLog(`DeepSeek API 已配置（${SOURCE_LABELS[source]}）`);
      sendJson(response, 200, {
        connected: true,
        configured: true,
        source,
        sourceLabel: SOURCE_LABELS[source],
        secureStorage: source === "secure-store",
        balanceAvailable: isAvailable,
        isAvailable,
        currency: payload.currency || null,
        balance: isAvailable ? null : "账户当前没有可用余额",
      }, origin);
    } catch (error) {
      const code = error?.code || "";
      const message = code === "deepseek-invalid-key" ? "DeepSeek API Key 无效或已失效。"
        : code === "deepseek-network" ? "无法连接 DeepSeek，请检查网络后重试。"
        : error?.message || "连接失败";
      appendLog(`DeepSeek 配置失败：${safeError(message)}`, "warn");
      sendJson(response, 400, { error: message.replace(KEY_PATTERN, "[hidden]"), code: code || "invalid" }, origin);
    }
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/providers/deepseek") {
    deepSeekMemoryKey = null;
    deleteDpapiKey();
    const envKey = typeof process.env.DEEPSEEK_API_KEY === "string" ? process.env.DEEPSEEK_API_KEY.trim() : "";
    if (envKey) {
      // 环境变量不是 CCW 创建的，不删除；但向用户解释为什么仍处于连接状态。
      sendJson(response, 200, { configured: true, source: "environment", message: "环境中仍存在 DEEPSEEK_API_KEY，DeepSeek 依然处于连接状态。" }, origin);
    } else {
      appendLog("DeepSeek 配置已移除");
      sendJson(response, 200, { configured: false, source: null, message: "已断开 DeepSeek。" }, origin);
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage/deepseek") {
    const analytics = parseDeepSeekSnapshot();
    if (!analytics) {
      sendJson(response, 404, { error: "未找到可解析的 DeepSeek 平台快照" }, origin);
      return;
    }
    sendJson(response, 200, analytics, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/logs") {
    sendJson(response, 200, { logs: logEntries }, origin);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bridge/start") {
    // 前端"一键桥接"：同源宿主拉起独立桥接进程（4318），随后前端轮询直到就绪。
    const reachable = await probeStandaloneBridge(1000);
    if (!reachable && !spawnedBridgePid) {
      try { startStandaloneBridge(); }
      catch (error) { sendJson(response, 500, { error: safeError(error) }, origin); return; }
    }
    sendJson(response, 200, { started: reachable || Boolean(spawnedBridgePid) }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memory") {
    sendJson(response, 200, { workspaces: memoryWorkspaces() }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    try { sendJson(response, 200, { sessions: claudeSessionHistory() }, origin); }
    catch (error) { sendJson(response, 500, { error: safeError(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions/detail") {
    const projectId = url.searchParams.get("projectId") || "";
    const sessionId = url.searchParams.get("sessionId") || "";
    try { sendJson(response, 200, claudeSessionDetail(projectId, sessionId), origin); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memory/file") {
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const file = url.searchParams.get("file") || "";
    const memoryDir = memoryDirFor(workspaceId);
    if (!memoryDir || !MEMORY_FILE.test(file)) { sendJson(response, 400, { error: "无效的工作区或文件" }, origin); return; }
    const target = resolve(memoryDir, file);
    if (!insideDirectory(memoryDir, target) || !existsSync(target)) { sendJson(response, 400, { error: "记忆文件不存在" }, origin); return; }
    sendJson(response, 200, { file, content: readFileSync(target, "utf8") }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memory/workspaces") {
    // 全部项目目录（含尚无记忆的工作区），供前端新建记忆时选择分区
    const ids = [];
    try {
      for (const projectId of readdirSync(memoryRootDir())) {
        if (memoryDirFor(projectId)) ids.push({ id: projectId, label: projectId });
      }
    } catch { /* 目录不存在时返回空列表 */ }
    ids.sort((a, b) => a.id.localeCompare(b.id));
    sendJson(response, 200, { workspaces: ids }, origin);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/memory") {
    try {
      const body = await readJson(request);
      const { workspaceId, ...entry } = body;
      if (typeof workspaceId !== "string") throw new Error("缺少工作区标识");
      const result = writeMemory(workspaceId, entry);
      sendJson(response, 200, result, origin);
    } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/api/memory") {
    const workspaceId = url.searchParams.get("workspaceId") || "";
    const file = url.searchParams.get("file") || "";
    try { sendJson(response, 200, deleteMemory(workspaceId, file), origin); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/workspace/tree") {
    const root = url.searchParams.get("path") || "";
    const sub = url.searchParams.get("dir") || "";
    if (!validDirectory(root)) { sendJson(response, 400, { error: "请提供有效的项目目录" }, origin); return; }
    const target = resolve(root, sub);
    if (!insideDirectory(root, target)) { sendJson(response, 400, { error: "目录超出工作区范围" }, origin); return; }
    if (!validDirectory(target)) { sendJson(response, 400, { error: "目录不存在" }, origin); return; }
    const entries = listDirectory(target);
    if (!entries) { sendJson(response, 500, { error: "无法读取目录" }, origin); return; }
    sendJson(response, 200, { root: resolve(root), dir: sub, entries, truncated: entries.length >= MAX_TREE_ENTRIES }, origin);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/workspace/select-directory") {
    try {
      const body = await readJson(request).catch(() => ({}));
      const selected = await selectWorkspaceDirectory(typeof body.initialPath === "string" ? body.initialPath : "");
      sendJson(response, 200, selected ? { path: selected, cancelled: false } : { path: "", cancelled: true }, origin);
    } catch (error) {
      sendJson(response, 500, { error: safeError(error) }, origin);
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/workspace/changes") {
    const dir = url.searchParams.get("path") || "";
    if (!validDirectory(dir)) { sendJson(response, 400, { error: "请提供有效的项目目录" }, origin); return; }
    try { sendJson(response, 200, gitStatus(dir), origin); }
    catch (error) { sendJson(response, 500, { error: safeError(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/workspace/diff") {
    const dir = url.searchParams.get("path") || "";
    const file = url.searchParams.get("file") || "";
    const status = url.searchParams.get("status") || "";
    if (!validDirectory(dir) || !file) { sendJson(response, 400, { error: "请提供项目目录与变更文件" }, origin); return; }
    try { sendJson(response, 200, gitFileDiff(dir, file, status), origin); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/workspace/file") {
    const dir = url.searchParams.get("path") || "";
    const file = url.searchParams.get("file") || "";
    if (!validDirectory(dir) || !file) { sendJson(response, 400, { error: "请提供项目目录与相对文件路径" }, origin); return; }
    try { sendJson(response, 200, readWorkspaceFile(dir, file), origin); }
    catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin); }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/cancel") {
    const body = await readJson(request).catch(() => ({}));
    const child = typeof body.requestId === "string" ? running.get(body.requestId) : null;
    const cancelled = terminateProcessTree(child);
    if (cancelled) appendLog(`用户停止任务及其子进程（${body.requestId}）`, "warn");
    sendJson(response, 200, { cancelled }, origin);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/steer") {
    try {
      const body = await readJson(request, MAX_RUN_REQUEST_CHARS);
      const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(body.requestId) ? body.requestId : null;
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const images = parseRunImages(body.images);
      if (!requestId || (!prompt && images.length === 0) || prompt.length > 100_000) throw new Error("插话内容为空或无效");
      const child = running.get(requestId);
      if (!child || child.killed || child.stdin.destroyed || child.stdin.writableEnded) {
        sendJson(response, 409, { error: "当前任务已经结束，插话将保留在队列中" }, origin);
        return;
      }
      const runState = runStates.get(child);
      if (!runState?.initialized) {
        sendJson(response, 409, { error: "Claude Code 控制通道尚未就绪，请稍后重试" }, origin);
        return;
      }
      if (runState.pendingRedirects > 0) {
        sendJson(response, 409, { error: "另一条消息正在插入，请等待 Claude 确认" }, origin);
        return;
      }
      const content = [
        ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } })),
        ...(prompt ? [{ type: "text", text: prompt }] : []),
      ];
      const userMessage = { type: "user", message: { role: "user", content } };
      runState.pendingRedirects += 1;
      try {
        await sendClaudeControlRequest(child, { subtype: "interrupt" });
        writeRunUserMessage(child, userMessage);
        appendLog(`Claude 已确认中断并接收调整方向（${requestId}）`);
        sendJson(response, 200, { steered: true, acknowledged: true }, origin);
      } finally {
        runState.pendingRedirects -= 1;
        maybeEndRunInput(child);
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }, origin);
    }
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/api/run") { sendJson(response, 404, { error: "Not found" }, origin); return; }

  try {
    const body = await readJson(request, MAX_RUN_REQUEST_CHARS);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const images = parseRunImages(body.images);
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const provider = PROVIDER_KINDS.has(body.provider) ? body.provider : "claude";
    let model = defaultModelFor(provider);
    if (typeof body.model === "string" && body.model) {
      if (!modelAllowed(provider, body.model)) {
        throw new Error(provider === "deepseek" ? "DeepSeek 只支持 V4 Pro 与 V4 Flash 模型。" : "Claude 只支持 Sonnet、Opus 与 Haiku 模型。");
      }
      model = body.model;
    }
    const permissionMode = ALLOWED_PERMISSION_MODES.has(body.permissionMode) ? body.permissionMode : "plan";
    const effort = ALLOWED_EFFORT_LEVELS.has(body.effort) ? body.effort : "medium";
    const sessionId = typeof body.sessionId === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(body.sessionId) ? body.sessionId : null;
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(body.requestId) ? body.requestId : null;
    if ((!prompt && images.length === 0) || prompt.length > 100_000) throw new Error("任务内容为空或过长");
    if (!validDirectory(cwd)) throw new Error("请选择本机存在的项目目录");

    const claudePath = findClaude();
    if (!claudePath) throw new Error("没有检测到 Claude Code。请先安装并完成 claude 登录。");
    // 子进程环境按 provider 独立构造；DeepSeek 未配置时在 spawn 之前返回明确错误。
    let childEnv = process.env;
    if (provider === "deepseek") {
      const credential = deepSeekCredential();
      if (!credential) throw new Error("尚未配置 DeepSeek API Key，请先完成连接。");
      childEnv = deepSeekChildEnvironment(process.env, model, effort, credential.key);
    }
    // DeepSeek 五档交互映射为 high/max 两档（见 PRD 4.4），CLAUDE_CODE_EFFORT_LEVEL 与 --effort 保持一致。
    const claudeEffort = provider === "deepseek" ? DEEPSEEK_EFFORT_MAP[effort] || "high" : effort;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", model, "--permission-mode", permissionMode, "--effort", claudeEffort];
    if (sessionId) args.push("--resume", sessionId);
    const isCmd = process.platform === "win32" && claudePath.toLowerCase().endsWith(".cmd");
    const child = spawn(claudePath, args, { cwd, env: childEnv, shell: isCmd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const runState = { initialized: false, messagesSent: 0, resultsSeen: 0, pendingRedirects: 0 };
    runStates.set(child, runState);
    if (requestId) running.set(requestId, child);
    appendLog(`Claude Code 会话启动：provider=${provider} ${args.join(" ")}（cwd: ${cwd}）`);

    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) });
    child.stdout.pipe(response, { end: false });
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event?.type === "control_response") settleControlResponse(child, event);
          if (event?.type === "result") {
            runState.resultsSeen += 1;
            maybeEndRunInput(child);
          }
        } catch { /* 非完整 JSON 由下一块继续拼接 */ }
      }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", (error) => {
      rejectPendingControls(child, error);
      appendLog(`Claude Code 启动失败：${error.message}`, "error");
      if (!response.writableEnded) response.write(`${JSON.stringify({ type: "bridge_error", message: error.message })}\n`);
      if (!response.writableEnded) response.end();
    });
    child.on("exit", (code) => {
      rejectPendingControls(child, new Error("Claude Code 已退出"));
      if (requestId) running.delete(requestId);
      if (code !== 0 && code !== null) {
        appendLog(`Claude Code 异常退出（code ${code}）：${stderr.trim().slice(-200) || "无错误输出"}`, "error");
        if (!response.writableEnded) response.write(`${JSON.stringify({ type: "bridge_error", message: stderr.trim() || `Claude Code exited with code ${code}` })}\n`);
      } else appendLog(`Claude Code 会话结束（code ${code}）`);
      if (!response.writableEnded) response.end();
    });
    response.on("close", () => { if (!response.writableEnded) terminateProcessTree(child); });
    const content = [
      ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } })),
      ...(prompt ? [{ type: "text", text: prompt }] : []),
    ];
    try {
      await sendClaudeControlRequest(child, { subtype: "initialize", hooks: null }, 15_000);
      runState.initialized = true;
      writeRunUserMessage(child, { type: "user", message: { role: "user", content } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Claude Code 控制通道初始化失败：${message}`, "error");
      if (!response.writableEnded) response.write(`${JSON.stringify({ type: "bridge_error", message: `Claude Code 控制通道初始化失败：${message}` })}\n`);
      if (!response.writableEnded) response.end();
      terminateProcessTree(child);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(`任务被拒绝：${message}`, "warn");
    sendJson(response, 400, { error: message }, origin);
  }
}

/** 返回 Node http 风格的请求处理函数，供 Vite 插件挂载（同源模式）。 */
export function createBridgeHandler() {
  return handleRequest;
}

// 直接运行本文件时（node bridge/server.mjs），作为独立进程监听 4318；
// 被 vite 插件 import 时只导出 handler，不占用端口。
const isStandalone = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isStandalone) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    appendLog(`桥接器已启动：http://${HOST}:${PORT}`);
    console.log(`Claude Code White bridge: http://${HOST}:${PORT}`);
  });
}

/* ---------- 导出：接口测试与前端共享的纯函数 ---------- */

export {
  BRIDGE_PROTOCOL,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODELS,
  DEEPSEEK_UI_MODELS,
  DEEPSEEK_EFFORT_MAP,
  DEEPSEEK_VISION_MODEL,
  modelAllowed,
  defaultModelFor,
  deepSeekModelSupportsImages,
  isLocalOrigin,
  deepSeekConfiguration,
  deepSeekCredential,
  deepSeekChildEnvironment,
  readDpapiKey,
  writeDpapiKey,
  deleteDpapiKey,
  fetchDeepSeekBalance,
};

export function __setDeepSeekMemoryKeyForTests(value) {
  deepSeekMemoryKey = value || null;
  deepSeekDpapiCache = null;
}

export function __setFetchImplForTests(impl) {
  fetchImpl = impl;
}
