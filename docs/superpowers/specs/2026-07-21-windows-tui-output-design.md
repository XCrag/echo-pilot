# Windows TUI Output Rendering Design

## Problem

The detail dashboard counts captured output by logical newline-delimited lines.
Provider wrappers emit normalized JSON as one long line, and `boxLine()` then
truncates that line to the fixed panel width. The error at the end of the JSON
is therefore invisible regardless of available terminal height.

The TUI also redraws by writing raw ANSI erase-screen bytes. Some Windows
console environments do not perform the intended in-place redraw, causing a
complete dashboard copy to be appended on every refresh.

## Design

Wrap captured output into visual lines no wider than the panel content width.
Calculate the output budget from terminal rows, then retain the newest visual
lines so the end of a long normalized error remains visible. Existing short
output lines retain their current rendering.

Replace the raw erase-screen prefix with Node readline cursor operations:
move to column zero and row zero, then clear from the cursor downward before
writing the dashboard. Apply these operations only for TTY output; injected or
redirected non-TTY streams continue receiving plain dashboard text without
terminal-control calls.

## Components

- `lib/tui.js`: add width-bounded output wrapping, use wrapped lines in detail
  rendering, and perform cross-platform TTY redraw through `node:readline`.
- `test/tui.test.js`: verify a single long output line exposes its trailing
  error within the row budget and verify TTY redraw uses readline operations.

## Error Handling

Wrapping treats captured output as display text and does not parse or mutate
provider JSON. Empty output continues to display `-`. Cursor operations use the
existing stdout dependency and do not alter scheduler or provider errors.

## Testing

Use TDD for two behaviors. First prove that a long one-line JSON error is
currently truncated, then implement visual wrapping and verify the trailing
error appears without exceeding terminal rows. Next prove that TTY redraw does
not call readline cursor clearing, then implement cursor-to-home and
clear-screen-down calls. Run the focused TUI tests and the complete test suite.

## Scope

This change affects only TUI display and redraw behavior. It does not change
wrapper output, scheduler execution, Codex arguments, or the fixed panel width.
