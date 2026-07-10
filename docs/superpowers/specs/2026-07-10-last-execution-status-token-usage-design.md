# Last Execution Status and Token Usage Design

Date: 2026-07-10

## Goal

Show the previous execution status and token consumption for both Codex and
Claude tasks in the TUI:

- A compact summary in the task list's existing `Last` column.
- A complete provider-appropriate token breakdown in task detail view.

The feature describes command execution and result normalization. It does not
validate whether the arithmetic answer itself is correct.

## Current Behavior

The scheduler records child exit code, signal, timestamps, start failures, and
captured output lines. It does not retain raw stdout or parse structured command
results.

The task list already has a fourteen-character `Last` column. The detail view
already shows a `Last` line containing an error, signal, or exit code. Neither
view currently displays token usage.

Codex now emits one normalized JSON object containing execution status and a
normalized usage object. Claude emits JSON, but the configured `jq` filter
currently retains only `result` and `usage` and formats the object across
multiple lines.

## Chosen Approach

Parse structured command stdout in the scheduler and store a provider-neutral
`lastExecution` summary in task state. The TUI only formats this state; it does
not parse display output.

This keeps responsibilities separated:

- Command wrappers and filters produce structured results.
- The scheduler owns execution lifecycle and result capture.
- A focused result normalizer maps provider fields into task state.
- The TUI renders the normalized state.

## Structured Output Capture

For TUI runs, the scheduler already starts children with piped stdout and
stderr. Each run will additionally retain the raw stdout buffers for that run.
The existing line-oriented `outputLines` behavior remains unchanged for the
Selected Output panel.

When the child closes, the scheduler joins the raw stdout buffers once as UTF-8
and passes the resulting text, exit code, and signal to the execution-result
normalizer.

Plain non-TUI mode continues to inherit child stdout/stderr. It can still record
exit or signal status, but token usage is unavailable when stdout is not
captured.

## Claude Output

The configured Claude command will retain these outer result fields:

- `type`
- `subtype`
- `is_error`
- `result`
- `usage`

Its `jq` invocation will use compact output so stdout contains a single JSON
line. Claude's response text and usage values are not otherwise changed.

## Normalized Task State

Each task state gains a nullable `lastExecution` value:

```js
{
  status: "success",
  finishedAt: 1234567890,
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
    totalTokens: 995
  }
}
```

`status` is one of:

- `success`: no signal, exit code zero, and no structured `is_error: true`.
- `error`: start failure, non-zero exit, or structured `is_error: true`.
- `stopped`: the process finished because of a signal.

`usage` is null when no structured usage object can be recovered. Individual
missing counters normalize to zero only when a usage object is present.
`usage.kind` is `codex` or `claude` and selects the provider-appropriate detail
labels without coupling the TUI to the task's display name.

The previous `lastExecution` remains visible while a new run is in progress and
is replaced only when that new run finishes or fails to start.

## Token Normalization

Codex fields map as follows:

- `input_tokens` -> `inputTokens`
- `cached_input_tokens` -> `cachedInputTokens`
- `output_tokens` -> `outputTokens`
- `reasoning_output_tokens` -> `reasoningOutputTokens`
- `total_tokens` -> `totalTokens`

Codex total fallback is `inputTokens + outputTokens`. Cached and reasoning
counters are not added again.

Claude fields map as follows:

- `input_tokens` -> `inputTokens`
- `cache_creation_input_tokens` -> `cacheCreationInputTokens`
- `cache_read_input_tokens` -> `cacheReadInputTokens`
- `output_tokens` -> `outputTokens`

Claude total is:

```text
input + cache creation + cache read + output
```

Unknown numeric usage fields are ignored. Invalid or negative counters are
treated as zero.

## Status Precedence

The execution normalizer applies this order:

1. A child signal produces `stopped`.
2. A start error or non-zero exit code produces `error`.
3. Parsed `is_error: true` or a non-success result subtype produces `error`.
4. Otherwise, a zero exit code produces `success`.

Malformed or missing JSON does not turn a zero exit code into an error. The
status falls back to the process result and usage remains null.

## Task List Display

The existing `Last` column remains fourteen characters wide. It displays:

```text
OK · 995t
ERR · 1.7kt
STOP · 0t
```

Token formatting uses compact suffixes when needed:

- Below 1,000: exact value, such as `995t`.
- 1,000 to below 1,000,000: one decimal `kt`, such as `1.7kt`.
- 1,000,000 and above: one decimal `Mt`.

When usage is unavailable, the token portion is `-`, for example `OK · -`.
Before any run completes, the column remains `-`.

## Detail Display

The detail header's `Last` line shows the normalized status plus the existing
exit, signal, or error information.

A `Last Token Usage` section appears between Selected Command and Selected
Output. It uses at most two content lines so useful output remains visible in a
24-row terminal.

Codex example:

```text
Total 995 · Input 970 · Output 25
Cached 100 · Reasoning 5
```

Claude example:

```text
Total 1,699 · Input 2 · Output 136
Cache create 1,561 · Cache read 0
```

If usage is unavailable, the section contains `-`.

## Error Handling

- Invalid JSON never crashes the scheduler.
- Missing usage produces a valid execution summary with `usage: null`.
- Start failures produce an error summary with the existing error message.
- Signals produce `stopped` even when captured JSON reports another state.
- Non-zero exits override a structured success response.
- Structured `is_error: true` can mark a zero-exit command as failed.
- Existing raw output remains available for diagnosis.

## Testing

Tests will cover:

- Codex usage and success normalization.
- Claude usage and success normalization.
- Claude structured error with exit code zero.
- Non-zero exit overriding structured success.
- Signal producing stopped status.
- Missing, malformed, and multiline JSON fallback behavior.
- Start failures.
- Previous summary remaining visible during the next run.
- Compact token formatting at exact, kilo, and mega thresholds.
- Task-list summaries for success, error, stopped, and unknown usage.
- Detail token breakdown for Codex and Claude.
- Detail layout continuing to preserve Selected Output space.
- Claude command retaining status fields and using compact JSON.

The complete existing test suite will run after implementation.

## Documentation

README will describe the list and detail displays and explain that the status
is execution-level. It will also document the different Codex and Claude cache
usage counters.

## Out of Scope

- Checking whether an arithmetic answer is mathematically correct.
- Persisting execution history across process restarts.
- Displaying cumulative token totals across multiple runs.
- Changing schedule behavior.
- Adding token cost estimation.
