const readline = require('node:readline');

const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const PANEL_WIDTH = 82;
const CONTENT_WIDTH = PANEL_WIDTH - 4;
const STATUS_COLORS = {
  RUNNING: '\x1b[32m',
  WAITING: '\x1b[36m',
  STOPPED: '\x1b[90m',
  FAILED: '\x1b[31m',
};
const RESET_COLOR = '\x1b[0m';

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatSchedule(schedule = {}) {
  const baseSeconds = Math.round((schedule.baseDelayMs || 120_000) / 1000);
  const jitterSeconds = Math.round((schedule.jitterMs ?? 20_000) / 1000);
  return `schedule ${baseSeconds}s ±${jitterSeconds}s`;
}

function compactCommand(state) {
  const command = [state.command, ...(state.args || [])].join(' ');
  return truncate(command, CONTENT_WIDTH);
}

function formatLastResult(state) {
  if (state.lastError) return `error=${state.lastError}`;
  if (state.lastSignal) return `signal=${state.lastSignal}`;
  if (state.lastExitCode !== null && state.lastExitCode !== undefined) {
    return `exit=${state.lastExitCode}`;
  }
  return '-';
}

function truncate(value, width) {
  if (value.length <= width) return value;
  if (width <= 1) return '…'.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function pad(value, width) {
  return truncate(String(value), width).padEnd(width);
}

function colorStatus(status, useColor) {
  const normalizedStatus = status.toUpperCase();
  const paddedStatus = pad(normalizedStatus, 8);
  if (!useColor || !STATUS_COLORS[normalizedStatus]) return paddedStatus;
  return `${STATUS_COLORS[normalizedStatus]}${paddedStatus}${RESET_COLOR}`;
}

function boxLine(content = '') {
  return `│ ${pad(content, CONTENT_WIDTH)} │`;
}

function sectionBox(title, lines) {
  const top = `┌─ ${title} ${'─'.repeat(Math.max(0, PANEL_WIDTH - title.length - 5))}┐`;
  const body = lines.length === 0 ? [boxLine('-')] : lines.map((line) => boxLine(line));
  return [top, ...body, `└${'─'.repeat(PANEL_WIDTH - 2)}┘`];
}

function tableDivider(left, middle, right) {
  return [
    left,
    '─'.repeat(14),
    middle,
    '─'.repeat(10),
    middle,
    '─'.repeat(10),
    middle,
    '─'.repeat(16),
    middle,
    '─'.repeat(5),
    right,
  ].join('');
}

function tableRow({ task, status, nextRun, last, selected }, useColor = false) {
  const renderedStatus = status === 'Status' ? pad(status, 8) : colorStatus(status, useColor);

  return [
    '│ ',
    pad(task, 12),
    ' │ ',
    renderedStatus,
    ' │ ',
    pad(nextRun, 8),
    ' │ ',
    pad(last, 14),
    ' │ ',
    pad(selected, 3),
    ' │',
  ].join('');
}

function renderTaskTable(taskStates, selectedIndex, now, useColor) {
  const rows = [
    tableDivider('├', '┬', '┤'),
    tableRow({ task: 'Task', status: 'Status', nextRun: 'Next Run', last: 'Last', selected: 'Sel' }),
    tableDivider('├', '┼', '┤'),
  ];

  taskStates.forEach((state, index) => {
    rows.push(
      tableRow(
        {
          task: state.name,
          status: state.status,
          nextRun: state.nextRunAt ? formatRemainingTime(state.nextRunAt - now) : '-',
          last: formatLastResult(state),
          selected: index === selectedIndex ? '◀' : '',
        },
        useColor,
      ),
    );
  });

  rows.push(tableDivider('└', '┴', '┘'));
  return rows;
}

function renderListDashboard(taskStates, selectedIndex, now, logs, useColor, schedule, editField, editValue) {
  const title = ' Auto Reply ';
  const titleRuleWidth = Math.max(0, PANEL_WIDTH - title.length - 2);
  const lines = [
    `┌${title}${'─'.repeat(titleRuleWidth)}┐`,
    boxLine(`${taskStates.length} tasks · ${formatSchedule(schedule)}`),
    boxLine('↑/↓ select · enter detail · s start · x stop · r once · l loop · q quit'),
    boxLine('a start all · z stop all · b edit base · j edit jitter'),
    ...renderTaskTable(taskStates, selectedIndex, now, useColor),
  ];

  if (editField) {
    const label = editField === 'base' ? 'Set base delay seconds' : 'Set jitter seconds';
    lines.push('');
    lines.push(...sectionBox('Edit Schedule', [`${label}: ${editValue || '_'}`]));
  }

  lines.push('');
  const visibleLogs = logs.slice(-8);
  lines.push(...sectionBox('Recent Logs', visibleLogs.length === 0 ? ['-'] : visibleLogs));

  return lines.join('\n');
}

function renderDetailDashboard(taskStates, selectedIndex, now, rows = 24) {
  const selectedTask = taskStates[selectedIndex] || taskStates[0];
  if (!selectedTask) return renderListDashboard(taskStates, selectedIndex, now, [], false);

  const title = ` Task Detail: ${selectedTask.name} `;
  const titleRuleWidth = Math.max(0, PANEL_WIDTH - title.length - 2);
  const nextRun = selectedTask.nextRunAt ? formatRemainingTime(selectedTask.nextRunAt - now) : '-';
  const headerLines = [
    `┌${title}${'─'.repeat(titleRuleWidth)}┐`,
    boxLine('esc back · x stop · r run once · l loop · s start/resume · q quit'),
    boxLine(`Status:   ${selectedTask.status.toUpperCase()}`),
    boxLine(`Next Run: ${nextRun}`),
    boxLine(`Last:     ${formatLastResult(selectedTask)}`),
    `└${'─'.repeat(PANEL_WIDTH - 2)}┘`,
  ];
  const commandLines = sectionBox('Selected Command', [compactCommand(selectedTask)]);
  const fixedLineCount = headerLines.length + 1 + commandLines.length + 1 + 2;
  const outputLineLimit = Math.max(1, Math.min(24, rows - fixedLineCount));
  const outputLines = selectedTask.outputLines ? selectedTask.outputLines.slice(-outputLineLimit) : [];
  const lines = [
    ...headerLines,
    '',
    ...commandLines,
    '',
    ...sectionBox('Selected Output', outputLines.length === 0 ? ['-'] : outputLines),
  ];

  return lines.slice(0, rows).join('\n');
}

function renderDashboard(taskStates, options = {}) {
  const selectedIndex = options.selectedIndex || 0;
  const now = options.now || Date.now();
  const logs = options.logs || [];
  const useColor = options.useColor || false;
  const mode = options.mode || 'list';
  const rows = options.rows || 24;
  const schedule = options.schedule || { baseDelayMs: 120_000, jitterMs: 20_000 };
  const editField = options.editField || null;
  const editValue = options.editValue || '';

  if (mode === 'detail') return renderDetailDashboard(taskStates, selectedIndex, now, rows);
  return renderListDashboard(taskStates, selectedIndex, now, logs, useColor, schedule, editField, editValue);
}

function createBufferedLogger(logs, redraw, maxEntries = 100) {
  function push(level, message) {
    logs.push(`${new Date().toLocaleTimeString()} ${level} ${message}`);
    if (logs.length > maxEntries) logs.splice(0, logs.length - maxEntries);
    redraw();
  }

  return {
    log(message) {
      push('INFO', message);
    },
    error(message) {
      push('ERROR', message);
    },
  };
}

function startTui(runner, options = {}) {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  const setRefreshInterval = options.setInterval || setInterval;
  const clearRefreshInterval = options.clearInterval || clearInterval;
  const now = options.now || Date.now;
  const exit = options.exit || process.exit;
  const logs = options.logs || [];
  const tasks = runner.getTasks();
  let selectedIndex = 0;
  let mode = 'list';
  let editField = null;
  let editValue = '';
  let closed = false;

  function redraw() {
    if (closed) return;
    const states = tasks.map((task) => task.getState());
    const terminalRows = stdout.rows || process.stdout.rows || 24;
    const schedule = runner.getSchedule ? runner.getSchedule() : { baseDelayMs: 120_000, jitterMs: 20_000 };
    stdout.write(
      CLEAR_SCREEN +
        renderDashboard(states, {
          selectedIndex,
          now: now(),
          logs,
          mode,
          schedule,
          editField,
          editValue,
          rows: terminalRows,
          useColor: Boolean(stdout.isTTY && !process.env.NO_COLOR),
        }) +
        '\n',
    );
  }

  const unsubscribeCallbacks = tasks.map((task) => task.subscribe(redraw));
  const interval = setRefreshInterval(redraw, 1000);

  function cleanup(shouldExit = false) {
    if (closed) return;
    closed = true;
    unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    clearRefreshInterval(interval);
    runner.stop();
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write(SHOW_CURSOR);
    if (shouldExit) exit(0);
  }

  function selectedTask() {
    return tasks[selectedIndex];
  }

  function handleKeypress(_value, key = {}) {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      cleanup(true);
      return;
    }

    if (editField) {
      if (/^\d$/.test(_value || '')) {
        editValue += _value;
      } else if (key.name === 'backspace') {
        editValue = editValue.slice(0, -1);
      } else if (key.name === 'escape') {
        editField = null;
        editValue = '';
      } else if (key.name === 'return') {
        const seconds = Number.parseInt(editValue, 10);
        if (Number.isFinite(seconds) && seconds >= 0 && runner.updateSchedule) {
          if (editField === 'base' && seconds > 0) {
            runner.updateSchedule({ baseDelayMs: seconds * 1000 });
          } else if (editField === 'jitter') {
            runner.updateSchedule({ jitterMs: seconds * 1000 });
          }
        }
        editField = null;
        editValue = '';
      }

      redraw();
      return;
    }

    if (key.name === 'return') {
      mode = 'detail';
    } else if (key.name === 'escape') {
      mode = 'list';
    } else if (key.name === 'b') {
      mode = 'list';
      editField = 'base';
      editValue = '';
    } else if (key.name === 'j') {
      mode = 'list';
      editField = 'jitter';
      editValue = '';
    } else if (key.name === 'up') {
      selectedIndex = Math.max(0, selectedIndex - 1);
    } else if (key.name === 'down') {
      selectedIndex = Math.min(tasks.length - 1, selectedIndex + 1);
    } else if (key.name === 's') {
      selectedTask().start();
    } else if (key.name === 'x') {
      selectedTask().stop();
    } else if (key.name === 'r') {
      selectedTask().runNow();
    } else if (key.name === 'l') {
      selectedTask().runContinuous();
    } else if (key.name === 'a') {
      runner.start();
    } else if (key.name === 'z') {
      runner.stop();
    }

    redraw();
  }

  readline.emitKeypressEvents(stdin);
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.on('keypress', handleKeypress);
  stdout.write(HIDE_CURSOR);
  redraw();

  return {
    redraw,
    close() {
      stdin.off('keypress', handleKeypress);
      cleanup(false);
    },
  };
}

module.exports = {
  createBufferedLogger,
  formatRemainingTime,
  renderDashboard,
  startTui,
};
