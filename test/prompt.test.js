const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateArithmeticPrompt,
  renderCommandSpec,
} = require('../lib/prompt');

function sequenceRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('generateArithmeticPrompt creates a varied 1-1000 arithmetic prompt', () => {
  const prompt = generateArithmeticPrompt({
    random: sequenceRandom([0.99, 0, 0.1, 0.999, 0.9, 0.5, 0.2, 0.25, 0.75, 0.4]),
  });

  assert.equal(
    prompt,
    'Calculate 1 + 1000 - 501 + 251 - 401. Reply with only the final number.',
  );
});

test('renderCommandSpec replaces arithmetic prompt placeholders in args', () => {
  const rendered = renderCommandSpec(
    {
      name: 'sample',
      command: 'example',
      args: ['run', '{{arithmeticPrompt}}', 'again: {{arithmeticPrompt}}'],
    },
    {
      promptFactory: () => 'Calculate 2 + 3. Reply with only the final number.',
    },
  );

  assert.deepEqual(rendered, {
    name: 'sample',
    command: 'example',
    args: [
      'run',
      'Calculate 2 + 3. Reply with only the final number.',
      'again: Calculate 2 + 3. Reply with only the final number.',
    ],
  });
});
