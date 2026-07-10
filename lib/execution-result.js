function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function parseStructuredOutput(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;

  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function usageKind(provider, usage) {
  if (
    provider === "claude" ||
    Object.hasOwn(usage, "cache_creation_input_tokens") ||
    Object.hasOwn(usage, "cache_read_input_tokens")
  ) {
    return "claude";
  }
  return "codex";
}

function normalizeUsage(provider, usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const kind = usageKind(provider, usage);
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  const cachedInputTokens = tokenCount(usage.cached_input_tokens);
  const cacheCreationInputTokens = tokenCount(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = tokenCount(usage.cache_read_input_tokens);
  const reasoningOutputTokens = tokenCount(usage.reasoning_output_tokens);
  const hasSuppliedTotal =
    typeof usage.total_tokens === "number" &&
    Number.isFinite(usage.total_tokens) &&
    usage.total_tokens >= 0;
  const totalTokens = kind === "claude"
    ? inputTokens + cacheCreationInputTokens + cacheReadInputTokens + outputTokens
    : hasSuppliedTotal
      ? usage.total_tokens
      : inputTokens + outputTokens;

  return {
    kind,
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function normalizeLastExecution({
  provider,
  stdout = "",
  exitCode = null,
  signal = null,
  error = null,
  finishedAt = Date.now(),
} = {}) {
  const structured = parseStructuredOutput(stdout);
  const structuredError =
    structured &&
    (structured.is_error === true ||
      (typeof structured.subtype === "string" && structured.subtype !== "success"));
  const errorMessage = error ? error.message || String(error) : null;

  let status = "success";
  if (signal) {
    status = "stopped";
  } else if (errorMessage || (exitCode !== null && exitCode !== 0)) {
    status = "error";
  } else if (structuredError) {
    status = "error";
  }

  return {
    status,
    finishedAt,
    exitCode,
    signal,
    error: errorMessage,
    usage: normalizeUsage(provider, structured && structured.usage),
  };
}

module.exports = {
  normalizeLastExecution,
};
