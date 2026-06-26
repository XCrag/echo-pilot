#!/usr/bin/env node

const { loadConfig } = require('../lib/config');
const { createRunner } = require('../lib/scheduler');
const { createBufferedLogger, startTui } = require('../lib/tui');

const logs = [];
let session = null;

const logger = createBufferedLogger(logs, () => {
  if (session) session.redraw();
});

const { commands, schedule } = loadConfig(undefined, { logger });
const runner = createRunner(commands, { ...schedule, logger, captureOutput: true });

session = startTui(runner, { logs });

process.once('SIGTERM', () => {
  session.close();
  process.exit(0);
});
