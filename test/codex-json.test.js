const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const { normalizeCodexRun } = require("../lib/codex-json");
const {
  buildCodexArgs,
  runCodexJson,
} = require("../bin/codex-json");

function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function parseSingleJsonLine(chunks) {
  assert.equal(chunks.length, 1);
  const output = chunks[0];
  const value = JSON.parse(output);
  assert.equal(output, `${JSON.stringify(value)}\n`);
  return value;
}

test("normalizeCodexRun combines the final structured message and usage", () => {
  const stdout = jsonl([
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: JSON.stringify({
          success: true,
          answer: "42",
          message: "Calculation completed",
        }),
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 970,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 5,
      },
    },
  ]);

  assert.deepEqual(normalizeCodexRun({ stdout, exitCode: 0 }), {
    ok: true,
    value: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: {
        success: true,
        answer: "42",
        message: "Calculation completed",
      },
      error: null,
      usage: {
        input_tokens: 970,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 5,
        total_tokens: 995,
      },
    },
  });
});

test("normalizeCodexRun defaults missing usage counters to zero", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: '{"success":true,"answer":"7","message":"ok"}',
      },
    },
    { type: "turn.completed", usage: { input_tokens: 10 } },
  ]);

  assert.deepEqual(normalizeCodexRun({ stdout, exitCode: 0 }).value.usage, {
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 10,
  });
});

test("normalizeCodexRun rejects turn.failed while preserving usage", () => {
  const stdout = jsonl([
    {
      type: "turn.failed",
      error: { message: "request failed" },
      usage: { input_tokens: 12, output_tokens: 3 },
    },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 1 });

  assert.equal(normalized.ok, false);
  assert.equal(normalized.value.subtype, "error");
  assert.equal(normalized.value.is_error, true);
  assert.equal(normalized.value.result, null);
  assert.match(normalized.value.error, /request failed/);
  assert.equal(normalized.value.usage.total_tokens, 15);
});

test("normalizeCodexRun rejects a non-zero child exit", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: '{"success":true,"answer":"9","message":"ok"}',
      },
    },
    { type: "turn.completed", usage: {} },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 2 });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /code 2/);
});

test("normalizeCodexRun reports invalid JSONL", () => {
  const normalized = normalizeCodexRun({
    stdout: '{"type":"turn.started"}\nnot-json\n',
    exitCode: 0,
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /line 2/);
});

test("normalizeCodexRun reports a missing final agent message", () => {
  const normalized = normalizeCodexRun({
    stdout: jsonl([{ type: "turn.completed", usage: {} }]),
    exitCode: 0,
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /agent message/);
});

test("normalizeCodexRun reports a non-JSON final agent message", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: { type: "agent_message", text: "42" },
    },
    { type: "turn.completed", usage: {} },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 0 });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /final agent message/);
});

test("normalizeCodexRun reports spawn errors", () => {
  const normalized = normalizeCodexRun({
    stdout: "",
    exitCode: null,
    spawnError: new Error("codex not found"),
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /codex not found/);
});

test("normalizeCodexRun reports a null JSONL event without throwing", () => {
  const stdout = jsonl([null, { type: "turn.completed", usage: {} }]);
  let normalized;

  assert.doesNotThrow(() => {
    normalized = normalizeCodexRun({ stdout, exitCode: 0 });
  });
  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /line 1/);
});

test("normalizeCodexRun treats null usage as empty usage", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: { type: "agent_message", text: "{}" },
    },
    { type: "turn.completed", usage: null },
  ]);
  let normalized;

  assert.doesNotThrow(() => {
    normalized = normalizeCodexRun({ stdout, exitCode: 0 });
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.value.usage, {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  });
});

test("buildCodexArgs adds JSONL and schema flags after exec", () => {
  const schemaPath = "/repo/schemas/arithmetic-result.schema.json";

  assert.deepEqual(
    buildCodexArgs(["exec", "--model", "gpt-test", "Calculate 1 + 1"], schemaPath),
    [
      "exec",
      "--json",
      "--output-schema",
      schemaPath,
      "--model",
      "gpt-test",
      "Calculate 1 + 1",
    ],
  );
});

test("runCodexJson emits one result JSON and forwards stderr", () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const spawnCalls = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  const exitCodes = [];
  const stderrChunk = Buffer.from("model refresh warning\n");

  runCodexJson({
    args: ["exec", "prompt"],
    schemaPath: "/repo/schema.json",
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return child;
    },
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: (chunk) => stderrChunks.push(chunk) },
    setExitCode: (code) => exitCodes.push(code),
  });

  child.stderr.emit("data", stderrChunk);
  child.stdout.emit("data", Buffer.from(jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: '{"success":true,"answer":"2","message":"ok"}',
      },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 20, output_tokens: 4 },
    },
  ])));
  child.emit("close", 0, null);

  assert.deepEqual(spawnCalls, [{
    command: "codex",
    args: [
      "exec",
      "--json",
      "--output-schema",
      "/repo/schema.json",
      "prompt",
    ],
    options: { stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.equal(stderrChunks[0], stderrChunk);
  assert.equal(parseSingleJsonLine(stdoutChunks).usage.total_tokens, 24);
  assert.deepEqual(exitCodes, [0]);
});

test("runCodexJson preserves UTF-8 split across stdout chunks", () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdoutChunks = [];

  runCodexJson({
    args: ["exec", "prompt"],
    spawn: () => child,
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: () => {} },
    setExitCode: () => {},
  });

  const codexOutput = Buffer.from(jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({
          success: true,
          answer: "2",
          message: "计算完成",
        }),
      },
    },
    { type: "turn.completed", usage: {} },
  ]));
  const characterIndex = codexOutput.indexOf(Buffer.from("计"));
  assert.notEqual(characterIndex, -1);
  const splitIndex = characterIndex + 1;

  child.stdout.emit("data", codexOutput.subarray(0, splitIndex));
  child.stdout.emit("data", codexOutput.subarray(splitIndex));
  child.emit("close", 0, null);

  assert.deepEqual(parseSingleJsonLine(stdoutChunks).result, {
    success: true,
    answer: "2",
    message: "计算完成",
  });
});

test("runCodexJson normalizes synchronous spawn errors", () => {
  const stdoutChunks = [];
  const exitCodes = [];

  const child = runCodexJson({
    args: ["exec", "prompt"],
    spawn: () => {
      throw new Error("spawn denied");
    },
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: () => {} },
    setExitCode: (code) => exitCodes.push(code),
  });

  assert.equal(child, null);
  const output = parseSingleJsonLine(stdoutChunks);
  assert.equal(output.is_error, true);
  assert.match(output.error, /spawn denied/);
  assert.deepEqual(exitCodes, [1]);
});

test("runCodexJson emits one error result when the child fails", () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdoutChunks = [];
  const exitCodes = [];

  runCodexJson({
    args: ["exec", "prompt"],
    spawn: () => child,
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: () => {} },
    setExitCode: (code) => exitCodes.push(code),
  });

  child.emit("error", new Error("connection lost"));
  child.emit("close", 1, null);

  assert.match(parseSingleJsonLine(stdoutChunks).error, /connection lost/);
  assert.deepEqual(exitCodes, [1]);
});
