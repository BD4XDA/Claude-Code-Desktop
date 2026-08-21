/**
 * 把皮肤包同步到 dsh web profile 的 node_modules（皮肤中心的注册根目录）：
 *   ~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-claude-code-white/
 * 工作区是本皮肤的唯一源头；dsh 升级/pnpm install 后重新执行本脚本即可恢复。
 * 用法：node sync-to-dsh.mjs（先 node build.mjs 构建 lib/client.js）
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(
  homedir(),
  ".dsh",
  "profiles",
  "web",
  "node_modules",
  "@linxin666",
  "dsh-client-ui-skin-claude-code-white"
);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["package.json", "skin.json", "cordis.patch.yml", "lib"]) {
  cpSync(join(here, entry), join(target, entry), { recursive: true });
}
console.log(`synced skin -> ${target}`);
