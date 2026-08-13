import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 4318;
const BRIDGE_PROTOCOL = 2;
// 桥接鉴权：宿主（vite 插件 / run-vinext）与独立桥接进程共享同一随机 token，
// 通过状态文件 %LOCALAPPDATA%\ClaudeCodeWhite\bridge-token 交换；页面启动时从
// 豁免端点 /bridge-token.json 换取 token，之后所有请求携带 X-Bridge-Token。
// 自定义头强制浏览器先发 preflight（远程恶意网站被 CORS 拒绝），值校验挡住本机
// 任意 localhost 页面的直读。OPTIONS 与 /api/status、/api/bridge/start、
// /bridge-token.json 豁免，供启动器健康检查、前端就绪探测与 token 引导使用。
const STATE_DIR = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "ClaudeCodeWhite")
  : join(homedir(), ".claude-code-white");
const TOKEN_FILE = join(STATE_DIR, "bridge-token");
const TOKEN_EXEMPT_PATHS = new Set(["/api/status", "/api/bridge/start", "/bridge-token.json"]);
let cachedToken = "";

function bridgeToken() {
  if (cachedToken) return cachedToken;
  if (process.env.BRIDGE_TOKEN) { cachedToken = process.env.BRIDGE_TOKEN; return cachedToken; }
  try {
    if (existsSync(TOKEN_FILE)) {
      const saved = readFileSync(TOKEN_FILE, "utf8").trim();
      if (saved) { cachedToken = saved; return saved; }
    }
    cachedToken = randomBytes(24).toString("hex");
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE, cachedToken, "utf8");
  } catch { /* 持久化失败时仅用内存 token，鉴权仍然生效 */ }
  return cachedToken;
}

// /api/run 简单限流：每分钟最多 24 次会话启动，防止本机恶意页面耗尽订阅额度。
const RUN_WINDOW_MS = 60_000;
const RUN_MAX = 24;
let runTimestamps = [];

function rateLimitRun() {
  const now = Date.now();
  runTimestamps = runTimestamps.filter((t) => now - t < RUN_WINDOW_MS);
  if (runTimestamps.length >= RUN_MAX) return false;
  runTimestamps.push(now);
  return true;
}
const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku"]);
const ALLOWED_PERMISSION_MODES = new Set(["plan", "manual", "acceptEdits", "auto", "dontAsk"]);
const ALLOWED_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
// 本机专属桥接：任何 localhost 端口的前端页面都可读取（开发 3000 / 生产任意端口），
// 非本机来源一律不返回 Access-Control-Allow-Origin，浏览器仍会拦截读取。
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const running = new Map();
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

function appendLog(message, level = "info") {
  const entry = { t: Date.now(), level, message: String(message).replace(/sk-[a-zA-Z0-9_-]+/g, "[hidden]").slice(0, 600) };
  logEntries.push(entry);
  if (logEntries.length > 400) logEntries.splice(0, logEntries.length - 400);
}

/* ---------- 一键桥接：由同源宿主（dev server 插件）拉起独立桥接进程 ---------- */

let spawnedBridgePid = null;

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
    "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function sendJson(response, status, payload, origin = "") {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_100_000) reject(new Error("请求内容过大"));
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("请求不是有效 JSON")); }
    });
    request.on("error", reject);
  });
}

function validDirectory(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return existsSync(value) && statSync(value).isDirectory(); } catch { return false; }
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
  return (error instanceof Error ? error.message : String(error)).replace(/sk-[a-zA-Z0-9_-]+/g, "[hidden]").slice(0, 180);
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

  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const payload = await fetchJson("https://api.deepseek.com/user/balance", { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, Accept: "application/json" });
      providers.push({
        id: "deepseek", name: "DeepSeek", configured: true, state: payload.is_available ? "ready" : "limited",
        summary: payload.is_available ? "官方余额接口已连接" : "账户当前没有可用余额",
        balances: (payload.balance_infos || []).map((item) => ({ currency: item.currency, total: item.total_balance, granted: item.granted_balance, toppedUp: item.topped_up_balance })),
        href: "https://platform.deepseek.com/usage",
      });
    } catch (error) {
      providers.push({ id: "deepseek", name: "DeepSeek", configured: true, state: "error", summary: "余额检测失败", detail: safeError(error), href: "https://platform.deepseek.com/usage" });
    }
  } else providers.push({ id: "deepseek", name: "DeepSeek", configured: false, state: "missing", summary: "设置 DEEPSEEK_API_KEY 后可读取充值与赠金余额", href: "https://platform.deepseek.com/usage" });

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
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  // 除健康检查端点外，一律要求 X-Bridge-Token 与状态文件 token 一致。
  if (!TOKEN_EXEMPT_PATHS.has(url.pathname) && request.headers["x-bridge-token"] !== bridgeToken()) {
    sendJson(response, 403, { error: "桥接鉴权失败：缺少或错误的 X-Bridge-Token" }, origin);
    return;
  }

  // 页面启动时凭此端点换取 token（豁免鉴权：先有 token 才能带 token）。
  if (request.method === "GET" && url.pathname === "/bridge-token.json") {
    sendJson(response, 200, { token: bridgeToken() }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    const claudePath = findClaude();
    sendJson(response, 200, { bridge: true, bridgeProtocol: BRIDGE_PROTOCOL, capabilities: ["approval-strategies", "effort-levels"], claudeInstalled: Boolean(claudePath), claudePath, claudeVersion: claudeVersion(claudePath), pathEntries: (process.env.PATH || "").split(delimiter).length, cwd: process.cwd() }, origin);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/usage") {
    try { sendJson(response, 200, { providers: await usageProviders(), checkedAt: new Date().toISOString() }, origin); }
    catch (error) { sendJson(response, 500, { error: safeError(error) }, origin); }
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
    if (child && !child.killed) { child.kill(); appendLog(`用户取消任务（${body.requestId}）`, "warn"); }
    sendJson(response, 200, { cancelled: Boolean(child) }, origin);
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/api/run") { sendJson(response, 404, { error: "Not found" }, origin); return; }

  try {
    const body = await readJson(request);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const model = ALLOWED_MODELS.has(body.model) ? body.model : "sonnet";
    const permissionMode = ALLOWED_PERMISSION_MODES.has(body.permissionMode) ? body.permissionMode : "plan";
    const effort = ALLOWED_EFFORT_LEVELS.has(body.effort) ? body.effort : "medium";
    const sessionId = typeof body.sessionId === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(body.sessionId) ? body.sessionId : null;
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(body.requestId) ? body.requestId : null;
    if (!prompt || prompt.length > 100_000) throw new Error("任务内容为空或过长");
    if (!validDirectory(cwd)) throw new Error("请选择本机存在的项目目录");

    const claudePath = findClaude();
    if (!claudePath) throw new Error("没有检测到 Claude Code。请先安装并完成 claude 登录。");
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", model, "--permission-mode", permissionMode, "--effort", effort];
    if (sessionId) args.push("--resume", sessionId);
    const isCmd = process.platform === "win32" && claudePath.toLowerCase().endsWith(".cmd");
    const child = spawn(claudePath, args, { cwd, env: process.env, shell: isCmd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    if (requestId) running.set(requestId, child);
    appendLog(`Claude Code 会话启动：${args.join(" ")}（cwd: ${cwd}）`);

    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Content-Type-Options": "nosniff", ...corsHeaders(origin) });
    child.stdout.pipe(response, { end: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", (error) => {
      appendLog(`Claude Code 启动失败：${error.message}`, "error");
      response.write(`${JSON.stringify({ type: "bridge_error", message: error.message })}\n`);
      response.end();
    });
    child.on("exit", (code) => {
      if (requestId) running.delete(requestId);
      if (code !== 0 && code !== null) {
        appendLog(`Claude Code 异常退出（code ${code}）：${stderr.trim().slice(-200) || "无错误输出"}`, "error");
        response.write(`${JSON.stringify({ type: "bridge_error", message: stderr.trim() || `Claude Code exited with code ${code}` })}\n`);
      } else appendLog(`Claude Code 会话结束（code ${code}）`);
      response.end();
    });
    response.on("close", () => { if (!response.writableEnded && !child.killed) child.kill(); });
    child.stdin.end(prompt);
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
