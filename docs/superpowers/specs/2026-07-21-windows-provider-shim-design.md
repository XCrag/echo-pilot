# Windows Provider Shim Launch Design

## Problem

On Windows, npm exposes the provider CLIs as `codex.cmd` and `claude.cmd`.
Interactive shells resolve those shims, but the wrappers currently call
`child_process.spawn("codex", args)` and `spawn("claude", args)` directly.
In the reported Node/Windows environment that bypasses command-shell shim
resolution and fails immediately with `spawn codex ENOENT`.

## Design

Introduce one small provider-command builder shared by both wrappers. On
Windows it will launch `%ComSpec%` (falling back to `cmd.exe`) with `/d`, `/s`,
and `/c`, followed by the provider's explicit `.cmd` shim and the unchanged
provider arguments. On non-Windows platforms it will return the existing
provider command and arguments unchanged.

The wrappers will continue using `spawn` with their existing stdio settings,
event handling, normalization, exit codes, and termination behavior. Platform
and environment inputs will be injectable only where needed for deterministic
tests.

## Components

- `lib/provider-command.js`: build the platform-specific executable and argv.
- `bin/codex-json.js`: use the builder before spawning Codex.
- `bin/claude-json.js`: use the builder before spawning Claude.
- Wrapper tests: assert Windows uses `ComSpec` plus the `.cmd` shim and Unix
  retains direct invocation.

## Error Handling

If `ComSpec` is unset on Windows, use `cmd.exe`, which is the standard Windows
command interpreter name. Existing spawn-error reporting remains responsible
for a missing interpreter, missing shim, or provider launch failure.

## Testing

Use TDD to demonstrate that each wrapper currently passes the bare provider
name to `spawn` when simulating Windows. Implement the shared builder, verify
the Windows executable and argv exactly, verify non-Windows behavior remains
unchanged, then run the complete test suite.

## Explicit Non-Goal

Do not change scheduler timing or LOOP behavior. An immediately failing LOOP
must continue retrying immediately, as explicitly required by the user.
