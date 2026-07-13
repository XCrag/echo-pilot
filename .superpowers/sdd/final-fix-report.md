# Last Execution Status and Token Usage — Final Review Fix Report

Date: 2026-07-13
Branch: `main` (current workspace; no worktree by user choice)

## Outcome

Implemented the complete final-review fix list:

- Replaced the Claude `sh | jq` pipeline with an executable, dependency-free Node wrapper that invokes `claude` directly, forwards stderr, buffers stdout safely across UTF-8 chunk boundaries, projects exactly the five requested outer fields, emits one compact JSON line only for a zero-exit valid outer JSON object, and preserves spawn/child/parse failures as non-zero wrapper exits.
- Routed both built-in `DEFAULT_COMMANDS` and repository `commands.json` through the direct wrapper without changing Claude flags or the arithmetic prompt argument.
- Made scheduler stdout/stderr listeners generation-aware so old children cannot contaminate a restarted run's raw structured capture or `outputLines`.
- Added an injectable structured stdout ceiling with a 1 MiB default. Exact-boundary data remains parseable; overflow clears and permanently disables the per-run raw buffer while selected output remains line-bounded and the final execution falls back to process status with `usage: null`.
- Locked execution-result provider inference/fallback, explicit zero totals, raw string errors, and input immutability. The existing production normalizer already satisfied all four cases, so it was not changed.
- Updated README commands, configuration, and Claude failure semantics.

## RED/GREEN Evidence

### Claude wrapper

RED command:

```text
node --test test/claude-json.test.js
```

RED result: exit 1; test file failed with `Cannot find module '../bin/claude-json'`, confirming the new wrapper tests exercised a missing implementation.

GREEN command:

```text
node --test test/claude-json.test.js
```

GREEN result: exit 0; 8 tests passed, 0 failed. Covered direct argv, compact projected output, stderr forwarding, upstream non-zero with no stdout, invalid JSON, split UTF-8, synchronous spawn failure, asynchronous error/close exactly-once settlement, and late-event suppression.

### Command routing

RED command:

```text
node --test test/scheduler.test.js test/config.test.js
```

RED result: exit 1; 38 passed and 2 failed. Both failures showed the old `command: "sh"` / `-c` pipeline where the tests required `bin/claude-json.js` with direct arguments.

GREEN command:

```text
node --test test/claude-json.test.js test/scheduler.test.js test/config.test.js
```

GREEN result: exit 0; 48 tests passed, 0 failed.

### Scheduler generation ownership and byte ceiling

RED command:

```text
node --test test/scheduler.test.js
```

RED result: exit 1; 34 passed and 3 failed. Stale stdout and stderr appeared in the restarted run's `outputLines`, and oversized structured stdout still produced usage instead of `null`. The exact-boundary characterization already passed.

GREEN command:

```text
node --test test/scheduler.test.js
```

GREEN result: exit 0; 37 tests passed, 0 failed, including stale stdout, stale stderr, exact-byte-boundary, overflow fallback, and bounded selected output.

### Execution-result normalizer lock

Command:

```text
node --test test/execution-result.test.js
```

Result: exit 0; 14 tests passed, 0 failed. The added characterization cases passed immediately, demonstrating that no production normalizer change was needed.

## Final Verification

Focused verification:

```text
node --test test/claude-json.test.js test/scheduler.test.js test/execution-result.test.js
```

Result: exit 0; 59 passed, 0 failed.

Full suite:

```text
npm test
```

Result: exit 0; 107 passed, 0 failed.

Whitespace check:

```text
git diff --check
```

Result: exit 0; no output.

JSON parse check:

```text
node -e 'const fs = require("node:fs"); for (const file of ["package.json", "commands.json", "schemas/arithmetic-result.schema.json"]) JSON.parse(fs.readFileSync(file, "utf8")); console.log("parsed 3 JSON files")'
```

Result: exit 0; `parsed 3 JSON files`.

Syntax and executable check:

```text
node --check bin/claude-json.js && node --check lib/scheduler.js && file bin/claude-json.js
```

Result: exit 0; `bin/claude-json.js` reported as an executable `/usr/bin/env node` script.

## Files

- `.superpowers/sdd/final-fix-report.md` — this evidence and self-review report.
- `bin/claude-json.js` — direct Claude child wrapper and five-field outer JSON projection.
- `test/claude-json.test.js` — focused wrapper lifecycle and stream tests.
- `lib/scheduler.js` — direct Claude default plus generation-aware bounded structured capture.
- `test/scheduler.test.js` — command, stale stream, boundary, and overflow regressions.
- `commands.json` — direct Claude wrapper configuration.
- `test/config.test.js` — repository configuration regression.
- `test/execution-result.test.js` — normalizer edge-case locks.
- `README.md` — direct invocation/config examples and failure semantics.
- `docs/superpowers/plans/2026-07-13-last-execution-final-review-fixes.md` — implementation plan used for this work.

## Self-Review

- Claude transport: confirmed there is no shell or `jq` in either command source. All original Claude flags are separate argv elements in the original order; the empty system prompt and arithmetic prompt token are preserved.
- Failure semantics: child non-zero, child signal, synchronous/asynchronous spawn failure, invalid JSON, and non-object JSON all produce a non-zero wrapper status. Failure paths emit no structured stdout, so the scheduler reliably falls back to process status and `usage: null`.
- Output contract: successful wrapper settlement writes exactly once, uses `JSON.stringify(...) + "\n"`, discards extra outer fields, and supplies the same five keys that the former `jq` object constructor supplied.
- Stream ownership: generation equality is checked before both raw stdout accounting and displayed stdout/stderr mutation. Existing close/error generation checks remain intact.
- Memory bound: byte accounting uses Buffer lengths, allows exactly 1 MiB by default, clears already-retained chunks on the first overflow, does not retain subsequent raw chunks, and continues the independently bounded `outputLines` path.
- Normalization: added edge cases did not reveal a defect; production normalizer remained untouched.
- Compatibility: Codex command behavior, scheduling transitions, process-group termination, TUI layout/rendering, and dependency count were not changed. Full tests cover those paths.

## Concerns

No unresolved correctness concerns. The Claude wrapper intentionally leaves stdout empty on transport or parse failure; this is the mechanism that prevents invalid structured data from being mistaken for success, while stderr and the non-zero exit retain diagnostics and status.
