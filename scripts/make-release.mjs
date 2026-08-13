/**
 * 制作可公开提交的干净发布包（供 GitHub 使用）。
 * 排除一切本机隐私与构建产物：node_modules、dist、.git、.wrangler、
 * DeepSeek 平台快照（含余额与消费数据）、.env（保留 .env.example）、
 * *.tsbuildinfo 等。输出到 ./release/ 目录并压缩为 zip。
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
// 用 Node 原生实现 zip（zlib.deflateRawSync + crc32），保证中文文件名按 UTF-8
// 写入并设置语言标志——Windows 自带 bsdtar 按 GBK 写文件名，7-Zip/跨平台解压会乱码。
const { deflateRawSync, crc32 } = await import("node:zlib");
const files = [];
const walkForZip = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkForZip(full);
    else files.push(full);
  }
};
walkForZip(OUT);
const chunks = [];
const central = [];
for (const file of files) {
  const data = readFileSync(file);
  const name = Buffer.from(`./${file.slice(OUT.length + 1).replace(/\\/g, "/")}`, "utf8");
  const crc = crc32(data);
  const compressed = deflateRawSync(data);
  const method = compressed.length < data.length ? 8 : 0;
  const body = method === 8 ? compressed : data;
  const dosTime = 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // local file header signature
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // UTF-8 flag
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosTime, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const offset = chunks.reduce((sum, c) => sum + c.length, 0);
  chunks.push(local, name, body);
  const dirEntry = Buffer.alloc(46);
  dirEntry.writeUInt32LE(0x02014b50, 0); // central directory signature
  dirEntry.writeUInt16LE(20, 4);         // version made by
  dirEntry.writeUInt16LE(20, 6);         // version needed
  dirEntry.writeUInt16LE(0x0800, 8);     // UTF-8 flag
  dirEntry.writeUInt16LE(method, 10);
  dirEntry.writeUInt16LE(dosTime, 12);
  dirEntry.writeUInt16LE(dosTime, 14);
  dirEntry.writeUInt32LE(crc, 16);
  dirEntry.writeUInt32LE(body.length, 20);
  dirEntry.writeUInt32LE(data.length, 24);
  dirEntry.writeUInt16LE(name.length, 28);
  dirEntry.writeUInt16LE(0, 30);         // extra length
  dirEntry.writeUInt16LE(0, 32);         // comment length
  dirEntry.writeUInt16LE(0, 34);         // disk number
  dirEntry.writeUInt16LE(0, 36);         // internal attrs
  dirEntry.writeUInt32LE(0, 38);         // external attrs
  dirEntry.writeUInt32LE(offset, 42);    // local header offset
  central.push(dirEntry, name);
}
const centralStart = chunks.reduce((sum, c) => sum + c.length, 0);
const centralSize = central.reduce((sum, c) => sum + c.length, 0);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralSize, 12);
eocd.writeUInt32LE(centralStart, 16);
eocd.writeUInt16LE(0, 20);
writeFileSync(ZIP, Buffer.concat([...chunks, ...central, eocd]));
console.log(`[make-release] zip 已生成: ${ZIP}（${files.length} 个文件，UTF-8 文件名）`);
