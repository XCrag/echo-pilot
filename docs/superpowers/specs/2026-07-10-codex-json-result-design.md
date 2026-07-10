# Codex Unified JSON Result Design

Date: 2026-07-10

## Goal

Make the configured Codex task emit exactly one machine-readable JSON object on
stdout. The object must combine the structured arithmetic answer with the token
usage reported by Codex. Codex diagnostics and progress output must remain on
stderr so they can be displayed separately by the existing TUI.

Claude command behavior is outside this change and remains unchanged.

## Current Behavior

`commands.json` invokes `codex exec` directly. Without `--json`, Codex writes its
final message to stdout and writes progress and diagnostics to stderr. The
scheduler captures both streams line by line, but it does not interpret Codex
events or combine the response with usage information.

The arithmetic prompt is rendered immediately before every command run. It is
shared by the Codex and Claude tasks.

## Chosen Approach

Add a dedicated Node.js Codex wrapper instead of embedding a large `jq` program
in `commands.json` or adding provider-specific behavior to the generic
scheduler.

The wrapper will invoke Codex with both:

- `--json`, which makes stdout a JSONL event stream and exposes the terminal
  event's usage data.
- `--output-schema`, which constrains the final agent message to the arithmetic
  result schema.

The wrapper will parse the JSONL stream and emit one normalized JSON object when
the child process finishes.

## Components

### Arithmetic result schema

A repository-owned JSON Schema will define the final Codex response:

```json
{
  "success": true,
  "answer": "42",
  "message": "Calculation completed"
}
```

The schema will require all three fields and reject additional properties. The
answer is a string so negative values and large integers are preserved without
numeric conversion concerns.

### Codex JSONL parser

A focused parser module will accept Codex JSONL text and the child exit status.
It will:

1. Parse every non-empty stdout line as a JSON event.
2. Locate the last terminal event (`turn.completed` or `turn.failed`).
3. Locate the last completed agent message.
4. Parse the agent message text as the schema-constrained JSON result.
5. Read usage from the terminal event.
6. Produce the normalized result object.

Keeping this logic in a pure function makes success and failure cases testable
without launching Codex or making network requests.

### Codex process wrapper

The executable wrapper will:

1. Receive the existing Codex CLI arguments, including the rendered arithmetic
   prompt.
2. Add `--json` and the repository schema path.
3. Spawn the real `codex` executable.
4. Buffer stdout as JSONL.
5. Forward stderr unchanged as it arrives.
6. On process close, call the parser and print exactly one JSON object followed
   by a newline to stdout.
7. Exit non-zero when the Codex process fails or the JSONL result cannot be
   normalized.

The wrapper will not print progress messages of its own to stdout.

### Command configuration

The Codex entry in `commands.json` will invoke the Node.js wrapper. Its existing
model, feature, sandbox, repository, and ephemeral arguments will remain the
same. The Claude entry and scheduling values will not change.

## Normalized Output Contract

Successful runs emit:

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
  "usage": {
    "input_tokens": 970,
    "cached_input_tokens": 0,
    "output_tokens": 25,
    "reasoning_output_tokens": 0,
    "total_tokens": 995
  }
}
```

`total_tokens` is calculated as `input_tokens + output_tokens`.
`cached_input_tokens` is already included in `input_tokens`, and
`reasoning_output_tokens` is already represented within output usage, so neither
is added again.

## Failure Handling

The wrapper treats a run as failed when any of these conditions holds:

- The Codex child exits with a non-zero status.
- The last terminal event is missing or is `turn.failed`.
- A JSONL line cannot be parsed.
- A completed agent message is missing.
- The final agent message is not valid JSON.

On failure, the wrapper still emits exactly one normalized JSON object to
stdout, with `subtype: "error"`, `is_error: true`, a null result, available
usage data, and a concise error message. It then exits non-zero so the existing
scheduler records the run as failed.

Codex stderr is not used as the success signal. Non-fatal messages such as a
model-catalog refresh error remain visible as diagnostics but do not override a
successful exit and `turn.completed` event.

## Data Flow

1. The scheduler renders `{{arithmeticPrompt}}`.
2. The scheduler starts the Codex wrapper with the configured arguments.
3. The wrapper starts `codex exec --json --output-schema ...`.
4. Codex diagnostics stream to wrapper stderr and then to the scheduler/TUI.
5. Codex JSONL events are buffered from stdout.
6. The wrapper combines the final structured message and terminal usage.
7. The wrapper writes one normalized JSON line to stdout.
8. The scheduler records the wrapper exit code and displays the output.

## Testing

Tests will cover:

- A successful event stream produces the expected normalized result.
- Usage fields and `total_tokens` are calculated correctly.
- A `turn.failed` event produces an error result and failure status.
- A non-zero child exit produces an error result even if a completed event is
  present.
- Invalid JSONL produces a normalized parse error.
- A missing or non-JSON final agent message produces a normalized error.
- The configured Codex command invokes the wrapper while preserving the
  existing Codex options and arithmetic prompt token.

The complete existing test suite will be run after implementation.

## Documentation

README examples will show the wrapper-based Codex command, the unified output
shape, the separation between stdout and stderr, and the distinction between
execution success and the schema's task-level `result.success` value.

## Out of Scope

- Changing Claude output or parsing.
- Evaluating the arithmetic expression independently to validate the model's
  answer.
- Adding provider-specific parsing to the generic scheduler.
- Fixing the custom model-catalog endpoint's `data` versus `models` response
  mismatch.
