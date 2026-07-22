#!/usr/bin/env node

const { spawn: defaultSpawn } = require("node:child_process");

const { buildProviderCommand } = require("../lib/provider-command");

const DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES = 1024 * 1024;

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
  propagateSignal = (signal) => process.kill(process.pid, signal),
  maxStructuredOutputBytes = DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES,
  platform,
  env,
} = {}) {
  const structuredCapture = {
    chunks: [],
    byteLength: 0,
    enabled: true,
  };
  let finished = false;
  let finishing = false;

  function fail(code, signal, message) {
    if (finished || finishing) return;
    finished = true;
    if (message) stderr.write(`${message}\n`);
    if (signal) {
      propagateSignal(signal);
    } else {
      setExitCode(code && code !== 0 ? code : 1);
    }
  }

  function finish(exitCode, signal) {
    if (finished || finishing) return;

    let outerResult;
    try {
      if (!structuredCapture.enabled) {
        throw new Error("structured stdout byte ceiling exceeded");
      }
      outerResult = JSON.parse(
        Buffer.concat(structuredCapture.chunks).toString("utf8"),
      );
      outerResult = projectClaudeResult(outerResult);
    } catch (error) {
      fail(
        exitCode && exitCode !== 0 ? exitCode : 1,
        signal,
        `Claude output is not valid JSON: ${error.message}`,
      );
      return;
    }

    finishing = true;
    stdout.write(`${JSON.stringify(outerResult)}\n`, () => {
      if (finished) return;
      finished = true;
      finishing = false;
      if (signal) {
        propagateSignal(signal);
      } else {
        setExitCode(exitCode && exitCode !== 0 ? exitCode : 0);
      }
    });
  }

  let child;
  try {
    const providerCommand = buildProviderCommand("claude", args, {
      platform,
      env,
    });
    const spawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
    };
    if ((platform || process.platform) === "win32") {
      spawnOptions.windowsHide = true;
    }
    child = spawn(providerCommand.command, providerCommand.args, spawnOptions);
  } catch (error) {
    fail(1, null, `Claude failed to start: ${error.message}`);
    return null;
  }

  child.stdout.on("data", (chunk) => {
    if (!structuredCapture.enabled || finished || finishing) return;
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk));
    const nextByteLength = structuredCapture.byteLength + buffer.length;
    if (nextByteLength <= maxStructuredOutputBytes) {
      structuredCapture.chunks.push(buffer);
      structuredCapture.byteLength = nextByteLength;
    } else {
      structuredCapture.chunks.length = 0;
      structuredCapture.byteLength = 0;
      structuredCapture.enabled = false;
    }
  });
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.once("error", (error) => {
    fail(1, null, `Claude failed to start: ${error.message}`);
  });
  child.once("close", finish);

  return child;
}

if (require.main === module) {
  runClaudeJson();
}

module.exports = {
  DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES,
  projectClaudeResult,
  runClaudeJson,
};
