const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadCommands, loadConfig } = require('../lib/config');

test('loadCommands reads command definitions from a JSON file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configPath = path.join(directory, 'commands.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      [
        {
          name: 'custom',
          command: 'node',
          args: ['--version'],
        },
      ],
      null,
      2,
    ),
  );

  assert.deepEqual(loadCommands(configPath), [
    {
      name: 'custom',
      command: 'node',
      args: ['--version'],
    },
  ]);
});

test('loadConfig reads schedule and commands from an object config file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configPath = path.join(directory, 'commands.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schedule: {
        baseDelaySeconds: 300,
        jitterSeconds: 20,
      },
      commands: [
        {
          name: 'custom',
          command: 'node',
          args: ['--version'],
        },
      ],
    }),
  );

  assert.deepEqual(loadConfig(configPath), {
    schedule: {
      baseDelayMs: 300_000,
      jitterMs: 20_000,
    },
    commands: [
      {
        name: 'custom',
        command: 'node',
        args: ['--version'],
      },
    ],
  });
});

test('loadConfig resolves relative executable paths from the config directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configPath = path.join(directory, 'commands.json');

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      commands: [
        {
          name: 'wrapper',
          command: './bin/wrapper.js',
          args: ['exec'],
        },
      ],
    }),
  );

  assert.equal(
    loadConfig(configPath).commands[0].command,
    path.join(directory, 'bin', 'wrapper.js'),
  );
});

test('loadConfig resolves ../ executable paths from a parsed config', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configDirectory = path.join(directory, 'config');
  const configPath = path.join(configDirectory, 'commands.json');
  fs.mkdirSync(configDirectory);

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      commands: [
        {
          name: 'wrapper',
          command: '../bin/wrapper.js',
          args: ['exec'],
        },
      ],
    }),
  );

  assert.equal(
    loadConfig(configPath).commands[0].command,
    path.join(directory, 'bin', 'wrapper.js'),
  );
});

test('loadConfig resolves relative fallback commands from a missing config directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configDirectory = path.join(directory, 'config');
  const configPath = path.join(configDirectory, 'missing.json');
  const errors = [];

  const config = loadConfig(configPath, {
    fallbackCommands: [
      {
        name: 'wrapper',
        command: './bin/wrapper.js',
        args: ['exec'],
      },
    ],
    logger: { error: (message) => errors.push(message) },
  });

  assert.equal(
    config.commands[0].command,
    path.join(configDirectory, 'bin', 'wrapper.js'),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Using built-in defaults/);
});

test('loadCommands validates command definitions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reply-config-'));
  const configPath = path.join(directory, 'commands.json');

  fs.writeFileSync(configPath, JSON.stringify([{ name: 'broken', command: 'node' }]));

  assert.throws(
    () => loadCommands(configPath),
    /commands\[0\]\.args must be an array/,
  );
});

test('repository config invokes Claude wrapper through Node', () => {
  const configPath = path.join(__dirname, '..', 'commands.json');
  const claude = loadConfig(configPath).commands.find(
    (commandSpec) => commandSpec.name === 'claude',
  );

  assert.deepEqual(claude, {
    name: 'claude',
    command: 'node',
    args: [
      './bin/claude-json.js',
      '-p',
      '--bare',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--system-prompt',
      '',
      '--output-format',
      'json',
      '{{arithmeticPrompt}}',
    ],
  });
});
