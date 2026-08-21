import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  return handler(new Request("http://localhost/", { headers: { accept: "text/html" } }));
}

test("server-renders the Claude Code workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Claude Code White<\/title>/i);
  assert.match(html, /Claude Code/);
  assert.match(html, /工作区变更/);
  assert.match(html, /仅规划/);
  assert.match(html, /查看流程详情/);
  assert.match(html, /终端/);
  assert.match(html, /用量与额度/);
  assert.match(html, /并行会话/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the local bridge narrow and Claude Code-specific", async () => {
  const [page, layout, css, bridge, packageJson, launcher, silentLauncher, shortcutCreator] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../bridge/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../Start-Claude-Code-White.ps1", import.meta.url), "utf8"),
    readFile(new URL("../Launch-Claude-Code-White.vbs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/create-shortcut.ps1", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Claude Code/);
  assert.match(page, /permissionMode/);
  assert.match(page, /批准策略/);
  assert.match(page, /思考强度/);
  assert.match(page, /查看流程详情/);
  assert.match(page, /收起流程/);
  assert.match(css, /\.process-collapse-footer/i);
  assert.match(page, /processOpen:\s*false/);
  assert.match(page, /keepOnlyOneControlOpen/);
  assert.match(page, /function ClaudeSettingsControl/);
  assert.match(page, /选择模型/);
  assert.match(page, /webkitSpeechRecognition/);
  assert.match(page, /语音转文字/);
  assert.match(page, /voice-button/);
  assert.match(page, /sidebarCollapsed/);
  assert.match(page, /claude-code-sidebar-collapsed/);
  assert.match(page, /SidebarToggle/);
  assert.match(page, /快速调整思考强度/);
  assert.match(page, /applySliderDetent/);
  assert.match(page, /settleSlider/);
  assert.match(page, /Ctrl\+Shift\+M/);
  assert.match(page, /更高效/);
  assert.match(page, /更智能/);
  assert.match(page, /dontAsk/);
  assert.match(page, /xhigh/);
  assert.match(page, /multiple/);
  assert.match(page, /handleImagePaste/);
  assert.match(page, /handleImageDrop/);
  assert.match(page, /每次最多上传/);
  assert.match(page, /workspaceSessionGroups/);
  assert.match(page, /queuedTurns/);
  assert.match(page, /排队消息/);
  assert.match(page, /steerQueuedTurn/);
  assert.match(page, /调整方向/);
  assert.match(page, /\/api\/workspace\/select-directory/);
  assert.match(page, /provider-accordion/);
  assert.match(page, /data-usage-part="models"/);
  assert.match(page, /\/api\/usage\/deepseek/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(css, /--accent:\s*#d37c51/i);
  assert.match(css, /--accent-action:\s*#e7a08e/i);
  assert.match(css, /--canvas:\s*#f8f9fa/i);
  assert.match(css, /data-theme="dark"/i);
  assert.match(css, /--font-editorial:/i);
  assert.match(css, /--font-control:\s*var\(--font-geist-sans\)/i);
  assert.doesNotMatch(css, /--font-control:[^;]*FangSong/i);
  assert.match(css, /\.assistant-content\s*>\s*p\s*\{[^}]*font-size:\s*15\.5px/i);
  assert.match(css, /--claude-symbol:/i);
  assert.match(css, /\.claude-mark::before/i);
  assert.match(css, /\.claude-settings-popover/i);
  assert.match(css, /Codex 式底栏结构/);
  assert.match(css, /\.ion-slider/i);
  assert.match(css, /@keyframes ion-stream-back/i);
  assert.match(css, /Codex 式流程/);
  assert.match(css, /\.composer\s*\{[^}]*overflow:\s*visible/i);
  assert.match(css, /\.session-pane:has\(\.composer-control\[open\]\)/i);
  assert.match(css, /\.draft-image-rail/i);
  assert.match(css, /\.composer-drop-overlay/i);
  assert.match(css, /\.message-image-grid/i);
  assert.match(css, /\.app-shell\.sidebar-collapsed \.sidebar/i);
  assert.match(css, /\.sidebar-toggle-button/i);
  assert.match(css, /\.sidebar-backdrop/i);
  assert.match(bridge, /const HOST = "127\.0\.0\.1"/);
  assert.match(bridge, /--output-format", "stream-json"/);
  assert.match(bridge, /--input-format", "stream-json"/);
  assert.match(bridge, /--permission-mode/);
  assert.match(bridge, /--effort/);
  assert.match(bridge, /ALLOWED_EFFORT_LEVELS/);
  assert.match(bridge, /BRIDGE_PROTOCOL = 9/);
  assert.match(launcher, /bridgeProtocol -ge 9/);
  assert.match(bridge, /multi-image-input/);
  assert.match(bridge, /native-folder-picker/);
  assert.match(bridge, /live-steering/);
  assert.match(bridge, /\/api\/steer/);
  assert.match(bridge, /subtype:\s*"interrupt"/);
  assert.match(bridge, /sendClaudeControlRequest/);
  assert.match(bridge, /control_response/);
  assert.match(bridge, /acknowledged:\s*true/);
  assert.match(page, /已立即调整方向/);
  assert.match(page, /steer-user-/);
  assert.match(page, /steer-assistant-/);
  assert.match(page, /activeAssistantIdsRef/);
  assert.match(page, /Claude Code 已接收插入消息/);
  assert.match(bridge, /select-workspace-folder\.vbs/);
  assert.match(bridge, /spawn\("wscript\.exe"/);
  assert.doesNotMatch(bridge, /-32000/);
  assert.match(bridge, /parseRunImages/);
  assert.match(bridge, /media_type/);
  assert.match(bridge, /\/api\/usage/);
  assert.match(bridge, /api\.deepseek\.com\/user\/balance/);
  assert.match(bridge, /parseDeepSeekSnapshot/);
  assert.match(bridge, /\/api\/cancel/);
  assert.match(bridge, /terminateProcessTree/);
  assert.match(bridge, /taskkill\.exe/);
  assert.match(page, /stoppingSessionIds/);
  assert.match(page, /正在停止当前任务/);
  assert.match(bridge, /\/api\/workspace\/diff/);
  assert.match(bridge, /\/api\/sessions\/detail/);
  assert.match(bridge, /\.claude", "projects/);
  assert.match(bridge, /--no-ext-diff/);
  assert.match(page, /diff-preview/);
  assert.match(page, /恢复历史任务/);
  assert.match(css, /\.queued-turns/i);
  assert.match(css, /\.queued-menu-popover/i);
  assert.match(css, /\.queue-kebab/i);
  assert.match(page, /openQueuedTurnInSideChat/);
  assert.match(page, /编辑消息/);
  assert.match(page, /在侧边会话中打开/);
  assert.match(page, /关闭排队/);
  assert.match(css, /\.workspace-session-group/i);
  assert.match(css, /scrollbar-gutter:\s*stable/i);
  assert.match(page, /Ctrl ⇧ P/);
  assert.match(launcher, /Test-ClaudeCodeWhite/);
  assert.match(launcher, /--strictPort/);
  assert.match(launcher, /--app=\$url/);
  assert.match(launcher, /Get-Command node\.exe/);
  assert.match(launcher, /-WindowStyle Hidden/);
  assert.match(silentLauncher, /shell\.Run/i);
  assert.match(silentLauncher, /, 0, False/i);
  assert.match(shortcutCreator, /wscript\.exe/i);
  assert.doesNotMatch(bridge, /dangerously-skip-permissions/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("accepts image batches before validating the workspace", async (context) => {
  const { createBridgeHandler } = await import(new URL("../bridge/server.mjs", import.meta.url));
  const server = createServer(createBridgeHandler());
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const image = { name: "pixel.png", mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=" };
  const response = await fetch(`http://127.0.0.1:${address.port}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ prompt: "比较两张图片", images: [image, image], cwd: "Z:\\claude-code-white-does-not-exist", model: "haiku", permissionMode: "plan", effort: "low" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /项目目录/);
});

test("rejects image batches above the ten-image limit", async (context) => {
  const { createBridgeHandler } = await import(new URL("../bridge/server.mjs", import.meta.url));
  const server = createServer(createBridgeHandler());
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const image = { mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=" };
  const response = await fetch(`http://127.0.0.1:${address.port}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ prompt: "比较图片", images: Array.from({ length: 11 }, () => image), cwd: process.cwd() }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /最多上传 10 张/);
});

test("keeps live steering scoped to an active local run", async (context) => {
  const { createBridgeHandler } = await import(new URL("../bridge/server.mjs", import.meta.url));
  const server = createServer(createBridgeHandler());
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/steer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ requestId: "session-test-active", prompt: "改为先修复测试" }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /已经结束/);
});
