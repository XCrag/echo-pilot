const ARITHMETIC_PROMPT_TOKEN = '{{arithmeticPrompt}}';

function randomInteger(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

function chooseOperator(random = Math.random) {
  return random() < 0.5 ? '+' : '-';
}

function generateArithmeticPrompt({
  min = 1,
  max = 1000,
  minTerms = 3,
  maxTerms = 5,
  random = Math.random,
} = {}) {
  const termCount = randomInteger(minTerms, maxTerms, random);
  const parts = [String(randomInteger(min, max, random))];

  for (let index = 1; index < termCount; index += 1) {
    parts.push(chooseOperator(random));
    parts.push(String(randomInteger(min, max, random)));
  }

  return `Calculate ${parts.join(' ')}. Reply with only the final number.`;
}

function renderValue(value, promptFactory) {
  if (typeof value !== 'string' || !value.includes(ARITHMETIC_PROMPT_TOKEN)) {
    return value;
  }

  return value.split(ARITHMETIC_PROMPT_TOKEN).join(promptFactory());
}

function renderCommandSpec(commandSpec, options = {}) {
  const promptFactory = options.promptFactory || generateArithmeticPrompt;

  return {
    ...commandSpec,
    command: renderValue(commandSpec.command, promptFactory),
    args: commandSpec.args.map((arg) => renderValue(arg, promptFactory)),
  };
}

module.exports = {
  ARITHMETIC_PROMPT_TOKEN,
  generateArithmeticPrompt,
  renderCommandSpec,
};
