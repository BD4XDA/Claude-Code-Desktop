/**
 * 制作可公开提交的干净发布包（供 GitHub 使用）。
 * 排除一切本机隐私与构建产物：node_modules、dist、.git、.wrangler、
 * DeepSeek 平台快照（含余额与消费数据）、.env（保留 .env.example）、
 * *.tsbuildinfo 等。输出到 ./release/ 目录并压缩为 zip。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
// 输出放在项目同级目录，避免把发布产物复制进自身。
const OUT = join(resolve(ROOT, ".."), "claude-code-white-release");
const ZIP = join(resolve(ROOT, ".."), "claude-code-white-release.zip");

const EXCLUDED_TOP = new Set([
  "node_modules",
  ".git",
  "dist",
  ".wrangler",
  ".vinext",
  ".next",
  "release",
  ".openai",
  ".cache",
  "tsconfig.tsbuildinfo",
]);

const isExcluded = (src) => {
  const name = src.split(/[\\/]/).pop();
  if (EXCLUDED_TOP.has(name)) return true;
  if (name.endsWith(".tsbuildinfo")) return true;
  if (name.startsWith(".env") && name !== ".env.example") return true;
  if (/^DeepSeek.*\.html$/i.test(name)) return true;
  if (/^DeepSeek.*_files$/i.test(name)) return true;
  return false;
};

console.log(`[make-release] 根目录: ${ROOT}`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(ROOT, OUT, { recursive: true, filter: (src) => !isExcluded(src) });

const copied = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    copied.push(full.slice(OUT.length + 1));
    if (entry.isDirectory()) walk(full);
  }
};
walk(OUT);
console.log(`[make-release] 已复制 ${copied.length} 个条目到 ${OUT}`);
console.log(`[make-release] 已排除: ${[...EXCLUDED_TOP].join(", ")} 等`);

rmSync(ZIP, { force: true });
// Windows 自带 bsdtar（%SystemRoot%\System32\tar.exe），可直接打包 zip；失败不阻塞（可提交目录本身）。
const tar = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
const result = spawnSync(tar, ["-a", "-c", "-f", ZIP, "-C", OUT, "."], { encoding: "utf8", windowsHide: true });
if (result.status === 0 && existsSync(ZIP)) {
  console.log(`[make-release] zip 已生成: ${ZIP}`);
} else {
  console.warn(`[make-release] zip 压缩失败（${(result.stderr || "未知错误").trim().slice(0, 200)}），可直接提交 ${OUT} 目录`);
}
