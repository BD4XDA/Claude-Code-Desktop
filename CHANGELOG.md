# 更新日志

## 2026-08-21

### 新增
- **dsh-skin v0.1.0**：DeepSeek Harness（dsh web）换肤皮肤包（`@linxin666/dsh-client-ui-skin-claude-code-white`），移植 Claude Code White 的珊瑚橙 × 暖白 × Geist 风格，浅/深两套主题跟随 dsh 切换，只改外观不影响功能。
- 仓库新增 `.vite/` 缓存目录忽略规则。

### 发布
- 重建公开发布包 `claude-code-white-release.zip`（UTF-8 文件名，包含 dsh-skin 与最新文档），同步提交至 GitHub。
- GitHub 主线整理：以 1.0 干净主线替换旧的上传式历史（README 改名、旧 zip 上传等已被取代的提交）。

## 2026-08-14

### 变更
- 桥接鉴权链路（前端换取并携带 `X-Bridge-Token`）合入后**回滚**：保持本地桥接无鉴权的简单架构，仅监听 127.0.0.1。

## 2026-08-13

### 新增
- Claude 任务栏图标（含生成脚本 `scripts/generate-icons.py`）。
- 双语文档（README / README.first）、软件声明。
- 发布脚本升级：`make-release.mjs` 原生实现 ZIP 写入，中文文件名按 UTF-8 编码（修复 Windows bsdtar GBK 乱码）。

### 里程碑
- **Claude Code White 1.0（干净历史基线）**：基于 ef57760 整理。完整功能：工具可视化、按回答自动折叠流程、实时 tokens、记忆读写、一键桥接（同源拉起独立桥接进程）、管理员快捷方式、会话并排/搜索/恢复、用量与额度面板（本地统计 + DeepSeek 平台快照导入）。
