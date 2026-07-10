const { spawn: defaultSpawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { normalizeLastExecution } = require("./execution-result");
const { renderCommandSpec } = require("./prompt");

const DEFAULT_BASE_DELAY_MS = 120_000;
const DEFAULT_JITTER_MS = 20_000;
const CODEX_WRAPPER_PATH = path.join(__dirname, "..", "bin", "codex-json.js");

const DEFAULT_COMMANDS = [
  {
    name: "codex",
    command: CODEX_WRAPPER_PATH,
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
      'claude -p --bare --disable-slash-commands --strict-mcp-config --system-prompt "" --output-format json "{{arithmeticPrompt}}" | jq -c \'{type, subtype, is_error, result, usage}\'',
    ],
  },
];

function getJitteredDelayMs({
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  jitterMs = DEFAULT_JITTER_MS,
  random = Math.random,
} = {}) {
  return Math.round(baseDelayMs - jitterMs + random() * jitterMs * 2);
}

function createTaskController(commandSpec, dependencies = {}) {
  const spawn = dependencies.spawn || defaultSpawn;
  const setTimer = dependencies.setTimeout || setTimeout;
  const clearTimer = dependencies.clearTimeout || clearTimeout;
  const random = dependencies.random || Math.random;
  const logger = dependencies.logger || console;
  const promptFactory = dependencies.promptFactory;
  const killProcess =
    dependencies.killProcess || ((pid, signal) => process.kill(pid, signal));
  const now = dependencies.now || Date.now;
  const captureOutput = dependencies.captureOutput || false;
  const maxOutputLines = dependencies.maxOutputLines || 80;
  const baseDelayMs = dependencies.baseDelayMs || DEFAULT_BASE_DELAY_MS;
  const jitterMs = dependencies.jitterMs ?? DEFAULT_JITTER_MS;
  const getSchedule =
    dependencies.getSchedule || (() => ({ baseDelayMs, jitterMs }));
  const events = new EventEmitter();

  let child = null;
  let timer = null;
  let stopped = true;
  let continuous = false;
  let requestedSignal = null;
  let runGeneration = 0;
  let state = {
    name: commandSpec.name,
    status: "stopped",
    mode: "idle",
    command: commandSpec.command,
    args: [...commandSpec.args],
    nextRunAt: null,
    lastExitCode: null,
    lastSignal: null,
    lastError: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastExecution: null,
    outputLines: [],
  };

  function getState() {
    return {
      ...state,
      args: [...state.args],
      lastExecution: state.lastExecution
        ? {
            ...state.lastExecution,
            usage: state.lastExecution.usage
              ? { ...state.lastExecution.usage }
              : null,
          }
        : null,
      outputLines: [...state.outputLines],
    };
  }

  function setState(partialState) {
    state = {
      ...state,
      ...partialState,
    };
    events.emit("state", getState());
  }

  function clearWaitingTimer() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  function appendOutput(source, chunk) {
    const lines = String(chunk)
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => `[${source}] ${line}`);

    if (lines.length === 0) return;

    setState({
      outputLines: [...state.outputLines, ...lines].slice(-maxOutputLines),
    });
  }

  function attachOutputCapture(runningChild, stdoutChunks) {
    if (!captureOutput) return;

    if (runningChild.stdout) {
      runningChild.stdout.on("data", (chunk) => {
        stdoutChunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
        appendOutput("stdout", chunk);
      });
    }

    if (runningChild.stderr) {
      runningChild.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    }
  }

  function terminateChild(runningChild, signal = "SIGTERM") {
    if (!runningChild || runningChild.killed) return;

    if (runningChild === child) requestedSignal = signal;

    if (Number.isInteger(runningChild.pid)) {
      try {
        killProcess(-runningChild.pid, signal);
        return;
      } catch (error) {
        if (error.code !== "ESRCH") {
          logger.error(
            `[${commandSpec.name}] failed to stop process group ${runningChild.pid}: ${error.message}`,
          );
        }
      }
    }

    runningChild.kill(signal);
  }

  function scheduleNext() {
    if (stopped) return;

    const schedule = getSchedule();
    const delayMs = getJitteredDelayMs({
      baseDelayMs: schedule.baseDelayMs,
      jitterMs: schedule.jitterMs,
      random,
    });
    const delaySeconds = Math.round(delayMs / 1000);
    logger.log(`[${commandSpec.name}] next run in ${delaySeconds}s`);
    setState({
      status: "waiting",
      mode: "timer",
      nextRunAt: now() + delayMs,
    });
    timer = setTimer(() => runOnce({ continueLoop: true }), delayMs);
  }

  function runOnce({ continueLoop = true, continuousLoop = false } = {}) {
    if (child) return false;

    requestedSignal = null;
    const generation = ++runGeneration;
    let settled = false;

    clearWaitingTimer();
    stopped = !continueLoop;
    continuous = continueLoop && continuousLoop;
    const mode = continuous ? "loop" : continueLoop ? "timer" : "once";

    const renderedCommandSpec = renderCommandSpec(commandSpec, {
      promptFactory,
    });

    logger.log(
      `[${renderedCommandSpec.name}] running: ${renderedCommandSpec.command} ${renderedCommandSpec.args.join(" ")}`,
    );

    setState({
      status: "running",
      mode,
      command: renderedCommandSpec.command,
      args: renderedCommandSpec.args,
      nextRunAt: null,
      lastError: null,
      lastStartedAt: now(),
      outputLines: [],
    });

    try {
      child = spawn(renderedCommandSpec.command, renderedCommandSpec.args, {
        detached: true,
        stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      });
    } catch (error) {
      child = null;
      stopped = true;
      continuous = false;
      logger.error(`[${commandSpec.name}] failed to start: ${error.message}`);
      setState({
        status: "failed",
        mode: "idle",
        lastError: error.message,
        lastFinishedAt: now(),
        lastExecution: normalizeLastExecution({
          provider: commandSpec.name,
          error,
          finishedAt: now(),
        }),
      });
      return false;
    }

    const runningChild = child;
    const stdoutChunks = [];
    attachOutputCapture(runningChild, stdoutChunks);

    runningChild.once("error", (error) => {
      if (settled || generation !== runGeneration) return;
      if (requestedSignal) return;
      settled = true;
      logger.error(`[${commandSpec.name}] failed to start: ${error.message}`);
      child = null;
      stopped = true;
      continuous = false;
      setState({
        status: "failed",
        mode: "idle",
        lastError: error.message,
        lastFinishedAt: now(),
        lastExecution: normalizeLastExecution({
          provider: commandSpec.name,
          error,
          finishedAt: now(),
        }),
      });
    });

    runningChild.once("close", (code, signal) => {
      if (settled || generation !== runGeneration) return;
      settled = true;
      const effectiveSignal = signal || requestedSignal;
      const result = effectiveSignal
        ? `signal ${effectiveSignal}`
        : `exit ${code}`;
      logger.log(`[${commandSpec.name}] finished with ${result}`);
      child = null;
      const lastExecution = normalizeLastExecution({
        provider: commandSpec.name,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        exitCode: code,
        signal: effectiveSignal,
        finishedAt: now(),
      });
      const nextState = {
        lastExitCode: code,
        lastSignal: effectiveSignal,
        lastFinishedAt: now(),
        lastExecution,
      };
      if (stopped) {
        nextState.status = "stopped";
        nextState.mode = "idle";
      }
      setState(nextState);
      if (stopped) return;
      if (continuous) {
        runOnce({ continueLoop: true, continuousLoop: true });
        return;
      }
      scheduleNext();
    });

    return true;
  }

  return {
    getState,
    subscribe(listener) {
      events.on("state", listener);
      return () => events.off("state", listener);
    },
    start() {
      if (state.status === "running" || state.status === "waiting")
        return false;
      stopped = false;
      return runOnce({ continueLoop: true });
    },
    runNow() {
      if (state.status === "running") return false;
      return runOnce({ continueLoop: state.status === "waiting" });
    },
    runContinuous() {
      if (state.status === "running") {
        stopped = false;
        continuous = true;
        setState({ mode: "loop" });
        return true;
      }
      return runOnce({ continueLoop: true, continuousLoop: true });
    },
    rescheduleWaiting() {
      if (state.status !== "waiting") return false;
      clearWaitingTimer();
      scheduleNext();
      return true;
    },
    stop() {
      stopped = true;
      continuous = false;
      clearWaitingTimer();

      if (child && !child.killed) {
        terminateChild(child, "SIGTERM");
      }
      child = null;
      setState({
        status: "stopped",
        mode: "idle",
        nextRunAt: null,
      });
      return true;
    },
  };
}

function runCommandLoop(commandSpec, dependencies = {}) {
  return createTaskController(commandSpec, dependencies);
}

function createRunner(commands = DEFAULT_COMMANDS, dependencies = {}) {
  let schedule = {
    baseDelayMs: dependencies.baseDelayMs || DEFAULT_BASE_DELAY_MS,
    jitterMs: dependencies.jitterMs ?? DEFAULT_JITTER_MS,
  };
  const tasks = commands.map((commandSpec) =>
    createTaskController(commandSpec, {
      ...dependencies,
      getSchedule: () => schedule,
    }),
  );

  return {
    getTasks() {
      return tasks;
    },
    getSchedule() {
      return { ...schedule };
    },
    updateSchedule(nextSchedule) {
      const baseDelayMs = nextSchedule.baseDelayMs ?? schedule.baseDelayMs;
      const jitterMs = nextSchedule.jitterMs ?? schedule.jitterMs;

      if (baseDelayMs <= 0 || jitterMs < 0 || jitterMs > baseDelayMs) {
        return false;
      }

      schedule = { baseDelayMs, jitterMs };
      tasks.forEach((task) => task.rescheduleWaiting());
      return true;
    },
    start() {
      tasks.forEach((task) => task.start());
    },
    runContinuous() {
      tasks.forEach((task) => task.runContinuous());
    },
    stop() {
      tasks.forEach((task) => task.stop());
    },
  };
}

module.exports = {
  DEFAULT_COMMANDS,
  createTaskController,
  getJitteredDelayMs,
  runCommandLoop,
  createRunner,
};
