# Last Execution Status and Token Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the previous Codex and Claude execution status plus compact/full token usage in the TUI task list and detail view.

**Architecture:** A pure execution-result normalizer parses captured structured stdout into provider-neutral task state. The scheduler buffers raw stdout per run and stores `lastExecution`; the TUI only formats normalized state and never parses command output.

**Tech Stack:** Node.js CommonJS, `node:test`, existing scheduler/TUI, Claude CLI JSON output with `jq -c`.

## Global Constraints

- Support both configured tasks: Codex and Claude.
- The list uses the existing fourteen-character `Last` column and compact values such as `OK · 995t`.
- The detail view shows a provider-appropriate token breakdown in at most two content lines.
- Status is execution-level; arithmetic answer correctness is not evaluated.
- Signal overrides all other status sources and produces `stopped`.
- Non-zero exit and structured `is_error: true` produce `error`.
- Missing or malformed structured stdout falls back to process status with `usage: null`.
- Codex total is input plus output unless a valid `total_tokens` is supplied; cached and reasoning counters are not added again.
- Claude total is input plus cache creation plus cache read plus output.
- Preserve the previous summary while a new run is executing.
- Keep existing Selected Output capture and schedule behavior unchanged.
- No new npm dependencies.

## File Structure

- Create `lib/execution-result.js`: pure structured-output parsing and provider usage normalization.
- Create `test/execution-result.test.js`: normalizer behavior tests.
- Modify `lib/scheduler.js`: capture raw stdout, track requested stop signals, and store `lastExecution`.
- Modify `test/scheduler.test.js`: scheduler lifecycle and Claude command tests.
- Modify `commands.json`: retain Claude status fields and use compact JSON.
- Modify `lib/tui.js`: compact summary, token formatting, and detail usage section.
- Modify `test/tui.test.js`: list/detail rendering and layout tests.
- Modify `README.md`: document status and token displays.

---

### Task 1: Execution Result Normalizer

**Files:**
- Create: `lib/execution-result.js`
- Create: `test/execution-result.test.js`

**Interfaces:**
- Produces: `normalizeLastExecution({ provider, stdout, exitCode, signal, error, finishedAt }) -> LastExecution`.
- Produces `LastExecution.status`: `success | error | stopped`.
- Produces `LastExecution.usage`: null or normalized usage with `kind: codex | claude`.

- [ ] **Step 1: Write failing Codex and Claude success tests**

Create `test/execution-result.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test/execution-result.test.js
```

Expected: FAIL with `Cannot find module '../lib/execution-result'`.

- [ ] **Step 3: Implement successful usage normalization**

Create `lib/execution-result.js`:

```js
function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function parseStructuredOutput(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;

  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function usageKind(provider, usage) {
  if (
    provider === "claude" ||
    Object.hasOwn(usage, "cache_creation_input_tokens") ||
    Object.hasOwn(usage, "cache_read_input_tokens")
  ) {
    return "claude";
  }
  return "codex";
}

function normalizeUsage(provider, usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const kind = usageKind(provider, usage);
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  const cachedInputTokens = tokenCount(usage.cached_input_tokens);
  const cacheCreationInputTokens = tokenCount(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = tokenCount(usage.cache_read_input_tokens);
  const reasoningOutputTokens = tokenCount(usage.reasoning_output_tokens);
  const hasSuppliedTotal =
    typeof usage.total_tokens === "number" &&
    Number.isFinite(usage.total_tokens) &&
    usage.total_tokens >= 0;
  const totalTokens = kind === "claude"
    ? inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens
    : hasSuppliedTotal
      ? usage.total_tokens
      : inputTokens + outputTokens;

  return {
    kind,
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function normalizeLastExecution({
  provider,
  stdout = "",
  exitCode = null,
  signal = null,
  error = null,
  finishedAt = Date.now(),
} = {}) {
  const structured = parseStructuredOutput(stdout);

  return {
    status: "success",
    finishedAt,
    exitCode,
    signal,
    error: error ? error.message || String(error) : null,
    usage: normalizeUsage(provider, structured && structured.usage),
  };
}

module.exports = {
  normalizeLastExecution,
};
```

- [ ] **Step 4: Run success tests and verify GREEN**

Run:

```bash
node --test test/execution-result.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Add failing status precedence and fallback tests**

Append to `test/execution-result.test.js`:

```js
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
```

- [ ] **Step 6: Run precedence tests and verify RED**

Run:

```bash
node --test test/execution-result.test.js
```

Expected: the two success tests pass and status precedence tests fail because the implementation always reports success.

- [ ] **Step 7: Implement status precedence**

Replace the return portion of `normalizeLastExecution` with:

```js
  const structuredError =
    structured &&
    (structured.is_error === true ||
      (typeof structured.subtype === "string" && structured.subtype !== "success"));
  const errorMessage = error ? error.message || String(error) : null;

  let status = "success";
  if (signal) {
    status = "stopped";
  } else if (errorMessage || (exitCode !== null && exitCode !== 0)) {
    status = "error";
  } else if (structuredError) {
    status = "error";
  }

  return {
    status,
    finishedAt,
    exitCode,
    signal,
    error: errorMessage,
    usage: normalizeUsage(provider, structured && structured.usage),
  };
```

- [ ] **Step 8: Run normalizer tests and verify GREEN**

Run:

```bash
node --test test/execution-result.test.js
```

Expected: 9 tests pass.

- [ ] **Step 9: Commit the normalizer**

```bash
git add lib/execution-result.js test/execution-result.test.js
git commit -m "feat: normalize command execution usage"
```

---

### Task 2: Scheduler Capture and Claude Structured Status

**Files:**
- Modify: `lib/scheduler.js`
- Modify: `test/scheduler.test.js`
- Modify: `commands.json`

**Interfaces:**
- Consumes: `normalizeLastExecution` from Task 1.
- Produces: task state `lastExecution`, deeply copied by `getState()`.
- Produces: Claude stdout containing compact `{type, subtype, is_error, result, usage}` JSON.

- [ ] **Step 1: Update the expected Claude command first**

In `test/scheduler.test.js`, change the expected Claude shell command to:

```js
'claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq -c \'{type, subtype, is_error, result, usage}\''
```

- [ ] **Step 2: Verify the command test fails**

Run:

```bash
node --test --test-name-pattern="default commands" test/scheduler.test.js
```

Expected: FAIL because the current command uses pretty `{result, usage}` output.

- [ ] **Step 3: Update built-in and configured Claude commands**

Apply the exact compact filter from Step 1 to both `lib/scheduler.js` and
`commands.json`. Do not change the Claude CLI flags, Codex command, or schedule.

- [ ] **Step 4: Verify the command test passes**

Run:

```bash
node --test --test-name-pattern="default commands" test/scheduler.test.js
```

Expected: PASS.

- [ ] **Step 5: Add failing scheduler state tests**

Append tests to `test/scheduler.test.js` using EventEmitter children with piped
stdout/stderr:

```js
test("createTaskController stores Codex lastExecution and usage", () => {
  let child;
  const task = createTaskController(
    { name: "codex", command: "example", args: [] },
    {
      captureOutput: true,
      now: () => 5000,
      spawn: () => {
        child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runNow();
  child.stdout.emit("data", Buffer.from('{"subtype":"success","is_error":false,"usage":{"input_tokens":10,'));
  child.stdout.emit("data", Buffer.from('"output_tokens":2,"total_tokens":12}}\n'));
  child.emit("close", 0, null);

  assert.equal(task.getState().lastExecution.status, "success");
  assert.equal(task.getState().lastExecution.finishedAt, 5000);
  assert.equal(task.getState().lastExecution.usage.totalTokens, 12);
});

test("createTaskController preserves lastExecution while the next run is running", () => {
  const children = [];
  const task = createTaskController(
    { name: "claude", command: "example", args: [] },
    {
      captureOutput: true,
      spawn: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        children.push(child);
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runNow();
  children[0].stdout.emit("data", Buffer.from('{"subtype":"success","is_error":false,"usage":{"output_tokens":3}}'));
  children[0].emit("close", 0, null);
  const previous = task.getState().lastExecution;

  task.runNow();

  assert.deepEqual(task.getState().lastExecution, previous);
});

test("createTaskController records requested stop as stopped", () => {
  let child;
  const task = createTaskController(
    { name: "codex", command: "example", args: [] },
    {
      captureOutput: true,
      spawn: () => {
        child = new EventEmitter();
        child.pid = 123;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        return child;
      },
      killProcess: () => {},
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  task.stop();
  child.emit("close", 1, null);

  assert.equal(task.getState().lastExecution.status, "stopped");
  assert.equal(task.getState().lastExecution.signal, "SIGTERM");
});

test("createTaskController records start failures in lastExecution", () => {
  const task = createTaskController(
    { name: "codex", command: "missing", args: [] },
    {
      now: () => 99,
      spawn: () => {
        throw new Error("spawn denied");
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runNow();

  assert.equal(task.getState().lastExecution.status, "error");
  assert.equal(task.getState().lastExecution.error, "spawn denied");
  assert.equal(task.getState().lastExecution.finishedAt, 99);
});
```

- [ ] **Step 6: Run scheduler tests and verify RED**

Run:

```bash
node --test test/scheduler.test.js
```

Expected: new tests fail because task state has no `lastExecution`.

- [ ] **Step 7: Add scheduler state and raw stdout capture**

In `lib/scheduler.js`:

```js
const { normalizeLastExecution } = require("./execution-result");
```

Initialize state with:

```js
lastExecution: null,
```

Deep-copy it in `getState()`:

```js
lastExecution: state.lastExecution
  ? {
      ...state.lastExecution,
      usage: state.lastExecution.usage
        ? { ...state.lastExecution.usage }
        : null,
    }
  : null,
```

Add controller state:

```js
let requestedSignal = null;
let runGeneration = 0;
```

At the beginning of each new `runOnce`, after rejecting an existing child:

```js
requestedSignal = null;
const generation = ++runGeneration;
let settled = false;
```

Change output attachment to accept a run-local buffer:

```js
function attachOutputCapture(runningChild, stdoutChunks) {
  if (!captureOutput) return;

  if (runningChild.stdout) {
    runningChild.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      appendOutput("stdout", chunk);
    });
  }

  if (runningChild.stderr) {
    runningChild.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
  }
}
```

When termination is requested for the active child:

```js
if (runningChild === child) requestedSignal = signal;
```

After spawning, create `const stdoutChunks = [];` and pass it to
`attachOutputCapture`.

The existing child handlers currently use `if (child !== runningChild) return`.
Replace that guard in both `error` and `close` handlers with:

```js
if (settled || generation !== runGeneration) return;
settled = true;
```

This deliberately allows a stopped child to report its close event after
`stop()` clears `child`, but still ignores that old close after a newer run has
incremented `runGeneration`. It also prevents an `error` followed by `close`
from recording the same run twice.

On synchronous or emitted start error, set:

```js
lastExecution: normalizeLastExecution({
  provider: commandSpec.name,
  error,
  finishedAt: now(),
}),
```

On close, compute:

```js
const effectiveSignal = signal || requestedSignal;
const lastExecution = normalizeLastExecution({
  provider: commandSpec.name,
  stdout: Buffer.concat(stdoutChunks).toString("utf8"),
  exitCode: code,
  signal: effectiveSignal,
  finishedAt: now(),
});
```

Store `lastExecution`, `lastExitCode: code`, and
`lastSignal: effectiveSignal` in `nextState`.

- [ ] **Step 8: Run scheduler tests and verify GREEN**

Run:

```bash
node --test test/scheduler.test.js
```

Expected: all scheduler tests pass.

- [ ] **Step 9: Run normalizer and scheduler tests together**

Run:

```bash
node --test test/execution-result.test.js test/scheduler.test.js
```

Expected: all selected tests pass.

- [ ] **Step 10: Commit scheduler integration**

```bash
git add lib/scheduler.js test/scheduler.test.js commands.json
git commit -m "feat: track last execution token usage"
```

---

### Task 3: TUI Status and Token Rendering

**Files:**
- Modify: `lib/tui.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: scheduler `state.lastExecution` from Task 2.
- Produces: `formatTokenCount(value) -> string`.
- Produces: compact `Last` summary and provider-specific usage detail lines.

- [ ] **Step 1: Add failing token formatter tests**

Update imports in `test/tui.test.js` and add:

```js
const {
  formatRemainingTime,
  formatTokenCount,
  renderDashboard,
  startTui,
} = require('../lib/tui');

test('formatTokenCount formats exact, kilo, and mega token values', () => {
  assert.equal(formatTokenCount(0), '0t');
  assert.equal(formatTokenCount(999), '999t');
  assert.equal(formatTokenCount(1_000), '1.0kt');
  assert.equal(formatTokenCount(1_700), '1.7kt');
  assert.equal(formatTokenCount(1_000_000), '1.0Mt');
});
```

- [ ] **Step 2: Run formatter test and verify RED**

Run:

```bash
node --test --test-name-pattern="formatTokenCount" test/tui.test.js
```

Expected: FAIL because `formatTokenCount` is not exported.

- [ ] **Step 3: Implement and export token formatting**

Add to `lib/tui.js`:

```js
function formatTokenCount(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}Mt`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}kt`;
  return `${value}t`;
}
```

Export it from `module.exports`.

- [ ] **Step 4: Run formatter test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Update sample task state and add failing rendering tests**

Give the Claude sample task this `lastExecution`:

```js
lastExecution: {
  status: 'success',
  finishedAt: 1000,
  exitCode: 0,
  signal: null,
  error: null,
  usage: {
    kind: 'claude',
    inputTokens: 2,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 1561,
    cacheReadInputTokens: 0,
    outputTokens: 136,
    reasoningOutputTokens: 0,
    totalTokens: 1699,
  },
},
```

Change list expectations to include `OK · 1.7kt`. Change detail expectations to
include:

```text
Last Token Usage
Total 1,699 · Input 2 · Output 136
Cache create 1,561 · Cache read 0
```

Add this focused list test:

```js
test('renderDashboard list mode summarizes error and stopped executions', () => {
  const tasks = [
    {
      name: 'codex',
      status: 'waiting',
      mode: 'timer',
      command: 'codex',
      args: [],
      nextRunAt: null,
      lastExecution: {
        status: 'error',
        exitCode: 1,
        signal: null,
        error: null,
        usage: null,
      },
      outputLines: [],
    },
    {
      name: 'claude',
      status: 'stopped',
      mode: 'idle',
      command: 'claude',
      args: [],
      nextRunAt: null,
      lastExecution: {
        status: 'stopped',
        exitCode: 1,
        signal: 'SIGTERM',
        error: null,
        usage: {
          kind: 'claude',
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
      },
      outputLines: [],
    },
  ];

  const output = renderDashboard(tasks, { now: 1000, mode: 'list' });

  assert.match(output, /codex.*ERR · -/);
  assert.match(output, /claude.*STOP · 0t/);
});
```

Add this Codex detail test:

```text
Total 995 · Input 970 · Output 25
Cached 100 · Reasoning 5
```

```js
test('renderDashboard detail mode shows Codex token breakdown', () => {
  const tasks = sampleTasks();
  tasks[0].lastExecution = {
    status: 'success',
    finishedAt: 1000,
    exitCode: 0,
    signal: null,
    error: null,
    usage: {
      kind: 'codex',
      inputTokens: 970,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 25,
      reasoningOutputTokens: 5,
      totalTokens: 995,
    },
  };

  const output = renderDashboard(tasks, {
    selectedIndex: 0,
    now: 1000,
    mode: 'detail',
  });

  assert.match(output, /Last:\s+OK · exit=0/);
  assert.match(output, /Last Token Usage/);
  assert.match(output, /Total 995 · Input 970 · Output 25/);
  assert.match(output, /Cached 100 · Reasoning 5/);
});
```

- [ ] **Step 6: Run TUI tests and verify RED**

Run:

```bash
node --test test/tui.test.js
```

Expected: rendering tests fail because `Last` still uses exit codes and the
detail view has no token section.

- [ ] **Step 7: Implement compact status and detail usage formatting**

Add to `lib/tui.js`:

```js
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function statusLabel(status) {
  if (status === 'success') return 'OK';
  if (status === 'stopped') return 'STOP';
  return 'ERR';
}

function formatLastSummary(state) {
  if (!state.lastExecution) return '-';
  const usage = state.lastExecution.usage;
  const tokens = usage ? formatTokenCount(usage.totalTokens) : '-';
  return `${statusLabel(state.lastExecution.status)} · ${tokens}`;
}

function formatLastDetail(state) {
  if (!state.lastExecution) return formatLastResult(state);

  const parts = [statusLabel(state.lastExecution.status)];
  if (state.lastExecution.signal) {
    parts.push(`signal=${state.lastExecution.signal}`);
  } else if (state.lastExecution.error) {
    parts.push(`error=${state.lastExecution.error}`);
  } else if (state.lastExecution.exitCode !== null) {
    parts.push(`exit=${state.lastExecution.exitCode}`);
  }
  return parts.join(' · ');
}

function formatTokenUsageLines(usage) {
  if (!usage) return ['-'];
  const number = (value) => NUMBER_FORMAT.format(value);
  const first = `Total ${number(usage.totalTokens)} · Input ${number(usage.inputTokens)} · Output ${number(usage.outputTokens)}`;

  if (usage.kind === 'claude') {
    return [
      first,
      `Cache create ${number(usage.cacheCreationInputTokens)} · Cache read ${number(usage.cacheReadInputTokens)}`,
    ];
  }

  return [
    first,
    `Cached ${number(usage.cachedInputTokens)} · Reasoning ${number(usage.reasoningOutputTokens)}`,
  ];
}
```

Use `formatLastSummary(state)` in `renderTaskTable`.
Use `formatLastDetail(selectedTask)` in the detail header.

Create:

```js
const usageLines = sectionBox(
  'Last Token Usage',
  formatTokenUsageLines(selectedTask.lastExecution && selectedTask.lastExecution.usage),
);
```

Insert `usageLines` between Selected Command and Selected Output. To preserve at
least one Selected Output content line in an 18-row terminal, use this compact
layout with only one blank separator:

```js
const fixedLineCount =
  headerLines.length + 1 + commandLines.length + usageLines.length + 2;
const outputLineLimit = Math.max(1, Math.min(24, rows - fixedLineCount));
const lines = [
  ...headerLines,
  '',
  ...commandLines,
  ...usageLines,
  ...sectionBox('Selected Output', outputLines.length === 0 ? ['-'] : outputLines),
];
```

- [ ] **Step 8: Run TUI tests and verify GREEN**

Run:

```bash
node --test test/tui.test.js
```

Expected: all TUI tests pass, including the existing terminal-height limit.

- [ ] **Step 9: Commit TUI rendering**

```bash
git add lib/tui.js test/tui.test.js
git commit -m "feat: display last execution token usage"
```

---

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: final task state and TUI display from Tasks 1-3.
- Produces: accurate user documentation for list/detail status and token usage.

- [ ] **Step 1: Update README Claude command examples**

Update both Claude command examples to use:

```bash
jq -c '{type, subtype, is_error, result, usage}'
```

- [ ] **Step 2: Document list and detail displays**

Add a TUI section showing:

```text
Last
OK · 995t
ERR · 1.7kt
STOP · 0t
```

Document that detail view shows Codex cached/reasoning counters or Claude
cache-create/cache-read counters, and that status is execution-level rather
than arithmetic-answer validation.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run static checks**

Run:

```bash
git diff --check
node -e 'JSON.parse(require("node:fs").readFileSync("commands.json", "utf8"))'
```

Expected: both commands exit zero with no output.

- [ ] **Step 5: Verify documentation matches configuration**

Run:

```bash
rg -n "jq -c|OK ·|Last Token Usage|Cache create|Reasoning" README.md commands.json lib/tui.js
```

Expected: README, configuration, and rendering code contain matching command
and display terminology.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain last execution usage display"
```

- [ ] **Step 7: Run fresh post-commit verification**

Run:

```bash
npm test
git status --short
```

Expected: all tests pass and status output is empty.
