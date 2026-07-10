const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  DEFAULT_COMMANDS,
  createTaskController,
  createRunner,
  getJitteredDelayMs,
  runCommandLoop,
} = require("../lib/scheduler");

test("getJitteredDelayMs returns base delay plus or minus jitter", () => {
  assert.equal(getJitteredDelayMs({ random: () => 0 }), 100_000);
  assert.equal(getJitteredDelayMs({ random: () => 0.5 }), 120_000);
  assert.equal(getJitteredDelayMs({ random: () => 1 }), 140_000);
});

test("getJitteredDelayMs supports custom base delay and jitter", () => {
  const options = { baseDelayMs: 300_000, jitterMs: 20_000 };

  assert.equal(getJitteredDelayMs({ ...options, random: () => 0 }), 280_000);
  assert.equal(getJitteredDelayMs({ ...options, random: () => 0.5 }), 300_000);
  assert.equal(getJitteredDelayMs({ ...options, random: () => 1 }), 320_000);
});

test("default commands match the requested codex and claude invocations", () => {
  assert.deepEqual(DEFAULT_COMMANDS, [
    {
      name: "codex",
      command: "codex",
      args: [
        "exec",
        "--model",
        "gpt-5.6-sol",
        "--config",
        'model_reasoning_effort="none"',
        "--config",
        'web_search="disabled"',
        "--disable",
        "shell_tool",
        "--disable",
        "multi_agent",
        "--disable",
        "hooks",
        "--disable",
        "plugins",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-rules",
        "--ephemeral",
        "{{arithmeticPrompt}}",
      ],
    },
    {
      name: "claude",
      command: "sh",
      args: [
        "-c",
        'claude -p --bare --tools "" --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq \'{result, usage}\'',
      ],
    },
  ]);
});

test("runCommandLoop starts immediately and schedules the next run after close", () => {
  const spawned = [];
  const timers = [];

  const loop = runCommandLoop(
    {
      name: "sample",
      command: "example",
      args: ["--flag"],
    },
    {
      random: () => 0.5,
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return { id: timers.length };
      },
      clearTimeout: () => {},
      spawn: (command, args, options) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, options, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  loop.start();

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "example");
  assert.deepEqual(spawned[0].args, ["--flag"]);
  assert.equal(spawned[0].options.stdio, "inherit");

  spawned[0].child.emit("close", 0);

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 120_000);

  timers[0].callback();

  assert.equal(spawned.length, 2);
});

test("runCommandLoop uses configured schedule delay", () => {
  const spawned = [];
  const timers = [];

  const loop = runCommandLoop(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      baseDelayMs: 300_000,
      jitterMs: 20_000,
      random: () => 0,
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return { id: timers.length };
      },
      clearTimeout: () => {},
      spawn: () => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push(child);
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  loop.start();
  spawned[0].emit("close", 0);

  assert.equal(timers[0].delayMs, 280_000);
});

test("runCommandLoop renders command templates before every run", () => {
  const spawned = [];
  const timers = [];
  let promptNumber = 0;

  const loop = runCommandLoop(
    {
      name: "sample",
      command: "example",
      args: ["{{arithmeticPrompt}}"],
    },
    {
      random: () => 0.5,
      setTimeout: (callback, delayMs) => {
        timers.push({ callback, delayMs });
        return { id: timers.length };
      },
      clearTimeout: () => {},
      promptFactory: () => `prompt-${++promptNumber}`,
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  loop.start();
  spawned[0].child.emit("close", 0);
  timers[0].callback();

  assert.deepEqual(
    spawned.map((entry) => entry.args),
    [["prompt-1"], ["prompt-2"]],
  );
});

test("createTaskController exposes status and can stop a waiting task", () => {
  const spawned = [];
  const timers = [];
  const clearedTimers = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: ["{{arithmeticPrompt}}"],
    },
    {
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        clearedTimers.push(timer);
      },
      promptFactory: () => "prompt",
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  assert.equal(task.getState().status, "stopped");

  task.start();

  assert.equal(task.getState().status, "running");
  assert.deepEqual(spawned[0].args, ["prompt"]);

  spawned[0].child.emit("close", 0);

  assert.equal(task.getState().status, "waiting");
  assert.equal(task.getState().nextRunAt, 121_000);

  task.stop();

  assert.equal(task.getState().status, "stopped");
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test("createTaskController can run now from waiting state", () => {
  const spawned = [];
  const timers = [];
  const clearedTimers = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: ["--flag"],
    },
    {
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        clearedTimers.push(timer);
      },
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  spawned[0].child.emit("close", 0);
  task.runNow();

  assert.equal(spawned.length, 2);
  assert.equal(task.getState().status, "running");
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test("createTaskController run now from stopped state does not start the loop", () => {
  const spawned = [];
  const timers = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: ["--flag"],
    },
    {
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: () => {},
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runNow();

  assert.equal(spawned.length, 1);
  assert.equal(task.getState().status, "running");

  spawned[0].child.emit("close", 0);

  assert.equal(task.getState().status, "stopped");
  assert.equal(task.getState().nextRunAt, null);
  assert.deepEqual(timers, []);
});

test("createTaskController exposes the current run mode", () => {
  const spawned = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push(child);
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  assert.equal(task.getState().mode, "idle");

  task.start();

  assert.equal(task.getState().mode, "timer");

  spawned[0].emit("close", 0);

  assert.equal(task.getState().mode, "timer");

  task.stop();

  assert.equal(task.getState().mode, "idle");

  task.runNow();

  assert.equal(task.getState().mode, "once");

  spawned[1].emit("close", 0);

  assert.equal(task.getState().mode, "idle");

  task.runContinuous();

  assert.equal(task.getState().mode, "loop");
});

test("createTaskController continuous run starts the next run immediately after close", () => {
  const spawned = [];
  const timers = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: ["--flag"],
    },
    {
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: () => {},
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runContinuous();

  assert.equal(spawned.length, 1);
  assert.equal(task.getState().status, "running");

  spawned[0].child.emit("close", 0);

  assert.equal(spawned.length, 2);
  assert.equal(task.getState().status, "running");
  assert.deepEqual(timers, []);
});

test("createTaskController continuous run clears an existing waiting timer", () => {
  const spawned = [];
  const timers = [];
  const clearedTimers = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        clearedTimers.push(timer);
      },
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  spawned[0].child.emit("close", 0);
  task.runContinuous();

  assert.equal(spawned.length, 2);
  assert.equal(task.getState().status, "running");
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test("createTaskController continuous run waits for a running child to finish", () => {
  const spawned = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push(child);
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  task.runContinuous();

  assert.equal(spawned.length, 1);

  spawned[0].emit("close", 0);

  assert.equal(spawned.length, 2);
  assert.equal(task.getState().status, "running");
});

test("createTaskController stop prevents a continuous run from starting the next run", () => {
  const spawned = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.killed = false;
        child.kill = () => {
          child.killed = true;
        };
        spawned.push(child);
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.runContinuous();
  task.stop();
  spawned[0].emit("close", 0);

  assert.equal(spawned.length, 1);
  assert.equal(task.getState().status, "stopped");
});

test("createTaskController kills a running child when stopped", () => {
  let killedWith = null;

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.killed = false;
        child.kill = (signal) => {
          killedWith = signal;
          child.killed = true;
        };
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  task.stop();

  assert.equal(killedWith, "SIGTERM");
  assert.equal(task.getState().status, "stopped");
});

test("createTaskController starts children in a detached process group", () => {
  let spawnOptions = null;

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: (_command, _args, options) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawnOptions = options;
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();

  assert.equal(spawnOptions.detached, true);
});

test("createTaskController stops the whole process group for a running child", () => {
  const killedGroups = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.pid = 1234;
        child.killed = false;
        child.kill = () => {
          child.killed = true;
        };
        return child;
      },
      killProcess: (pid, signal) => {
        killedGroups.push({ pid, signal });
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  task.stop();

  assert.deepEqual(killedGroups, [{ pid: -1234, signal: "SIGTERM" }]);
  assert.equal(task.getState().status, "stopped");
});

test("createTaskController ignores close from an old stopped child after restart", () => {
  const spawned = [];

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      spawn: () => {
        const child = new EventEmitter();
        child.killed = false;
        child.kill = () => {
          child.killed = true;
        };
        spawned.push(child);
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();
  task.stop();
  task.runNow();
  spawned[0].emit("close", null, "SIGTERM");

  assert.equal(spawned.length, 2);
  assert.equal(task.getState().status, "running");
});

test("createTaskController captures stdout and stderr when captureOutput is enabled", () => {
  let spawnedChild = null;
  let spawnOptions = null;

  const task = createTaskController(
    {
      name: "sample",
      command: "example",
      args: [],
    },
    {
      captureOutput: true,
      maxOutputLines: 3,
      spawn: (_command, _args, options) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        spawnedChild = child;
        spawnOptions = options;
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      logger: { log: () => {}, error: () => {} },
    },
  );

  task.start();

  assert.deepEqual(spawnOptions.stdio, ["ignore", "pipe", "pipe"]);

  spawnedChild.stdout.emit("data", Buffer.from("first\nsecond\n"));
  spawnedChild.stderr.emit("data", Buffer.from("warn\n"));
  spawnedChild.stdout.emit("data", Buffer.from("third\n"));

  assert.deepEqual(task.getState().outputLines, [
    "[stdout] second",
    "[stderr] warn",
    "[stdout] third",
  ]);
});

test("createRunner starts each configured command in its own loop", () => {
  const spawned = [];

  const runner = createRunner(
    [
      { name: "first", command: "one", args: ["a"] },
      { name: "second", command: "two", args: ["b"] },
    ],
    {
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args });
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      random: () => 0.5,
      logger: { log: () => {}, error: () => {} },
    },
  );

  runner.start();

  assert.deepEqual(spawned, [
    { command: "one", args: ["a"] },
    { command: "two", args: ["b"] },
  ]);
});

test("createRunner starts each configured command in continuous mode", () => {
  const spawned = [];

  const runner = createRunner(
    [
      { name: "first", command: "one", args: ["a"] },
      { name: "second", command: "two", args: ["b"] },
    ],
    {
      spawn: (command, args) => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push({ command, args, child });
        return child;
      },
      setTimeout: () => ({ id: 1 }),
      clearTimeout: () => {},
      random: () => 0.5,
      logger: { log: () => {}, error: () => {} },
    },
  );

  runner.runContinuous();

  assert.deepEqual(
    spawned.map(({ command, args }) => ({ command, args })),
    [
      { command: "one", args: ["a"] },
      { command: "two", args: ["b"] },
    ],
  );

  spawned[0].child.emit("close", 0);

  assert.deepEqual(
    spawned.map(({ command, args }) => ({ command, args })),
    [
      { command: "one", args: ["a"] },
      { command: "two", args: ["b"] },
      { command: "one", args: ["a"] },
    ],
  );
});

test("createRunner updates schedule and reschedules waiting tasks", () => {
  const spawned = [];
  const timers = [];
  const clearedTimers = [];

  const runner = createRunner(
    [
      {
        name: "sample",
        command: "example",
        args: [],
      },
    ],
    {
      baseDelayMs: 120_000,
      jitterMs: 20_000,
      random: () => 0.5,
      now: () => 1_000,
      setTimeout: (callback, delayMs) => {
        const timer = { callback, delayMs, id: timers.length + 1 };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        clearedTimers.push(timer);
      },
      spawn: () => {
        const child = new EventEmitter();
        child.kill = () => {};
        spawned.push(child);
        return child;
      },
      logger: { log: () => {}, error: () => {} },
    },
  );

  runner.start();
  spawned[0].emit("close", 0);

  assert.equal(timers[0].delayMs, 120_000);

  runner.updateSchedule({ baseDelayMs: 300_000, jitterMs: 20_000 });

  assert.deepEqual(runner.getSchedule(), {
    baseDelayMs: 300_000,
    jitterMs: 20_000,
  });
  assert.deepEqual(clearedTimers, [timers[0]]);
  assert.equal(timers[1].delayMs, 300_000);
  assert.equal(runner.getTasks()[0].getState().nextRunAt, 301_000);
});
