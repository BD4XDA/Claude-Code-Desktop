/**
 * 把本地桥接器挂载到 Vite dev server：`npm run dev` 一个进程即同时提供
 * 前端与 /api/* 桥接端点，无需再单独启动桥接器。
 * 生产模式（vinext start）请继续使用 `node bridge/server.mjs` 独立进程。
 */
import { createBridgeHandler } from "./server.mjs";

function attach(server) {
  const handler = createBridgeHandler();
  server.middlewares.use((req, res, next) => {
    if (req.url?.startsWith("/api/")) {
      handler(req, res).catch((error) => {
        // 桥接内部已自行处理错误；这里兜底避免挂起请求。
        if (!res.headersSent) next(error);
      });
      return;
    }
    next();
  });
}

export function bridgePlugin() {
  return {
    name: "claude-code-white-bridge",
    apply: "serve",
    configureServer: attach,
  };
}
