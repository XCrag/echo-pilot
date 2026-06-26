# auto-reply

Small CLI that repeatedly runs two commands:

```bash
codex exec --skip-git-repo-check --sandbox read-only --ignore-rules --ephemeral "{{arithmeticPrompt}}"
claude -p --bare --tools "" --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq '{result, usage}'
```

Each command has its own loop. A command starts, waits for that process to exit,
then schedules its next run after a random delay from 100 to 140 seconds.

## Usage

```bash
npm test
node bin/auto-reply.js
```

Stop it with `Ctrl+C`.

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
      "command": "codex",
      "args": ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-rules", "--ephemeral", "{{arithmeticPrompt}}"]
    },
    {
      "name": "claude",
      "command": "sh",
      "args": ["-c", "claude -p --bare --tools \"\" --disable-slash-commands --strict-mcp-config --system-prompt \"\" --output-format json \"{{arithmeticPrompt}}\" | jq '{result, usage}'"]
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
