#!/usr/bin/env node

const { spawn: defaultSpawn } = require("node:child_process");

function projectClaudeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Claude output is not a valid JSON object");
  }

  return {
    type: value.type ?? null,
    subtype: value.subtype ?? null,
    is_error: value.is_error ?? null,
    result: value.result ?? null,
    usage: value.usage ?? null,
  };
}

function runClaudeJson({
  args = process.argv.slice(2),
  spawn = defaultSpawn,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  const stdoutChunks = [];
  let finished = false;

  function fail(code, message) {
    if (finished) return;
    finished = true;
    if (message) stderr.write(`${message}\n`);
    setExitCode(code && code !== 0 ? code : 1);
  }

  function finish(exitCode, signal) {
    if (finished) return;
    if (signal) {
      fail(1, `Claude exited with signal ${signal}`);
      return;
    }
    if (exitCode !== 0) {
      fail(exitCode, `Claude exited with code ${exitCode}`);
      return;
    }

    let outerResult;
    try {
      outerResult = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8"));
      outerResult = projectClaudeResult(outerResult);
    } catch (error) {
      fail(1, `Claude output is not valid JSON: ${error.message}`);
      return;
    }

    finished = true;
    stdout.write(`${JSON.stringify(outerResult)}\n`);
    setExitCode(0);
  }

  let child;
  try {
    child = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(1, `Claude failed to start: ${error.message}`);
    return null;
  }

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
    );
  });
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", (error) => {
    fail(1, `Claude failed to start: ${error.message}`);
  });
  child.once("close", finish);

  return child;
}

if (require.main === module) {
  runClaudeJson();
}

module.exports = {
  projectClaudeResult,
  runClaudeJson,
};
