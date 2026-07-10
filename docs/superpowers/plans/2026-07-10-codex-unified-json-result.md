# Codex Unified JSON Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the configured Codex task emit one normalized JSON object containing the schema-constrained arithmetic answer and Codex's measured token usage while leaving diagnostics on stderr.

**Architecture:** A pure CommonJS parser normalizes Codex JSONL events, and a thin executable wrapper owns process spawning and stream separation. The generic scheduler remains provider-agnostic; `commands.json` routes only the Codex task through the wrapper.

**Tech Stack:** Node.js CommonJS, `node:child_process`, `node:test`, JSON Schema, existing scheduler/configuration system.

## Global Constraints

- Codex stdout must contain exactly one normalized JSON object followed by a newline.
- Codex stderr must be forwarded unchanged and must not determine success by itself.
- Success requires child exit code `0` and a terminal `turn.completed` event.
- `total_tokens` equals `input_tokens + output_tokens`; cached and reasoning token counters are not added again.
- Claude command behavior and scheduling values remain unchanged.
- No new npm dependencies.

## File Structure

- Create `schemas/arithmetic-result.schema.json`: strict final-response schema passed to Codex.
- Create `lib/codex-json.js`: pure JSONL parsing, usage normalization, and success/error result construction.
- Create `bin/codex-json.js`: Codex child-process wrapper and stdout/stderr orchestration.
- Create `test/codex-json.test.js`: parser and wrapper behavior tests with no network access.
- Modify `lib/config.js`: resolve relative executable paths against the configuration file directory.
- Modify `test/config.test.js`: lock relative executable path resolution.
- Modify `lib/scheduler.js`: update only the built-in Codex command to call the absolute wrapper path.
- Modify `test/scheduler.test.js`: lock the new built-in command contract.
- Modify `commands.json`: route the configured Codex task through the wrapper.
- Modify `README.md`: document the wrapper command and unified output contract.

---

### Task 1: Strict Arithmetic Schema and JSONL Normalizer

**Files:**
- Create: `schemas/arithmetic-result.schema.json`
- Create: `lib/codex-json.js`
- Create: `test/codex-json.test.js`

**Interfaces:**
- Consumes: Codex stdout JSONL text, numeric/null child exit code, and optional child signal or spawn error.
- Produces: `normalizeCodexRun({ stdout, exitCode, signal, spawnError }) -> { ok: boolean, value: object }`.
- Produces: `value` with keys `type`, `subtype`, `is_error`, `result`, `error`, and `usage`.

- [ ] **Step 1: Write the failing success and usage tests**

Create `test/codex-json.test.js` with the first tests:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeCodexRun } = require("../lib/codex-json");

function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
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
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: FAIL with `Cannot find module '../lib/codex-json'`.

- [ ] **Step 3: Add the strict arithmetic response schema**

Create `schemas/arithmetic-result.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "success": { "type": "boolean" },
    "answer": { "type": "string" },
    "message": { "type": "string" }
  },
  "required": ["success", "answer", "message"],
  "additionalProperties": false
}
```

- [ ] **Step 4: Implement the minimal successful-run normalizer**

Create `lib/codex-json.js`:

```js
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(usage = {}) {
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);

  return {
    input_tokens: inputTokens,
    cached_input_tokens: numberOrZero(usage.cached_input_tokens),
    output_tokens: outputTokens,
    reasoning_output_tokens: numberOrZero(usage.reasoning_output_tokens),
    total_tokens: inputTokens + outputTokens,
  };
}

function parseEvents(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function findLast(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function normalizeCodexRun({ stdout, exitCode }) {
  const events = parseEvents(stdout);
  const terminalEvent = findLast(
    events,
    (event) => event.type === "turn.completed" || event.type === "turn.failed",
  );
  const messageEvent = findLast(
    events,
    (event) =>
      event.type === "item.completed" &&
      event.item &&
      event.item.type === "agent_message",
  );
  const result = JSON.parse(messageEvent.item.text);

  return {
    ok: exitCode === 0 && terminalEvent.type === "turn.completed",
    value: {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      error: null,
      usage: normalizeUsage(terminalEvent.usage),
    },
  };
}

module.exports = {
  normalizeCodexRun,
};
```

- [ ] **Step 5: Run the parser tests and verify GREEN**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: 2 tests pass.

- [ ] **Step 6: Add failing normalization error tests**

Append to `test/codex-json.test.js`:

```js
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
```

- [ ] **Step 7: Run the new tests and verify RED**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: the success tests pass and the six error tests fail because the initial implementation throws or returns a success-shaped value.

- [ ] **Step 8: Complete defensive normalization**

Replace `lib/codex-json.js` with a defensive implementation that:

```js
function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(usage = {}) {
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);

  return {
    input_tokens: inputTokens,
    cached_input_tokens: numberOrZero(usage.cached_input_tokens),
    output_tokens: outputTokens,
    reasoning_output_tokens: numberOrZero(usage.reasoning_output_tokens),
    total_tokens: inputTokens + outputTokens,
  };
}

function errorValue(message, usage) {
  return {
    ok: false,
    value: {
      type: "result",
      subtype: "error",
      is_error: true,
      result: null,
      error: message,
      usage: normalizeUsage(usage),
    },
  };
}

function parseEvents(stdout) {
  const events = [];
  const lines = String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`invalid Codex JSONL at line ${index + 1}`);
    }
  }

  return events;
}

function findLast(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function eventErrorMessage(event) {
  return event && event.error && typeof event.error.message === "string"
    ? event.error.message
    : "Codex turn failed";
}

function normalizeCodexRun({
  stdout = "",
  exitCode = null,
  signal = null,
  spawnError = null,
} = {}) {
  if (spawnError) return errorValue(`Codex failed to start: ${spawnError.message}`);

  let events;
  try {
    events = parseEvents(stdout);
  } catch (error) {
    return errorValue(error.message);
  }

  const terminalEvent = findLast(
    events,
    (event) => event.type === "turn.completed" || event.type === "turn.failed",
  );
  const usage = terminalEvent && terminalEvent.usage;

  if (!terminalEvent) return errorValue("Codex terminal event is missing");
  if (terminalEvent.type === "turn.failed") {
    return errorValue(eventErrorMessage(terminalEvent), usage);
  }
  if (signal) return errorValue(`Codex exited with signal ${signal}`, usage);
  if (exitCode !== 0) return errorValue(`Codex exited with code ${exitCode}`, usage);

  const messageEvent = findLast(
    events,
    (event) =>
      event.type === "item.completed" &&
      event.item &&
      event.item.type === "agent_message",
  );
  if (!messageEvent) return errorValue("Codex final agent message is missing", usage);

  let result;
  try {
    result = JSON.parse(messageEvent.item.text);
  } catch {
    return errorValue("Codex final agent message is not valid JSON", usage);
  }

  return {
    ok: true,
    value: {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      error: null,
      usage: normalizeUsage(usage),
    },
  };
}

module.exports = {
  normalizeCodexRun,
};
```

- [ ] **Step 9: Run the parser tests and verify GREEN**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: 8 tests pass.

- [ ] **Step 10: Commit the parser and schema**

```bash
git add schemas/arithmetic-result.schema.json lib/codex-json.js test/codex-json.test.js
git commit -m "feat: normalize codex json events"
```

---

### Task 2: Codex Process Wrapper

**Files:**
- Create: `bin/codex-json.js`
- Modify: `test/codex-json.test.js`

**Interfaces:**
- Consumes: `normalizeCodexRun` from Task 1.
- Produces: `buildCodexArgs(args, schemaPath) -> string[]`.
- Produces: `runCodexJson({ args, spawn, stdout, stderr, setExitCode, schemaPath }) -> child | null`.
- Runtime contract: forward child stderr immediately, buffer child stdout, emit one normalized JSON line at completion.

- [ ] **Step 1: Add failing argument and stream orchestration tests**

Append these imports and tests to `test/codex-json.test.js`:

```js
const { EventEmitter } = require("node:events");
const path = require("node:path");

const {
  buildCodexArgs,
  runCodexJson,
} = require("../bin/codex-json");

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

  runCodexJson({
    args: ["exec", "prompt"],
    schemaPath: "/repo/schema.json",
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return child;
    },
    stdout: { write: (chunk) => stdoutChunks.push(String(chunk)) },
    stderr: { write: (chunk) => stderrChunks.push(String(chunk)) },
    setExitCode: (code) => exitCodes.push(code),
  });

  child.stderr.emit("data", Buffer.from("model refresh warning\n"));
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
  assert.deepEqual(stderrChunks, ["model refresh warning\n"]);
  assert.equal(stdoutChunks.length, 1);
  assert.equal(JSON.parse(stdoutChunks[0]).usage.total_tokens, 24);
  assert.deepEqual(exitCodes, [0]);
});
```

- [ ] **Step 2: Run the wrapper tests and verify RED**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: FAIL with `Cannot find module '../bin/codex-json'`.

- [ ] **Step 3: Implement the wrapper**

Create `bin/codex-json.js`:

```js
#!/usr/bin/env node

const { spawn: defaultSpawn } = require("node:child_process");
const path = require("node:path");

const { normalizeCodexRun } = require("../lib/codex-json");

const DEFAULT_SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "schemas",
  "arithmetic-result.schema.json",
);

function buildCodexArgs(args, schemaPath = DEFAULT_SCHEMA_PATH) {
  if (args[0] !== "exec") {
    throw new Error("Codex wrapper requires exec as its first argument");
  }

  return [
    "exec",
    "--json",
    "--output-schema",
    schemaPath,
    ...args.slice(1),
  ];
}

function runCodexJson({
  args = process.argv.slice(2),
  spawn = defaultSpawn,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  schemaPath = DEFAULT_SCHEMA_PATH,
} = {}) {
  let child;
  try {
    child = spawn("codex", buildCodexArgs(args, schemaPath), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (spawnError) {
    const normalized = normalizeCodexRun({ spawnError });
    stdout.write(`${JSON.stringify(normalized.value)}\n`);
    setExitCode(1);
    return null;
  }

  const stdoutChunks = [];
  let finished = false;

  function finish(details) {
    if (finished) return;
    finished = true;
    const normalized = normalizeCodexRun({
      stdout: stdoutChunks.join(""),
      ...details,
    });
    stdout.write(`${JSON.stringify(normalized.value)}\n`);
    setExitCode(normalized.ok ? 0 : 1);
  }

  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", (spawnError) => finish({ spawnError }));
  child.once("close", (exitCode, signal) => finish({ exitCode, signal }));

  return child;
}

if (require.main === module) {
  runCodexJson();
}

module.exports = {
  DEFAULT_SCHEMA_PATH,
  buildCodexArgs,
  runCodexJson,
};
```

Make the wrapper executable:

```bash
chmod +x bin/codex-json.js
```

- [ ] **Step 4: Run the wrapper tests and verify GREEN**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: 10 tests pass.

- [ ] **Step 5: Add failing spawn-error and failed-close wrapper tests**

Append to `test/codex-json.test.js`:

```js
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
  assert.equal(JSON.parse(stdoutChunks[0]).is_error, true);
  assert.match(JSON.parse(stdoutChunks[0]).error, /spawn denied/);
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

  assert.equal(stdoutChunks.length, 1);
  assert.match(JSON.parse(stdoutChunks[0]).error, /connection lost/);
  assert.deepEqual(exitCodes, [1]);
});
```

- [ ] **Step 6: Run the wrapper failure tests**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: 12 tests pass. The first terminal child event must produce one JSON object and one exit-status update.

- [ ] **Step 7: Commit the executable wrapper**

```bash
git add bin/codex-json.js test/codex-json.test.js
git commit -m "feat: wrap codex structured output"
```

---

### Task 3: Route the Codex Task Through the Wrapper

**Files:**
- Modify: `lib/config.js:1-87`
- Modify: `test/config.test.js`
- Modify: `lib/scheduler.js:1-42`
- Modify: `test/scheduler.test.js:24-73`
- Modify: `commands.json:7-38`

**Interfaces:**
- Consumes: `bin/codex-json.js` from Task 2.
- Produces: configured relative executable paths resolved against the directory containing `commands.json`.
- Produces: configured and built-in Codex commands whose `command` is the absolute `bin/codex-json.js` path and whose arguments preserve the existing Codex invocation.

- [ ] **Step 1: Add a failing relative-command resolution test**

Append to `test/config.test.js`:

```js
test('loadConfig resolves relative executable paths from the config directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configPath = path.join(directory, 'commands.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      commands: [
        {
          name: 'wrapper',
          command: './bin/wrapper.js',
          args: ['exec'],
        },
      ],
    }),
  );

  assert.equal(
    loadConfig(configPath).commands[0].command,
    path.join(directory, 'bin', 'wrapper.js'),
  );
});
```

- [ ] **Step 2: Run the config test and verify RED**

Run:

```bash
node --test --test-name-pattern="relative executable" test/config.test.js
```

Expected: FAIL because the command remains `./bin/wrapper.js`.

- [ ] **Step 3: Resolve relative command paths in `loadConfig`**

Add this helper to `lib/config.js`:

```js
function resolveCommandPaths(commands, configPath) {
  const configDirectory = path.dirname(configPath);

  return commands.map((commandSpec) => {
    if (!commandSpec.command.startsWith('./') && !commandSpec.command.startsWith('../')) {
      return commandSpec;
    }

    return {
      ...commandSpec,
      command: path.resolve(configDirectory, commandSpec.command),
    };
  });
}
```

Change `loadConfig` so both parsed and fallback commands pass through the helper:

```js
if (!fs.existsSync(configPath)) {
  logger.error(`Config file not found: ${configPath}. Using built-in defaults.`);
  return {
    schedule: fallbackSchedule,
    commands: resolveCommandPaths(fallbackCommands, configPath),
  };
}

const rawConfig = fs.readFileSync(configPath, 'utf8');
const parsedConfig = JSON.parse(rawConfig);
const normalizedConfig = normalizeConfig(parsedConfig);
return {
  ...normalizedConfig,
  commands: resolveCommandPaths(normalizedConfig.commands, configPath),
};
```

- [ ] **Step 4: Run the config test and verify GREEN**

Run:

```bash
node --test test/config.test.js
```

Expected: all config tests pass.

- [ ] **Step 5: Change the built-in command expectation first**

Update only the Codex portion of `default commands match the requested codex and claude invocations` in `test/scheduler.test.js`:

```js
{
  name: "codex",
  command: path.join(__dirname, "..", "bin", "codex-json.js"),
  args: [
    "exec",
    "--model",
    "gpt-5.6-sol",
    "--config",
    'model_reasoning_effort="none"',
    "--config",
    'web_search="disabled"',
    "--disable",
    "shell_tool",
    "--disable",
    "multi_agent",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ignore-rules",
    "--ephemeral",
    "{{arithmeticPrompt}}",
  ],
}
```

Add `const path = require("node:path");` with the existing test imports.

- [ ] **Step 6: Run the focused scheduler test and verify RED**

Run:

```bash
node --test --test-name-pattern="default commands" test/scheduler.test.js
```

Expected: FAIL because `DEFAULT_COMMANDS` still invokes `codex` directly.

- [ ] **Step 7: Update the built-in Codex command**

Add `const path = require("node:path");` to `lib/scheduler.js`, define:

```js
const CODEX_WRAPPER_PATH = path.join(__dirname, "..", "bin", "codex-json.js");
```

Then change the Codex entry to use `command: CODEX_WRAPPER_PATH` and keep its arguments beginning with `"exec"`. Do not change the Claude entry or scheduler behavior.

- [ ] **Step 8: Run the focused scheduler test and verify GREEN**

Run:

```bash
node --test --test-name-pattern="default commands" test/scheduler.test.js
```

Expected: the matching test passes.

- [ ] **Step 9: Update the configured Codex command**

Change the first command in `commands.json` to:

```json
{
  "name": "codex",
  "command": "./bin/codex-json.js",
  "args": [
    "exec",
    "--model",
    "gpt-5.6-sol",
    "--config",
    "model_reasoning_effort=\"none\"",
    "--config",
    "web_search=\"disabled\"",
    "--disable",
    "shell_tool",
    "--disable",
    "multi_agent",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ignore-rules",
    "--ephemeral",
    "{{arithmeticPrompt}}"
  ]
}
```

- [ ] **Step 10: Run command rendering and configuration tests**

Run:

```bash
node --test test/prompt.test.js test/config.test.js test/scheduler.test.js
```

Expected: all selected tests pass, including per-run replacement of `{{arithmeticPrompt}}`.

- [ ] **Step 11: Commit command routing**

```bash
git add lib/config.js test/config.test.js lib/scheduler.js test/scheduler.test.js commands.json
git commit -m "feat: route codex through json wrapper"
```

---

### Task 4: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the wrapper and normalized output contract from Tasks 1-3.
- Produces: user-facing instructions that match the actual configured command and stream behavior.

- [ ] **Step 1: Update the README command examples**

Replace the direct Codex example with:

```bash
./bin/codex-json.js exec --model gpt-5.6-sol --config 'model_reasoning_effort="none"' --config 'web_search="disabled"' --disable shell_tool --disable multi_agent --disable hooks --disable plugins --skip-git-repo-check --sandbox read-only --ignore-rules --ephemeral "{{arithmeticPrompt}}"
```

Update the `commands.json` example to match Task 3.

- [ ] **Step 2: Document stdout, stderr, and the normalized result**

Add a concise section containing this exact successful-output example:

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": {
    "success": true,
    "answer": "42",
    "message": "Calculation completed"
  },
  "error": null,
  "usage": {
    "input_tokens": 970,
    "cached_input_tokens": 0,
    "output_tokens": 25,
    "reasoning_output_tokens": 0,
    "total_tokens": 995
  }
}
```

State that stdout contains one JSON object, stderr contains Codex diagnostics,
and a non-zero wrapper exit or `turn.failed` produces `subtype: "error"`.

- [ ] **Step 3: Run the complete automated test suite**

Run:

```bash
npm test
```

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run static repository checks**

Run:

```bash
git diff --check
node -e 'JSON.parse(require("node:fs").readFileSync("commands.json", "utf8")); JSON.parse(require("node:fs").readFileSync("schemas/arithmetic-result.schema.json", "utf8"))'
```

Expected: both commands exit `0` with no output.

- [ ] **Step 5: Verify the wrapper locally without making a Codex request**

Run:

```bash
node --test test/codex-json.test.js
```

Expected: all Codex parser/wrapper tests pass without network access.

- [ ] **Step 6: Review the final diff against the design**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- README.md commands.json lib/config.js lib/scheduler.js lib/codex-json.js bin/codex-json.js schemas/arithmetic-result.schema.json test/codex-json.test.js test/config.test.js test/scheduler.test.js
```

Expected: changes are limited to the planned schema, parser, wrapper, Codex command routing, tests, and documentation; Claude and schedule values are unchanged.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain codex unified json output"
```

- [ ] **Step 8: Run fresh final verification after the last commit**

Run:

```bash
npm test
git status --short
```

Expected: all tests pass and `git status --short` prints nothing.
