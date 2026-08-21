/**
 * DOM 检查：找出工作区里 resize 手柄 / 拖拽手柄 / 交互热区并打印矩形。
 * 用法：node inspect.mjs [url] [waitMs]
 */
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = process.argv[2] ?? "http://127.0.0.1:3080/";
const waitMs = Number(process.argv[3] ?? 9000);
const port = 9666 + Math.floor(Math.random() * 200);

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", `--remote-debugging-port=${port}`,
  "--user-data-dir=" + `${process.env.TEMP}\\ccw-insp-${port}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0;
  const call = (m, p = {}) => new Promise((res, rej) => {
    const n = id++;
    const h = (ev) => { const msg = JSON.parse(ev.data); if (msg.id === n) { ws.removeEventListener("message", h); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id: n, method: m, params: p }));
  });
  await call("Page.enable");
  await call("Page.navigate", { url });
  await sleep(waitMs);

  const expr = `(() => {
    const out = [];
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    // 1) 光标为 resize / 拖拽的可见元素
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const cur = cs.cursor;
      if (/col-resize|row-resize|ew-resize|ns-resize|grab|move/.test(cur)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 60 && r.height < 60) {
          out.push({ kind: "cursor:" + cur, tag: el.tagName, cls: (el.className || "").toString().slice(0, 80), ...rect(el), pointerEvents: cs.pointerEvents });
        }
      }
    }
    // 2) draggable 属性
    for (const el of document.querySelectorAll("[draggable='true']")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ kind: "draggable", tag: el.tagName, cls: (el.className || "").toString().slice(0, 80), ...rect(el) });
    }
    // 3) 宽>6px 高>40px 或反之的"隐形热区"（兄弟带 resize 光标）
    const resizeEls = [...document.querySelectorAll("*")].filter(el => /col-resize|row-resize/.test(getComputedStyle(el).cursor));
    out.push({ kind: "resize-count", n: resizeEls.length });
    for (const el of resizeEls.slice(0, 12)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ kind: "resize", tag: el.tagName, cls: (el.className || "").toString().slice(0, 60), ...rect(el) });
    }
    // 4) 文本中含"拖动/拖拽/移动/上下文"的元素
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walk.nextNode())) {
      const t = (node.textContent || "").trim();
      if (/^.{0,6}(拖|移|上下文|context).{0,6}$/.test(t.slice(0, 20))) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 400) out.push({ kind: "text", tag: node.tagName, text: t.slice(0, 20), ...rect(node) });
      }
    }
    return out;
  })()`;
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result.value, null, 1));
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
