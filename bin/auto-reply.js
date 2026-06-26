#!/usr/bin/env node

const { loadConfig } = require('../lib/config');
const { createRunner } = require('../lib/scheduler');

const { commands, schedule } = loadConfig();
const runner = createRunner(commands, schedule);

function shutdown(signal) {
  console.log(`received ${signal}, stopping...`);
  runner.stop();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, shutdown);
}

runner.start();
