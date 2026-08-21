"use client";
/* eslint-disable @next/next/no-img-element -- Local image data URLs should bypass the remote image optimizer. */

import { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type BridgeStatus = { bridge: boolean; bridgeProtocol?: number; capabilities?: string[]; claudeInstalled: boolean; claudeVersion?: string; claudePath?: string; cwd?: string };
type TimelineItem = { kind: "thinking" | "tool" | "file" | "result"; title: string; detail: string; state?: "done" | "running" };
type ToolCall = { id: string; name: string; input: string; state: "running" | "done" | "error"; result?: string };
type Usage = { input: number; output: number; cache: number; cost: number };
type MessageImage = { id: string; name: string; mediaType: string; dataUrl: string };
type DraftImage = MessageImage & { size: number; data: string };
type QueuedTurn = { id: string; body: string; images: DraftImage[]; createdAt: number; state?: "queued" | "steering" | "steered" };
type Message = { id: string; role: "user" | "assistant"; body: string; images?: MessageImage[]; timeline?: TimelineItem[]; tools?: ToolCall[]; processOpen?: boolean; elapsedMs?: number; usage?: { input: number; output: number; cache: number; cost: number } };
type PermissionMode = "plan" | "manual" | "acceptEdits" | "auto" | "dontAsk";
type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
type Session = {
  id: string;
  title: string;
  projectPath: string;
  model: string;
  permissionMode: PermissionMode;
  effort: EffortLevel;
  claudeSessionId: string | null;
  draft: string;
  sending: boolean;
  messages: Message[];
  usage: Usage;
};
type Provider = {
  id: string;
  name: string;
  configured: boolean;
  state: "ready" | "missing" | "limited" | "error";
  summary: string;
  detail?: string;
  balances?: Array<{ currency: string; total: string; granted?: string; toppedUp?: string }>;
  href?: string;
};
type DeepSeekModelUsage = {
  model: string;
  requests: number;
  tokens: number;
  promptCacheHitToken: number | null;
  promptCacheMissToken: number | null;
  responseToken: number | null;
  cost: number | null;
};
type DeepSeekAnalytics = {
  source: string;
  sourceLabel: string;
  updatedAt: string;
  range: { label: string; start: string; end: string };
  summary: { currency: string; cost: number; requests: number; tokens: number };
  models: DeepSeekModelUsage[];
  precision: { requests: string; tokens: string; totalCost: string; modelCost: string; dailySeries: string };
  note: string;
};
type ChangeEntry = { status: string; file: string; path: string; previousPath?: string };
type WorkspaceChanges = { isGit: boolean; root?: string; branch?: string; entries: ChangeEntry[]; stat?: string };
type DiffPayload = { file: string; diff: string; additions: number; deletions: number; binary: boolean; truncated: boolean };
type TreeEntry = { name: string; type: "dir" | "file" };
type TreePayload = { root: string; dir: string; entries: TreeEntry[]; truncated?: boolean };
type FilePayload = { name: string; content: string; lines: number; size: number };
type BridgeLogEntry = { t: number; level: string; message: string };
type MemoryEntry = { file: string; name: string; description: string; type: string; body: string };
type MemoryWorkspace = { id: string; label: string; index: string[] | null; entries: MemoryEntry[] };
type MemoryPayload = { workspaces: MemoryWorkspace[] };
type MemoryWorkspaceOption = { id: string; label: string };
type MemoryForm = { open: boolean; workspaceId: string; name: string; description: string; type: string; body: string; editingFile: string | null; saving: boolean };
type HistorySession = { id: string; projectId: string; cwd: string; slug: string; title: string; preview: string; model: string; updatedAt: string; size: number };
type HistoryDetail = { id: string; projectId: string; cwd: string; model: string; title: string; messages: Array<{ role: "user" | "assistant"; body: string; timestamp: string | null }>; truncated: boolean };
type BrowserSpeechResult = { isFinal: boolean; 0: { transcript: string } };
type BrowserSpeechEvent = Event & { resultIndex: number; results: ArrayLike<BrowserSpeechResult> };
type BrowserSpeechErrorEvent = Event & { error: string; message?: string };
type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type CommandId = "new" | "history" | "changes" | "files" | "terminal" | "memory" | "inspector" | "theme";

const MEMORY_TYPE_LABEL: Record<string, string> = { user: "用户", feedback: "反馈", project: "项目", reference: "参考" };
const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet", description: "日常编码首选，速度与能力均衡", badge: "S" },
  { value: "opus", label: "Opus", description: "复杂架构、深度分析与高难度任务", badge: "O" },
  { value: "haiku", label: "Haiku", description: "响应最快，适合轻量修改与查询", badge: "H" },
];
const PERMISSION_OPTIONS: Array<{ value: PermissionMode; label: string; short: string; icon: string; description: string }> = [
  { value: "plan", label: "仅规划", short: "仅规划", icon: "◇", description: "只分析和制定方案，不修改文件或执行命令" },
  { value: "manual", label: "操作前批准", short: "需批准", icon: "◐", description: "Claude 请求操作许可；未批准的操作不会执行" },
  { value: "acceptEdits", label: "自动批准编辑", short: "自动编辑", icon: "✎", description: "文件编辑自动执行，命令和敏感操作仍受限制" },
  { value: "auto", label: "智能批准", short: "智能批准", icon: "✦", description: "由 Claude Code 根据风险自动判断是否需要批准" },
  { value: "dontAsk", label: "不询问（受限）", short: "不询问", icon: "⊘", description: "不弹出批准请求；未获授权的操作会直接拒绝" },
];
const EFFORT_OPTIONS: Array<{ value: EffortLevel; label: string; short: string; bars: number; description: string }> = [
  { value: "low", label: "快速", short: "快速", bars: 1, description: "较短思考，适合简单修改和明确问题" },
  { value: "medium", label: "标准", short: "标准", bars: 2, description: "速度与质量均衡，适合日常编码" },
  { value: "high", label: "深入", short: "深入", bars: 3, description: "增加推理投入，适合调试和复杂实现" },
  { value: "xhigh", label: "极强", short: "极强", bars: 4, description: "更长时间分析，适合架构和困难问题" },
  { value: "max", label: "最大", short: "最大", bars: 5, description: "使用最大推理投入，速度最慢且消耗更高" },
];
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp";
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
const REQUIRED_BRIDGE_PROTOCOL = 9;

function readDraftImage(file: File): Promise<DraftImage> {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const separator = dataUrl.indexOf(",");
      if (separator < 0) { reject(new Error(`无法读取图片：${file.name}`)); return; }
      resolvePromise({ id: crypto.randomUUID(), name: file.name || "剪贴板图片", mediaType: file.type, size: file.size, dataUrl, data: dataUrl.slice(separator + 1) });
    };
    reader.readAsDataURL(file);
  });
}

// 同源优先（npm run dev 已内置桥接），回退到独立桥接进程 4318（生产模式）。
let BRIDGE_BASE = "http://127.0.0.1:4318";
async function probeBridgeBase() {
  try {
    const response = await fetch("/api/status", { signal: AbortSignal.timeout(1200) });
    if (response.ok) { BRIDGE_BASE = ""; return true; }
  } catch { /* 同源无桥接时回退独立端口 */ }
  return false;
}
function api(path: string) { return `${BRIDGE_BASE}${path}`; }
const welcome: Message = {
  id: "welcome",
  role: "assistant",
  body: "工作区已经连接。你可以让我阅读代码、规划改动、运行测试，或把另一个任务并排打开。每个窗格都是独立的 Claude Code 会话。",
  processOpen: false,
  timeline: [
    { kind: "thinking", title: "读取工作区", detail: "已建立本地项目上下文", state: "done" },
    { kind: "file", title: "安全模式", detail: "默认使用计划模式，写入前由 Claude Code 请求许可", state: "done" },
  ],
};

function makeSession(id: string, title: string, projectPath = ""): Session {
  return {
    id, title, projectPath, model: "sonnet", permissionMode: "plan", effort: "medium", claudeSessionId: null,
    draft: "", sending: false, messages: [welcome], usage: { input: 0, output: 0, cache: 0, cost: 0 },
  };
}

function normalizeWorkspacePath(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function workspaceName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || "未选择工作区";
}

function mergeVoiceDraft(base: string, transcript: string) {
  const spoken = transcript.trim();
  if (!spoken) return base;
  const needsSpace = Boolean(base) && !/\s$/.test(base) && !/[\u3400-\u9fff]$/.test(base) && !/^[\u3400-\u9fff]/.test(spoken);
  return `${base}${needsSpace ? " " : ""}${spoken}`;
}

const initialSessions = [
  makeSession("session-main", "完善 Claude Code 桌面端"),
  makeSession("session-tests", "运行测试并检查问题"),
  makeSession("session-docs", "整理发布说明"),
];

function ClaudeMark({ small = false }: { small?: boolean }) {
  return <span className={`claude-mark ${small ? "small" : ""}`} aria-hidden="true"/>;
}

type UiIconName = "plus" | "chat" | "search" | "history" | "folder" | "changes" | "split" | "edit" | "trash" | "usage" | "send" | "stop" | "workspace" | "microphone" | "sidebarCollapse" | "sidebarExpand";

function UiIcon({ name, size = 16 }: { name: UiIconName; size?: number }) {
  const paths: Record<UiIconName, React.ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chat: <><path d="M5 6.5h14v9.5H9l-4 3v-12.5Z"/></>,
    search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></>,
    history: <><path d="M4.5 8.5A8 8 0 1 1 5 16M4.5 4.5v4h4"/><path d="M12 8v4l3 2"/></>,
    folder: <><path d="M3.5 6.5h6l2 2h9v9.5h-17Z"/></>,
    changes: <><path d="M7 4v14M17 6v14M4.5 7 7 4l2.5 3M14.5 17 17 20l2.5-3"/></>,
    split: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M12 5v14"/></>,
    edit: <><path d="m5 17-.5 3 3-.5L18 7l-2.5-2.5Z"/><path d="m13.5 6.5 2.5 2.5"/></>,
    trash: <><path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13M10 10v6M14 10v6"/></>,
    usage: <><path d="M5 18V11M10 18V7M15 18V4M20 18V9"/></>,
    send: <><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></>,
    stop: <><rect x="7" y="7" width="10" height="10" rx="2"/></>,
    workspace: <><path d="M4 7.5h6l2 2h8v9H4Z"/><path d="M4 7.5V5h6l2 2.5"/></>,
    microphone: <><rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3M9 20h6"/></>,
    sidebarCollapse: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15M16 9l-3 3 3 3"/></>,
    sidebarExpand: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15M13 9l3 3-3 3"/></>,
  };
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function IconButton({ label, children, onClick, active = false }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return <button type="button" className={`icon-button ${active ? "active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function SidebarToggle({ expanded, onClick, placement }: { expanded: boolean; onClick: () => void; placement: "sidebar" | "topbar" }) {
  const label = expanded ? "收起侧栏" : "展开侧栏";
  return <button type="button" className={`sidebar-toggle-button in-${placement}`} aria-label={`${label}（Ctrl+B）`} title={`${label}（Ctrl+B）`} aria-expanded={expanded} onClick={onClick}>
    <UiIcon name={expanded ? "sidebarCollapse" : "sidebarExpand"} size={17}/>
  </button>;
}

function closeControlMenu(event: React.MouseEvent<HTMLButtonElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

function keepOnlyOneControlOpen(event: React.SyntheticEvent<HTMLDetailsElement>) {
  const current = event.currentTarget;
  if (!current.open) return;
  current.closest(".composer")?.querySelectorAll<HTMLDetailsElement>("details.composer-control[open]").forEach((control) => {
    if (control !== current) control.open = false;
  });
}

function PermissionControl({ value, sending, onChange }: { value: PermissionMode; sending: boolean; onChange: (value: PermissionMode) => void }) {
  const selected = PERMISSION_OPTIONS.find((option) => option.value === value) || PERMISSION_OPTIONS[0];
  return <details className="composer-control permission-control" onToggle={keepOnlyOneControlOpen}>
    <summary title={`批准策略：${selected.label}`}><span className="control-glyph">{selected.icon}</span><span>{selected.short}</span><i>⌄</i></summary>
    <div className="control-popover permission-popover">
      <header><strong>批准策略</strong><span>{sending ? "更改将在下一轮生效" : "控制 Claude Code 可以执行的操作"}</span></header>
      <div>{PERMISSION_OPTIONS.map((option) => <button type="button" className={option.value === value ? "selected" : ""} key={option.value} onClick={(event) => { onChange(option.value); closeControlMenu(event); }}>
        <span className="control-option-icon">{option.icon}</span><span><strong>{option.label}</strong><small>{option.description}</small></span>{option.value === value && <b>✓</b>}
      </button>)}</div>
      <footer>“不询问”不会绕过安全限制；被限制的操作会直接拒绝。</footer>
    </div>
  </details>;
}

function ClaudeSettingsControl({ model, effort, sending, onModelChange, onEffortChange }: { model: string; effort: EffortLevel; sending: boolean; onModelChange: (value: string) => void; onEffortChange: (value: EffortLevel) => void }) {
  const selectedModel = MODEL_OPTIONS.find((option) => option.value === model) || MODEL_OPTIONS[0];
  const selectedEffort = EFFORT_OPTIONS.find((option) => option.value === effort) || EFFORT_OPTIONS[1];
  const effortIndex = Math.max(0, EFFORT_OPTIONS.findIndex((option) => option.value === selectedEffort.value));
  const effortStep = 100 / Math.max(1, EFFORT_OPTIONS.length - 1);
  const [panel, setPanel] = useState<"quick" | "main" | "model" | "effort">("quick");
  const [sliderActive, setSliderActive] = useState(false);
  const [sliderValue, setSliderValue] = useState(effortIndex * effortStep);
  const sliderValueRef = useRef(effortIndex * effortStep);
  function applySliderDetent(nextValue: number) {
    const raw = Math.max(0, Math.min(100, nextValue));
    const nearestIndex = Math.max(0, Math.min(EFFORT_OPTIONS.length - 1, Math.round(raw / effortStep)));
    const stop = nearestIndex * effortStep;
    const detentRadius = 4.5;
    const distance = raw - stop;
    if (Math.abs(distance) <= detentRadius) return stop;
    const segmentStart = Math.max(0, stop - effortStep / 2);
    const segmentEnd = Math.min(100, stop + effortStep / 2);
    if (distance < 0) {
      const travel = stop - detentRadius - segmentStart;
      return travel <= 0 ? stop : segmentStart + (raw - segmentStart) / travel * (stop - segmentStart);
    }
    const travel = segmentEnd - stop - detentRadius;
    return travel <= 0 ? stop : stop + (raw - stop - detentRadius) / travel * (segmentEnd - stop);
  }
  function updateSlider(nextValue: number) {
    const bounded = applySliderDetent(nextValue);
    const nextIndex = Math.max(0, Math.min(EFFORT_OPTIONS.length - 1, Math.round(bounded / effortStep)));
    sliderValueRef.current = bounded;
    setSliderValue(bounded);
    if (EFFORT_OPTIONS[nextIndex].value !== selectedEffort.value) onEffortChange(EFFORT_OPTIONS[nextIndex].value);
  }
  function settleSlider() {
    const nextIndex = Math.max(0, Math.min(EFFORT_OPTIONS.length - 1, Math.round(sliderValueRef.current / effortStep)));
    const snapped = nextIndex * effortStep;
    sliderValueRef.current = snapped;
    setSliderValue(snapped);
    setSliderActive(false);
    if (EFFORT_OPTIONS[nextIndex].value !== selectedEffort.value) onEffortChange(EFFORT_OPTIONS[nextIndex].value);
  }
  return <details className="composer-control claude-settings-control" onToggle={(event) => { keepOnlyOneControlOpen(event); if (event.currentTarget.open) { const snapped = effortIndex * effortStep; setPanel("quick"); setSliderActive(false); sliderValueRef.current = snapped; setSliderValue(snapped); } else settleSlider(); }}>
    <summary className={`effort-size-${effortIndex}`} title={`选择模型与思考强度：${selectedModel.label} · ${selectedEffort.label}（Ctrl+Shift+M）`}><span className="settings-bolt" aria-hidden="true">✦</span><span>{selectedModel.label} · {selectedEffort.short}</span><i>⌄</i></summary>
    <div className={`control-popover claude-settings-popover panel-${panel}`}>
      {panel === "quick" ? <div className={`effort-quick-panel ${sliderActive ? "adjusting" : ""}`}>
        <div className="effort-quick-heading">{sliderActive ? <><span>更高效</span><span>更智能</span></> : <><button type="button" onClick={() => setPanel("main")}>高级 <i>›</i></button><b aria-hidden="true">✦</b></>}</div>
        <div className="ion-slider">
          <span className="ion-slider-start-cap" aria-hidden="true"/>
          <span className="ion-slider-fill" style={{ clipPath: `inset(0 ${100 - sliderValue}% 0 0)` }}><span className="ion-particles" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index}/>)}</span></span>
          <span className="ion-slider-stops" aria-hidden="true">{EFFORT_OPTIONS.map((option, index) => <i className={index * effortStep <= sliderValue ? "passed" : ""} key={option.value}/>)}</span>
          <input type="range" min="0" max="100" step="0.1" value={sliderValue} aria-label="快速调整思考强度" aria-valuetext={selectedEffort.label} onChange={(event) => updateSlider(Number(event.currentTarget.value))} onKeyDown={(event) => { const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0; if (direction) { event.preventDefault(); updateSlider(Math.round(sliderValue / effortStep) * effortStep + direction * effortStep); settleSlider(); } }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setSliderActive(true); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); settleSlider(); }} onPointerCancel={settleSlider} onBlur={settleSlider}/>
        </div>
      </div> : panel === "main" ? <>
        <div className="settings-overview">
          <button type="button" onClick={() => setPanel("model")}><span>模型</span><b>{selectedModel.label}</b><i>›</i></button>
          <button type="button" onClick={() => setPanel("effort")}><span>思考强度</span><b>{selectedEffort.label}</b><i>›</i></button>
        </div>
        <footer>{sending ? "更改将从下一轮推理生效" : "这些设置仅作用于当前 Claude Code 会话"}</footer>
      </> : <>
        <header className="settings-subheader"><button type="button" aria-label="返回会话设置" onClick={() => setPanel("main")}>‹</button><span><strong>{panel === "model" ? "选择模型" : "思考强度"}</strong><small>{panel === "model" ? "选择下一轮使用的 Claude 模型" : "控制后续任务的推理投入"}</small></span></header>
        <div>{panel === "model" ? MODEL_OPTIONS.map((option) => <button type="button" className={option.value === model ? "selected" : ""} key={option.value} onClick={() => { onModelChange(option.value); setPanel("main"); }}>
          <span className="model-option-icon"><i aria-hidden="true"/>{option.badge}</span><span><strong>{option.label}</strong><small>{option.description}</small></span>{option.value === model && <b>✓</b>}
        </button>) : EFFORT_OPTIONS.map((option, optionIndex) => <button type="button" className={option.value === effort ? "selected" : ""} key={option.value} onClick={() => { const snapped = optionIndex * effortStep; onEffortChange(option.value); sliderValueRef.current = snapped; setSliderValue(snapped); setPanel("main"); }}>
          <span className="effort-option-bars">{[1,2,3,4,5].map((bar) => <i className={bar <= option.bars ? "on" : ""} key={bar}/>)}</span><span><strong>{option.label}</strong><small>{option.description}</small></span>{option.value === effort && <b>✓</b>}
        </button>)}</div>
      </>}
    </div>
  </details>;
}

function ToolTimeline({ items }: { items: TimelineItem[] }) {
  const glyph = { thinking: "◌", tool: ">_", file: "◇", result: "✓" };
  return <div className="timeline">{items.map((item, index) => (
    <div className="timeline-row" key={`${item.title}-${index}`}>
      <span className={`timeline-icon ${item.state === "running" ? "running" : ""}`}>{glyph[item.kind]}</span>
      <div><strong>{item.title}</strong><span>{item.detail}</span></div>
    </div>
  ))}</div>;
}

function ProcessFlow({ message, onToggle }: { message: Message; onToggle: () => void }) {
  const timeline = message.timeline || [];
  const tools = message.tools || [];
  if (timeline.length === 0 && tools.length === 0) return null;
  const runningTool = tools.find((tool) => tool.state === "running");
  const latestStep = [...timeline].reverse().find((item) => item.state === "running") || timeline[timeline.length - 1];
  const running = Boolean(runningTool || latestStep?.state === "running") && message.elapsedMs === undefined;
  const failures = tools.filter((tool) => tool.state === "error").length;
  const stepCount = timeline.length;
  const summary = running ? (runningTool ? `正在运行 ${runningTool.name}` : latestStep?.title || "Claude 正在工作") : failures > 0 ? "流程完成，部分操作失败" : "流程已完成";
  return <section className={`process-flow ${running ? "running" : "done"} ${message.processOpen ? "open" : ""}`}>
    <header className="process-summary">
      <span className="process-status" aria-hidden="true">{running ? <i/> : failures > 0 ? "!" : "✓"}</span>
      <div><strong>{summary}</strong><small>{stepCount} 个步骤{tools.length > 0 ? ` · ${tools.length} 个工具调用` : ""}{message.elapsedMs !== undefined ? ` · ${formatElapsed(message.elapsedMs)}` : ""}</small></div>
      <button type="button" className="process-toggle" aria-expanded={Boolean(message.processOpen)} onClick={onToggle}>{message.processOpen ? "收起详情" : "查看流程详情"}<span>{message.processOpen ? "⌃" : "⌄"}</span></button>
    </header>
    {message.processOpen && <div className="process-details">
      {timeline.length > 0 && <ToolTimeline items={timeline}/>}
      {tools.length > 0 && <div className="tool-list">{tools.map((tool) => <details className={`tool-card ${tool.state}`} key={tool.id} open={tool.state === "running"}>
        <summary><span className={`tool-dot ${tool.state}`}/><b>{tool.name}</b>{tool.state === "running" ? <em>执行中…</em> : tool.state === "error" ? <em className="tool-fail">失败</em> : tool.result ? <small>{Math.max(1, Math.round(tool.result.length / 1024 * 10) / 10)} KB</small> : null}</summary>
        {tool.input && tool.input !== "{}" && <pre className="tool-input">{tool.input.slice(0, 4000)}</pre>}
        {tool.result && <pre className={`tool-result ${tool.state === "error" ? "fail" : ""}`}>{tool.result.slice(0, 6000)}</pre>}
      </details>)}</div>}
      <footer className="process-collapse-footer"><button type="button" onClick={onToggle}>收起流程 <span aria-hidden="true">⌃</span></button></footer>
    </div>}
  </section>;
}

function formatElapsed(ms: number | undefined) {
  if (!Number.isFinite(ms) || ms === undefined || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
}

function formatTokens(n: number | undefined) {
  if (!n || n <= 0) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function modelFamily(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("opus") ? "opus" : normalized.includes("haiku") ? "haiku" : "sonnet";
}

function normalizeEvent(event: Record<string, unknown>) {
  const next: { text?: string; sessionId?: string; timeline?: TimelineItem; usage?: Partial<Usage>; tools?: ToolCall[]; toolResults?: Array<{ id: string; content: string; error: boolean }> } = {};
  if (event.type === "bridge_error") next.text = `\n\n${String(event.message || "Claude Code 调用失败")}`;
  if (event.type === "system" && event.subtype === "init") {
    next.sessionId = typeof event.session_id === "string" ? event.session_id : undefined;
    next.timeline = { kind: "thinking", title: "会话已连接", detail: "正在分析项目上下文", state: "done" };
  }
  if (event.type === "assistant" && event.message && typeof event.message === "object") {
    const message = event.message as { content?: Array<{ type?: string; text?: string; name?: string; id?: string; input?: unknown }>; usage?: Record<string, number> };
    next.text = message.content?.filter((part) => part.type === "text").map((part) => part.text || "").join("") || "";
    const tools = message.content?.filter((part) => part.type === "tool_use") || [];
    if (tools.length) {
      next.tools = tools.map((tool) => ({
        id: tool.id || `${tool.name}-${Math.random()}`,
        name: tool.name || "调用工具",
        input: JSON.stringify(tool.input ?? {}, null, 2),
        state: "running",
      }));
      next.timeline = { kind: "tool", title: `调用 ${tools.map((tool) => tool.name).join("、")}`, detail: "正在执行", state: "running" };
    }
    if (message.usage) next.usage = {
      input: message.usage.input_tokens || 0,
      output: message.usage.output_tokens || 0,
      cache: (message.usage.cache_read_input_tokens || 0) + (message.usage.cache_creation_input_tokens || 0),
    };
  }
  if (event.type === "user" && event.message && typeof event.message === "object") {
    const message = event.message as { content?: Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> };
    const results = message.content?.filter((part) => part.type === "tool_result") || [];
    if (results.length) {
      next.toolResults = results.map((part) => {
        const raw = part.content;
        const content = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
        return { id: part.tool_use_id || "", content: content.slice(0, 6000), error: Boolean(part.is_error) };
      });
    }
  }
  if (event.type === "result") {
    next.sessionId = typeof event.session_id === "string" ? event.session_id : undefined;
    next.timeline = { kind: "result", title: "任务完成", detail: "结果已写入当前会话", state: "done" };
    next.usage = { cost: typeof event.total_cost_usd === "number" ? event.total_cost_usd : 0 };
  }
  return next;
}

export default function Home() {
  const [status, setStatus] = useState<BridgeStatus>({ bridge: false, claudeInstalled: false });
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [visibleIds, setVisibleIds] = useState<string[]>(["session-main", "session-tests"]);
  const [activeId, setActiveId] = useState("session-main");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"changes" | "files" | "terminal" | "memory">("changes");
  const [usageOpen, setUsageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSelected, setCommandSelected] = useState(0);
  const [usageGroupBy, setUsageGroupBy] = useState<"model" | "apiKey">("model");
  const [usageSwitchProgress, setUsageSwitchProgress] = useState(0);
  const [usageSwitchDragging, setUsageSwitchDragging] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [deepseekAnalytics, setDeepseekAnalytics] = useState<DeepSeekAnalytics | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const aborters = useRef(new Map<string, AbortController>());
  const activeAssistantIdsRef = useRef(new Map<string, string>());
  const conversationRefs = useRef(new Map<string, HTMLDivElement | null>());
  const stickToBottomRef = useRef(new Map<string, boolean>());
  const usageDragRef = useRef<{ startX: number; startProgress: number; progress: number; travel: number; moved: boolean; left: number; width: number } | null>(null);
  const usageWasDragged = useRef(false);
  const queueLaunchingRef = useRef(new Set<string>());
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechSessionIdRef = useRef<string | null>(null);
  const speechDraftBaseRef = useRef("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [changes, setChanges] = useState<WorkspaceChanges | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [selectedChange, setSelectedChange] = useState<string | null>(null);
  const [diffPreview, setDiffPreview] = useState<DiffPayload | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [treeLoadingDir, setTreeLoadingDir] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePayload | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [logs, setLogs] = useState<BridgeLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryPayload | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [bridgeStarting, setBridgeStarting] = useState(false);
  const [truncatedDirs, setTruncatedDirs] = useState<Set<string>>(new Set());
  const [memoryWorkspaces, setMemoryWorkspaces] = useState<MemoryWorkspaceOption[]>([]);
  const [memoryForm, setMemoryForm] = useState<MemoryForm>({ open: false, workspaceId: "", name: "", description: "", type: "project", body: "", editingFile: null, saving: false });
  const [draftImages, setDraftImages] = useState<Record<string, DraftImage[]>>({});
  const [imageNotices, setImageNotices] = useState<Record<string, string>>({});
  const [imageDragSessionId, setImageDragSessionId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<MessageImage | null>(null);
  const [queuedTurns, setQueuedTurns] = useState<Record<string, QueuedTurn[]>>({});
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(new Set());
  const [folderPickingId, setFolderPickingId] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [usageProviderOpen, setUsageProviderOpen] = useState<string>("deepseek");
  const [listeningSessionId, setListeningSessionId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedTheme = localStorage.getItem("claude-code-theme");
        const storedSessions = localStorage.getItem("claude-code-sessions");
        const storedSidebar = localStorage.getItem("claude-code-sidebar-collapsed");
        if (storedTheme === "dark" || storedTheme === "light") setTheme(storedTheme);
        if (storedSidebar === "true") setSidebarCollapsed(true);
        if (storedSessions) {
          const parsed = JSON.parse(storedSessions) as { sessions: Session[]; visibleIds: string[]; activeId: string };
          if (parsed.sessions?.length) {
            setSessions(parsed.sessions.map((session) => ({ ...session, sending: false, draft: session.draft || "", messages: (session.messages || [welcome]).map((message) => ({ ...message, images: undefined })), effort: EFFORT_OPTIONS.some((option) => option.value === session.effort) ? session.effort : "medium", permissionMode: String(session.permissionMode) === "default" ? "manual" : PERMISSION_OPTIONS.some((option) => option.value === session.permissionMode) ? session.permissionMode : "plan" })));
            setVisibleIds(parsed.visibleIds?.slice(0, 3) || [parsed.sessions[0].id]);
            setActiveId(parsed.activeId || parsed.sessions[0].id);
          }
        }
      } catch { /* Ignore stale device-local state. */ }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    speechSessionIdRef.current = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* Recognition may already be closed. */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("claude-code-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!hydrated) return;
    // 图片只停留在当前运行中的本机会话，不把体积较大的 base64 写入 localStorage。
    const persistableSessions = sessions.map((session) => ({ ...session, messages: session.messages.map((message) => {
      const persistable = { ...message };
      delete persistable.images;
      return persistable;
    }) }));
    localStorage.setItem("claude-code-sessions", JSON.stringify({ sessions: persistableSessions, visibleIds, activeId }));
  }, [sessions, visibleIds, activeId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("claude-code-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed, hydrated]);

  // 会话流式输出时自动跟随底部；用户向上翻历史则暂停，滚回底部附近后恢复
  function handlePaneScroll(id: string) {
    const element = conversationRefs.current.get(id);
    if (!element) return;
    stickToBottomRef.current.set(id, element.scrollHeight - element.scrollTop - element.clientHeight < 80);
  }

  useEffect(() => {
    for (const id of visibleIds) {
      const element = conversationRefs.current.get(id);
      if (element && stickToBottomRef.current.get(id) !== false) {
        element.scrollTop = element.scrollHeight;
      }
    }
  }, [sessions, visibleIds]);

  function applyStatus(next: BridgeStatus) {
    setStatus(next);
    // 会话没有显式项目目录时，回填桥接器的工作目录（桥接器从项目根启动）
    if (next.cwd) {
      setSessions((current) => current.map((session) => session.projectPath ? session : { ...session, projectPath: next.cwd as string }));
    }
  }

  useEffect(() => {
    void (async () => {
      await probeBridgeBase();
      try {
        const response = await fetch(api("/api/status"));
        applyStatus(await response.json());
      } catch { applyStatus({ bridge: false, claudeInstalled: false }); }
    })();
  }, []);

  const active = sessions.find((session) => session.id === activeId) || sessions[0];
  const visibleSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => `${session.title} ${session.projectPath}`.toLowerCase().includes(query));
  }, [sessions, searchQuery]);
  const workspaceSessionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; path: string; label: string; sessions: Session[] }>();
    for (const session of visibleSessions) {
      const key = normalizeWorkspacePath(session.projectPath) || "__unassigned__";
      const group = groups.get(key) || { key, path: session.projectPath, label: workspaceName(session.projectPath), sessions: [] };
      group.sessions.push(session);
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => {
      const leftActive = left.sessions.some((session) => session.id === activeId) ? 1 : 0;
      const rightActive = right.sessions.some((session) => session.id === activeId) ? 1 : 0;
      return rightActive - leftActive || left.label.localeCompare(right.label, "zh-CN");
    });
  }, [activeId, visibleSessions]);
  const localUsage = useMemo(() => sessions.reduce((total, session) => ({
    input: total.input + session.usage.input,
    output: total.output + session.usage.output,
    cache: total.cache + session.usage.cache,
    cost: total.cost + session.usage.cost,
  }), { input: 0, output: 0, cache: 0, cost: 0 }), [sessions]);
  const claudeModelUsage = useMemo(() => Object.values(sessions.reduce<Record<string, { model: string; input: number; output: number; cache: number; cost: number }>>((groups, session) => {
    const key = session.model || "unknown";
    const current = groups[key] || { model: key, input: 0, output: 0, cache: 0, cost: 0 };
    groups[key] = { model: key, input: current.input + session.usage.input, output: current.output + session.usage.output, cache: current.cache + session.usage.cache, cost: current.cost + session.usage.cost };
    return groups;
  }, {})), [sessions]);
  const activeProjectPath = active?.projectPath || "";
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return historySessions;
    return historySessions.filter((session) => `${session.title} ${session.preview} ${session.cwd}`.toLowerCase().includes(query));
  }, [historyQuery, historySessions]);

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const response = await fetch(api("/api/sessions"));
      const payload = await response.json().catch(() => null) as { sessions?: HistorySession[] } | null;
      setHistorySessions(response.ok ? payload?.sessions || [] : []);
    } catch { setHistorySessions([]); }
    finally { setHistoryLoading(false); }
  }

  async function restoreHistorySession(summary: HistorySession) {
    setRestoringSessionId(summary.id);
    try {
      const response = await fetch(api(`/api/sessions/detail?projectId=${encodeURIComponent(summary.projectId)}&sessionId=${encodeURIComponent(summary.id)}`));
      const detail = await response.json().catch(() => null) as (HistoryDetail & { error?: string }) | null;
      if (!response.ok || !detail) throw new Error(detail?.error || "无法恢复任务");
      const id = `session-restored-${Date.now()}`;
      const messages: Message[] = detail.messages.length ? detail.messages.map((message, index) => ({ id: `${id}-history-${index}`, role: message.role, body: message.body })) : [welcome];
      if (detail.truncated) messages.unshift({ id: `${id}-notice`, role: "assistant", body: "这段任务历史较长，当前显示最近的对话；Claude Code 的完整上下文仍会随会话一并恢复。" });
      const restored: Session = { ...makeSession(id, detail.title, detail.cwd || summary.cwd), model: modelFamily(detail.model), claudeSessionId: detail.id, messages };
      setSessions((current) => [restored, ...current]);
      setVisibleIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, Math.max(1, current.length)));
      setActiveId(id);
      setHistoryOpen(false);
    } catch (error) { window.alert(error instanceof Error ? error.message : "无法恢复任务"); }
    finally { setRestoringSessionId(null); }
  }

  const loadChanges = useCallback(async (path: string) => {
    if (!status.bridge) return;
    setChangesLoading(true);
    try {
      const response = await fetch(api(`/api/workspace/changes?path=${encodeURIComponent(path)}`));
      const next = response.ok ? await response.json() as WorkspaceChanges : null;
      setChanges(next);
      setSelectedChange((current) => current && next?.entries.some((entry) => entry.path === current) ? current : null);
      setDiffPreview((current) => current && next?.entries.some((entry) => entry.path === current.file) ? current : null);
    } catch { setChanges(null); }
    finally { setChangesLoading(false); }
  }, [status.bridge]);

  const previewDiff = useCallback(async (path: string, entry: ChangeEntry) => {
    setSelectedChange(entry.path);
    setDiffPreview(null);
    setDiffError("");
    setDiffLoading(true);
    try {
      const response = await fetch(api(`/api/workspace/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(entry.path)}&status=${encodeURIComponent(entry.status)}`));
      const payload = await response.json().catch(() => null) as (DiffPayload & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "无法读取 Diff");
      setDiffPreview(payload);
    } catch (error) { setDiffError(error instanceof Error ? error.message : "无法读取 Diff"); }
    finally { setDiffLoading(false); }
  }, []);

  const openDir = useCallback(async (path: string, dir: string) => {
    setExpandedDirs((current) => { const next = new Set(current); next.add(dir); return next; });
    setTreeLoadingDir(dir);
    try {
      const response = await fetch(api(`/api/workspace/tree?path=${encodeURIComponent(path)}&dir=${encodeURIComponent(dir)}`));
      if (response.ok) {
        const payload = await response.json() as TreePayload;
        setTreeCache((current) => ({ ...current, [dir]: payload.entries }));
        if (payload.truncated) setTruncatedDirs((current) => new Set(current).add(dir));
      }
    } catch { /* 目录读取失败时保持为空 */ }
    finally { setTreeLoadingDir(null); }
  }, []);

  const closeDir = useCallback((dir: string) => {
    setExpandedDirs((current) => { const next = new Set(current); next.delete(dir); return next; });
  }, []);

  const previewFile = useCallback(async (path: string, file: string) => {
    setFilePreviewLoading(true);
    setFilePreview(null);
    try {
      const response = await fetch(api(`/api/workspace/file?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}`));
      if (response.ok) setFilePreview(await response.json());
    } catch { /* 读取失败时忽略 */ }
    finally { setFilePreviewLoading(false); }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const response = await fetch(api("/api/logs"));
      if (response.ok) { const payload = await response.json() as { logs: BridgeLogEntry[] }; setLogs(payload.logs || []); }
    } catch { /* 桥接器未启动时忽略 */ }
  }, []);

  const loadMemories = useCallback(async () => {
    if (!status.bridge) return;
    setMemoriesLoading(true);
    try {
      const response = await fetch(api("/api/memory"));
      setMemories(response.ok ? await response.json() as MemoryPayload : null);
    } catch { setMemories(null); }
    finally { setMemoriesLoading(false); }
  }, [status.bridge]);

  async function loadMemoryWorkspaces() {
    try {
      const response = await fetch(api("/api/memory/workspaces"));
      if (response.ok) {
        const payload = await response.json() as { workspaces: MemoryWorkspaceOption[] };
        setMemoryWorkspaces(payload.workspaces || []);
      }
    } catch { /* 桥接未连接时保持空列表 */ }
  }

  function openNewMemory() {
    setMemoryForm({ open: true, workspaceId: memoryWorkspaces[0]?.id || "", name: "", description: "", type: "project", body: "", editingFile: null, saving: false });
    void loadMemoryWorkspaces();
  }

  async function editMemory(workspaceId: string, entry: MemoryEntry) {
    setMemoryForm({ open: true, workspaceId, name: entry.name, description: entry.description, type: entry.type, body: entry.body, editingFile: entry.file, saving: false });
    // 列表里的正文是截断预览，编辑时拉取完整内容
    try {
      const response = await fetch(api(`/api/memory/file?workspaceId=${encodeURIComponent(workspaceId)}&file=${encodeURIComponent(entry.file)}`));
      if (response.ok) {
        const payload = await response.json() as { content: string };
        const match = payload.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
        const body = match ? payload.content.slice(match[0].length).trim() : payload.content.trim();
        setMemoryForm((current) => ({ ...current, body }));
      }
    } catch { /* 读取失败时沿用截断正文 */ }
    void loadMemoryWorkspaces();
  }

  async function saveMemory() {
    const form = memoryForm;
    if (!form.workspaceId || !form.name.trim()) return;
    setMemoryForm((current) => ({ ...current, saving: true }));
    try {
      const response = await fetch(api("/api/memory"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: form.workspaceId,
          name: form.name.trim(),
          description: form.description.trim(),
          type: form.type,
          body: form.body,
          ...(form.editingFile ? { file: form.editingFile } : {}),
        }),
      });
      if (response.ok) {
        setMemoryForm({ open: false, workspaceId: "", name: "", description: "", type: "project", body: "", editingFile: null, saving: false });
        await loadMemories();
      } else {
        const payload = await response.json().catch(() => null);
        window.alert(payload?.error ? `保存失败：${payload.error}` : "保存失败");
      }
    } catch { window.alert("保存失败：桥接未连接"); }
    finally { setMemoryForm((current) => ({ ...current, saving: false })); }
  }

  async function removeMemory(workspaceId: string, entry: MemoryEntry) {
    if (!window.confirm(`删除记忆「${entry.name}」？${entry.file} 会从本机移除。`)) return;
    try {
      await fetch(api(`/api/memory?workspaceId=${encodeURIComponent(workspaceId)}&file=${encodeURIComponent(entry.file)}`), { method: "DELETE" });
      await loadMemories();
    } catch { /* 桥接未连接时忽略 */ }
  }

  useEffect(() => {
    if (!status.bridge || !activeProjectPath) return;
    // 项目切换时先清空旧数据再加载；延迟到下一帧，避免连锁渲染
    const timer = window.setTimeout(() => {
      setChanges(null);
      setSelectedChange(null);
      setDiffPreview(null);
      setDiffError("");
      setTreeCache({});
      setExpandedDirs(new Set());
      setFilePreview(null);
      void loadChanges(activeProjectPath);
      void openDir(activeProjectPath, "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeProjectPath, status.bridge, loadChanges, openDir]);

  useEffect(() => {
    if (!inspector || inspectorTab !== "terminal" || !status.bridge) return;
    const first = window.setTimeout(() => { void refreshLogs(); }, 100);
    const timer = window.setInterval(() => { void refreshLogs(); }, 2500);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [inspector, inspectorTab, status.bridge, refreshLogs]);

  useEffect(() => {
    if (inspectorTab !== "memory") return;
    const timer = window.setTimeout(() => { void loadMemories(); }, 0);
    return () => window.clearTimeout(timer);
  }, [inspectorTab, loadMemories]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommandOpen(false);
        setHistoryOpen(false);
        setUsageOpen(false);
        setPreviewImage(null);
        setMobileSidebar(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (window.matchMedia("(max-width: 820px)").matches) setMobileSidebar((value) => !value);
        else setSidebarCollapsed((value) => !value);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandQuery("");
        setCommandSelected(0);
        setCommandOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        const control = document.querySelector<HTMLDetailsElement>(".session-pane.active .claude-settings-control");
        if (control) control.open = !control.open;
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        newSession();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  async function recheckStatus() {
    await probeBridgeBase();
    try {
      const response = await fetch(api("/api/status"));
      applyStatus(await response.json());
    } catch { applyStatus({ bridge: false, claudeInstalled: false }); }
  }

  async function startBridge() {
    setBridgeStarting(true);
    // 1) 优先让同源宿主拉起独立桥接（dev server 挂载了桥接端点；生产模式 npm run start 已自动拉起）
    try {
      const sameOrigin = await fetch("/api/bridge/start", { method: "POST", signal: AbortSignal.timeout(1500) });
      if (sameOrigin.ok) await probeBridgeBase();
    } catch { /* 同源无桥接端点（如生产页面）时忽略 */ }
    // 2) 轮询独立桥接端口直到就绪（约 8s），就绪后切到独立桥接
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 1000));
      try {
        const response = await fetch("http://127.0.0.1:4318/api/status", { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          BRIDGE_BASE = "http://127.0.0.1:4318";
          applyStatus(await response.json());
          setBridgeStarting(false);
          return;
        }
      } catch { /* 桥接尚未就绪，继续等待 */ }
    }
    setBridgeStarting(false);
    await recheckStatus();
  }

  async function addDraftImages(id: string, incoming: File[]) {
    const files = incoming.filter((file): file is File => file instanceof File);
    if (!files.length) return;
    const existing = draftImages[id] || [];
    const unsupported = files.find((file) => !IMAGE_MEDIA_TYPES.has(file.type));
    const tooLarge = files.find((file) => file.size > MAX_IMAGE_BYTES);
    const nextTotal = existing.reduce((sum, image) => sum + image.size, 0) + files.reduce((sum, file) => sum + file.size, 0);
    let notice = "";
    if (unsupported) notice = `${unsupported.name || "所选文件"} 不是支持的图片格式。请选择 JPG、PNG、GIF 或 WebP。`;
    else if (existing.length + files.length > MAX_IMAGES_PER_MESSAGE) notice = `每次最多上传 ${MAX_IMAGES_PER_MESSAGE} 张图片。`;
    else if (tooLarge) notice = `${tooLarge.name} 超过单张 5 MB 的限制。`;
    else if (nextTotal > MAX_IMAGE_TOTAL_BYTES) notice = "本次图片总大小不能超过 20 MB。";
    if (notice) { setImageNotices((current) => ({ ...current, [id]: notice })); return; }
    try {
      const additions = await Promise.all(files.map(readDraftImage));
      setDraftImages((current) => ({ ...current, [id]: [...(current[id] || []), ...additions] }));
      setImageNotices((current) => ({ ...current, [id]: "" }));
    } catch (error) {
      setImageNotices((current) => ({ ...current, [id]: error instanceof Error ? error.message : "图片读取失败，请重新选择。" }));
    }
  }

  function closeSidebar() {
    if (window.matchMedia("(max-width: 820px)").matches) setMobileSidebar(false);
    else setSidebarCollapsed(true);
  }

  function openSidebar() {
    if (window.matchMedia("(max-width: 820px)").matches) setMobileSidebar(true);
    else setSidebarCollapsed(false);
  }

  function removeDraftImage(id: string, imageId: string) {
    setDraftImages((current) => ({ ...current, [id]: (current[id] || []).filter((image) => image.id !== imageId) }));
    setImageNotices((current) => ({ ...current, [id]: "" }));
  }

  function handleImagePaste(event: ReactClipboardEvent<HTMLTextAreaElement>, id: string) {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    void addDraftImages(id, files);
  }

  function handleImageDrag(event: ReactDragEvent<HTMLFormElement>, id: string) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setImageDragSessionId(id);
  }

  function handleImageDragLeave(event: ReactDragEvent<HTMLFormElement>, id: string) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    if (imageDragSessionId === id) setImageDragSessionId(null);
  }

  function handleImageDrop(event: ReactDragEvent<HTMLFormElement>, id: string) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setImageDragSessionId(null);
    void addDraftImages(id, Array.from(event.dataTransfer.files));
  }

  function renderTreeRows(dir: string, depth: number): React.ReactNode {
    const entries = treeCache[dir] || [];
    return <>
      {entries.map((entry) => {
      const entryPath = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.type === "dir") {
        const open = expandedDirs.has(entryPath);
        return <div className="tree-branch" key={entry.name}>
          <button className="tree-row" style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => (open ? closeDir(entryPath) : void openDir(activeProjectPath, entryPath))}>
            <span className="tree-chevron">{open ? "▾" : "▸"}</span><span>◇</span><span className="tree-name">{entry.name}</span>
          </button>
          {open && (treeCache[entryPath] ? renderTreeRows(entryPath, depth + 1) : <div className="tree-loading" style={{ paddingLeft: `${28 + depth * 14}px` }}>{treeLoadingDir === entryPath ? "读取中…" : ""}</div>)}
        </div>;
      }
      return <button className="tree-row file" style={{ paddingLeft: `${10 + depth * 14}px` }} key={entry.name} onClick={() => previewFile(activeProjectPath, entryPath)}>
        <span className="tree-chevron"/><span>◇</span><span className="tree-name">{entry.name}</span>
      </button>;
      })}
      {truncatedDirs.has(dir) && <div className="tree-truncated" style={{ paddingLeft: `${10 + depth * 14}px` }}>… 条目过多，仅显示前 300 项</div>}
    </>;
  }

  function patchSession(id: string, updater: (session: Session) => Session) {
    setSessions((current) => current.map((session) => session.id === id ? updater(session) : session));
  }

  function cancelVoiceInput() {
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    speechSessionIdRef.current = null;
    setListeningSessionId(null);
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* Recognition may already be closed. */ }
  }

  function toggleVoiceInput(id: string) {
    if (speechSessionIdRef.current === id && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch { cancelVoiceInput(); }
      return;
    }

    if (speechRecognitionRef.current) cancelVoiceInput();
    const current = sessions.find((session) => session.id === id);
    if (!current) return;
    const speechWindow = window as typeof window & { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setWorkspaceNotice("当前浏览器不支持语音转文字。请使用最新版 Chrome 打开 Claude Code White。");
      return;
    }

    const recognition = new Recognition();
    speechRecognitionRef.current = recognition;
    speechSessionIdRef.current = id;
    speechDraftBaseRef.current = current.draft;
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (speechRecognitionRef.current === recognition) setListeningSessionId(id);
    };
    recognition.onresult = (event) => {
      if (speechRecognitionRef.current !== recognition) return;
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript || "";
      const draft = mergeVoiceDraft(speechDraftBaseRef.current, transcript);
      patchSession(id, (session) => ({ ...session, draft }));
    };
    recognition.onerror = (event) => {
      if (speechRecognitionRef.current !== recognition || event.error === "aborted") return;
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "麦克风权限被拒绝。请点击 Chrome 地址栏旁的权限图标，允许此应用使用麦克风。"
        : event.error === "audio-capture"
          ? "没有检测到可用的麦克风，请检查设备连接。"
          : event.error === "no-speech"
            ? "没有听到语音，请靠近麦克风后重试。"
            : "语音识别暂时不可用，请检查网络后重试。";
      setWorkspaceNotice(message);
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current !== recognition) return;
      speechRecognitionRef.current = null;
      speechSessionIdRef.current = null;
      setListeningSessionId((currentId) => currentId === id ? null : currentId);
    };
    setWorkspaceNotice("");
    setListeningSessionId(id);
    try { recognition.start(); }
    catch {
      cancelVoiceInput();
      setWorkspaceNotice("无法启动语音输入，请确认 Chrome 已获得麦克风权限。");
    }
  }

  function openSession(id: string, alongside = false) {
    setActiveId(id);
    setVisibleIds((current) => {
      if (current.includes(id)) return current;
      if (!alongside) return [id];
      return [...current, id].slice(-3);
    });
    setMobileSidebar(false);
  }

  function newSession() {
    const id = crypto.randomUUID();
    const next = makeSession(id, `新任务 ${sessions.length + 1}`, active?.projectPath);
    setSessions((current) => [next, ...current]);
    setVisibleIds((current) => [...current, id].slice(-3));
    setActiveId(id);
    setMobileSidebar(false);
  }

  function closePane(id: string) {
    setVisibleIds((current) => {
      if (current.length === 1) return current;
      const next = current.filter((item) => item !== id);
      if (activeId === id) setActiveId(next[0]);
      return next;
    });
  }

  function renameSession(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    const nextTitle = window.prompt("重命名任务", session.title);
    if (nextTitle?.trim()) patchSession(id, (item) => ({ ...item, title: nextTitle.trim().slice(0, 40) }));
  }

  function deleteSession(id: string) {
    if (sessions.length <= 1) return;
    if (!window.confirm("删除这个任务？它会从列表移除，Claude Code 本机记录不受影响。")) return;
    if (speechSessionIdRef.current === id) cancelVoiceInput();
    const remaining = sessions.filter((item) => item.id !== id);
    setSessions(remaining);
    setQueuedTurns((current) => { const next = { ...current }; delete next[id]; return next; });
    setDraftImages((current) => { const next = { ...current }; delete next[id]; return next; });
    setVisibleIds((current) => {
      const next = current.filter((item) => item !== id);
      return next.length ? next : [remaining[0].id];
    });
    setActiveId((current) => (current === id ? remaining[0].id : current));
  }

  function movePane(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    setVisibleIds((current) => {
      const next = [...current];
      const from = next.indexOf(draggedId);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    setDraggedId(null);
  }

  async function chooseProject(id: string) {
    const current = sessions.find((session) => session.id === id);
    if (!current) return;
    if (!status.bridge) {
      setWorkspaceNotice("本地桥接未启动，暂时无法打开目录选择器。");
      return;
    }
    if ((status.bridgeProtocol || 0) < REQUIRED_BRIDGE_PROTOCOL || !status.capabilities?.includes("native-folder-picker")) {
      setWorkspaceNotice("当前仍是旧版后台。请完全退出 Claude Code White 后重新打开，再选择工作区。");
      return;
    }
    setFolderPickingId(id);
    setWorkspaceNotice("");
    try {
      const response = await fetch(api("/api/workspace/select-directory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialPath: current.projectPath }),
      });
      const payload = await response.json().catch(() => null) as { path?: string; cancelled?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "目录选择器未能打开");
      if (payload?.path) {
        patchSession(id, (session) => ({ ...session, projectPath: payload.path as string, claudeSessionId: null }));
        if (id === activeId) {
          setTreeCache({});
          setExpandedDirs(new Set());
          setFilePreview(null);
          void loadChanges(payload.path);
        }
      }
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : "目录选择失败，请稍后重试。");
    } finally {
      setFolderPickingId(null);
    }
  }

  async function submit(event: FormEvent, id: string) {
    event.preventDefault();
    if (speechSessionIdRef.current === id) cancelVoiceInput();
    const current = sessions.find((session) => session.id === id);
    const images = draftImages[id] || [];
    if (!current || (!current.draft.trim() && images.length === 0)) return;
    const prompt = current.draft.trim();
    if (current.sending) {
      const queued: QueuedTurn = { id: crypto.randomUUID(), body: prompt, images, createdAt: Date.now() };
      setQueuedTurns((all) => ({ ...all, [id]: [...(all[id] || []), queued] }));
      setDraftImages((all) => ({ ...all, [id]: [] }));
      setImageNotices((all) => ({ ...all, [id]: "" }));
      patchSession(id, (session) => ({ ...session, draft: "" }));
      return;
    }
    await runTurn(id, prompt, images);
  }

  async function runTurn(id: string, prompt: string, images: DraftImage[], preserveDraft = false) {
    const current = sessions.find((session) => session.id === id);
    if (!current || current.sending) return;
    const assistantId = crypto.randomUUID();
    const projectPath = current.projectPath;
    const startedAt = Date.now();
    const titleSource = prompt || `分析 ${images.length} 张图片`;
    const autoTitle = current.title.startsWith("新任务") ? (titleSource.length > 22 ? `${titleSource.slice(0, 22)}…` : titleSource) : null;
    const messageImages = images.map(({ id: imageId, name, mediaType, dataUrl }) => ({ id: imageId, name, mediaType, dataUrl }));
    activeAssistantIdsRef.current.set(id, assistantId);
    if (!preserveDraft) {
      setDraftImages((all) => ({ ...all, [id]: [] }));
      setImageNotices((all) => ({ ...all, [id]: "" }));
    }
    patchSession(id, (session) => ({ ...session, title: autoTitle || session.title, draft: preserveDraft ? session.draft : "", sending: true, messages: [
      ...session.messages,
      { id: crypto.randomUUID(), role: "user", body: prompt, images: messageImages },
      { id: assistantId, role: "assistant", body: "", processOpen: true, timeline: [{ kind: "thinking", title: "启动 Claude Code", detail: "建立独立流式会话", state: "running" }] },
    ] }));

    if (!status.bridge || !status.claudeInstalled) {
      patchSession(id, (session) => ({ ...session, sending: false, messages: session.messages.map((message) => message.id === assistantId ? {
        ...message, body: "本地桥接尚未就绪。请通过启动脚本打开应用，并确认 Claude Code 已登录。", processOpen: false,
        timeline: [{ kind: "result", title: "等待本地连接", detail: "没有执行命令或写入文件", state: "done" }],
      } : message) }));
      activeAssistantIdsRef.current.delete(id);
      return;
    }

    const controller = new AbortController();
    aborters.current.set(id, controller);
    const toolIndexById = new Map<string, number>();
    let aborted = false;
    try {
      const response = await fetch(api("/api/run"), {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ prompt, images: images.map(({ name, mediaType, data }) => ({ name, mediaType, data })), cwd: projectPath, model: current.model, permissionMode: current.permissionMode, effort: current.effort, sessionId: current.claudeSessionId, requestId: id }),
      });
      if (!response.ok || !response.body) throw new Error(await response.text() || "本地桥没有返回数据");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const normalized = normalizeEvent(JSON.parse(line));
          const targetAssistantId = activeAssistantIdsRef.current.get(id) || assistantId;
          patchSession(id, (session) => {
            let tools = session.messages.find((item) => item.id === targetAssistantId)?.tools || [];
            // 追加新的工具调用（tool_use），记录 id → 下标
            if (normalized.tools) {
              for (const tool of normalized.tools) {
                toolIndexById.set(tool.id, tools.length);
                tools = [...tools, tool];
              }
            }
            // 关联工具结果（tool_result），失败标红
            if (normalized.toolResults) {
              for (const result of normalized.toolResults) {
                const index = toolIndexById.get(result.id);
                if (index !== undefined) {
                  tools = tools.map((tool, toolIndex) => toolIndex === index ? { ...tool, state: result.error ? "error" : "done", result: result.content } : tool);
                }
              }
            }
            return {
              ...session,
              claudeSessionId: normalized.sessionId || session.claudeSessionId,
              usage: normalized.usage ? {
                input: session.usage.input + (normalized.usage.input || 0),
                output: session.usage.output + (normalized.usage.output || 0),
                cache: session.usage.cache + (normalized.usage.cache || 0),
                cost: Math.max(session.usage.cost, normalized.usage.cost || 0),
              } : session.usage,
              messages: session.messages.map((message) => message.id === targetAssistantId ? {
                ...message,
                body: normalized.text ? `${message.body}${normalized.text}` : message.body,
                timeline: normalized.timeline ? [...(message.timeline || []), normalized.timeline] : message.timeline,
                tools,
                // 本次任务实时 token 用量（随 assistant usage 事件累加，cost 取 result 事件最大值）
                usage: normalized.usage ? {
                  input: (message.usage?.input || 0) + (normalized.usage.input || 0),
                  output: (message.usage?.output || 0) + (normalized.usage.output || 0),
                  cache: (message.usage?.cache || 0) + (normalized.usage.cache || 0),
                  cost: Math.max(message.usage?.cost || 0, normalized.usage.cost || 0),
                } : message.usage,
              } : message),
            };
          });
        }
        if (done) break;
      }
      void loadChanges(projectPath);
    } catch (error) {
      const text = error instanceof Error && error.name === "AbortError" ? "任务已停止。" : `连接失败：${error instanceof Error ? error.message : String(error)}`;
      aborted = error instanceof Error && error.name === "AbortError";
      const targetAssistantId = activeAssistantIdsRef.current.get(id) || assistantId;
      patchSession(id, (session) => ({ ...session, messages: session.messages.map((message) => message.id === targetAssistantId ? { ...message, body: message.body || text } : message) }));
    } finally {
      aborters.current.delete(id);
      const targetAssistantId = activeAssistantIdsRef.current.get(id) || assistantId;
      // 流结束时收尾仍在执行中的工具卡片（正常结束=done，中断=error），并记录本次任务耗时
      patchSession(id, (session) => ({
        ...session,
        sending: false,
        messages: session.messages.map((message) => message.id === targetAssistantId
          ? {
              ...message,
              elapsedMs: Date.now() - startedAt,
              processOpen: false,
              tools: message.tools?.map((tool) => tool.state === "running" ? { ...tool, state: aborted ? "error" : "done", result: tool.result || (aborted ? "任务已停止" : "") } : tool),
            }
          : message),
      }));
      activeAssistantIdsRef.current.delete(id);
    }
  }

  function removeQueuedTurn(sessionId: string, turnId: string) {
    setQueuedTurns((current) => ({ ...current, [sessionId]: (current[sessionId] || []).filter((turn) => turn.id !== turnId) }));
  }

  function restoreQueuedTurn(sessionId: string, turnId: string) {
    const turn = (queuedTurns[sessionId] || []).find((item) => item.id === turnId);
    if (!turn) return;
    patchSession(sessionId, (session) => ({ ...session, draft: [session.draft.trim(), turn.body].filter(Boolean).join("\n") }));
    setDraftImages((current) => ({ ...current, [sessionId]: [...(current[sessionId] || []), ...turn.images].slice(0, MAX_IMAGES_PER_MESSAGE) }));
    removeQueuedTurn(sessionId, turnId);
  }

  function openQueuedTurnInSideChat(sessionId: string, turnId: string) {
    const turn = (queuedTurns[sessionId] || []).find((item) => item.id === turnId);
    const source = sessions.find((session) => session.id === sessionId);
    if (!turn || !source || turn.state === "steering" || turn.state === "steered") return;
    const newId = crypto.randomUUID();
    const summary = turn.body.trim().replace(/\s+/g, " ");
    const nextSession: Session = {
      ...makeSession(newId, summary.slice(0, 28) || `图片任务 ${turn.images.length}`, source.projectPath),
      model: source.model,
      permissionMode: source.permissionMode,
      effort: source.effort,
      draft: turn.body,
    };
    setSessions((current) => [nextSession, ...current]);
    setDraftImages((current) => ({ ...current, [newId]: turn.images }));
    removeQueuedTurn(sessionId, turnId);
    setVisibleIds((current) => [...current.filter((id) => id !== sessionId && id !== newId).slice(-1), sessionId, newId]);
    setActiveId(newId);
    setMobileSidebar(false);
  }

  async function steerQueuedTurn(sessionId: string, turnId: string) {
    const turn = (queuedTurns[sessionId] || []).find((item) => item.id === turnId);
    const session = sessions.find((item) => item.id === sessionId);
    if (!turn || !session?.sending || turn.state === "steering" || turn.state === "steered") return;
    if ((status.bridgeProtocol || 0) < REQUIRED_BRIDGE_PROTOCOL || !status.capabilities?.includes("live-steering")) {
      setImageNotices((current) => ({ ...current, [sessionId]: "当前后台不支持实时插话，请重新启动 Claude Code White。" }));
      return;
    }
    setQueuedTurns((current) => ({ ...current, [sessionId]: (current[sessionId] || []).map((item) => item.id === turnId ? { ...item, state: "steering" } : item) }));
    try {
      const response = await fetch(api("/api/steer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: sessionId, prompt: turn.body, images: turn.images.map(({ name, mediaType, data }) => ({ name, mediaType, data })) }),
      });
      const payload = await response.json().catch(() => null) as { steered?: boolean; acknowledged?: boolean; error?: string } | null;
      if (!response.ok || !payload?.steered || !payload.acknowledged) throw new Error(payload?.error || "Claude Code 未确认调整方向");
      const insertedUserId = `steer-user-${turn.id}`;
      const continuationAssistantId = `steer-assistant-${turn.id}`;
      const insertedImages = turn.images.map(({ id: imageId, name, mediaType, dataUrl }) => ({ id: imageId, name, mediaType, dataUrl }));
      patchSession(sessionId, (current) => {
        if (current.messages.some((message) => message.id === insertedUserId)) return current;
        const activeAssistantId = activeAssistantIdsRef.current.get(sessionId)
          || [...current.messages].reverse().find((message) => message.role === "assistant" && message.processOpen)?.id;
        const closedMessages = current.messages.map((message) => message.id === activeAssistantId ? {
          ...message,
          processOpen: false,
          timeline: [...(message.timeline || []), { kind: "result" as const, title: "已立即调整方向", detail: turn.body || `已接收 ${turn.images.length} 张图片`, state: "done" as const }],
          tools: message.tools?.map((tool) => tool.state === "running" ? { ...tool, state: "done" as const, result: tool.result || "已根据新消息调整方向" } : tool),
        } : message);
        return {
          ...current,
          messages: [
            ...closedMessages,
            { id: insertedUserId, role: "user" as const, body: turn.body, images: insertedImages },
            {
              id: continuationAssistantId,
              role: "assistant" as const,
              body: "",
              processOpen: true,
              timeline: [{ kind: "thinking" as const, title: "按新消息继续", detail: "Claude Code 已接收插入消息", state: "running" as const }],
            },
          ],
        };
      });
      // 后续流式事件写入新的回复段，保证“旧回复 → 插入消息 → 新回复”的可读顺序。
      activeAssistantIdsRef.current.set(sessionId, continuationAssistantId);
      removeQueuedTurn(sessionId, turnId);
      setImageNotices((current) => ({ ...current, [sessionId]: "" }));
    } catch (error) {
      setQueuedTurns((current) => ({ ...current, [sessionId]: (current[sessionId] || []).map((item) => item.id === turnId ? { ...item, state: "queued" } : item) }));
      setImageNotices((current) => ({ ...current, [sessionId]: error instanceof Error ? error.message : "实时插话发送失败，已保留在队列中。" }));
    }
  }

  useEffect(() => {
    for (const session of sessions) {
      const sessionQueue = queuedTurns[session.id] || [];
      if (!session.sending && sessionQueue.some((turn) => turn.state === "steered")) {
        setQueuedTurns((current) => ({ ...current, [session.id]: (current[session.id] || []).filter((turn) => turn.state !== "steered") }));
      }
      const next = sessionQueue.find((turn) => !turn.state || turn.state === "queued");
      if (!next || session.sending || queueLaunchingRef.current.has(session.id)) continue;
      queueLaunchingRef.current.add(session.id);
      setQueuedTurns((current) => ({ ...current, [session.id]: (current[session.id] || []).filter((turn) => turn.id !== next.id) }));
      void runTurn(session.id, next.body, next.images, true).finally(() => queueLaunchingRef.current.delete(session.id));
    }
  // This queue pass deliberately launches the runTurn snapshot associated with this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedTurns, sessions]);

  async function stopSession(id: string) {
    if (stoppingSessionIds.has(id)) return;
    setStoppingSessionIds((current) => new Set(current).add(id));
    aborters.current.get(id)?.abort();
    try {
      const response = await fetch(api("/api/cancel"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id }) });
      if (!response.ok) throw new Error("停止请求未被后台接受");
    } catch (error) {
      setImageNotices((current) => ({ ...current, [id]: error instanceof Error ? error.message : "停止任务失败" }));
    } finally {
      setStoppingSessionIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  }

  async function refreshUsage() {
    setUsageLoading(true);
    try {
      const [providerResponse, analyticsResponse] = await Promise.all([
        fetch(api("/api/usage")),
        fetch(api("/api/usage/deepseek")),
      ]);
      const payload = await providerResponse.json();
      setProviders(payload.providers || []);
      if (analyticsResponse.ok) setDeepseekAnalytics(await analyticsResponse.json());
    } catch {
      setProviders([{ id: "bridge", name: "本地用量服务", configured: false, state: "error", summary: "桥接服务未启动" }]);
    } finally { setUsageLoading(false); }
  }

  function exportDeepSeekUsage() {
    if (!deepseekAnalytics) return;
    const rows = [
      ["model", "requests", "tokens", "cache_hit_tokens", "cache_miss_tokens", "output_tokens", "cost", "currency"],
      ...deepseekAnalytics.models.map((item) => [item.model, item.requests, item.tokens, item.promptCacheHitToken ?? "", item.promptCacheMissToken ?? "", item.responseToken ?? "", item.cost ?? "", deepseekAnalytics.summary.currency]),
    ];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `deepseek-usage-${deepseekAnalytics.updatedAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showUsage() { setUsageOpen(true); void refreshUsage(); }

  const commands: Array<{ id: CommandId; label: string; detail: string; icon: string; keys?: string }> = [
    { id: "new", label: "新建任务", detail: "创建独立 Claude Code 会话", icon: "＋", keys: "Ctrl K" },
    { id: "history", label: "恢复历史任务", detail: "继续本机已有 Claude Code 会话", icon: "↶" },
    { id: "changes", label: "查看工作区变更", detail: "检查文件状态与单文件 Diff", icon: "↕" },
    { id: "files", label: "打开文件浏览器", detail: "浏览当前项目目录", icon: "◇" },
    { id: "terminal", label: "查看桥接日志", detail: "检查本地运行状态", icon: ">_" },
    { id: "memory", label: "管理项目记忆", detail: "查看和编辑 Claude Code 记忆", icon: "✦" },
    { id: "inspector", label: inspector ? "收起检查面板" : "展开检查面板", detail: "切换右侧项目上下文", icon: "◧" },
    { id: "theme", label: theme === "light" ? "切换到深色主题" : "切换到浅色主题", detail: "更改本机界面外观", icon: theme === "light" ? "☾" : "☀" },
  ];
  const filteredCommands = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(commandQuery.trim().toLowerCase()));

  function runCommand(id: CommandId) {
    setCommandOpen(false);
    setCommandQuery("");
    setCommandSelected(0);
    if (id === "new") newSession();
    else if (id === "history") void openHistory();
    else if (id === "theme") setTheme((current) => current === "light" ? "dark" : "light");
    else if (id === "inspector") setInspector((current) => !current);
    else {
      setInspector(true);
      setInspectorTab(id);
    }
  }

  function chooseUsageGroup(next: "model" | "apiKey") {
    if (usageWasDragged.current) return;
    setUsageGroupBy(next);
    setUsageSwitchProgress(next === "apiKey" ? 1 : 0);
  }

  function beginUsageDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    usageDragRef.current = {
      startX: event.clientX,
      startProgress: usageSwitchProgress,
      progress: usageSwitchProgress,
      travel: Math.max(1, (rect.width - 6) / 2),
      moved: false,
      left: rect.left,
      width: rect.width,
    };
    usageWasDragged.current = false;
    setUsageSwitchDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveUsageDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = usageDragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    drag.progress = Math.min(1, Math.max(0, drag.startProgress + delta / drag.travel));
    setUsageSwitchProgress(drag.progress);
  }

  function endUsageDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = usageDragRef.current;
    if (!drag) return;
    const next = drag.moved
      ? (drag.progress >= .5 ? "apiKey" : "model")
      : (event.clientX >= drag.left + drag.width / 2 ? "apiKey" : "model");
    usageWasDragged.current = true;
    usageDragRef.current = null;
    setUsageSwitchDragging(false);
    setUsageGroupBy(next);
    setUsageSwitchProgress(next === "apiKey" ? 1 : 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => { usageWasDragged.current = false; }, 0);
  }

  function cancelUsageDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!usageDragRef.current) return;
    usageDragRef.current = null;
    setUsageSwitchDragging(false);
    setUsageSwitchProgress(usageGroupBy === "apiKey" ? 1 : 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const deepseekRequestMax = Math.max(1, ...(deepseekAnalytics?.models.map((item) => item.requests) || [1]));
  const deepseekTokenMax = Math.max(1, ...(deepseekAnalytics?.models.map((item) => item.tokens) || [1]));
  const connectionLabel = !status.bridge ? "本地桥未启动" : !status.claudeInstalled ? "未检测到 Claude Code" : status.claudeVersion || "Claude Code 已连接";

  return <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
    <aside className={`sidebar ${mobileSidebar ? "mobile-open" : ""}`}>
      <div className="brand-row"><ClaudeMark/><div className="brand-copy"><strong>Claude Code</strong><span>Desktop</span></div><SidebarToggle expanded onClick={closeSidebar} placement="sidebar"/></div>
      <button className="new-session" onClick={newSession}><span><UiIcon name="plus"/></span> 新建任务 <kbd>Ctrl K</kbd></button>
      <nav className="primary-nav" aria-label="主导航">
        <button className="active"><span><UiIcon name="chat"/></span>会话</button><button className={searchOpen ? "active" : ""} onClick={() => setSearchOpen((value) => !value)}><span><UiIcon name="search"/></span>搜索</button><button onClick={() => void openHistory()}><span><UiIcon name="history"/></span>历史任务</button><button onClick={() => { setInspector(true); setInspectorTab("files"); }}><span><UiIcon name="folder"/></span>文件</button><button onClick={() => { setInspector(true); setInspectorTab("changes"); }}><span><UiIcon name="changes"/></span>变更</button>
      </nav>
      {searchOpen && <div className="session-search"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索任务或目录…" autoFocus/></div>}
      <div className="section-label"><span>工作区任务</span><small>{visibleSessions.length}</small></div>
      <div className="session-list">{workspaceSessionGroups.map((group) => <section className="workspace-session-group" key={group.key}>
        <header title={group.path || "尚未选择目录"}><span className="workspace-folder-icon"><UiIcon name="workspace" size={13}/></span><strong>{group.label}</strong><small>{group.sessions.length}</small></header>
        <div>{group.sessions.map((session) => (
          <div className={`session ${activeId === session.id ? "active" : ""}`} key={session.id}>
            <button onClick={() => openSession(session.id)}><span className="session-title">{session.title}</span><small>{session.sending ? "正在工作" : `${session.model}${(queuedTurns[session.id]?.length || 0) ? ` · 排队 ${queuedTurns[session.id].length}` : ""}`}</small></button>
            <span className="session-actions">
              <button className="split-open" title="并排打开" aria-label={`并排打开 ${session.title}`} onClick={() => openSession(session.id, true)}><UiIcon name="split" size={14}/></button>
              <button className="session-action" title="重命名" aria-label={`重命名 ${session.title}`} onClick={() => renameSession(session.id)}><UiIcon name="edit" size={13}/></button>
              <button className="session-action danger" title="删除" aria-label={`删除 ${session.title}`} disabled={sessions.length === 1} onClick={() => deleteSession(session.id)}><UiIcon name="trash" size={13}/></button>
            </span>
          </div>
        ))}</div>
      </section>)}</div>
      <div className="sidebar-bottom">
        <button className="usage-button" onClick={showUsage}><span className="usage-ring"><UiIcon name="usage" size={16}/></span><span><strong>用量与额度</strong><small>{localUsage.input + localUsage.output > 0 ? `${(localUsage.input + localUsage.output).toLocaleString()} tokens` : "Claude · DeepSeek · OpenAI"}</small></span><b>›</b></button>
        <button className="project-button" disabled={folderPickingId !== null} onClick={() => void chooseProject(activeId)}><span className="project-icon"><UiIcon name="folder" size={20}/></span><span><strong>{folderPickingId === activeId ? "正在打开文件夹选择器…" : workspaceName(active?.projectPath || "")}</strong><small>{active?.projectPath || "选择工作目录"}</small></span><b className="project-open-label">{folderPickingId === activeId ? "等待选择" : "更换"}<span>›</span></b></button>
        <div className="account-row"><span className="avatar">LH</span><span><strong>Lavinia</strong><small>本地工作区</small></span><IconButton label="切换主题" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "☾" : "☀"}</IconButton></div>
      </div>
    </aside>
    <button type="button" className={`sidebar-backdrop ${mobileSidebar ? "visible" : ""}`} aria-label="关闭侧栏" onClick={() => setMobileSidebar(false)}/>

    <section className="workspace">
      <header className="topbar">
        <div className="topbar-title"><SidebarToggle expanded={false} onClick={openSidebar} placement="topbar"/><div><strong>{active?.title}</strong><span>{visibleIds.length} 个并行会话 · {active?.projectPath}</span></div></div>
        <div className="topbar-actions">{!status.bridge && <><button className="bridge-start" disabled={bridgeStarting} onClick={() => void startBridge()}>{bridgeStarting ? "启动中…" : "一键桥接"}</button><button className="connection-retry" title="桥接未就绪时点击重新检测" onClick={() => void recheckStatus()}>↻</button></>}<span className={`connection ${status.claudeInstalled ? "online" : ""}`}><i/>{connectionLabel}</span><button className="command-trigger" onClick={() => { setCommandQuery(""); setCommandSelected(0); setCommandOpen(true); }} title="快捷操作（Ctrl+Shift+P）"><span>⌕</span><kbd>Ctrl ⇧ P</kbd></button><div className="layout-switch" aria-label="会话布局"><button onClick={() => setVisibleIds([activeId])}>▢</button><button className={visibleIds.length === 2 ? "active" : ""} onClick={() => setVisibleIds((current) => (current.length >= 2 ? current.slice(0, 2) : current))}>▥</button><button className={visibleIds.length === 3 ? "active" : ""} onClick={() => setVisibleIds((current) => (current.length >= 3 ? current.slice(0, 3) : current))}>▦</button></div><IconButton label="检查面板" active={inspector} onClick={() => setInspector((value) => !value)}>◧</IconButton></div>
      </header>

      <div className={`workbench ${inspector ? "with-inspector" : ""}`}>
        <div className={`session-grid columns-${visibleIds.length}`}>{visibleIds.map((id) => {
          const session = sessions.find((item) => item.id === id);
          if (!session) return null;
          const sessionDraftImages = draftImages[id] || [];
          const hasDraftContent = Boolean(session.draft.trim() || sessionDraftImages.length);
          return <section className={`session-pane ${activeId === id ? "active" : ""}`} key={id} onDragOver={(event) => event.preventDefault()} onDrop={() => movePane(id)} onClick={() => setActiveId(id)}>
            <header className="pane-header" draggable onDragStart={() => setDraggedId(id)}><span className={`run-dot ${session.sending ? "busy" : ""}`}/><div><strong>{session.title}</strong><small>{session.projectPath}</small></div><span className="pane-model">{session.model}</span>{visibleIds.length > 1 && <IconButton label="关闭此窗格" onClick={() => closePane(id)}>×</IconButton>}</header>
            <div className="conversation" ref={(element) => { conversationRefs.current.set(id, element); }} onScroll={() => handlePaneScroll(id)}><div className="conversation-inner">
              <div className="day-divider"><span>今天</span></div>
              {session.messages.map((message) => message.role === "user" ? <article className="message user-message" key={message.id}><div className="user-message-content">{message.images && message.images.length > 0 && <div className={`message-image-grid ${message.images.length === 1 ? "single" : "multiple"}`}>{message.images.map((image) => <button type="button" className="message-image" key={image.id} title={`查看 ${image.name}`} onClick={() => setPreviewImage(image)}><img src={image.dataUrl} alt={image.name}/></button>)}</div>}{message.body && <div className="user-bubble">{message.body}</div>}</div></article> : <article className="message assistant-message" key={message.id}><ClaudeMark small/><div className="assistant-content"><div className="message-meta"><strong>Claude</strong><span>Code</span>{message.usage && (message.usage.input + message.usage.output) > 0 && <span className="message-tokens" title={`输入 ${message.usage.input.toLocaleString()} · 输出 ${message.usage.output.toLocaleString()} · 缓存 ${message.usage.cache.toLocaleString()}${message.usage.cost > 0 ? ` · $${message.usage.cost.toFixed(4)}` : ""}`}>▲{formatTokens(message.usage.input)} ▼{formatTokens(message.usage.output)}</span>}{message.elapsedMs !== undefined && <span className="message-elapsed">⏱ {formatElapsed(message.elapsedMs)}</span>}</div>
                {message.body && <p>{message.body}</p>}
                <ProcessFlow message={message} onToggle={() => patchSession(id, (item) => ({ ...item, messages: item.messages.map((entry) => entry.id === message.id ? { ...entry, processOpen: !entry.processOpen } : entry) }))}/>
              </div></article>)}
              {session.sending && <div className="working"><span/><span/><span/> Claude 正在工作</div>}
            </div></div>
            <form className={`composer-wrap ${imageDragSessionId === id ? "image-dragging" : ""}`} onSubmit={(event) => submit(event, id)} onDragEnter={(event) => handleImageDrag(event, id)} onDragOver={(event) => handleImageDrag(event, id)} onDragLeave={(event) => handleImageDragLeave(event, id)} onDrop={(event) => handleImageDrop(event, id)}>
              {(queuedTurns[id]?.length || 0) > 0 && <div className="queued-turns" aria-label={`${queuedTurns[id].length} 条排队消息`}>{queuedTurns[id].map((turn, index) => {
                const queueBusy = turn.state === "steering" || turn.state === "steered";
                return <article className={`queued-turn state-${turn.state || "queued"}`} key={turn.id}>
                  <span className="queue-turn-marker" aria-hidden="true">↳</span>
                  {turn.images.length > 0 && <span className="queued-inline-image" title={`${turn.images.length} 张图片`}><img src={turn.images[0].dataUrl} alt={turn.images[0].name}/>{turn.images.length > 1 && <b>+{turn.images.length - 1}</b>}</span>}
                  <div className="queued-copy"><p title={turn.body || `发送 ${turn.images.length} 张图片`}>{turn.body || `发送 ${turn.images.length} 张图片`}</p>{index > 0 && <small>排队 {index + 1}</small>}</div>
                  <div className="queued-actions">
                    <button type="button" className="steer-action" disabled={queueBusy} title="中断当前步骤，让 Claude 立即按这条消息调整方向" onClick={() => void steerQueuedTurn(id, turn.id)}><span>↳</span><em>{turn.state === "steering" ? "正在插入" : turn.state === "steered" ? "已转向" : "调整方向"}</em></button>
                    <button type="button" className="queued-icon-action" title="删除这条排队消息" aria-label="删除这条排队消息" onClick={() => removeQueuedTurn(id, turn.id)}><UiIcon name="trash" size={15}/></button>
                    <details className="queued-more"><summary aria-label="更多排队操作" title="更多操作"><span className="queue-kebab" aria-hidden="true"><i/><i/><i/></span></summary><div className="queued-menu-popover">
                      <button type="button" disabled={queueBusy} onClick={() => restoreQueuedTurn(id, turn.id)}><UiIcon name="edit" size={16}/><span>编辑消息</span></button>
                      <button type="button" disabled={queueBusy} onClick={() => openQueuedTurnInSideChat(id, turn.id)}><UiIcon name="split" size={16}/><span>在侧边会话中打开</span></button>
                      <button type="button" onClick={() => removeQueuedTurn(id, turn.id)}><span className="queue-close-glyph" aria-hidden="true">↳</span><span>关闭排队</span></button>
                    </div></details>
                  </div>
                </article>;
              })}</div>}
              <div className="composer">{imageDragSessionId === id && <div className="composer-drop-overlay"><span><UiIcon name="plus"/></span><strong>松开以添加多张图片</strong><small>JPG、PNG、GIF、WebP</small></div>}{sessionDraftImages.length > 0 && <div className="draft-image-rail" aria-label={`已添加 ${sessionDraftImages.length} 张图片`}>{sessionDraftImages.map((image) => <div className="draft-image" key={image.id}><button type="button" className="draft-image-preview" title={`查看 ${image.name}`} onClick={() => setPreviewImage(image)}><img src={image.dataUrl} alt={image.name}/></button><button type="button" className="draft-image-remove" aria-label={`移除 ${image.name}`} onClick={() => removeDraftImage(id, image.id)}>×</button></div>)}</div>}<textarea value={session.draft} onChange={(event) => { if (speechSessionIdRef.current === id) cancelVoiceInput(); patchSession(id, (item) => ({ ...item, draft: event.target.value })); }} onPaste={(event) => handleImagePaste(event, id)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={session.sending ? "继续输入；发送后可选择立即调整方向…" : sessionDraftImages.length ? "补充说明，或直接发送图片…" : "让 Claude 修改代码、运行命令、解释项目或分析图片…"} rows={2}/>{imageNotices[id] && <div className="image-notice" role="status">{imageNotices[id]}</div>}<div className="composer-toolbar"><div className="toolbar-left"><label className="add-context image-picker" title="上传图片（支持一次选择多张）" aria-label="上传图片"><input type="file" accept={IMAGE_ACCEPT} multiple onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void addDraftImages(id, files); }}/><span><UiIcon name="plus" size={16}/></span></label><PermissionControl value={session.permissionMode} sending={session.sending} onChange={(permissionMode) => patchSession(id, (item) => ({ ...item, permissionMode }))}/></div><div className="composer-actions"><ClaudeSettingsControl model={session.model} effort={session.effort} sending={session.sending} onModelChange={(model) => patchSession(id, (item) => ({ ...item, model }))} onEffortChange={(effort) => patchSession(id, (item) => ({ ...item, effort }))}/><button type="button" className={`voice-button ${listeningSessionId === id ? "listening" : ""}`} aria-pressed={listeningSessionId === id} title={listeningSessionId === id ? "停止语音输入" : "语音转文字"} aria-label={listeningSessionId === id ? "停止语音输入" : "开始语音转文字"} onClick={() => toggleVoiceInput(id)}><UiIcon name="microphone" size={17}/><span className="voice-listening-dot" aria-hidden="true"/></button>{session.sending ? <>{hasDraftContent && <button className="send-button queue-send" title="加入排队" aria-label="加入排队"><UiIcon name="send" size={15}/></button>}<button type="button" className="stop-button" disabled={stoppingSessionIds.has(id)} title={stoppingSessionIds.has(id) ? "正在停止…" : "停止当前任务"} aria-label={stoppingSessionIds.has(id) ? "正在停止当前任务" : "停止当前任务"} onClick={() => void stopSession(id)}><UiIcon name="stop" size={14}/></button></> : <button className="send-button" disabled={!hasDraftContent} title="发送" aria-label="发送"><UiIcon name="send" size={15}/></button>}</div></div></div>
            </form>
          </section>;
        })}</div>

        {inspector && <aside className="inspector"><div className="inspector-tabs"><button className={inspectorTab === "changes" ? "active" : ""} onClick={() => setInspectorTab("changes")}>变更</button><button className={inspectorTab === "files" ? "active" : ""} onClick={() => setInspectorTab("files")}>文件</button><button className={inspectorTab === "terminal" ? "active" : ""} onClick={() => setInspectorTab("terminal")}>终端</button><button className={inspectorTab === "memory" ? "active" : ""} onClick={() => setInspectorTab("memory")}>记忆</button></div>
          {inspectorTab === "changes" && <>
            <div className="change-summary"><div><strong>工作区变更</strong><span>{changes?.root || activeProjectPath || "等待项目目录"}</span></div><button className="refresh-chip" onClick={() => loadChanges(activeProjectPath)} disabled={changesLoading || !status.bridge}>{changesLoading ? "读取中" : "刷新"}</button></div>
            {!status.bridge ? <div className="empty-inspector"><span>↕</span><strong>桥接器未连接</strong><p>启动本地桥接后，这里会按项目展示 Git 变更。</p></div>
              : changes === null ? <div className="empty-inspector"><span>↕</span><strong>变更会显示在这里</strong><p>每个会话的文件修改、Diff 与测试结果会按项目归集。</p></div>
              : !changes.isGit ? <div className="clean-state"><strong>当前目录不是 Git 仓库</strong><p>无法读取变更。</p></div>
              : changes.entries.length === 0 ? <div className="clean-state"><strong>✓ 工作区干净</strong><p>{changes.branch ? `分支 ${changes.branch} 没有未提交变更。` : "没有未提交变更。"}</p></div>
              : <>
                  <ul className="change-list">{changes.entries.map((entry) => (
                    <li key={`${entry.status}-${entry.path}`}><button type="button" className={selectedChange === entry.path ? "active" : ""} aria-pressed={selectedChange === entry.path} onClick={() => void previewDiff(activeProjectPath, entry)}><span className={`change-status s-${entry.status.replace(/[^A-Za-z?]/g, "") || "x"}`}>{entry.status}</span><span className="change-file" title={entry.file}>{entry.file}</span><span className="change-open">›</span></button></li>
                  ))}</ul>
                  {diffLoading ? <div className="diff-state">正在生成单文件 Diff…</div>
                    : diffError ? <div className="diff-state error">{diffError}</div>
                    : diffPreview ? <section className="diff-preview"><header><span title={diffPreview.file}>{diffPreview.file}</span><small><b>+{diffPreview.additions}</b><em>−{diffPreview.deletions}</em></small></header>
                      {diffPreview.binary ? <div className="diff-state">这是二进制文件，无法显示文本 Diff。</div> : diffPreview.diff ? <pre>{diffPreview.diff.split("\n").map((line, index) => {
                        const kind = line.startsWith("+++") || line.startsWith("---") ? "meta" : line.startsWith("+") ? "addition" : line.startsWith("-") ? "deletion" : line.startsWith("@@") ? "hunk" : line.startsWith("diff ") || line.startsWith("index ") ? "meta" : "context";
                        return <code className={kind} key={`${index}-${line.slice(0, 24)}`}><span>{index + 1}</span>{line || " "}</code>;
                      })}</pre> : <div className="diff-state">这个文件当前没有可显示的文本差异。</div>}
                      {diffPreview.truncated && <footer>Diff 较大，预览已截断到 512 KB。</footer>}
                    </section>
                    : changes.stat && <pre className="diff-stat">{changes.stat}</pre>}
                </>}
          </>}
          {inspectorTab === "files" && <div className="file-tree">
            <div className="file-tree-toolbar"><span>{activeProjectPath.split(/[\\/]/).filter(Boolean).pop() || "工作区"}</span><div className="file-tree-toolbar-actions">{filePreviewLoading && <small className="preview-loading">读取中…</small>}<button className="refresh-chip" onClick={() => { setTreeCache({}); setExpandedDirs(new Set()); setFilePreview(null); void openDir(activeProjectPath, ""); }}>刷新</button></div></div>
            {treeCache[""] === undefined ? <div className="empty-inspector"><span>◇</span><strong>文件会显示在这里</strong><p>按活动会话的项目目录读取真实文件树。</p></div>
              : <div className="tree-root">{renderTreeRows("", 0)}</div>}
            {filePreview && <div className="file-preview"><header><span>{filePreview.name}</span><small>{filePreview.lines} 行 · {(filePreview.size / 1024).toFixed(1)} KB</small></header><pre>{filePreview.content.slice(0, 20000)}{filePreview.content.length > 20000 ? "\n…（预览截断）" : ""}</pre></div>}
          </div>}
          {inspectorTab === "terminal" && <div className="terminal-card live"><div><span/>Claude Code bridge 日志 <small>每 2.5s 轮询</small></div>
            <div className="terminal-log">{logs.length === 0 ? <em>等待桥接器输出…</em> : logs.slice(-150).map((entry, index) => (
              <code className={entry.level} key={`${entry.t}-${index}`}><b>{new Date(entry.t).toLocaleTimeString("zh-CN", { hour12: false })}</b>{entry.message}</code>
            ))}</div>
          </div>}
          {inspectorTab === "memory" && <div className="memory-panel">
            <div className="change-summary"><div><strong>记忆</strong><span>本机 Claude Code 记忆 · 按工作区与类型</span></div><div className="file-tree-toolbar-actions"><button className="refresh-chip" onClick={openNewMemory}>＋ 新建</button><button className="refresh-chip" onClick={() => loadMemories()} disabled={memoriesLoading}>{memoriesLoading ? "读取中" : "刷新"}</button></div></div>
            {memoryForm.open && <div className="memory-form">
              <div className="memory-form-row">
                <label><span>工作区（分区）</span><select value={memoryForm.workspaceId} onChange={(event) => setMemoryForm((current) => ({ ...current, workspaceId: event.target.value }))}><option value="">选择工作区…</option>{memoryWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.label}</option>)}</select></label>
                <label><span>类型（分类）</span><select value={memoryForm.type} onChange={(event) => setMemoryForm((current) => ({ ...current, type: event.target.value }))}>{Object.entries(MEMORY_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              </div>
              <label><span>名称</span><input value={memoryForm.name} onChange={(event) => setMemoryForm((current) => ({ ...current, name: event.target.value }))} placeholder="记忆名称，如 project-architecture"/></label>
              <label><span>描述</span><input value={memoryForm.description} onChange={(event) => setMemoryForm((current) => ({ ...current, description: event.target.value }))} placeholder="一句话说明，用于索引与检索"/></label>
              <label><span>正文</span><textarea rows={6} value={memoryForm.body} onChange={(event) => setMemoryForm((current) => ({ ...current, body: event.target.value }))} placeholder="记忆内容…"/></label>
              <div className="memory-form-actions"><button className="refresh-chip" onClick={saveMemory} disabled={memoryForm.saving || !memoryForm.workspaceId || !memoryForm.name.trim()}>{memoryForm.saving ? "保存中…" : "保存"}</button><button className="refresh-chip" onClick={() => setMemoryForm({ open: false, workspaceId: "", name: "", description: "", type: "project", body: "", editingFile: null, saving: false })}>取消</button></div>
            </div>}
            {!status.bridge ? <div className="empty-inspector"><span>◇</span><strong>桥接器未连接</strong><p>启动本地桥接后，这里会按工作区展示记忆。</p></div>
              : memories === null ? <div className="empty-inspector"><span>◇</span><strong>记忆会显示在这里</strong><p>读取 ~/.claude/projects 下各工作区的记忆文件。</p></div>
              : memories.workspaces.length === 0 ? <div className="clean-state"><strong>还没有记忆</strong><p>各项目使用 Claude Code 时写入的记忆会按工作区归集。</p></div>
              : memories.workspaces.map((workspace) => (
                <details className="memory-workspace" key={workspace.id}>
                  <summary><span className="memory-ws-name">{workspace.label}</span><small>{workspace.entries.length} 条</small></summary>
                  <div className="memory-list">{workspace.entries.map((entry) => (
                    <details className="memory-card" key={entry.file}>
                      <summary><span className={`memory-type t-${entry.type}`}>{MEMORY_TYPE_LABEL[entry.type] || entry.type}</span><strong>{entry.name}</strong><span className="memory-card-actions"><button className="memory-action" title="编辑" aria-label={`编辑 ${entry.name}`} onClick={(event) => { event.preventDefault(); void editMemory(workspace.id, entry); }}>✎</button><button className="memory-action danger" title="删除" aria-label={`删除 ${entry.name}`} onClick={(event) => { event.preventDefault(); void removeMemory(workspace.id, entry); }}>×</button></span></summary>
                      {entry.description && <p className="memory-desc">{entry.description}</p>}
                      {entry.body && <pre className="memory-body">{entry.body}</pre>}
                    </details>
                  ))}</div>
                </details>
              ))}
          </div>}
        </aside>}
      </div>
    </section>

    {workspaceNotice && <div className="app-toast" role="status"><span>!</span><p>{workspaceNotice}</p><button type="button" aria-label="关闭提示" onClick={() => setWorkspaceNotice("")}>×</button></div>}
    {previewImage && <div className="image-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImage(null); }}><section role="dialog" aria-modal="true" aria-label={previewImage.name}><header><span title={previewImage.name}>{previewImage.name}</span><button type="button" aria-label="关闭图片预览" onClick={() => setPreviewImage(null)}>×</button></header><img src={previewImage.dataUrl} alt={previewImage.name}/></section></div>}

    {commandOpen && <div className="modal-backdrop command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="快捷操作">
      <div className="command-search"><span>⌕</span><input value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandSelected(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setCommandSelected((current) => Math.min(filteredCommands.length - 1, current + 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setCommandSelected((current) => Math.max(0, current - 1)); } else if (event.key === "Enter" && filteredCommands[commandSelected]) runCommand(filteredCommands[commandSelected].id); }} placeholder="输入要执行的操作…" autoFocus/><kbd>Esc</kbd></div>
      <div className="command-list">{filteredCommands.length === 0 ? <div className="command-empty">没有匹配的操作</div> : filteredCommands.map((command, index) => <button type="button" className={index === commandSelected ? "suggested" : ""} key={command.id} onMouseEnter={() => setCommandSelected(index)} onClick={() => runCommand(command.id)}><span className="command-icon">{command.icon}</span><span><strong>{command.label}</strong><small>{command.detail}</small></span>{command.keys && <kbd>{command.keys}</kbd>}</button>)}</div>
      <footer><span>↑↓ 浏览</span><span>Enter 执行</span><span>Esc 关闭</span></footer>
    </section></div>}

    {historyOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}><section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header><div><span className="eyebrow">LOCAL CLAUDE CODE</span><h2 id="history-title">恢复历史任务</h2><p>继续终端或其他窗口中创建的 Claude Code 会话，保留原有上下文。</p></div><IconButton label="关闭历史任务" onClick={() => setHistoryOpen(false)}>×</IconButton></header>
      <div className="history-search"><span>⌕</span><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索标题、对话或项目路径…" autoFocus/><small>{filteredHistory.length} 个任务</small></div>
      <div className="history-list">{historyLoading ? <div className="history-empty">正在读取本机 Claude Code 历史…</div> : filteredHistory.length === 0 ? <div className="history-empty">没有找到可恢复的历史任务。</div> : filteredHistory.map((item) => <article className="history-item" key={`${item.projectId}-${item.id}`}>
        <div className="history-mark">{item.title.slice(0, 1).toUpperCase()}</div><div className="history-copy"><header><strong>{item.title}</strong><time>{formatHistoryTime(item.updatedAt)}</time></header><p>{item.preview || "该任务尚无可显示的用户消息"}</p><footer><span>{item.cwd || item.projectId}</span><small>{modelFamily(item.model)}</small></footer></div><button className="history-restore" disabled={restoringSessionId !== null} onClick={() => void restoreHistorySession(item)}>{restoringSessionId === item.id ? "恢复中…" : "继续"}</button>
      </article>)}</div>
      <footer><span>仅从本机 <code>~/.claude/projects</code> 读取，不会上传历史内容。</span><button onClick={() => void openHistory()} disabled={historyLoading}>刷新</button></footer>
    </section></div>}

    {usageOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUsageOpen(false); }}><section className="usage-modal analytics-modal" role="dialog" aria-modal="true" aria-label="用量与额度">
      <header className="analytics-header"><div><span className="eyebrow">USAGE & COST</span><h2>用量与额度</h2><p>按模型核对请求、Tokens 与费用。密钥始终留在本机。</p></div><IconButton label="关闭" onClick={() => setUsageOpen(false)}>×</IconButton></header>

      <div className="provider-accordion-list">
      <details className="provider-accordion deepseek-interface" open={usageProviderOpen === "deepseek"}>
        <summary onClick={(event) => { event.preventDefault(); setUsageProviderOpen((current) => current === "deepseek" ? "" : "deepseek"); }}><div className="provider-summary-main"><div className="provider-logo deepseek">D</div><div><strong>DeepSeek API</strong><span>余额、消费、请求和模型 Tokens</span></div></div><div className="provider-summary-side"><span className="provider-state ready">已连接</span><b>⌄</b></div></summary>
        <div className="provider-interface-body">
      <div className="analytics-toolbar" data-usage-part="filters">
        <div className="time-filter" title="DeepSeek 平台快照仅包含近 30 天数据"><span>时间维度</span><strong>近 30 天</strong></div>
        <label className="filter-note" title="平台快照未提供按 API Key 的拆分数据"><span>API Key</span><em>快照不拆分</em></label>
        <span className="data-source"><i/>{deepseekAnalytics?.sourceLabel || "等待数据"}</span>
        <button className="export-button" onClick={exportDeepSeekUsage} disabled={!deepseekAnalytics}>导出 CSV</button>
      </div>

      <div className="analytics-scroll">
        <section className="metric-grid" data-usage-part="summary">
          <article><span>消费金额</span><strong>{deepseekAnalytics ? `¥${deepseekAnalytics.summary.cost.toFixed(2)}` : "—"}</strong><small>{deepseekAnalytics?.summary.currency || "CNY"}</small></article>
          <article><span>API 请求次数</span><strong>{deepseekAnalytics?.summary.requests.toLocaleString() || "—"}</strong><small>精确到模型</small></article>
          <article><span>Tokens</span><strong>{deepseekAnalytics?.summary.tokens.toLocaleString() || "—"}</strong><small>输入、缓存与输出合计</small></article>
          <article className="balance-metric"><span>可用余额</span><strong>{providers.find((item) => item.id === "deepseek")?.balances?.[0]?.total ? `¥${providers.find((item) => item.id === "deepseek")?.balances?.[0]?.total}` : "—"}</strong><small>DeepSeek 官方余额接口</small></article>
        </section>

        <section className="cost-panel" data-usage-part="cost">
          <div className="panel-title"><div><strong>消费金额（{deepseekAnalytics?.summary.currency || "CNY"}）</strong><span>{deepseekAnalytics ? `¥${deepseekAnalytics.summary.cost.toFixed(2)}` : "等待数据"}</span></div><div className={`segmented glass-segmented ${usageGroupBy === "apiKey" ? "show-api-key" : "show-model"} ${usageSwitchDragging ? "is-dragging" : ""}`} role="tablist" aria-label="消费金额分组，可点击或左右拖动" title="点击切换，也可以按住左右拖动" onPointerDown={beginUsageDrag} onPointerMove={moveUsageDrag} onPointerUp={endUsageDrag} onPointerCancel={cancelUsageDrag}><span className="glass-selection" aria-hidden="true" style={{ transform: `translateX(${usageSwitchProgress * 100}%)` }}/><button className={usageGroupBy === "model" ? "active" : ""} role="tab" aria-selected={usageGroupBy === "model"} onClick={() => chooseUsageGroup("model")}>模型</button><button className={usageGroupBy === "apiKey" ? "active" : ""} role="tab" aria-selected={usageGroupBy === "apiKey"} onClick={() => chooseUsageGroup("apiKey")}>API Key</button></div></div>
          <div className={`exact-cost-chart chart-transition group-${usageGroupBy}`} key={usageGroupBy}><div className="chart-y"><span>{deepseekAnalytics?.summary.cost.toFixed(2) || "0"}</span><span>0</span></div><div className="chart-field"><i className="grid-line top"/><i className="grid-line bottom"/><div className="total-cost-column" style={{ height: deepseekAnalytics ? "78%" : "0%" }}><b>{deepseekAnalytics ? `¥${deepseekAnalytics.summary.cost.toFixed(2)}` : ""}</b></div><div className="chart-axis"><span>{deepseekAnalytics ? new Date(deepseekAnalytics.range.start).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—"}</span><span>{usageGroupBy === "model" ? `${deepseekAnalytics?.models.length || 0} 个模型` : "全部 API Key"}</span><span>{deepseekAnalytics ? new Date(deepseekAnalytics.range.end).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "—"}</span></div></div></div>
          <p className="precision-note">{deepseekAnalytics?.note || "正在读取 DeepSeek 平台数据…"}</p>
        </section>

        <section className="model-usage-section" data-usage-part="models">
          <div className="section-heading"><div><span className="eyebrow">MODEL BREAKDOWN</span><h3>模型用量</h3></div><span>{deepseekAnalytics?.models.length || 0} 个模型</span></div>
          <div className="model-usage-list">{deepseekAnalytics?.models.map((item, index) => <article className="model-usage-card" key={item.model}>
            <header><div><i style={{ background: index % 2 ? "#d87a54" : "#6f9fd8" }}/><strong>{item.model}</strong></div><span>精确数据</span></header>
            <div className="model-metrics">
              <div data-usage-part="requests"><div><span>API 请求次数</span><strong>{item.requests.toLocaleString()}</strong></div><div className="horizontal-chart"><i style={{ width: `${Math.max(2, item.requests / deepseekRequestMax * 100)}%` }}/></div><small>占全部请求 {deepseekAnalytics.summary.requests ? (item.requests / deepseekAnalytics.summary.requests * 100).toFixed(2) : "0.00"}%</small></div>
              <div data-usage-part="tokens"><div><span>Tokens</span><strong>{item.tokens.toLocaleString()}</strong></div><div className="horizontal-chart token"><i style={{ width: `${Math.max(2, item.tokens / deepseekTokenMax * 100)}%` }}/></div><small>占全部 Tokens {deepseekAnalytics.summary.tokens ? (item.tokens / deepseekAnalytics.summary.tokens * 100).toFixed(2) : "0.00"}%</small></div>
            </div>
            <div className="token-ledger"><span>缓存命中 <b>{item.promptCacheHitToken?.toLocaleString() || "快照未提供"}</b></span><span>缓存未命中 <b>{item.promptCacheMissToken?.toLocaleString() || "快照未提供"}</b></span><span>输出 <b>{item.responseToken?.toLocaleString() || "快照未提供"}</b></span></div>
          </article>) || <div className="provider-skeleton">正在读取模型用量…</div>}</div>
        </section>
        </div>
        </div>
      </details>

      <details className="provider-accordion claude-interface" open={usageProviderOpen === "claude"}>
        <summary onClick={(event) => { event.preventDefault(); setUsageProviderOpen((current) => current === "claude" ? "" : "claude"); }}><div className="provider-summary-main"><div className="provider-logo claude">C</div><div><strong>Claude Code</strong><span>本客户端逐会话模型账本</span></div></div><div className="provider-summary-side"><span className="provider-state ready">本机记录</span><b>⌄</b></div></summary>
        <div className="provider-interface-body"><section className="local-ledger" data-usage-part="local"><div><span className="eyebrow">LOCAL LEDGER</span><h3>Claude Code 模型用量</h3><p>来自 Claude Code 返回的真实 Token 与 API 成本，只在这台设备累计。</p></div><div className="ledger-values"><span><b>{(localUsage.input + localUsage.output).toLocaleString()}</b> Tokens</span><span><b>{localUsage.input.toLocaleString()} / {localUsage.output.toLocaleString()}</b> 输入 / 输出</span><span><b>${localUsage.cost.toFixed(4)}</b> API 成本</span></div></section>
          <div className="claude-model-list">{claudeModelUsage.map((item) => <article key={item.model}><div><strong>Claude {item.model}</strong><span>{item.input + item.output > 0 ? "已记录" : "等待首次调用"}</span></div><p><b>{(item.input + item.output).toLocaleString()}</b> Tokens</p><small>输入 {item.input.toLocaleString()} · 输出 {item.output.toLocaleString()} · 缓存 {item.cache.toLocaleString()} · ${item.cost.toFixed(4)}</small></article>)}</div>
        </div>
      </details>

      {providers.filter((provider) => !["deepseek", "claude"].includes(provider.id)).map((provider) => <details className={`provider-accordion ${provider.id}-interface`} open={usageProviderOpen === provider.id} key={provider.id}>
        <summary onClick={(event) => { event.preventDefault(); setUsageProviderOpen((current) => current === provider.id ? "" : provider.id); }}><div className="provider-summary-main"><div className={`provider-logo ${provider.id}`}>{provider.name.slice(0, 1)}</div><div><strong>{provider.name}</strong><span>{provider.summary}</span></div></div><div className="provider-summary-side"><span className={`provider-state ${provider.state}`}>{provider.configured ? provider.state === "ready" ? "已连接" : "受限" : "未配置"}</span><b>⌄</b></div></summary>
        <div className="provider-interface-body"><div className="empty-api-interface"><span>API INTERFACE</span><h3>{provider.name} 模型用量</h3><p>{provider.detail || "配置相应的组织级用量密钥后，这里会按模型显示请求、Tokens、缓存和成本。"}</p>{provider.balances?.map((balance) => <div className="balance" key={balance.currency}><b>{balance.currency} {balance.total}</b><span>赠金 {balance.granted || "0"} · 充值 {balance.toppedUp || "0"}</span></div>)}{provider.href && <a href={provider.href} target="_blank" rel="noreferrer">打开官方用量页 ↗</a>}</div></div>
      </details>)}
      </div>
        <div className="usage-heading bottom-refresh"><strong>接口状态</strong><button onClick={refreshUsage} disabled={usageLoading}>{usageLoading ? "检测中…" : "重新检测全部接口"}</button></div>
      <footer><span>DeepSeek 普通 API Key 只能查询余额；模型历史来自官方平台快照，客户端不会伪造缺失的逐日或缓存拆分数据。</span><code>{deepseekAnalytics?.updatedAt ? `更新于 ${new Date(deepseekAnalytics.updatedAt).toLocaleString("zh-CN")}` : "DEEPSEEK_API_KEY"}</code></footer>
    </section></div>}
  </main>;
}
