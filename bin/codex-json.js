#!/usr/bin/env node

const { spawn: defaultSpawn } = require("node:child_process");
const path = require("node:path");

const { normalizeCodexRun } = require("../lib/codex-json");
const { buildProviderCommand } = require("../lib/provider-command");

const DEFAULT_SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "schemas",
  "arithmetic-result.schema.json",
);
const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const DEFAULT_TERMINATION_GRACE_MS = 1_000;

function buildCodexArgs(args, schemaPath = DEFAULT_SCHEMA_PATH) {
  if (args[0] !== "exec") {
    throw new Error("Codex wrapper requires exec as its first argument");
  }

  return [
    "exec",
    "--json",
    "--output-schema",
    schemaPath,
    ...args.slice(1),
  ];
}

function runCodexJson({
  args = process.argv.slice(2),
  spawn = defaultSpawn,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  schemaPath = DEFAULT_SCHEMA_PATH,
  signalSource = process,
  setTimeout: scheduleTimeout = global.setTimeout,
  clearTimeout: cancelTimeout = global.clearTimeout,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  platform,
  env,
} = {}) {
  const stdoutChunks = [];
  const signalHandlers = new Map();
  let child = null;
  let finished = false;
  let terminationSignal = null;
  let terminationTimer = null;

  function removeSignalHandlers() {
    for (const [signal, handler] of signalHandlers) {
      signalSource.removeListener(signal, handler);
    }
    signalHandlers.clear();
  }

  function finish(details = {}) {
    if (finished) return;
    finished = true;
    if (terminationTimer !== null) cancelTimeout(terminationTimer);
    removeSignalHandlers();
    const normalized = normalizeCodexRun({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      ...details,
    });
    stdout.write(`${JSON.stringify(normalized.value)}\n`);
    setExitCode(normalized.ok ? 0 : 1);
  }

  function forceChildShutdown() {
    if (!child) return;
    try {
      if (typeof child.kill === "function") child.kill("SIGKILL");
    } catch {
      // The child may already have exited between the grace timeout and here.
    }
    if (child.stdout && typeof child.stdout.destroy === "function") {
      child.stdout.destroy();
    }
    if (child.stderr && typeof child.stderr.destroy === "function") {
      child.stderr.destroy();
    }
    if (typeof child.unref === "function") child.unref();
  }

  function handleSignal(signal) {
    if (finished || terminationSignal) return;
    terminationSignal = signal;

    try {
      if (child && typeof child.kill === "function" && !child.killed) {
        child.kill(signal);
      }
    } catch {
      // The grace timeout still guarantees a normalized wrapper result.
    }

    if (finished) return;
    terminationTimer = scheduleTimeout(() => {
      finish({ signal: terminationSignal });
      forceChildShutdown();
    }, terminationGraceMs);
  }

  try {
    const providerCommand = buildProviderCommand(
      "codex",
      buildCodexArgs(args, schemaPath),
      { platform, env },
    );
    child = spawn(providerCommand.command, providerCommand.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (spawnError) {
    finish({ spawnError });
    return null;
  }

  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", (spawnError) => {
    if (!terminationSignal) finish({ spawnError });
  });
  child.once("close", (exitCode, signal) => {
    finish({ exitCode, signal: terminationSignal || signal });
  });

  for (const signal of TERMINATION_SIGNALS) {
    const handler = () => handleSignal(signal);
    signalHandlers.set(signal, handler);
    signalSource.on(signal, handler);
  }

  return child;
}

if (require.main === module) {
  runCodexJson();
}

module.exports = {
  DEFAULT_TERMINATION_GRACE_MS,
  DEFAULT_SCHEMA_PATH,
  buildCodexArgs,
  runCodexJson,
};
