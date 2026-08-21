/**
 * 截图 + canvas 重编码为标准 JPEG（兼容性最好）。
 * 用法：node shot-jpeg.mjs [url] [out.jpg] [waitMs] [scale]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = process.argv[2] ?? "http://127.0.0.1:3080/";
const out = process.argv[3] ?? "shot.jpg";
const waitMs = Number(process.argv[4] ?? 9000);
const scale = Number(process.argv[5] ?? 0.8);
const port = 9555 + Math.floor(Math.random() * 300);

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", `--remote-debugging-port=${port}`,
  "--user-data-dir=" + `${process.env.TEMP}\\ccw-shot-${port}`, "about:blank",
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
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const dataUrl = `data:image/png;base64,${shot.data}`;
  const expr = `new Promise(res => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(i.width * ${scale});
      c.height = Math.round(i.height * ${scale});
      const x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(i, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", 0.88).split(",")[1]);
    };
    i.onerror = () => res("ERR");
    i.src = ${JSON.stringify(dataUrl)};
  })`;
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.value === "ERR") throw new Error("canvas re-encode failed");
  writeFileSync(out, Buffer.from(r.result.value, "base64"));
  console.log("shot ->", out);
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
