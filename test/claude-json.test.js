const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES,
  runClaudeJson,
} = require("../bin/claude-json");

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
  const stdoutCallbacks = [];
  const stderrChunks = [];
  const exitCodes = [];
  const propagatedSignals = [];

  const returnedChild = runClaudeJson({
    args: options.args || ["-p", "prompt"],
    spawn: options.spawn || ((command, args, spawnOptions) => {
      spawnCalls.push({ command, args, options: spawnOptions });
      return child;
    }),
    stdout: {
      write: (chunk, callback) => {
        stdoutChunks.push(String(chunk));
        if (options.deferStdoutCallback) {
          stdoutCallbacks.push(callback);
        } else if (callback) {
          callback();
        }
      },
    },
    stderr: { write: (chunk) => stderrChunks.push(chunk) },
    setExitCode: (code) => exitCodes.push(code),
    propagateSignal: (signal) => propagatedSignals.push(signal),
    maxStructuredOutputBytes: options.maxStructuredOutputBytes,
  });

  return {
    child,
    exitCodes,
    returnedChild,
    spawnCalls,
    stderrChunks,
    propagatedSignals,
    stdoutCallbacks,
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

test("runClaudeJson emits valid structured usage before preserving a non-zero exit", () => {
  const harness = createHarness();

  harness.child.stdout.emit("data", Buffer.from(JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    result: "request failed",
    usage: { input_tokens: 20, output_tokens: 4 },
  })));
  harness.child.emit("close", 7, null);

  assert.deepEqual(parseSingleCompactLine(harness.stdoutChunks).usage, {
    input_tokens: 20,
    output_tokens: 4,
  });
  assert.deepEqual(harness.exitCodes, [7]);
});

test("runClaudeJson flushes valid structured usage before propagating a child signal", () => {
  const harness = createHarness({ deferStdoutCallback: true });

  harness.child.stdout.emit("data", Buffer.from(JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    result: "interrupted",
    usage: { input_tokens: 30, output_tokens: 5 },
  })));
  harness.child.emit("close", null, "SIGTERM");

  assert.deepEqual(parseSingleCompactLine(harness.stdoutChunks).usage, {
    input_tokens: 30,
    output_tokens: 5,
  });
  assert.deepEqual(harness.propagatedSignals, []);
  assert.deepEqual(harness.exitCodes, []);

  harness.stdoutCallbacks[0]();

  assert.deepEqual(harness.propagatedSignals, ["SIGTERM"]);
  assert.deepEqual(harness.exitCodes, []);
});

test("runClaudeJson propagates a child signal when stdout is missing", () => {
  const harness = createHarness();

  harness.child.emit("close", null, "SIGHUP");

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.propagatedSignals, ["SIGHUP"]);
  assert.deepEqual(harness.exitCodes, []);
});

test("runClaudeJson propagates a child signal when stdout is invalid", () => {
  const harness = createHarness();

  harness.child.stdout.emit("data", Buffer.from("not-json"));
  harness.child.emit("close", null, "SIGINT");

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.propagatedSignals, ["SIGINT"]);
  assert.deepEqual(harness.exitCodes, []);
  assert.match(String(harness.stderrChunks.at(-1)), /valid JSON/i);
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

test("runClaudeJson accepts structured stdout exactly at the byte ceiling", () => {
  const output = Buffer.from(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "2",
    usage: {},
  }));
  const harness = createHarness({
    maxStructuredOutputBytes: output.length,
  });

  harness.child.stdout.emit("data", output);
  harness.child.emit("close", 0, null);

  assert.equal(parseSingleCompactLine(harness.stdoutChunks).result, "2");
  assert.deepEqual(harness.exitCodes, [0]);
});

test("runClaudeJson defaults its structured stdout ceiling to 1 MiB", () => {
  assert.equal(DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES, 1024 * 1024);
});

test("runClaudeJson drops structured stdout after the byte ceiling is exceeded", () => {
  const output = Buffer.from(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "2",
    usage: {},
  }));
  const harness = createHarness({
    maxStructuredOutputBytes: output.length - 1,
  });

  harness.child.stdout.emit("data", output);
  harness.child.emit("close", 0, null);

  assert.deepEqual(harness.stdoutChunks, []);
  assert.deepEqual(harness.exitCodes, [1]);
  assert.match(String(harness.stderrChunks.at(-1)), /valid JSON/i);
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
