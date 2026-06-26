const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function runBin(filename, requireOverride) {
  const sourcePath = path.join(__dirname, "..", "bin", filename);
  const source = fs.readFileSync(sourcePath, "utf8").replace(/^#!.*\n/, "");
  const signalHandlers = new Map();
  const exitCodes = [];

  const context = {
    console: {
      log: () => {},
      error: () => {},
    },
    process: {
      env: {},
      once: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      exit: (code) => {
        exitCodes.push(code);
      },
    },
    require: requireOverride,
  };

  vm.runInNewContext(source, context, { filename: sourcePath });

  return { exitCodes, signalHandlers };
}

test("auto-reply-tui stops the TUI session for interrupt and hangup signals", () => {
  let closeCount = 0;

  const { exitCodes, signalHandlers } = runBin(
    "auto-reply-tui.js",
    (moduleName) => {
      if (moduleName === "../lib/config") {
        return {
          loadConfig: () => ({
            commands: [],
            schedule: {},
          }),
        };
      }

      if (moduleName === "../lib/scheduler") {
        return {
          createRunner: () => ({ stop: () => {} }),
        };
      }

      if (moduleName === "../lib/tui") {
        return {
          createBufferedLogger: () => ({}),
          startTui: () => ({
            close: () => {
              closeCount += 1;
            },
            redraw: () => {},
          }),
        };
      }

      throw new Error(`unexpected require: ${moduleName}`);
    },
  );

  assert.deepEqual([...signalHandlers.keys()].sort(), [
    "SIGHUP",
    "SIGINT",
    "SIGTERM",
  ]);

  signalHandlers.get("SIGHUP")();

  assert.equal(closeCount, 1);
  assert.deepEqual(exitCodes, [0]);
});

test("auto-reply stops the runner for interrupt and hangup signals", () => {
  let startCount = 0;
  let stopCount = 0;

  const { exitCodes, signalHandlers } = runBin("auto-reply.js", (moduleName) => {
    if (moduleName === "../lib/config") {
      return {
        loadConfig: () => ({
          commands: [],
          schedule: {},
        }),
      };
    }

    if (moduleName === "../lib/scheduler") {
      return {
        createRunner: () => ({
          start: () => {
            startCount += 1;
          },
          stop: () => {
            stopCount += 1;
          },
        }),
      };
    }

    throw new Error(`unexpected require: ${moduleName}`);
  });

  assert.equal(startCount, 1);
  assert.deepEqual([...signalHandlers.keys()].sort(), [
    "SIGHUP",
    "SIGINT",
    "SIGTERM",
  ]);

  signalHandlers.get("SIGHUP")("SIGHUP");

  assert.equal(stopCount, 1);
  assert.deepEqual(exitCodes, [0]);
});
