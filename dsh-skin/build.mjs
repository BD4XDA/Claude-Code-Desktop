/**
 * 构建 lib/client.js：把 src/theme.css 里的 {{FONTS}} 占位符替换为内嵌的
 * Geist / Geist Mono 字体（base64 data URI），再套进 client 模板。
 * 字体文件来自工作区 .vinext/fonts（next/font 产物，Geist OFL 许可）。
 * 用法：node build.mjs（构建后可选 node sync-to-dsh.mjs 同步到 dsh profile）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, "..", ".vinext", "fonts");

/** 子集文件（woff2 文件名）→ unicode-range，来自 .vinext 下各字体的 style.css */
const GEIST = {
  "geist-8ac0455e797f": {
    "geist-98bbbccb": "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "geist-001175b1": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    "geist-52306abf": "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    "geist-875ccdd4": "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    "geist-ff2310f5": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
  },
  "geist-mono-00e989178794": {
    "geist-mono-013b2f2f": "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "geist-mono-971fb274": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    "geist-mono-44745446": "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    "geist-mono-44e03052": "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    "geist-mono-f6b33328": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    "geist-mono-0638449e": "U+2000-2001, U+2004-2008, U+200A, U+23B8-23BD, U+2500-259F",
  },
};

function fontFace(family, dirName, files) {
  return Object.entries(files)
    .map(([file, range]) => {
      const data = readFileSync(join(fontsDir, dirName, `${file}.woff2`)).toString("base64");
      return (
        `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;` +
        `font-display:swap;src:url(data:font/woff2;base64,${data}) format('woff2');` +
        `unicode-range:${range}}`
      );
    })
    .join("");
}

let theme = readFileSync(join(here, "src", "theme.css"), "utf8");
theme = theme.replace(
  "{{FONTS}}",
  fontFace("Geist", "geist-8ac0455e797f", GEIST["geist-8ac0455e797f"]) +
    fontFace("Geist Mono", "geist-mono-00e989178794", GEIST["geist-mono-00e989178794"])
);

const faviconSvg = readFileSync(join(here, "..", "public", "favicon.svg"), "utf8").trim();
const faviconUri = `data:image/svg+xml;utf8,${encodeURIComponent(faviconSvg)}`;

let client = readFileSync(join(here, "src", "client.template.js"), "utf8");
client = client.replace("{{CSS_JSON}}", JSON.stringify(theme)).replace("{{FAVICON_JSON}}", JSON.stringify(faviconUri));

mkdirSync(join(here, "lib"), { recursive: true });
writeFileSync(join(here, "lib", "client.js"), client);
console.log(`built lib/client.js (${(client.length / 1024).toFixed(0)} KB, css ${(theme.length / 1024).toFixed(0)} KB)`);
