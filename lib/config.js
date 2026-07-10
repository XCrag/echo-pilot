const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_COMMANDS } = require('./scheduler');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'commands.json');
const DEFAULT_SCHEDULE = {
  baseDelayMs: 120_000,
  jitterMs: 20_000,
};

function validateCommand(commandSpec, index) {
  if (!commandSpec || typeof commandSpec !== 'object' || Array.isArray(commandSpec)) {
    throw new Error(`commands[${index}] must be an object`);
  }

  if (typeof commandSpec.name !== 'string' || commandSpec.name.length === 0) {
    throw new Error(`commands[${index}].name must be a non-empty string`);
  }

  if (typeof commandSpec.command !== 'string' || commandSpec.command.length === 0) {
    throw new Error(`commands[${index}].command must be a non-empty string`);
  }

  if (!Array.isArray(commandSpec.args)) {
    throw new Error(`commands[${index}].args must be an array`);
  }

  commandSpec.args.forEach((arg, argIndex) => {
    if (typeof arg !== 'string') {
      throw new Error(`commands[${index}].args[${argIndex}] must be a string`);
    }
  });
}

function validateCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('commands must be a non-empty array');
  }

  commands.forEach(validateCommand);
  return commands;
}

function validateSchedule(schedule = {}) {
  const baseDelaySeconds = schedule.baseDelaySeconds ?? DEFAULT_SCHEDULE.baseDelayMs / 1000;
  const jitterSeconds = schedule.jitterSeconds ?? DEFAULT_SCHEDULE.jitterMs / 1000;

  if (typeof baseDelaySeconds !== 'number' || !Number.isFinite(baseDelaySeconds) || baseDelaySeconds <= 0) {
    throw new Error('schedule.baseDelaySeconds must be a positive number');
  }

  if (typeof jitterSeconds !== 'number' || !Number.isFinite(jitterSeconds) || jitterSeconds < 0) {
    throw new Error('schedule.jitterSeconds must be a non-negative number');
  }

  if (jitterSeconds > baseDelaySeconds) {
    throw new Error('schedule.jitterSeconds must be less than or equal to schedule.baseDelaySeconds');
  }

  return {
    baseDelayMs: baseDelaySeconds * 1000,
    jitterMs: jitterSeconds * 1000,
  };
}

function normalizeConfig(parsedConfig) {
  if (Array.isArray(parsedConfig)) {
    return {
      schedule: DEFAULT_SCHEDULE,
      commands: validateCommands(parsedConfig),
    };
  }

  if (!parsedConfig || typeof parsedConfig !== 'object') {
    throw new Error('config must be an array or an object');
  }

  return {
    schedule: validateSchedule(parsedConfig.schedule),
    commands: validateCommands(parsedConfig.commands),
  };
}

function resolveCommandPaths(commands, configPath) {
  const configDirectory = path.dirname(configPath);

  return commands.map((commandSpec) => {
    if (!commandSpec.command.startsWith('./') && !commandSpec.command.startsWith('../')) {
      return commandSpec;
    }

    return {
      ...commandSpec,
      command: path.resolve(configDirectory, commandSpec.command),
    };
  });
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH, options = {}) {
  const logger = options.logger || console;
  const fallbackCommands = options.fallbackCommands || DEFAULT_COMMANDS;
  const fallbackSchedule = options.fallbackSchedule || DEFAULT_SCHEDULE;

  if (!fs.existsSync(configPath)) {
    logger.error(`Config file not found: ${configPath}. Using built-in defaults.`);
    return {
      schedule: fallbackSchedule,
      commands: resolveCommandPaths(fallbackCommands, configPath),
    };
  }

  const rawConfig = fs.readFileSync(configPath, 'utf8');
  const parsedConfig = JSON.parse(rawConfig);
  const normalizedConfig = normalizeConfig(parsedConfig);
  return {
    ...normalizedConfig,
    commands: resolveCommandPaths(normalizedConfig.commands, configPath),
  };
}

function loadCommands(configPath = DEFAULT_CONFIG_PATH, options = {}) {
  return loadConfig(configPath, options).commands;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_SCHEDULE,
  loadConfig,
  loadCommands,
  validateCommands,
  validateSchedule,
};
