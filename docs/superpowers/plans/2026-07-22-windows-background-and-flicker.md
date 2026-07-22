# Windows Background Provider and Flicker-Free TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows provider processes run without visible console popups and redraw the TUI without exposing a blank frame.

**Architecture:** Keep provider lifecycle ownership in the existing Codex and Claude wrappers, adding only the Windows-specific child-process visibility option. Keep dashboard rendering platform-neutral, but change the TTY write order so a complete new frame replaces the old frame before stale trailing rows are erased.

**Tech Stack:** Node.js CommonJS, `node:child_process`, `node:readline`, Node's built-in `node:test` and `node:assert/strict`.

## Global Constraints

- Do not change Codex native request or stream retries.
- Do not change scheduler timing or continuous LOOP behavior.
- Do not detach providers from the wrapper process.
- Keep provider commands, arguments, stdio pipes, and structured-output parsing unchanged.
- Do not add terminal diffing or alternate-screen support.
- On macOS and Linux, omit `windowsHide` from provider spawn options.
- For non-TTY output, preserve append-only frame output without cursor operations.

---

## File Structure

- `bin/codex-json.js`: Owns Codex provider process creation; add the Windows-only spawn option here.
- `bin/claude-json.js`: Owns Claude provider process creation; add the same Windows-only spawn option here.
- `lib/tui.js`: Owns frame rendering and terminal writes; reorder TTY frame replacement here.
- `test/codex-json.test.js`: Verifies Windows-hidden and non-Windows Codex spawn contracts.
- `test/claude-json.test.js`: Verifies Windows-hidden and non-Windows Claude spawn contracts.
- `test/tui.test.js`: Verifies observable TTY and non-TTY write ordering.

### Task 1: Hide Windows Provider Console Windows

**Files:**
- Modify: `test/codex-json.test.js`
- Modify: `test/claude-json.test.js`
- Modify: `bin/codex-json.js`
- Modify: `bin/claude-json.js`

**Interfaces:**
- Consumes: `runCodexJson({ platform, env, spawn, ... })` and `runClaudeJson({ platform, env, spawn, ... })`.
- Produces: Spawn options `{ stdio: ["ignore", "pipe", "pipe"], windowsHide: true }` on `win32`; the existing `{ stdio: ["ignore", "pipe", "pipe"] }` elsewhere.

- [ ] **Step 1: Update the Windows wrapper expectations first**

In `test/codex-json.test.js`, change the Windows command-shim expectation to:

```js
options: {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
},
```

Leave the direct non-Windows expectation as:

```js
options: { stdio: ["ignore", "pipe", "pipe"] },
```

In `test/claude-json.test.js`, make the identical change only in the Windows command-shim test, leaving the direct non-Windows expectation unchanged.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test test/codex-json.test.js test/claude-json.test.js
```

Expected: FAIL in both Windows command-shim tests because the actual spawn options do not contain `windowsHide: true`; all unrelated assertions remain green.

- [ ] **Step 3: Add the minimal platform-specific spawn option**

In each wrapper, replace the inline spawn options with a local object immediately before `spawn(...)`:

```js
const spawnOptions = {
  stdio: ["ignore", "pipe", "pipe"],
};
if ((platform || process.platform) === "win32") {
  spawnOptions.windowsHide = true;
}
child = spawn(providerCommand.command, providerCommand.args, spawnOptions);
```

For `bin/claude-json.js`, assign the returned process to its existing `child` variable rather than redeclaring it. Do not add `detached`, change stdio, or change `buildProviderCommand` inputs.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test test/codex-json.test.js test/claude-json.test.js
```

Expected: PASS for every Codex and Claude wrapper test, including unchanged non-Windows spawn expectations.

- [ ] **Step 5: Commit the provider-window fix**

```bash
git add bin/codex-json.js bin/claude-json.js test/codex-json.test.js test/claude-json.test.js
git commit -m "fix: hide provider consoles on Windows"
```

### Task 2: Replace TTY Frames Without a Blank Interval

**Files:**
- Modify: `test/tui.test.js`
- Modify: `lib/tui.js`

**Interfaces:**
- Consumes: `startTui(runner, { stdout, cursorTo, clearScreenDown, ... })`.
- Produces: For TTY output, observable order `cursorTo -> complete frame write -> clearScreenDown`; for non-TTY output, one appended complete frame and no cursor operations.

- [ ] **Step 1: Write the failing TTY ordering test**

Replace the `redrawCalls`-only instrumentation in `startTui redraws TTY output with readline operations` with a single ordered event list:

```js
const events = [];
const stdout = {
  isTTY: true,
  write: (chunk) => {
    const value = String(chunk);
    events.push(value.includes("Auto Reply") ? "write:frame" : `write:${value}`);
  },
};

const session = startTui(runner, {
  stdin,
  stdout,
  cursorTo: (_stream, column, row) => {
    events.push(`cursorTo:${column}:${row}`);
  },
  clearScreenDown: () => events.push("clearScreenDown"),
  setInterval: () => 1,
  clearInterval: () => {},
});

assert.deepEqual(events.slice(0, 4), [
  `write:\x1b[?25l`,
  "cursorTo:0:0",
  "write:frame",
  "clearScreenDown",
]);
```

Keep `session.close()` so cursor restoration and task cleanup still run.

- [ ] **Step 2: Add a non-TTY regression assertion**

In `startTui switches between list and detail mode with enter and escape`,
inject throwing cursor functions into its existing `startTui(...)` options and
verify the rendered frame is appended:

```js
cursorTo: () => {
  throw new Error("non-TTY redraw must not move the cursor");
},
clearScreenDown: () => {
  throw new Error("non-TTY redraw must not clear the screen");
},
```

Retain the existing assertion matching `Auto Reply` or `Recent Logs` in the last output chunk. This proves the frame is still written even though terminal controls are skipped.

- [ ] **Step 3: Run the focused TUI test and verify RED**

Run:

```bash
node --test test/tui.test.js
```

Expected: FAIL in `startTui redraws TTY output with readline operations`; actual order contains `clearScreenDown` before `write:frame`. The non-TTY assertion passes.

- [ ] **Step 4: Reorder frame construction and terminal writes minimally**

In `startTui`'s `redraw`, compute the complete frame before any terminal operation, then write and clear in this order:

```js
const states = tasks.map((task) => task.getState());
const terminalRows = stdout.rows || process.stdout.rows || 24;
const schedule = runner.getSchedule
  ? runner.getSchedule()
  : { baseDelayMs: 120_000, jitterMs: 20_000 };
const frame =
  renderDashboard(states, {
    selectedIndex,
    now: now(),
    logs,
    mode,
    schedule,
    editField,
    editValue,
    rows: terminalRows,
    useColor: Boolean(stdout.isTTY && !process.env.NO_COLOR),
  }) + "\n";

if (stdout.isTTY) cursorTo(stdout, 0, 0);
stdout.write(frame);
if (stdout.isTTY) clearScreenDown(stdout);
```

Remove the old pre-render `clearScreenDown(stdout)` call and the duplicate inline `renderDashboard(...)` expression. Do not alter the one-second refresh interval or state subscriptions.

- [ ] **Step 5: Run the focused TUI test and verify GREEN**

Run:

```bash
node --test test/tui.test.js
```

Expected: PASS for all TUI rendering, key handling, cleanup, TTY ordering, and non-TTY tests.

- [ ] **Step 6: Commit the flicker fix**

```bash
git add lib/tui.js test/tui.test.js
git commit -m "fix: redraw TUI without blank frames"
```

### Task 3: Full Regression Verification

**Files:**
- Verify only: `bin/codex-json.js`
- Verify only: `bin/claude-json.js`
- Verify only: `lib/tui.js`
- Verify only: `test/codex-json.test.js`
- Verify only: `test/claude-json.test.js`
- Verify only: `test/tui.test.js`

**Interfaces:**
- Consumes: The Windows spawn-option and TTY-frame contracts from Tasks 1 and 2.
- Produces: Evidence that the complete repository test suite remains green and the committed diff is limited to the approved scope.

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: exit code 0 with every test passing and no uncaught errors.

- [ ] **Step 2: Inspect the final patch**

```bash
git diff HEAD~2 --check
git diff HEAD~2 -- bin/codex-json.js bin/claude-json.js lib/tui.js test/codex-json.test.js test/claude-json.test.js test/tui.test.js
```

Expected: no whitespace errors; only Windows console hiding, TTY redraw ordering, and their tests are changed. Provider retry behavior, scheduler code, commands, arguments, and structured parsing are untouched.

- [ ] **Step 3: Confirm the worktree is clean**

```bash
git status --short
```

Expected: no output.
