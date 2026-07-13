const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { runClaudeJson } = require("../bin/claude-json");

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function createHarness(options = {}) {
  const child = options.child || createChild();
  const spawnCalls = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  const exitCodes = [];

  const returnedChild = runClaudeJson({
    args: options.args || ["-p", "prompt"],
    spawn: options.spawn || ((command, args, spawnOptions) => {
      spawnCalls.push({ command, args, options: spawnOptions });
      return child;
    }),
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: (chunk) => stderrChunks.push(chunk) },
    setExitCode: (code) => exitCodes.push(code),
  });

  return {
    child,
    exitCodes,
    returnedChild,
    spawnCalls,
    stderrChunks,
    stdoutChunks,
  };
}

function parseSingleCompactLine(chunks) {
  assert.equal(chunks.length, 1);
  const parsed = JSON.parse(chunks[0]);
  assert.equal(chunks[0], `${JSON.stringify(parsed)}\n`);
  return parsed;
}

test("runClaudeJson passes direct argv and emits one compact projected result", () => {
  const harness = createHarness({
    args: [
      "-p",
      "--bare",
      "--system-prompt",
      "",
      "--output-format",
      "json",
      "Calculate 1 + 1",
    ],
  });

  harness.child.stdout.emit("data", Buffer.from(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "2",
    usage: { input_tokens: 10, output_tokens: 2 },
    extra: "discarded",
  })));
  harness.child.emit("close", 0, null);

  assert.deepEqual(harness.spawnCalls, [{
    command: "claude",
    args: [
      "-p",
      "--bare",
      "--system-prompt",
      "",
      "--output-format",
      "json",
      "Calculate 1 + 1",
    ],
    options: { stdio: ["ignore", "pipe", "pipe"] },
  }]);
  assert.deepEqual(parseSingleCompactLine(harness.stdoutChunks), {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "2",
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  assert.deepEqual(harness.exitCodes, [0]);
  assert.equal(harness.returnedChild, harness.child);
});

test("runClaudeJson forwards child stderr unchanged", () => {
  const harness = createHarness();
  const diagnostic = Buffer.from("rate limit warning\n");

  harness.child.stderr.emit("data", diagnostic);
  harness.child.stdout.emit("data", Buffer.from("{}"));
  harness.child.emit("close", 0, null);

  assert.equal(harness.stderrChunks[0], diagnostic);
});

test("runClaudeJson preserves a non-zero child exit with no stdout", () => {
  const harness = createHarness();

  harness.child.emit("close", 7, null);

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.exitCodes, [7]);
});

test("runClaudeJson rejects invalid outer JSON", () => {
  const harness = createHarness();

  harness.child.stdout.emit("data", Buffer.from("not-json"));
  harness.child.emit("close", 0, null);

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.exitCodes, [1]);
  assert.match(String(harness.stderrChunks.at(-1)), /valid JSON/i);
});

test("runClaudeJson preserves UTF-8 split across stdout chunks", () => {
  const harness = createHarness();
  const output = Buffer.from(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "计算完成",
    usage: {},
  }));
  const splitAt = output.indexOf(Buffer.from("计")) + 1;

  harness.child.stdout.emit("data", output.subarray(0, splitAt));
  harness.child.stdout.emit("data", output.subarray(splitAt));
  harness.child.emit("close", 0, null);

  assert.equal(parseSingleCompactLine(harness.stdoutChunks).result, "计算完成");
  assert.deepEqual(harness.exitCodes, [0]);
});

test("runClaudeJson preserves synchronous spawn failure", () => {
  const harness = createHarness({
    spawn: () => {
      throw new Error("spawn denied");
    },
  });

  assert.equal(harness.returnedChild, null);
  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.exitCodes, [1]);
  assert.match(String(harness.stderrChunks.at(-1)), /spawn denied/);
});

test("runClaudeJson settles exactly once for async spawn error followed by close", () => {
  const harness = createHarness();

  harness.child.emit("error", new Error("claude unavailable"));
  harness.child.emit("close", 1, null);

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.exitCodes, [1]);
  assert.equal(harness.stderrChunks.length, 1);
  assert.match(String(harness.stderrChunks[0]), /claude unavailable/);
});

test("runClaudeJson ignores late events after a valid result", () => {
  const harness = createHarness();

  harness.child.stdout.emit("data", Buffer.from(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "2",
    usage: {},
  })));
  harness.child.emit("close", 0, null);
  harness.child.emit("error", new Error("late error"));
  harness.child.emit("close", 1, null);

  assert.equal(harness.stdoutChunks.length, 1);
  assert.deepEqual(harness.exitCodes, [0]);
});
