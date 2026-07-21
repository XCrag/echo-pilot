# Windows TUI Output Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the trailing error from long one-line wrapper output and redraw the TUI reliably in Windows terminals.

**Architecture:** Convert captured logical output lines into fixed-width visual lines before applying the terminal row budget. For TTY output, home and clear the screen through Node readline operations before writing each rendered dashboard; non-TTY streams receive plain text.

**Tech Stack:** Node.js CommonJS, `node:readline`, `node:test`

## Global Constraints

- Do not parse or mutate provider JSON.
- Preserve the fixed 82-column panel and current behavior for short lines.
- Do not change wrapper, scheduler, or Codex argument behavior.
- Work directly on the current branch as approved by the user.

---

### Task 1: Wrap Captured Output Within the Detail Panel

**Files:**
- Modify: `test/tui.test.js`
- Modify: `lib/tui.js:128-152,245-281`

**Interfaces:**
- Consumes: captured `selectedTask.outputLines` strings and `CONTENT_WIDTH`.
- Produces: visual output lines, each no wider than `CONTENT_WIDTH`, with the newest visual lines retained by the existing terminal row budget.

- [ ] **Step 1: Write the failing long-output regression test**

Add a detail-rendering test that assigns one long output line ending in a unique error marker, renders with `rows: 18`, and asserts that the marker is present, every rendered line is at most `PANEL_WIDTH` characters, and total lines do not exceed 18:

```js
test('renderDashboard detail mode wraps one-line output to expose its trailing error', () => {
  const tasks = sampleTasks();
  tasks[0].outputLines = [
    `[stdout] ${'x'.repeat(120)} error=unsupported-option`,
  ];

  const output = renderDashboard(tasks, {
    selectedIndex: 0,
    now: 1_000,
    mode: 'detail',
    rows: 18,
  });
  const lines = output.split('\n');

  assert.ok(lines.length <= 18);
  assert.ok(lines.every((line) => line.length <= 82));
  assert.match(output, /error=unsupported-option/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="wraps one-line output" test/tui.test.js`

Expected: FAIL because `boxLine()` truncates the only logical output line before its trailing error.

- [ ] **Step 3: Implement minimal visual-line wrapping**

Add a helper that splits each string into consecutive `CONTENT_WIDTH` chunks, represents an empty string as one empty chunk, and flattens all captured lines. In `renderDetailDashboard`, wrap before slicing:

```js
const visualOutputLines = wrapLines(selectedTask.outputLines || [], CONTENT_WIDTH);
const outputLines = visualOutputLines.slice(-outputLineLimit);
```

- [ ] **Step 4: Verify GREEN and focused detail tests**

Run: `node --test --test-name-pattern="detail mode" test/tui.test.js`

Expected: all matching detail-rendering tests pass with zero failures.

---

### Task 2: Use Cross-Platform TTY Redraw Operations

**Files:**
- Modify: `test/tui.test.js`
- Modify: `lib/tui.js:1-5,316-350`

**Interfaces:**
- Consumes: `stdout.isTTY`, `readline.cursorTo(stream, 0, 0)`, and `readline.clearScreenDown(stream)`.
- Produces: one cursor-home and one clear-down operation before every TTY dashboard write; no such operations for non-TTY output.

- [ ] **Step 1: Write the failing TTY redraw regression test**

Create a `startTui` test with `stdout.isTTY = true` and injected `cursorTo` / `clearScreenDown` spies. Assert initial redraw invokes each operation once and writes dashboard text separately from cursor-control behavior.

```js
assert.deepEqual(redrawCalls, ['cursorTo:0:0', 'clearScreenDown']);
assert.match(chunks.at(-1), /Auto Reply/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="readline operations" test/tui.test.js`

Expected: FAIL because `startTui` does not call injected cursor operations.

- [ ] **Step 3: Implement minimal TTY redraw**

In `startTui`, select injected operations or Node readline defaults:

```js
const cursorTo = options.cursorTo || readline.cursorTo;
const clearScreenDown = options.clearScreenDown || readline.clearScreenDown;
```

At the start of `redraw()`, when `stdout.isTTY`, call `cursorTo(stdout, 0, 0)` and `clearScreenDown(stdout)`. Remove `CLEAR_SCREEN` from the dashboard write. Leave cursor hide/show behavior unchanged.

- [ ] **Step 4: Verify GREEN and complete suite**

Run: `node --test --test-name-pattern="readline operations" test/tui.test.js`

Expected: the matching TTY test passes with zero failures.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Review and commit**

Run: `git diff --check && git diff -- lib/tui.js test/tui.test.js docs/superpowers/plans/2026-07-21-windows-tui-output.md`

Expected: no whitespace errors and only the two approved TUI rendering changes, their tests, and this plan.

```bash
git add lib/tui.js test/tui.test.js docs/superpowers/plans/2026-07-21-windows-tui-output.md
git commit -m "fix: render TUI output reliably on Windows"
```
