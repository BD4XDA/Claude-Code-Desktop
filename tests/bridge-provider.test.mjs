import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  BRIDGE_PROTOCOL, DEEPSEEK_BASE_URL, DEEPSEEK_EFFORT_MAP,
  modelAllowed, defaultModelFor, isLocalOrigin, deepSeekConfiguration, deepSeekCredential,
  deepSeekChildEnvironment, readDpapiKey, writeDpapiKey, deleteDpapiKey, fetchDeepSeekBalance,
  createBridgeHandler, __setDeepSeekMemoryKeyForTests, __setFetchImplForTests,
} from "../bridge/server.mjs";

// 测试密钥文件重定向到临时目录，绝不触碰用户真实 %LOCALAPPDATA%\ClaudeCodeWhite\。
const TEST_DPAPI_DIR = mkdtempSync(join(tmpdir(), "ccw-provider-test-"));
process.env.CCW_DPAPI_DIR = TEST_DPAPI_DIR;

const TEST_KEY = "sk-testkeynotreal0123456789abcdef";

function startServer(context) {
  const server = createServer(createBridgeHandler());
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      context.after(() => new Promise((done) => server.close(done)));
      resolvePromise(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function mockBalanceResponse(isAvailable = true) {
  return {
    is_available: isAvailable,
    currency: "CNY",
    balance_infos: [{ currency: "CNY", total_balance: "42.5", granted_balance: "0", topped_up_balance: "42.5" }],
  };
}

test("bridge protocol is 10 and provider whitelists stay independent", () => {
  assert.equal(BRIDGE_PROTOCOL, 10);
  assert.equal(modelAllowed("claude", "sonnet"), true);
  assert.equal(modelAllowed("claude", "opus"), true);
  assert.equal(modelAllowed("claude", "deepseek-v4-pro[1m]"), false);
  assert.equal(modelAllowed("deepseek", "deepseek-v4-pro[1m]"), true);
  assert.equal(modelAllowed("deepseek", "deepseek-v4-flash"), true);
  assert.equal(modelAllowed("deepseek", "deepseek-v4-pro"), true); // 兼容后备值
  assert.equal(modelAllowed("deepseek", "sonnet"), false);
  assert.equal(defaultModelFor("claude"), "sonnet");
  assert.equal(defaultModelFor("deepseek"), "deepseek-v4-pro[1m]");
  assert.deepEqual(DEEPSEEK_EFFORT_MAP, { low: "high", medium: "high", high: "high", xhigh: "max", max: "max" });
});

test("deepSeekChildEnvironment builds an isolated copy without mutating the original", () => {
  const base = {
    PATH: "C:\\windows",
    HOME: "C:\\Users\\tester",
    ANTHROPIC_API_KEY: "user-anthropic-key",
    ANTHROPIC_BASE_URL: "https://custom-proxy.local",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
  };
  const env = deepSeekChildEnvironment(base, "deepseek-v4-pro[1m]", "medium", TEST_KEY);
  assert.equal(env.ANTHROPIC_BASE_URL, DEEPSEEK_BASE_URL);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, TEST_KEY);
  assert.equal(env.ANTHROPIC_MODEL, "deepseek-v4-pro[1m]");
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "deepseek-v4-pro[1m]");
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "deepseek-v4-pro[1m]");
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-v4-flash");
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "deepseek-v4-flash");
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, "high");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(env.PATH, "C:\\windows");
  // 原对象不被修改
  assert.equal(base.ANTHROPIC_API_KEY, "user-anthropic-key");
  assert.equal(base.ANTHROPIC_BASE_URL, "https://custom-proxy.local");
  assert.equal(base.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, TEST_KEY);
  // xhigh/max → max
  assert.equal(deepSeekChildEnvironment({}, "deepseek-v4-flash", "xhigh", TEST_KEY).CLAUDE_CODE_EFFORT_LEVEL, "max");
});

test("origin guard accepts localhost and rejects foreign origins", () => {
  assert.equal(isLocalOrigin("http://localhost:3000"), true);
  assert.equal(isLocalOrigin("http://127.0.0.1:4318"), true);
  assert.equal(isLocalOrigin("https://localhost:443"), true);
  assert.equal(isLocalOrigin("https://evil.example.com"), false);
  assert.equal(isLocalOrigin("https://evil.example.com"), false);
  assert.equal(isLocalOrigin("http://localhost.evil.com"), false);
  assert.equal(isLocalOrigin(""), false);
});

test("POST provider state endpoints reject non-local origins before reading the body", async (context) => {
  const base = await startServer(context);
  const response = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
    body: JSON.stringify({ apiKey: TEST_KEY, remember: true }),
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /仅允许本机页面/);
});

test("POST /api/providers/deepseek rejects invalid keys and reports friendly errors", async (context) => {
  const base = await startServer(context);
  let calls = 0;
  __setFetchImplForTests(async (_url, options) => {
    calls += 1;
    assert.equal(options.headers.Authorization, `Bearer ${TEST_KEY}`);
    return new Response(JSON.stringify(mockBalanceResponse()), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  context.after(() => __setFetchImplForTests(globalThis.fetch));

  // 过大 body（>10KB）在验证前被拒绝
  const oversized = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ apiKey: TEST_KEY, junk: "x".repeat(12_000) }),
  });
  assert.equal(oversized.status, 400);

  // 空 Key / 含空白 Key 被拒绝，且不会调用余额接口
  const empty = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ apiKey: "   " }),
  });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /sk-|粘贴/);
  assert.equal(calls, 0);

  const blankInKey = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ apiKey: `${TEST_KEY} extra` }),
  });
  assert.equal(blankInKey.status, 400);
  assert.equal(calls, 0);
});

test("POST /api/providers/deepseek validates the key before storing, and never leaks it in responses", async (context) => {
  const base = await startServer(context);
  let invalid = false;
  __setFetchImplForTests(async (_url, options) => {
    if (invalid) return new Response(JSON.stringify({ error: "invalid api key" }), { status: 401, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(mockBalanceResponse(false)), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  context.after(() => { __setFetchImplForTests(globalThis.fetch); __setDeepSeekMemoryKeyForTests(null); });

  // 无效 Key：验证失败返回 400，且不覆盖此前可用的已保存 Key
  invalid = true;
  const bad = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ apiKey: TEST_KEY, remember: true }),
  });
  const badText = await bad.text();
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(badText).error, /无效或已失效/);
  assert.doesNotMatch(badText, /sk-testkey/);

  // 有效 Key（remember=false → 仅本次启动）
  invalid = false;
  const ok = await fetch(`${base}/api/providers/deepseek`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ apiKey: TEST_KEY, remember: false }),
  });
  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.connected, true);
  assert.equal(payload.source, "memory");
  assert.equal(payload.balanceAvailable, false);
  assert.equal(payload.configured, true);
  assert.equal(payload.secureStorage, false);
  assert.doesNotMatch(JSON.stringify(payload), /sk-testkey/);
  assert.equal(deepSeekCredential()?.source, "memory");
});

test("GET /api/providers/deepseek returns only non-sensitive provider state", async (context) => {
  const base = await startServer(context);
  __setDeepSeekMemoryKeyForTests(TEST_KEY);
  context.after(() => __setDeepSeekMemoryKeyForTests(null));
  const response = await fetch(`${base}/api/providers/deepseek`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.configured, true);
  assert.equal(payload.source, "memory");
  assert.equal(payload.baseUrl, DEEPSEEK_BASE_URL);
  assert.deepEqual(payload.models, ["deepseek-v4-pro[1m]", "deepseek-v4-flash"]);
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /sk-[a-zA-Z0-9]/);
  assert.doesNotMatch(text, /auth.*token/i);
});

test("DELETE /api/providers/deepseek clears CCW credentials but reports environment keys", async (context) => {
  const base = await startServer(context);
  __setDeepSeekMemoryKeyForTests(TEST_KEY);
  const previousEnv = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  context.after(() => {
    __setDeepSeekMemoryKeyForTests(null);
    if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousEnv;
  });

  let removed = await fetch(`${base}/api/providers/deepseek`, { method: "DELETE", headers: { Origin: "http://localhost:3000" } });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).configured, false);
  assert.equal(deepSeekCredential(), null);

  // 环境变量仍在时：不删除用户变量，响应继续报告 environment 来源
  process.env.DEEPSEEK_API_KEY = TEST_KEY;
  removed = await fetch(`${base}/api/providers/deepseek`, { method: "DELETE", headers: { Origin: "http://localhost:3000" } });
  assert.equal(removed.status, 200);
  const payload = await removed.json();
  assert.equal(payload.configured, true);
  assert.equal(payload.source, "environment");
  assert.match(payload.message, /DEEPSEEK_API_KEY/);
  assert.equal(process.env.DEEPSEEK_API_KEY, TEST_KEY);
});

test("credential precedence: memory beats environment beats Windows store", () => {
  const previousEnv = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  __setDeepSeekMemoryKeyForTests(null);
  try {
    assert.equal(deepSeekCredential(), null);
    process.env.DEEPSEEK_API_KEY = "sk-env-key-0123456789abcdef";
    assert.equal(deepSeekCredential()?.source, "environment");
    assert.equal(deepSeekCredential()?.key, "sk-env-key-0123456789abcdef");
    __setDeepSeekMemoryKeyForTests(TEST_KEY);
    assert.equal(deepSeekCredential()?.source, "memory");
    assert.equal(deepSeekCredential()?.key, TEST_KEY);
  } finally {
    __setDeepSeekMemoryKeyForTests(null);
    if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousEnv;
  }
});

test("fetchDeepSeekBalance distinguishes invalid-key from network errors", async () => {
  __setFetchImplForTests(async () => new Response(JSON.stringify({ error: "bad" }), { status: 401 }));
  await assert.rejects(fetchDeepSeekBalance(TEST_KEY), (error) => error?.code === "deepseek-invalid-key");
  __setFetchImplForTests(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(fetchDeepSeekBalance(TEST_KEY), /网络|失败|fetch failed/);
  __setFetchImplForTests(globalThis.fetch);
});

test("dpapi round-trip encrypts, decrypts, and deletes without leaking plaintext", { skip: process.platform !== "win32" }, async () => {
  const patternKey = `sk-dpatest-${"x".repeat(28)}`;
  writeDpapiKey(patternKey);
  const file = join(TEST_DPAPI_DIR, "deepseek-api-key.dpapi");
  const bytes = readFileSync(file);
  assert.ok(bytes.length > 0);
  assert.equal(bytes.includes(Buffer.from("sk-")), false, "加密文件不得包含明文 Key");
  assert.equal(readDpapiKey(), patternKey);
  deleteDpapiKey();
  assert.throws(() => readFileSync(file), /ENOENT/);
  assert.equal(readDpapiKey(), null);
  // 损坏文件不崩溃，只回退为未配置
  writeFileSync(file, Buffer.from("corrupted-content"));
  assert.equal(readDpapiKey(), null);
  rmSync(TEST_DPAPI_DIR, { recursive: true, force: true });
});

// 确保测试无论如何收尾，都不影响后续进程
after(() => {
  __setDeepSeekMemoryKeyForTests(null);
  __setFetchImplForTests(globalThis.fetch);
});
