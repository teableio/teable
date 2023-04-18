/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
// parser.test.ts
import type { IParsedLine } from './parseLine';
import { AISyntaxParser } from './parseLine';

describe('parseLine', () => {
  const asyncCallback = jest.fn(async (_line: IParsedLine) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('should parse a valid line correctly', () => {
    const line = 'add|1|hello;';
    const expected = { operation: 'add', index: 1, value: 'hello' };
    const parser = new AISyntaxParser(asyncCallback);
    expect(parser.parseLine(line)).toEqual(expected);
  });

  it('should return null for an invalid line', () => {
    const line = 'add|hello|1';
    const parser = new AISyntaxParser(asyncCallback);
    expect(parser.parseLine(line)).toBeNull();
  });

  it('should handle escaped pipe characters', () => {
    const line = 'update|3|ex\\|ample;';
    const parser = new AISyntaxParser(asyncCallback);
    const expected = { operation: 'update', index: 3, value: 'ex|ample' };
    expect(parser.parseLine(line)).toEqual(expected);
  });

  it('parses simplified field value syntax', () => {
    const input1 = 'create-field|1|singleLineText;';
    const parsed1 = new AISyntaxParser(asyncCallback).parseLine(input1);
    expect(parsed1).toEqual({
      operation: 'create-field',
      index: 1,
      value: { name: 'singleLineText', options: '' },
    });

    const input2 = 'create-field|2|longText;';
    const parsed2 = new AISyntaxParser(asyncCallback).parseLine(input2);
    expect(parsed2).toEqual({
      operation: 'create-field',
      index: 2,
      value: { name: 'longText', options: '' },
    });

    const input3 = 'create-field|3|status:singleSelect:choices(light:yellow, dark:blueDark1);';
    const parsed3 = new AISyntaxParser(asyncCallback).parseLine(input3);
    expect(parsed3).toEqual({
      operation: 'create-field',
      index: 3,
      value: {
        name: 'status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'light', color: 'yellow' },
            { name: 'dark', color: 'blueDark1' },
          ],
        },
      },
    });
  });

  it('parses simplified set-record value syntax', () => {
    const input1 =
      'set-record|0|Project Name:Project A,Start Date:2022/01/01,End Date:2022/06/30,Assigned To:@user1,Status:In Progress;';
    const parsed1 = new AISyntaxParser(asyncCallback).parseLine(input1);
    expect(parsed1).toEqual({
      operation: 'set-record',
      index: 0,
      value: {
        'Project Name': 'Project A',
        'Start Date': '2022/01/01',
        'End Date': '2022/06/30',
        'Assigned To': '@user1',
        Status: 'In Progress',
      },
    });
  });

  it('processes multiline input in chunks', async () => {
    const asyncCallback = jest.fn(async (_line: IParsedLine) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const input1 = `add|1`;
    const input2 = `add|1|world;\n`;
    const input3 = `add|1|world;\nremove|1|world;\n`;
    const parser = new AISyntaxParser(asyncCallback);

    await parser.processMultilineSyntax(input1);
    expect(asyncCallback).toHaveBeenCalledTimes(0);

    await parser.processMultilineSyntax(input2);
    expect(asyncCallback).toHaveBeenCalledTimes(1);
    expect(asyncCallback).toHaveBeenCalledWith({ operation: 'add', index: 1, value: 'world' });

    await parser.processMultilineSyntax(input3);
    expect(asyncCallback).toHaveBeenCalledTimes(2);
    expect(asyncCallback).toHaveBeenCalledWith({ operation: 'remove', index: 1, value: 'world' });
  });
});
