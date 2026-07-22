# Default Schedule 300 Seconds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change every effective default timer schedule and user-facing example from `120 ±20s` to `300 ±20s` while preserving custom schedules and immediate LOOP behavior.

**Architecture:** Update the existing default literals in configuration, scheduling, and TUI fallback boundaries rather than introducing a new constants module. Use tests to distinguish no-argument/default behavior from caller-supplied custom schedules, then synchronize repository configuration and documentation.

**Tech Stack:** Node.js CommonJS, JSON configuration, Markdown documentation, Node's built-in `node:test` and `node:assert/strict`.

## Global Constraints

- Default base delay is exactly 300,000 milliseconds (300 seconds).
- Jitter remains exactly 20,000 milliseconds (20 seconds), producing 280–320 second timer delays.
- Continuous LOOP mode remains immediate after the prior provider process exits.
- Provider retry behavior is unchanged.
- Do not introduce a shared constants module.
- Do not rewrite historical design or implementation documents.

---

## File Structure

- `lib/config.js`: Built-in schedule used for missing or partial configuration.
- `lib/scheduler.js`: Default delay used by controllers and command loops.
- `lib/tui.js`: Display and runner fallbacks when schedule data is unavailable.
- `commands.json`: Repository runtime schedule used by normal launches.
- `test/scheduler.test.js`: Default and explicit custom scheduler behavior.
- `test/config.test.js`: Missing/partial configuration fallback behavior.
- `test/tui.test.js`: Default schedule rendering behavior.
- `README.md`: User-facing configuration example and timing explanation.

### Task 1: Test and Implement the 300-Second Defaults

**Files:**
- Modify: `test/scheduler.test.js`
- Modify: `test/config.test.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `getJitteredDelayMs(options?)`, `runCommandLoop(commandSpec, dependencies?)`, `loadConfig(path, options?)`, and `renderDashboard(taskStates, options?)`.
- Produces: Test contracts requiring a 300,000 ms default base delay and preserving explicit 120,000 ms custom input.

- [ ] **Step 1: Change the no-argument scheduler expectations**

In `getJitteredDelayMs returns base delay plus or minus jitter`, replace the
expected values with:

```js
assert.equal(getJitteredDelayMs({ random: () => 0 }), 280_000);
assert.equal(getJitteredDelayMs({ random: () => 0.5 }), 300_000);
assert.equal(getJitteredDelayMs({ random: () => 1 }), 320_000);
```

Keep `getJitteredDelayMs supports custom base delay and jitter` explicitly
non-default by changing its input and expectations to:

```js
const options = { baseDelayMs: 120_000, jitterMs: 20_000 };

assert.equal(getJitteredDelayMs({ ...options, random: () => 0 }), 100_000);
assert.equal(getJitteredDelayMs({ ...options, random: () => 0.5 }), 120_000);
assert.equal(getJitteredDelayMs({ ...options, random: () => 1 }), 140_000);
```

In `runCommandLoop starts immediately and schedules the next run after close`,
change the default timer assertion to:

```js
assert.equal(timers[0].delayMs, 300_000);
```

- [ ] **Step 2: Add a built-in configuration fallback assertion**

In `loadConfig resolves relative fallback commands from a missing config directory`, add:

```js
assert.deepEqual(config.schedule, {
  baseDelayMs: 300_000,
  jitterMs: 20_000,
});
```

This exercises the actual missing-file default without changing the test's
custom fallback command.

- [ ] **Step 3: Update only the TUI default display contract**

In `renderDashboard list mode shows task status without selected output`, omit
the explicit `schedule` option as it does today and change:

```js
assert.match(output, /│ 2 tasks · schedule 300s ±20s/);
```

Leave log fixture text such as `[claude] next run in 120s` unchanged because it
represents captured runtime data, not a TUI default.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node --test test/scheduler.test.js test/config.test.js test/tui.test.js
```

Expected: FAIL on the new default scheduler, missing-config schedule, and TUI
display expectations. Explicit custom schedule tests continue to pass.

**Files:**
- Modify: `lib/config.js`
- Modify: `lib/scheduler.js`
- Modify: `lib/tui.js`
- Modify: `commands.json`

**Interfaces:**
- Consumes: Existing schedule shapes `{ baseDelayMs, jitterMs }` and JSON fields `{ baseDelaySeconds, jitterSeconds }`.
- Produces: 300-second base defaults with the unchanged 20-second jitter across all runtime entry points.

- [ ] **Step 1: Update configuration and scheduler defaults**

In `lib/config.js`, change only:

```js
const DEFAULT_SCHEDULE = {
  baseDelayMs: 300_000,
  jitterMs: 20_000,
};
```

In `lib/scheduler.js`, change only:

```js
const DEFAULT_BASE_DELAY_MS = 300_000;
```

- [ ] **Step 2: Update all TUI fallback base delays**

In `lib/tui.js`, change the three fallback occurrences from `120_000` to
`300_000`:

```js
const baseSeconds = Math.round((schedule.baseDelayMs || 300_000) / 1000);
```

```js
const schedule = options.schedule || { baseDelayMs: 300_000, jitterMs: 20_000 };
```

```js
const schedule = runner.getSchedule
  ? runner.getSchedule()
  : { baseDelayMs: 300_000, jitterMs: 20_000 };
```

- [ ] **Step 3: Update the repository runtime configuration**

In `commands.json`, change only:

```json
"baseDelaySeconds": 300
```

Keep `"jitterSeconds": 20` unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test test/scheduler.test.js test/config.test.js test/tui.test.js
```

Expected: every focused test passes, including the explicit custom 120-second
schedule test.

- [ ] **Step 5: Commit code and tests**

```bash
git add lib/config.js lib/scheduler.js lib/tui.js commands.json test/scheduler.test.js test/config.test.js test/tui.test.js
git commit -m "feat: use 300 second default schedule"
```

### Task 2: Synchronize Documentation and Verify the Repository

**Files:**
- Modify: `README.md`
- Verify: all files changed in Task 1

**Interfaces:**
- Consumes: The implemented `300 ±20s` runtime contract.
- Produces: User documentation matching runtime behavior and full-suite verification evidence.

- [ ] **Step 1: Update the README example and explanation**

Change the schedule example to:

```json
"schedule": {
  "baseDelaySeconds": 300,
  "jitterSeconds": 20
}
```

Change the explanatory sentence to state:

```text
`baseDelaySeconds: 300` with `jitterSeconds: 20` means each next run is
scheduled randomly between 280 and 320 seconds later.
```

- [ ] **Step 2: Confirm remaining 120-second values are intentional custom fixtures**

Run:

```bash
rg -n "120_000|120s|baseDelaySeconds.?[:=].?120" lib commands.json README.md test
```

Expected: no 120-second default remains in `lib`, `commands.json`, or README.
Any test hits are explicit custom schedule inputs, expected values derived from
those inputs, or captured log fixture strings.

- [ ] **Step 3: Run the complete test suite**

```bash
npm test
```

Expected: exit code 0 with every test passing and no uncaught errors.

- [ ] **Step 4: Check the patch and worktree**

```bash
git diff --check
git diff -- lib/config.js lib/scheduler.js lib/tui.js commands.json README.md test/scheduler.test.js test/config.test.js test/tui.test.js
git status --short
```

Expected: no whitespace errors; only approved default, test, configuration,
and documentation changes are present.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: document 300 second schedule"
```
