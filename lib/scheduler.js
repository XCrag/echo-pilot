const { spawn: defaultSpawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { renderCommandSpec } = require("./prompt");

const DEFAULT_BASE_DELAY_MS = 120_000;
const DEFAULT_JITTER_MS = 20_000;

const DEFAULT_COMMANDS = [
  {
    name: "codex",
    command: "codex",
    args: [
      "exec",
      "--model",
      "gpt-5.5",
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
    outputLines: [],
  };

  function getState() {
    return {
      ...state,
      args: [...state.args],
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

  function attachOutputCapture(runningChild) {
    if (!captureOutput) return;

    if (runningChild.stdout) {
      runningChild.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    }

    if (runningChild.stderr) {
      runningChild.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    }
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
        stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      });
      attachOutputCapture(child);
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
      });
      return false;
    }

    child.once("error", (error) => {
      logger.error(`[${commandSpec.name}] failed to start: ${error.message}`);
      child = null;
      stopped = true;
      continuous = false;
      setState({
        status: "failed",
        mode: "idle",
        lastError: error.message,
        lastFinishedAt: now(),
      });
    });

    child.once("close", (code, signal) => {
      const result = signal ? `signal ${signal}` : `exit ${code}`;
      logger.log(`[${commandSpec.name}] finished with ${result}`);
      child = null;
      const nextState = {
        lastExitCode: code,
        lastSignal: signal,
        lastFinishedAt: now(),
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
        child.kill("SIGTERM");
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
