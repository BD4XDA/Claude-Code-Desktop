# dsh-skin — Claude Code White 皮肤（DeepSeek Harness 换肤）

把 Claude-Code-White 工作区的前端风格移植到 dsh web（DeepSeek Harness）上：
珊瑚橙 × 暖白 × Geist 字形，浅色默认、深色跟随 dsh 主题切换。**只改外观，功能不变。**

## 结构

```
dsh-skin/
├── package.json          # @linxin666/dsh-client-ui-skin-claude-code-white
├── skin.json             # 皮肤中心注册元数据（bodyAttr: data-dsh-claude-code-white）
├── cordis.patch.yml      # roster 插入行（与 linxin666 内建皮肤同构）
├── lib/
│   ├── index.js          # host 侧空 apply
│   └── client.js         # 生成产物：ModuleLoader 注入 <style> + 标题/favicon 换肤
├── src/
│   ├── theme.css         # 主题源码（CCW token → dsw-static/alias 映射，浅/深两套）
│   └── client.template.js
├── build.mjs             # 内嵌 Geist 字体（.vinext/fonts → base64 data URI）并生成 lib/client.js
└── sync-to-dsh.mjs       # 同步到 ~/.dsh/profiles/web/node_modules/@linxin666/
```

## 使用

```bash
node build.mjs          # 工作区改动后构建 lib/client.js
node sync-to-dsh.mjs    # 同步到 dsh profile（dsh 升级 / pnpm install 后会丢失，重跑即可）
```

启用/停用皮肤（任选其一）：

- 网页设置 → 皮肤中心（若列表中可见）
- `curl -X POST http://127.0.0.1:3080/api/skin-center/apply -H 'content-type: application/json' -d '{"skin":"claude-code-white"}'`
- 恢复官方默认：`-d '{"official":true}'`
- 直接改 `~/.dsh/cordis.patch.yml` 的 `dsh-skin managed` 段（皮肤中心会自动重写该段）

## 说明

- 皮肤互斥由皮肤中心管理（`~/.dsh/cordis.patch.yml` managed 段），与 linxin666 内建皮肤
  （miku/qq98/…）完全同构，可随时切回。
- **附带修复 + 收窄**（`src/theme.css` 末尾）：
  - 右侧文件面板调宽手柄 `.aionui-explorer-handle` 原命中区 12px + `margin-left:-6px`
    （内联、z=30、整列高）探入聊天列右缘，拖调宽线时会误拖下方的"上下文"元素。
    皮肤内命中区收回到面板边界（聊天列内 0px）并**收窄到 2px**，视觉线为 1px
    发丝线居中贴边界；width/margin 为内联样式，覆盖需 `!important`。
  - 侧边栏调宽手柄 `.pI_x6G_handle` 命中区 8px → **2px**（居中跨边界）。
- Geist / Geist Mono 字体以 base64 内嵌（约 220KB），自包含、零路由、离线可用；
  中文回退到 Microsoft YaHei。
- 皮肤中心网页列表（构建期生成的卡片）不含本皮肤，但 `/apply` 与
  `dsh-skin use` 机制（运行时扫描 skin.json 注册表）完整支持。
