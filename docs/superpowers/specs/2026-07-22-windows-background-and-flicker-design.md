# Windows Background Provider and Flicker-Free TUI Design

## Problem

The Windows TUI has two disruptive behaviors:

1. Every refresh briefly exposes a cleared terminal because the renderer clears
   the screen before writing the next frame.
2. Every Codex or Claude provider launch can open a visible console window,
   interrupting the user, especially during continuous LOOP runs.

macOS does not visibly exhibit these behaviors, and Windows should provide the
same background-running experience.

## Design

### Render complete frames without a blank interval

Build the complete dashboard string before performing terminal operations. On
an interactive terminal, move the cursor to the top-left, write the complete
new frame, and only then clear any content remaining below it from a previous,
longer frame.

This changes the update order from:

```text
cursor home -> clear old frame -> write new frame
```

to:

```text
build new frame -> cursor home -> write new frame -> clear old remainder
```

The renderer continues to redraw once per second and on state changes. It does
not introduce line-level diffing, an alternate screen buffer, or platform-only
rendering branches.

For non-TTY output, preserve the existing behavior of appending rendered
frames without cursor control.

### Hide Windows provider consoles

When a provider wrapper runs on `win32`, pass `windowsHide: true` to the child
process spawn options. Apply this to both `bin/codex-json.js` and
`bin/claude-json.js`.

Keep the existing Windows `cmd.exe` command-shim resolution and stdout/stderr
pipes unchanged. On macOS and Linux, omit `windowsHide` so their spawn option
objects and runtime behavior remain unchanged.

## Data and Process Flow

```text
TUI refresh
  -> render dashboard fully in memory
  -> move cursor home
  -> write one complete frame
  -> erase stale rows below the new frame

Provider run
  -> wrapper resolves provider command
  -> Windows: spawn through existing shim with windowsHide=true
  -> macOS/Linux: spawn exactly as before
  -> wrapper waits for provider close
  -> scheduler handles the final result and LOOP behavior exactly as before
```

## Error Handling

- A provider spawn failure remains a normal wrapper error and is reported using
  the existing normalized result path.
- Hiding a Windows console must not detach the provider or change stdio capture.
- Cursor movement or clearing continues to be used only for TTY output.
- Cleanup must continue to restore the cursor and stop active tasks.

## Testing

Add focused regression tests that verify:

1. TTY redraw renders the complete frame before clearing stale screen content.
2. Non-TTY redraw retains its existing append-only behavior.
3. Codex uses `windowsHide: true` on `win32`.
4. Claude uses `windowsHide: true` on `win32`.
5. Non-Windows Codex and Claude spawn options remain unchanged.

Run the focused TUI and wrapper tests, followed by the full test suite.

## Explicit Non-Goals

- Do not change Codex native request or stream retries.
- Do not change scheduler timing or continuous LOOP behavior.
- Do not detach providers from the wrapper process.
- Do not change provider commands, arguments, or structured-output parsing.
- Do not add terminal diffing or alternate-screen support.
- Do not change macOS or Linux behavior beyond shared render ordering.
