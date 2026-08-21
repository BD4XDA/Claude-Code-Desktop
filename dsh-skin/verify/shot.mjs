/**
 * 无头浏览器验证脚本：加载 dsh web，检查 CCW 皮肤是否生效并截图。
 * 用法：node shot.mjs [url] [out.png] [waitMs]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = process.argv[2] ?? "http://127.0.0.1:3080/";
const out = process.argv[3] ?? "ccw-skin-light.png";
const waitMs = Number(process.argv[4] ?? 9000);
const port = 9222 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,900",
  `--remote-debugging-port=${port}`,
  "--user-data-dir=" + `${process.env.TEMP}\\ccw-shot-${port}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpCall = (ws, id, method, params = {}) =>
  new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener("message", onMsg);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  // 等调试端口就绪
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {}
    await sleep(250);
  }
  // 开新标签页
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const call = (method, params) => cdpCall(ws, ++id, method, params);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Page.navigate", { url });
  await sleep(waitMs);

  const evalExpr = `(() => {
    const cs = getComputedStyle(document.body);
    const rootBg = getComputedStyle(document.querySelector("#root") ?? document.body).backgroundColor;
    return {
      title: document.title,
      skinAttr: document.body.getAttribute("data-dsh-claude-code-white") ?? null,
      darkAttr: document.body.getAttribute("data-ds-dark-theme") ?? null,
      styleTag: !!document.querySelector('style[data-plugin-css*="ccw"]'),
      bodyBg: cs.backgroundColor,
      bodyFont: cs.fontFamily.slice(0, 60),
      aliasBrand: cs.getPropertyValue("--dsw-alias-brand-primary").trim(),
      aliasBgBase: cs.getPropertyValue("--dsw-alias-bg-base").trim(),
      rootBg,
      rootRadius: getComputedStyle(document.querySelector("#root") ?? document.body).borderRadius,
      hasRoot: !!document.querySelector("#root"),
      textSample: (document.querySelector("#root")?.innerText ?? "").slice(0, 80)
    };
  })()`;
  const verdict = await call("Runtime.evaluate", { expression: evalExpr, returnByValue: true });
  console.log("VERIFY:", JSON.stringify(verdict.result.value, null, 2));

  const shot = await call("Page.captureScreenshot", { format: out.toLowerCase().endsWith(".jpg") || out.toLowerCase().endsWith(".jpeg") ? "jpeg" : "png", quality: 88 });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("shot ->", out);
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
