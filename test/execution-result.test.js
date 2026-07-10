const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeLastExecution } = require("../lib/execution-result");

test("normalizeLastExecution maps Codex status and usage", () => {
  const result = normalizeLastExecution({
    provider: "codex",
    stdout: JSON.stringify({
      subtype: "success",
      is_error: false,
      usage: {
        input_tokens: 970,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 5,
        total_tokens: 995,
      },
    }),
    exitCode: 0,
    finishedAt: 1234,
  });

  assert.deepEqual(result, {
    status: "success",
    finishedAt: 1234,
    exitCode: 0,
    signal: null,
    error: null,
    usage: {
      kind: "codex",
      inputTokens: 970,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 25,
      reasoningOutputTokens: 5,
      totalTokens: 995,
    },
  });
});

test("normalizeLastExecution maps Claude cache usage", () => {
  const result = normalizeLastExecution({
    provider: "claude",
    stdout: JSON.stringify({
      subtype: "success",
      is_error: false,
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 1561,
        cache_read_input_tokens: 10,
        output_tokens: 136,
      },
    }),
    exitCode: 0,
    finishedAt: 5678,
  });

  assert.equal(result.status, "success");
  assert.deepEqual(result.usage, {
    kind: "claude",
    inputTokens: 2,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 1561,
    cacheReadInputTokens: 10,
    outputTokens: 136,
    reasoningOutputTokens: 0,
    totalTokens: 1709,
  });
});

test("signal produces stopped and overrides structured errors", () => {
  const result = normalizeLastExecution({
    provider: "codex",
    stdout: JSON.stringify({
      subtype: "error",
      is_error: true,
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
    exitCode: 1,
    signal: "SIGTERM",
    finishedAt: 1,
  });

  assert.equal(result.status, "stopped");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.usage.totalTokens, 12);
});

test("non-zero exit overrides a structured success", () => {
  const result = normalizeLastExecution({
    provider: "codex",
    stdout: '{"subtype":"success","is_error":false,"usage":{}}',
    exitCode: 2,
  });

  assert.equal(result.status, "error");
});

test("structured is_error marks a zero-exit command as error", () => {
  const result = normalizeLastExecution({
    provider: "claude",
    stdout: '{"subtype":"error","is_error":true,"usage":{"output_tokens":3}}',
    exitCode: 0,
  });

  assert.equal(result.status, "error");
  assert.equal(result.usage.totalTokens, 3);
});

test("malformed structured output falls back to process success", () => {
  const result = normalizeLastExecution({
    provider: "codex",
    stdout: "not-json",
    exitCode: 0,
  });

  assert.equal(result.status, "success");
  assert.equal(result.usage, null);
});

test("multiline structured output is parsed", () => {
  const result = normalizeLastExecution({
    provider: "claude",
    stdout: '{\n  "subtype": "success",\n  "is_error": false,\n  "usage": {"input_tokens": 1}\n}',
    exitCode: 0,
  });

  assert.equal(result.status, "success");
  assert.equal(result.usage.totalTokens, 1);
});

test("start errors produce error status without usage", () => {
  const result = normalizeLastExecution({
    provider: "codex",
    error: new Error("spawn denied"),
    finishedAt: 99,
  });

  assert.equal(result.status, "error");
  assert.equal(result.error, "spawn denied");
  assert.equal(result.usage, null);
});

test("invalid and negative token counters normalize to zero", () => {
  const result = normalizeLastExecution({
    provider: "claude",
    stdout: JSON.stringify({
      usage: {
        input_tokens: -1,
        cache_creation_input_tokens: "5",
        cache_read_input_tokens: Number.NaN,
        output_tokens: 2,
      },
    }),
    exitCode: 0,
  });

  assert.equal(result.usage.totalTokens, 2);
});
