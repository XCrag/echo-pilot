# Last Execution Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final-review correctness and robustness gaps in Claude result transport, scheduler output ownership, bounded structured capture, and execution-result normalization tests.

**Architecture:** Replace the shell pipeline with an executable CommonJS wrapper that owns the Claude child lifecycle and projects valid outer JSON. Make scheduler stream listeners generation-aware and keep per-run structured capture under a configurable byte ceiling. Lock the pure normalizer's existing edge-case behavior with regression tests.

**Tech Stack:** Node.js CommonJS, `node:child_process`, `node:events`, `node:test`; no third-party dependencies.

## Global Constraints

- Keep Codex invocation and behavior unchanged.
- Keep Claude CLI flags and arithmetic prompt unchanged while removing the shell and `jq` pipeline.
- Ignore stale stdout and stderr after a newer scheduler generation starts.
- Default raw structured stdout ceiling: 1 MiB; selected-output lines remain independently bounded.
- Preserve scheduling and TUI layout behavior.
- Use tests first and capture RED/GREEN evidence.
- Commit all implementation, tests, documentation, plan, and final report on current `main`.

---

### Task 1: Direct Claude JSON wrapper

**Files:**
- Create: `bin/claude-json.js`
- Create: `test/claude-json.test.js`
- Modify: `lib/scheduler.js`
- Modify: `test/scheduler.test.js`
- Modify: `commands.json`
- Modify: `test/config.test.js`
- Modify: `README.md`

**Interfaces:**
- Produces: `runClaudeJson({ args, spawn, stdout, stderr, setExitCode })`.
- Produces: one compact JSON line with `{type, subtype, is_error, result, usage}` only after a zero child exit and valid outer JSON object.
- Preserves: child stderr bytes and non-zero status for spawn, child-exit, and invalid-JSON failures.

- [ ] Write wrapper and command/config regression tests for direct argv, compact projection, stderr forwarding, split UTF-8, invalid JSON, child non-zero, synchronous/asynchronous spawn errors, and exactly-once settlement.
- [ ] Run `node --test test/claude-json.test.js test/scheduler.test.js test/config.test.js` and verify failures identify the missing wrapper and old shell configuration.
- [ ] Implement the minimal executable wrapper and route built-in/configured Claude commands to it with separate direct arguments.
- [ ] Update README command and configuration examples, then rerun the focused tests to GREEN.

### Task 2: Scheduler generation-owned, bounded capture

**Files:**
- Modify: `lib/scheduler.js`
- Modify: `test/scheduler.test.js`

**Interfaces:**
- Consumes: `generation` captured by `runOnce`.
- Produces: output listeners that mutate buffers/state only while `generation === runGeneration`.
- Consumes: injectable `maxStructuredOutputBytes`, defaulting to `1_048_576`.
- Produces: structured stdout at or below the ceiling; overflow clears/disables the raw buffer and yields `usage: null` at close while `outputLines` remains bounded.

- [ ] Add failing stale-stdout, stale-stderr, exact-boundary, and overflow tests.
- [ ] Run `node --test test/scheduler.test.js` and verify the intended stale-output and overflow failures.
- [ ] Pass generation into output capture and add the byte-accounted per-run capture state.
- [ ] Rerun scheduler tests to GREEN and refactor only while they remain green.

### Task 3: Execution-result regression lock

**Files:**
- Modify: `test/execution-result.test.js`
- Modify only if a test proves necessary: `lib/execution-result.js`

**Interfaces:**
- Locks provider selection: explicit Claude and Claude cache fields select Claude; otherwise fallback is Codex.
- Locks `total_tokens: 0`, raw string errors, and no mutation of the caller's input.

- [ ] Add the four focused regression cases.
- [ ] Run `node --test test/execution-result.test.js`; if already GREEN, record that production behavior required no change.

### Task 4: Verification, self-review, report, and commit

**Files:**
- Create: `.superpowers/sdd/final-fix-report.md`

- [ ] Run focused wrapper, scheduler, and normalizer tests.
- [ ] Run `npm test`, `git diff --check`, and JSON parse checks for `package.json`, `commands.json`, and the schema.
- [ ] Review the diff requirement-by-requirement, inspect executable mode, and record concerns.
- [ ] Write the report with RED/GREEN evidence, exact commands/results, changed files, and self-review.
- [ ] Stage all scoped files, commit once with an accurate subject, then confirm clean `git status --short`.

## Self-Review

- Spec coverage: all four review items, documentation/config routing, verification, reporting, and commit requirements map to a task above.
- Placeholder scan: no deferred implementation placeholders are present.
- Interface consistency: both command sources use `bin/claude-json.js`; scheduler tests inject `maxStructuredOutputBytes`; normalizer public API remains `normalizeLastExecution`.
