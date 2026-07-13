# auto-reply

Small CLI that repeatedly runs two commands:

```bash
./bin/codex-json.js exec --model gpt-5.6-sol --config 'model_reasoning_effort="none"' --config 'web_search="disabled"' --disable shell_tool --disable multi_agent --disable hooks --disable plugins --skip-git-repo-check --sandbox read-only --ignore-rules --ephemeral "{{arithmeticPrompt}}"
claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq -c '{type, subtype, is_error, result, usage}'
```

Each command has its own loop. A command starts, waits for that process to exit,
then schedules its next run after a random delay from 100 to 140 seconds.

## Usage

```bash
npm test
node bin/auto-reply.js
```

Stop it with `Ctrl+C`.

## Codex JSON Output

`./bin/codex-json.js` writes exactly one normalized JSON object to stdout and
forwards Codex diagnostics to stderr. The wrapper's `subtype`, `is_error`, and
exit status describe Codex execution and output-normalization success. A
non-zero Codex child exit, termination signal, `turn.failed` event, or
normalization error produces `subtype: "error"` and a non-zero wrapper exit.

`result.success` is separate task-level data defined by the arithmetic result
schema. A valid `result.success: false` response can therefore coexist with
`subtype: "success"`, `is_error: false`, and a zero wrapper exit. Successful
execution and normalization have this shape:

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

## TUI

Run the interactive controller:

```bash
node bin/auto-reply-tui.js
```

It opens with all tasks stopped. Use the keyboard to control them:

```text
↑/↓  select task
enter open selected task detail
esc  return to task list from detail
s    start/resume selected task
x    stop selected task
r    run selected task now
a    start all tasks
z    stop all tasks
b    edit base delay seconds for this TUI session
j    edit jitter seconds for this TUI session
q    quit
```

When editing schedule values in the TUI, type a number and press `Enter` to
apply it, or `Esc` to cancel. Waiting tasks are re-scheduled immediately using
the new values. These TUI edits are runtime-only; edit `commands.json` if you
want the defaults to persist across restarts.

The task list's `Last` column combines the last execution status with its
compact total token count:

```text
Last
OK · 995t
ERR · 1.7kt
STOP · 0t
```

The task detail screen's `Last Token Usage` section shows total, input, and
output tokens. Its provider-specific line shows `Cached` and `Reasoning`
counters for Codex, or `Cache create` and `Cache read` counters for Claude. The
`OK`, `ERR`, and `STOP` labels describe execution-level status; they do not
validate whether the arithmetic answer is correct.

In TUI mode, command stdout and stderr are captured and shown in the
`Selected Output` section on the selected task detail screen. The plain
`node bin/auto-reply.js` mode still writes command output directly to the
terminal. A `[stderr]` line means the command wrote to stderr; it does not
necessarily mean the task failed. Check the `Last` column for exit status.

## Change Schedule And Commands

Edit `commands.json`:

```json
{
  "schedule": {
    "baseDelaySeconds": 120,
    "jitterSeconds": 20
  },
  "commands": [
    {
      "name": "codex",
      "command": "./bin/codex-json.js",
      "args": ["exec", "--model", "gpt-5.6-sol", "--config", "model_reasoning_effort=\"none\"", "--config", "web_search=\"disabled\"", "--disable", "shell_tool", "--disable", "multi_agent", "--disable", "hooks", "--disable", "plugins", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-rules", "--ephemeral", "{{arithmeticPrompt}}"]
    },
    {
      "name": "claude",
      "command": "sh",
      "args": ["-c", "claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt \"\" --output-format json \"{{arithmeticPrompt}}\" | jq -c '{type, subtype, is_error, result, usage}'"]
    }
  ]
}
```

`baseDelaySeconds: 120` with `jitterSeconds: 20` means each next run is
scheduled randomly from 100 to 140 seconds after the previous command exits.

Restart `node bin/auto-reply-tui.js` or `node bin/auto-reply.js` after changing
the file.

`{{arithmeticPrompt}}` is rendered before every command run. It creates a
3-5 term expression using numbers from 1 to 1000, for example:

```text
Calculate 17 + 928 - 304 + 66. Reply with only the final number.
```
