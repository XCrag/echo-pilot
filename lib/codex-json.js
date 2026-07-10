function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeUsage(usage = {}) {
  const inputTokens = numberOrZero(usage.input_tokens);
  const outputTokens = numberOrZero(usage.output_tokens);

  return {
    input_tokens: inputTokens,
    cached_input_tokens: numberOrZero(usage.cached_input_tokens),
    output_tokens: outputTokens,
    reasoning_output_tokens: numberOrZero(usage.reasoning_output_tokens),
    total_tokens: inputTokens + outputTokens,
  };
}

function errorValue(message, usage) {
  return {
    ok: false,
    value: {
      type: "result",
      subtype: "error",
      is_error: true,
      result: null,
      error: message,
      usage: normalizeUsage(usage),
    },
  };
}

function parseEvents(stdout) {
  const events = [];
  const lines = String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`invalid Codex JSONL at line ${index + 1}`);
    }
  }

  return events;
}

function findLast(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function eventErrorMessage(event) {
  return event && event.error && typeof event.error.message === "string"
    ? event.error.message
    : "Codex turn failed";
}

function normalizeCodexRun({
  stdout = "",
  exitCode = null,
  signal = null,
  spawnError = null,
} = {}) {
  if (spawnError) return errorValue(`Codex failed to start: ${spawnError.message}`);

  let events;
  try {
    events = parseEvents(stdout);
  } catch (error) {
    return errorValue(error.message);
  }

  const terminalEvent = findLast(
    events,
    (event) => event.type === "turn.completed" || event.type === "turn.failed",
  );
  const usage = terminalEvent && terminalEvent.usage;

  if (!terminalEvent) return errorValue("Codex terminal event is missing");
  if (terminalEvent.type === "turn.failed") {
    return errorValue(eventErrorMessage(terminalEvent), usage);
  }
  if (signal) return errorValue(`Codex exited with signal ${signal}`, usage);
  if (exitCode !== 0) return errorValue(`Codex exited with code ${exitCode}`, usage);

  const messageEvent = findLast(
    events,
    (event) =>
      event.type === "item.completed" &&
      event.item &&
      event.item.type === "agent_message",
  );
  if (!messageEvent) return errorValue("Codex final agent message is missing", usage);

  let result;
  try {
    result = JSON.parse(messageEvent.item.text);
  } catch {
    return errorValue("Codex final agent message is not valid JSON", usage);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return errorValue("Codex final agent message is not a JSON object", usage);
  }

  return {
    ok: true,
    value: {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      error: null,
      usage: normalizeUsage(usage),
    },
  };
}

module.exports = {
  normalizeCodexRun,
};
