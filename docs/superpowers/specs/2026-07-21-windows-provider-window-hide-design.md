# Windows Provider Window Hiding Design

## Problem

Windows provider launches now correctly run through `cmd.exe`, but each launch
can create a visible console window. In LOOP mode, immediate retries therefore
produce repeated terminal popups.

## Design

Set `windowsHide: true` on the provider child-process spawn options when the
wrapper platform is `win32`. Keep the existing stdio pipes and command-shim
selection unchanged. On non-Windows platforms, omit `windowsHide` so existing
spawn option objects and behavior remain unchanged.

Apply the behavior to both `bin/codex-json.js` and `bin/claude-json.js`.

## Testing

Extend the existing Windows command-shim tests to require
`windowsHide: true`. Existing non-Windows direct-invocation tests must continue
to expect only the current stdio option. Run focused wrapper tests and the full
suite.

## Explicit Non-Goals

- Do not change LOOP timing or retry behavior.
- Do not change `.codex/config.toml` or MCP configuration.
- Do not change provider commands or arguments.
