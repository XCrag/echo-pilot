const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  formatRemainingTime,
  formatTokenCount,
  renderDashboard,
  startTui,
} = require('../lib/tui');

test('formatRemainingTime formats positive and expired times', () => {
  assert.equal(formatRemainingTime(0), '0s');
  assert.equal(formatRemainingTime(-1_000), '0s');
  assert.equal(formatRemainingTime(59_000), '59s');
  assert.equal(formatRemainingTime(61_000), '1m 1s');
});

test('formatTokenCount formats exact, kilo, and mega token values', () => {
  assert.equal(formatTokenCount(0), '0t');
  assert.equal(formatTokenCount(999), '999t');
  assert.equal(formatTokenCount(1_000), '1.0kt');
  assert.equal(formatTokenCount(1_700), '1.7kt');
  assert.equal(formatTokenCount(1_000_000), '1.0Mt');
});

function sampleTasks() {
  return [
    {
      name: 'codex',
      status: 'running',
      mode: 'loop',
      command: 'codex',
      args: ['exec', 'Calculate 1 + 2. Reply with only the final number.'],
      nextRunAt: null,
      lastExitCode: null,
      lastSignal: null,
      lastError: null,
      outputLines: [],
    },
    {
      name: 'claude',
      status: 'waiting',
      mode: 'timer',
      command: 'sh',
      args: ['-c', 'claude ...'],
      nextRunAt: 121_000,
      lastExitCode: 0,
      lastSignal: null,
      lastError: null,
      lastExecution: {
        status: 'success',
        finishedAt: 1000,
        exitCode: 0,
        signal: null,
        error: null,
        usage: {
          kind: 'claude',
          inputTokens: 2,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 1561,
          cacheReadInputTokens: 0,
          outputTokens: 136,
          reasoningOutputTokens: 0,
          totalTokens: 1699,
        },
      },
      outputLines: ['[stdout] {"result":"42"}', '[stdout] {"usage":{"input_tokens":12}}'],
    },
  ];
}

test('renderDashboard list mode shows task status without selected output', () => {
  const output = renderDashboard(sampleTasks(), {
    selectedIndex: 1,
    now: 1_000,
    logs: ['[claude] next run in 120s'],
    mode: 'list',
  });

  assert.match(output, /┌ Auto Reply/);
  assert.match(output, /│ 2 tasks · schedule 120s ±20s/);
  assert.match(output, /│ ↑\/↓ select · enter detail · s start · x stop · r once · l loop · q quit/);
  assert.match(output, /│ Task\s+│ Status\s+│ Mode\s+│ Next Run\s+│ Last\s+│ Sel │/);
  assert.match(output, /│ codex\s+│ RUNNING\s+│ LOOP\s+│ -\s+│ -\s+│\s+│/);
  assert.match(output, /│ claude\s+│ WAITING\s+│ TIMER\s+│ 2m 0s\s+│ OK · 1\.7kt\s+│ ◀\s+│/);
  assert.match(output, /Recent Logs/);
  assert.match(output, /OK · 1\.7kt/);
  assert.match(output, /\[claude\] next run in 120s/);
  assert.doesNotMatch(output, /Selected Output/);
  assert.doesNotMatch(output, /\[stdout\] \{"result":"42"\}/);
});

test('renderDashboard list mode summarizes error and stopped executions', () => {
  const tasks = [
    {
      name: 'codex',
      status: 'waiting',
      mode: 'timer',
      command: 'codex',
      args: [],
      nextRunAt: null,
      lastExecution: {
        status: 'error',
        exitCode: 1,
        signal: null,
        error: null,
        usage: null,
      },
      outputLines: [],
    },
    {
      name: 'claude',
      status: 'stopped',
      mode: 'idle',
      command: 'claude',
      args: [],
      nextRunAt: null,
      lastExecution: {
        status: 'stopped',
        exitCode: 1,
        signal: 'SIGTERM',
        error: null,
        usage: {
          kind: 'claude',
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
      },
      outputLines: [],
    },
  ];

  const output = renderDashboard(tasks, { now: 1000, mode: 'list' });

  assert.match(output, /codex.*ERR · -/);
  assert.match(output, /claude.*STOP · 0t/);
});

test('renderDashboard detail mode shows selected task command and output', () => {
  const output = renderDashboard(sampleTasks(), {
    selectedIndex: 1,
    now: 1_000,
    logs: ['[claude] next run in 120s'],
    mode: 'detail',
  });

  assert.match(output, /Task Detail: claude/);
  assert.match(output, /Status:\s+WAITING/);
  assert.match(output, /Mode:\s+TIMER/);
  assert.match(output, /Next Run:\s+2m 0s/);
  assert.match(output, /Last:\s+OK · exit=0/);
  assert.match(output, /Selected Command/);
  assert.match(output, /sh -c claude \.\.\./);
  assert.match(output, /Last Token Usage/);
  assert.match(output, /Total 1,699 · Input 2 · Output 136/);
  assert.match(output, /Cache create 1,561 · Cache read 0/);
  assert.match(output, /Selected Output/);
  assert.match(output, /\[stdout\] \{"result":"42"\}/);
  assert.match(output, /esc back · x stop · r run once · l loop · s start\/resume · q quit/);
});

test('renderDashboard detail mode shows Codex token breakdown', () => {
  const tasks = sampleTasks();
  tasks[0].lastExecution = {
    status: 'success',
    finishedAt: 1000,
    exitCode: 0,
    signal: null,
    error: null,
    usage: {
      kind: 'codex',
      inputTokens: 970,
      cachedInputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 25,
      reasoningOutputTokens: 5,
      totalTokens: 995,
    },
  };

  const output = renderDashboard(tasks, {
    selectedIndex: 0,
    now: 1000,
    mode: 'detail',
  });

  assert.match(output, /Last:\s+OK · exit=0/);
  assert.match(output, /Last Token Usage/);
  assert.match(output, /Total 995 · Input 970 · Output 25/);
  assert.match(output, /Cached 100 · Reasoning 5/);
});

test('renderDashboard detail mode limits output to terminal height', () => {
  const tasks = sampleTasks();
  tasks[1].outputLines = Array.from({ length: 50 }, (_, index) => `[stdout] line ${index + 1}`);

  const output = renderDashboard(tasks, {
    selectedIndex: 1,
    now: 1_000,
    mode: 'detail',
    rows: 18,
  });
  const lines = output.split('\n');

  assert.ok(lines.length <= 18, `expected at most 18 lines, got ${lines.length}`);
  assert.match(output, /esc back · x stop · r run once · l loop · s start\/resume · q quit/);
  assert.match(output, /\[stdout\] line 50/);
  assert.doesNotMatch(output, /\[stdout\] line 1/);
});

test('startTui switches between list and detail mode with enter and escape', () => {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  const chunks = [];
  const stdout = {
    isTTY: false,
    write: (chunk) => chunks.push(chunk),
  };
  const tasks = sampleTasks().map((state) => ({
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
    runNow: () => {},
  }));
  const runner = {
    getTasks: () => tasks,
    start: () => {},
    stop: () => {},
  };
  const intervals = [];

  const session = startTui(runner, {
    stdin,
    stdout,
    logs: [],
    now: () => 1_000,
    setInterval: (callback) => {
      intervals.push(callback);
      return callback;
    },
    clearInterval: () => {},
    exit: () => {},
  });

  assert.match(chunks.at(-1), /Recent Logs/);
  assert.doesNotMatch(chunks.at(-1), /Task Detail/);

  stdin.emit('keypress', '\r', { name: 'return' });

  assert.match(chunks.at(-1), /Task Detail: codex/);

  stdin.emit('keypress', '\u001b', { name: 'escape' });

  assert.match(chunks.at(-1), /Recent Logs/);
  assert.doesNotMatch(chunks.at(-1), /Task Detail/);

  session.close();
});

test('startTui starts continuous run for the selected task with l', () => {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  const stdout = {
    isTTY: false,
    write: () => {},
  };
  let continuousRuns = 0;
  const tasks = sampleTasks().map((state) => ({
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
    runNow: () => {},
    runContinuous: () => {
      continuousRuns += 1;
    },
  }));
  const runner = {
    getTasks: () => tasks,
    start: () => {},
    stop: () => {},
  };

  const session = startTui(runner, {
    stdin,
    stdout,
    logs: [],
    now: () => 1_000,
    setInterval: (callback) => callback,
    clearInterval: () => {},
    exit: () => {},
  });

  stdin.emit('keypress', 'l', { name: 'l' });

  assert.equal(continuousRuns, 1);

  session.close();
});

test('startTui edits base delay seconds from the keyboard', () => {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  const chunks = [];
  const stdout = {
    isTTY: false,
    write: (chunk) => chunks.push(chunk),
  };
  const tasks = sampleTasks().map((state) => ({
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
    runNow: () => {},
  }));
  let schedule = { baseDelayMs: 120_000, jitterMs: 20_000 };
  const updates = [];
  const runner = {
    getTasks: () => tasks,
    getSchedule: () => schedule,
    updateSchedule: (nextSchedule) => {
      schedule = { ...schedule, ...nextSchedule };
      updates.push(nextSchedule);
    },
    start: () => {},
    stop: () => {},
  };

  const session = startTui(runner, {
    stdin,
    stdout,
    logs: [],
    now: () => 1_000,
    setInterval: (callback) => callback,
    clearInterval: () => {},
    exit: () => {},
  });

  stdin.emit('keypress', 'b', { name: 'b' });
  assert.match(chunks.at(-1), /Set base delay seconds/);

  for (const digit of ['3', '0', '0']) {
    stdin.emit('keypress', digit, { name: digit });
  }
  stdin.emit('keypress', '\r', { name: 'return' });

  assert.deepEqual(updates.at(-1), { baseDelayMs: 300_000 });
  assert.match(chunks.at(-1), /schedule 300s ±20s/);

  session.close();
});

test('startTui quits from schedule edit mode with q', () => {
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  const stdout = {
    isTTY: false,
    write: () => {},
  };
  const tasks = sampleTasks().map((state) => ({
    getState: () => state,
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
    runNow: () => {},
  }));
  let exitCode = null;
  const runner = {
    getTasks: () => tasks,
    getSchedule: () => ({ baseDelayMs: 120_000, jitterMs: 20_000 }),
    updateSchedule: () => true,
    start: () => {},
    stop: () => {},
  };

  startTui(runner, {
    stdin,
    stdout,
    logs: [],
    now: () => 1_000,
    setInterval: (callback) => callback,
    clearInterval: () => {},
    exit: (code) => {
      exitCode = code;
    },
  });

  stdin.emit('keypress', 'b', { name: 'b' });
  stdin.emit('keypress', 'q', { name: 'q' });

  assert.equal(exitCode, 0);
});
