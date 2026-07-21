# Windows Wrapper Launch Design

## Problem

The scheduler currently passes `bin/codex-json.js` and `bin/claude-json.js`
directly to `child_process.spawn()`. This relies on Unix shebang execution and
fails on Windows before either provider CLI starts, with errors such as
`spawn EFTYPE`.

## Design

Launch both built-in JavaScript wrappers through `process.execPath`, the Node.js
executable running auto-reply. The wrapper path becomes the first argument and
the existing provider arguments follow unchanged.

Apply the same command shape to `commands.json` so configured commands do not
override the cross-platform defaults with direct `.js` execution. Document the
Node-based invocation in the README examples.

No platform-specific branch or `.cmd` wrapper will be introduced. The wrapper
scripts and their provider-child behavior remain unchanged.

## Data Flow

The scheduler spawns `process.execPath`; Node loads the selected wrapper; the
wrapper spawns `codex` or `claude`; normalized output flows back to the scheduler
exactly as it does today.

## Error Handling

Existing synchronous spawn-error and child `error` handling remains in place.
Using the current Node executable removes the unsupported direct-script launch
boundary without changing error semantics after the wrapper starts.

## Testing

Add a regression test asserting that both built-in command specifications use
`process.execPath`, place their expected wrapper path first in `args`, and retain
their provider arguments afterward. Run that test once before implementation to
confirm it fails for the current direct-script commands, then run it and the
complete test suite after the minimal production and configuration changes.

## Scope

Only built-in wrapper launch commands, checked-in command configuration, tests,
and related README examples are affected. Process termination behavior and
provider CLI discovery are outside this change.
