# Windows Provider Shim Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start npm-installed Codex and Claude `.cmd` shims through the Windows command interpreter while preserving direct Unix execution.

**Architecture:** A shared pure command builder returns `{ command, args }` for a provider launch. Both wrappers call it immediately before their existing `spawn`, using injectable platform/environment values for deterministic tests.

**Tech Stack:** Node.js CommonJS, `child_process.spawn`, `node:test`

## Global Constraints

- Windows must invoke `%ComSpec%` or `cmd.exe` with `/d /s /c` and the explicit provider `.cmd` shim.
- Non-Windows invocation and all provider arguments remain unchanged.
- Scheduler and LOOP behavior must not change; failed LOOP runs continue retrying immediately.
- Work directly on the current branch as approved by the user.

---

### Task 1: Route Both Wrappers Through a Platform-Specific Provider Command

**Files:**
- Create: `lib/provider-command.js`
- Modify: `bin/codex-json.js`
- Modify: `bin/claude-json.js`
- Modify: `test/codex-json.test.js`
- Modify: `test/claude-json.test.js`

**Interfaces:**
- Produces: `buildProviderCommand(provider, args, options)` returning `{ command: string, args: string[] }`.
- Extends: `runCodexJson` and `runClaudeJson` options with `platform` and `env`, defaulting to the current process values through the builder.

- [ ] **Step 1: Write failing wrapper integration tests**

For each wrapper, simulate `platform: 'win32'` and `env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }`. Assert the captured spawn call uses that executable and begins with `/d`, `/s`, `/c`, then `codex.cmd` or `claude.cmd`, followed by the wrapper's existing arguments.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="Windows command shim" test/codex-json.test.js test/claude-json.test.js`

Expected: both tests fail because wrappers still spawn bare provider names.

- [ ] **Step 3: Implement the pure builder and minimal wrapper integration**

Create `lib/provider-command.js`:

```js
function buildProviderCommand(provider, args, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== 'win32') return { command: provider, args };
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `${provider}.cmd`, ...args],
  };
}
```

Build the provider argv once immediately before `spawn`, then pass `providerCommand.command` and `providerCommand.args` into the unchanged spawn options. Do not modify event, output, signal, or exit handling.

- [ ] **Step 4: Verify GREEN and full suite**

Run: `node --test --test-name-pattern="Windows command shim" test/codex-json.test.js test/claude-json.test.js`

Expected: both matching tests pass.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Prove LOOP code is untouched and commit**

Run: `git diff --check && git diff --exit-code -- lib/scheduler.js`

Expected: both commands exit zero.

```bash
git add lib/provider-command.js bin/codex-json.js bin/claude-json.js test/codex-json.test.js test/claude-json.test.js docs/superpowers/plans/2026-07-21-windows-provider-shim.md
git commit -m "fix: launch provider shims through cmd on Windows"
```
