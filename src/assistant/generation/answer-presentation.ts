/** Only removes complete, simple bold delimiters in prose. Code and ambiguous markup stay literal. */
export function presentSimpleBold(input: string, complete = true): string {
  let output = '';
  let codeTicks = 0;
  for (let index = 0; index < input.length;) {
    const character = input[index];
    if (character === '\\' && index + 1 < input.length) {
      output += input.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === '`') {
      let end = index + 1;
      while (input[end] === '`') end++;
      if (!complete && end === input.length) break;
      const ticks = end - index;
      if (codeTicks === 0) codeTicks = ticks;
      else if (codeTicks === ticks) codeTicks = 0;
      output += input.slice(index, end);
      index = end;
      continue;
    }
    if (codeTicks === 0 && character === '*') {
      if (!complete && index + 1 === input.length) break;
      if (input[index + 1] === '*' && input[index + 2] !== '*' && input[index - 1] !== '*') {
        const end = findClosingBold(input, index + 2);
        if (end === -1 && !complete) break;
        if (!complete && end + 2 === input.length) break;
        const value = end < 0 ? '' : input.slice(index + 2, end);
        if (value && input[end + 2] !== '*' && !/[\r\n`]/u.test(value) && !/^\s|\s$/u.test(value)) {
          output += value;
          index = end + 2;
          continue;
        }
      }
    }
    output += character;
    index++;
  }
  return output;
}

function findClosingBold(input: string, start: number): number {
  for (let index = start; index < input.length - 1; index++) {
    if (input[index] === '\\') { index++; continue; }
    if (input[index] === '*' && input[index + 1] === '*') return index;
  }
  return -1;
}
