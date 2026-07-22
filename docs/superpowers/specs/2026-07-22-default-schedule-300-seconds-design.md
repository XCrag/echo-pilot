# Default Schedule 300 Seconds Design

## Goal

Change every effective default timer schedule from `120 ±20s` to `300 ±20s`,
so scheduled runs wait between 280 and 320 seconds by default.

## Design

Update the default base delay from 120,000 milliseconds to 300,000
milliseconds in the configuration loader, scheduler, and TUI fallback paths.
Update the repository `commands.json` value from 120 seconds to 300 seconds so
normal launches use the new default without relying on fallback behavior.

Keep the jitter at 20,000 milliseconds everywhere.

Update README examples and explanations to show `300 ±20s`. Update tests that
assert default scheduling or default TUI display. Retain explicit 120-second
values in tests whose purpose is to verify a caller-supplied custom schedule;
those values are inputs, not defaults.

## Behavior

```text
timer mode run completes
  -> base delay 300 seconds
  -> apply random jitter from -20 to +20 seconds
  -> next run occurs after 280 to 320 seconds
```

Continuous LOOP mode remains immediate after the previous provider process
fully exits. Run-once behavior is unchanged.

## Testing

- Verify the scheduler's no-argument jitter calculation centers on 300 seconds.
- Verify command-loop default timers use 300 seconds.
- Verify TUI fallback rendering displays `schedule 300s ±20s`.
- Verify repository configuration loads 300 seconds.
- Run the complete test suite.

## Non-Goals

- Do not change the ±20-second jitter.
- Do not change LOOP timing or provider retry behavior.
- Do not introduce a new shared constants module.
- Do not rewrite historical design or implementation documents.
