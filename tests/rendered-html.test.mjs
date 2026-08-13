import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
  assert.match(page, /processOpen:\s*false/);
  assert.match(page, /keepOnlyOneControlOpen/);
  assert.match(page, /function ModelControl/);
  assert.match(page, /选择模型/);
  assert.match(page, /dontAsk/);
  assert.match(page, /xhigh/);
  assert.match(page, /provider-accordion/);
  assert.match(page, /data-usage-part="models"/);
  assert.match(page, /\/api\/usage\/deepseek/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(css, /--accent:\s*#d37c51/i);
  assert.match(css, /--accent-action:\s*#e7a08e/i);
  assert.match(css, /--canvas:\s*#f8f9fa/i);
  assert.match(css, /data-theme="dark"/i);
  assert.match(css, /--font-editorial:/i);
  assert.match(css, /\.assistant-content\s*>\s*p\s*\{[^}]*font-size:\s*15\.5px/i);
  assert.match(css, /--claude-symbol:/i);
  assert.match(css, /\.claude-mark::before/i);
  assert.match(css, /\.model-popover/i);
  assert.match(css, /Codex 式流程/);
  assert.match(css, /\.composer\s*\{[^}]*overflow:\s*visible/i);
  assert.match(css, /\.session-pane:has\(\.composer-control\[open\]\)/i);
  assert.match(bridge, /const HOST = "127\.0\.0\.1"/);
  assert.match(bridge, /--output-format", "stream-json"/);
  assert.match(bridge, /--permission-mode/);
  assert.match(bridge, /--effort/);
  assert.match(bridge, /ALLOWED_EFFORT_LEVELS/);
  assert.match(bridge, /BRIDGE_PROTOCOL = 2/);
  assert.match(bridge, /\/api\/usage/);
  assert.match(bridge, /api\.deepseek\.com\/user\/balance/);
  assert.match(bridge, /parseDeepSeekSnapshot/);
  assert.match(bridge, /\/api\/cancel/);
  assert.match(bridge, /\/api\/workspace\/diff/);
  assert.match(bridge, /\/api\/sessions\/detail/);
  assert.match(bridge, /\.claude", "projects/);
  assert.match(bridge, /--no-ext-diff/);
  assert.match(page, /diff-preview/);
  assert.match(page, /恢复历史任务/);
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
