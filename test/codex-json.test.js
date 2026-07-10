const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeCodexRun } = require("../lib/codex-json");

function jsonl(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

test("normalizeCodexRun combines the final structured message and usage", () => {
  const stdout = jsonl([
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: JSON.stringify({
          success: true,
          answer: "42",
          message: "Calculation completed",
        }),
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 970,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 5,
      },
    },
  ]);

  assert.deepEqual(normalizeCodexRun({ stdout, exitCode: 0 }), {
    ok: true,
    value: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: {
        success: true,
        answer: "42",
        message: "Calculation completed",
      },
      error: null,
      usage: {
        input_tokens: 970,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 5,
        total_tokens: 995,
      },
    },
  });
});

test("normalizeCodexRun defaults missing usage counters to zero", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: '{"success":true,"answer":"7","message":"ok"}',
      },
    },
    { type: "turn.completed", usage: { input_tokens: 10 } },
  ]);

  assert.deepEqual(normalizeCodexRun({ stdout, exitCode: 0 }).value.usage, {
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 10,
  });
});

test("normalizeCodexRun rejects turn.failed while preserving usage", () => {
  const stdout = jsonl([
    {
      type: "turn.failed",
      error: { message: "request failed" },
      usage: { input_tokens: 12, output_tokens: 3 },
    },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 1 });

  assert.equal(normalized.ok, false);
  assert.equal(normalized.value.subtype, "error");
  assert.equal(normalized.value.is_error, true);
  assert.equal(normalized.value.result, null);
  assert.match(normalized.value.error, /request failed/);
  assert.equal(normalized.value.usage.total_tokens, 15);
});

test("normalizeCodexRun rejects a non-zero child exit", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: '{"success":true,"answer":"9","message":"ok"}',
      },
    },
    { type: "turn.completed", usage: {} },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 2 });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /code 2/);
});

test("normalizeCodexRun reports invalid JSONL", () => {
  const normalized = normalizeCodexRun({
    stdout: '{"type":"turn.started"}\nnot-json\n',
    exitCode: 0,
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /line 2/);
});

test("normalizeCodexRun reports a missing final agent message", () => {
  const normalized = normalizeCodexRun({
    stdout: jsonl([{ type: "turn.completed", usage: {} }]),
    exitCode: 0,
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /agent message/);
});

test("normalizeCodexRun reports a non-JSON final agent message", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: { type: "agent_message", text: "42" },
    },
    { type: "turn.completed", usage: {} },
  ]);

  const normalized = normalizeCodexRun({ stdout, exitCode: 0 });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /final agent message/);
});

test("normalizeCodexRun reports spawn errors", () => {
  const normalized = normalizeCodexRun({
    stdout: "",
    exitCode: null,
    spawnError: new Error("codex not found"),
  });

  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /codex not found/);
});

test("normalizeCodexRun reports a null JSONL event without throwing", () => {
  const stdout = jsonl([null, { type: "turn.completed", usage: {} }]);
  let normalized;

  assert.doesNotThrow(() => {
    normalized = normalizeCodexRun({ stdout, exitCode: 0 });
  });
  assert.equal(normalized.ok, false);
  assert.match(normalized.value.error, /line 1/);
});

test("normalizeCodexRun treats null usage as empty usage", () => {
  const stdout = jsonl([
    {
      type: "item.completed",
      item: { type: "agent_message", text: "{}" },
    },
    { type: "turn.completed", usage: null },
  ]);
  let normalized;

  assert.doesNotThrow(() => {
    normalized = normalizeCodexRun({ stdout, exitCode: 0 });
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.value.usage, {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  });
});
