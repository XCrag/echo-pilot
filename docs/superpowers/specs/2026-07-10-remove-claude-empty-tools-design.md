# Remove Claude Empty Tools Argument

## Context

The configured Claude command currently includes `--tools ""`. Passing an
explicit empty tools value may cause the Claude process to hang. The command is
duplicated in the runtime configuration, the built-in fallback configuration,
the default-command regression test, and the README.

## Design

Remove only the `--tools ""` argument from the Claude invocation. Keep all
other Claude flags, prompt interpolation, shell quoting, JSON output handling,
and the `jq` pipeline unchanged.

Update these four locations together:

- `commands.json`, which is the normal runtime configuration.
- `lib/scheduler.js`, which provides the built-in default command.
- `test/scheduler.test.js`, which asserts the default command exactly.
- `README.md`, which documents both the shell command and JSON configuration.

## Testing

First update the exact-command regression expectation so it fails against the
current default command. Then update the runtime/default command definitions and
documentation. Run the focused scheduler test, the complete test suite, and a
repository search confirming that no `--tools ""` occurrence remains.

## Success Criteria

- No configured or documented Claude invocation contains `--tools ""`.
- The remaining Claude command is otherwise byte-for-byte equivalent.
- The focused regression test and complete test suite pass.
