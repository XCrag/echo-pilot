#!/usr/bin/env node

const { spawn: defaultSpawn } = require("node:child_process");
const path = require("node:path");

const { normalizeCodexRun } = require("../lib/codex-json");

const DEFAULT_SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "schemas",
  "arithmetic-result.schema.json",
);

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
} = {}) {
  let child;
  try {
    child = spawn("codex", buildCodexArgs(args, schemaPath), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (spawnError) {
    const normalized = normalizeCodexRun({ spawnError });
    stdout.write(`${JSON.stringify(normalized.value)}\n`);
    setExitCode(1);
    return null;
  }

  const stdoutChunks = [];
  let finished = false;

  function finish(details) {
    if (finished) return;
    finished = true;
    const normalized = normalizeCodexRun({
      stdout: stdoutChunks.join(""),
      ...details,
    });
    stdout.write(`${JSON.stringify(normalized.value)}\n`);
    setExitCode(normalized.ok ? 0 : 1);
  }

  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", (spawnError) => finish({ spawnError }));
  child.once("close", (exitCode, signal) => finish({ exitCode, signal }));

  return child;
}

if (require.main === module) {
  runCodexJson();
}

module.exports = {
  DEFAULT_SCHEMA_PATH,
  buildCodexArgs,
  runCodexJson,
};
