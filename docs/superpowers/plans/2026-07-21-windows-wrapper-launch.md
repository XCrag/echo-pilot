# Windows Wrapper Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the built-in Codex and Claude JavaScript wrappers start reliably on Windows.

**Architecture:** The scheduler and checked-in command configuration will invoke the current Node executable and pass the wrapper file as argument zero. Wrapper behavior and provider CLI invocation remain unchanged.

**Tech Stack:** Node.js CommonJS, `node:test`, JSON, Markdown

## Global Constraints

- Use `process.execPath`; do not add platform branches or `.cmd` files.
- Preserve every existing provider argument and wrapper behavior.
- Keep existing spawn and child error semantics unchanged.

---

### Task 1: Launch Built-In Wrappers Through Node

**Files:**
- Modify: `test/scheduler.test.js`
- Modify: `lib/scheduler.js:10-54`
- Modify: `commands.json:6-48`
- Modify: `README.md:3-10,105-130`

**Interfaces:**
- Consumes: Node's `process.execPath` string and existing absolute `CODEX_WRAPPER_PATH` / `CLAUDE_WRAPPER_PATH` constants.
- Produces: `DEFAULT_COMMANDS`, where each command is `process.execPath` and each first argument is its wrapper path.

- [ ] **Step 1: Write the failing regression test**

Add to `test/scheduler.test.js`:

```js
test("DEFAULT_COMMANDS launch JavaScript wrappers through the current Node executable", () => {
  const expectedWrappers = ["codex-json.js", "claude-json.js"];

  assert.equal(DEFAULT_COMMANDS.length, expectedWrappers.length);
  DEFAULT_COMMANDS.forEach((commandSpec, index) => {
    assert.equal(commandSpec.command, process.execPath);
    assert.equal(path.basename(commandSpec.args[0]), expectedWrappers[index]);
    assert.equal(path.basename(path.dirname(commandSpec.args[0])), "bin");
  });
});
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `node --test --test-name-pattern="DEFAULT_COMMANDS launch" test/scheduler.test.js`

Expected: FAIL because `DEFAULT_COMMANDS[0].command` is currently the wrapper path rather than `process.execPath`.

- [ ] **Step 3: Implement the minimal scheduler change**

In both entries of `DEFAULT_COMMANDS`, set:

```js
command: process.execPath,
args: [CODEX_WRAPPER_PATH, /* existing Codex arguments */]
```

and:

```js
command: process.execPath,
args: [CLAUDE_WRAPPER_PATH, /* existing Claude arguments */]
```

Do not change the remaining argument order or values.

- [ ] **Step 4: Update checked-in configuration and documentation**

In `commands.json`, use `"node"` as each command and insert the corresponding relative wrapper path as the first argument:

```json
"command": "node",
"args": ["./bin/codex-json.js", "exec"]
```

```json
"command": "node",
"args": ["./bin/claude-json.js", "-p"]
```

Retain all arguments after `exec` and `-p`. Update the README command examples and configuration example to show the same `node ./bin/...` form.

- [ ] **Step 5: Verify GREEN and the complete suite**

Run: `node --test --test-name-pattern="DEFAULT_COMMANDS launch" test/scheduler.test.js`

Expected: the matching test passes with zero failures.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Review and commit**

Run: `git diff --check && git diff -- lib/scheduler.js commands.json README.md test/scheduler.test.js`

Expected: no whitespace errors; the diff contains only the wrapper-launch regression, Node command changes, and matching documentation.

```bash
git add test/scheduler.test.js lib/scheduler.js commands.json README.md docs/superpowers/plans/2026-07-21-windows-wrapper-launch.md
git commit -m "fix: launch wrappers through Node on Windows"
```
