import { spawn } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2] || "dev";
if (!new Set(["dev", "build", "start"]).has(command)) {
  console.error(`Unsupported vinext command: ${command}`);
  process.exit(2);
}
// 透传额外参数（如 npm run dev -- --port 3002）
const extraArgs = process.argv.slice(3);

const cli = resolve(process.cwd(), "node_modules", "vinext", "dist", "cli.js");

// 生产模式（npm run start）：自动拉起独立桥接进程（4318），
// 前端页面回退到独立桥接端口时无需再开一个终端。
let bridgeRestarts = 0;

function startBridge() {
  const script = resolve(process.cwd(), "bridge", "server.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
  console.log(`[start] 本地桥接已启动（pid ${child.pid}，127.0.0.1:4318）`);
  child.on("exit", (code, signal) => {
    // 端口被占用（已有一个桥接在跑）或异常退出时最多重拉 3 次；
    // 已有桥接在服务时重拉会立即退出，但不影响使用。
    if (code !== 0 && bridgeRestarts < 3) {
      bridgeRestarts += 1;
      console.log(`[start] 桥接进程退出（code ${code}${signal ? `, ${signal}` : ""}），${bridgeRestarts * 2}s 后重试…`);
      setTimeout(startBridge, bridgeRestarts * 2000);
    }
  });
}

const child = spawn(process.execPath, [cli, command, ...extraArgs], {
  cwd: process.cwd(),
  env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  stdio: "inherit",
  shell: false,
});

if (command === "start") startBridge();

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
