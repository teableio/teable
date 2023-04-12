/* eslint-disable sonarjs/no-duplicate-string */
// parser.test.ts
import type { IParsedLine } from './parseLine';
import { AISyntaxParser } from './parseLine';

describe('parseLine', () => {
  it('should parse a valid line correctly', () => {
    const line = 'add|1|hello';
    const expected = { operation: 'add', index: 1, value: 'hello' };
    const parser = new AISyntaxParser();
    expect(parser.parseLine(line)).toEqual(expected);
  });

  it('should return null for an invalid line', () => {
    const line = 'add|hello|1';
    const parser = new AISyntaxParser();
    expect(parser.parseLine(line)).toBeNull();
  });

  it('should handle escaped pipe characters', () => {
    const line = 'update|3|ex\\|ample';
    const parser = new AISyntaxParser();
    const expected = { operation: 'update', index: 3, value: 'ex|ample' };
    expect(parser.parseLine(line)).toEqual(expected);
  });

  it('parses simplified field value syntax', () => {
    const input1 = 'create-field|1|singleLineText';
    const parsed1 = new AISyntaxParser().parseLine(input1);
    expect(parsed1).toEqual({
      operation: 'create-field',
      index: 1,
      value: { type: 'singleLineText', value: '' },
    });

    const input2 = 'create-field|2|LongText';
    const parsed2 = new AISyntaxParser().parseLine(input2);
    expect(parsed2).toEqual({
      operation: 'create-field',
      index: 2,
      value: { type: 'LongText', value: '' },
    });

    const input3 = 'create-field|3|singleSelect:choices(light:yellow, dark:blueDark1)';
    const parsed3 = new AISyntaxParser().parseLine(input3);
    expect(parsed3).toEqual({
      operation: 'create-field',
      index: 3,
      value: {
        type: 'singleSelect',
        value: {
          choices: [
            { name: 'light', color: 'yellow' },
            { name: 'dark', color: 'blueDark1' },
          ],
        },
      },
    });
  });

  it('processes multiline input in chunks', async () => {
    const asyncCallback = jest.fn(async (_line: IParsedLine) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const input1 = `add|1`;
    const input2 = `add|1|world\n`;
    const input3 = `add|1|world\nremove|1|world\n`;
    const parser = new AISyntaxParser();

    await parser.processMultilineSyntax(input1, asyncCallback);
    expect(asyncCallback).toHaveBeenCalledTimes(0);

    await parser.processMultilineSyntax(input2, asyncCallback);
    expect(asyncCallback).toHaveBeenCalledTimes(1);
    expect(asyncCallback).toHaveBeenCalledWith({ operation: 'add', index: 1, value: 'world' });

    await parser.processMultilineSyntax(input3, asyncCallback);
    expect(asyncCallback).toHaveBeenCalledTimes(2);
    expect(asyncCallback).toHaveBeenCalledWith({ operation: 'remove', index: 1, value: 'world' });
  });
});
