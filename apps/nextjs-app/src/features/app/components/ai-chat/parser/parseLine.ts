import { FieldType } from '@teable-group/core';

/* eslint-disable sonarjs/no-small-switch */
export type IParsedLine = {
  operation: string;
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
};

export type IAsyncCallback = (line: IParsedLine) => Promise<void>;

export class AISyntaxParser {
  private lastIndex: number;

  constructor() {
    this.lastIndex = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseValue(type: string, value?: string): any {
    switch (type) {
      case FieldType.SingleSelect: {
        if (!value) {
          throw new Error('Missing value for singleSelect field');
        }
        const choices = value.split(',').map((choice) => {
          const [name, color] = choice.split('(');
          return {
            name,
            color: color.slice(0, -1),
          };
        });
        return { choices };
      }
      case 'number': {
        if (!value) {
          throw new Error('Missing value for number field');
        }
        const precisionMatch = value.match(/precision\((\d+)\)/);
        if (precisionMatch) {
          return { precision: parseInt(precisionMatch[1], 10) };
        } else {
          throw new Error('Invalid number field value');
        }
      }
      default:
        return value;
    }
  }

  parseLine(line: string): IParsedLine | null {
    const tokens = line.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|'));

    if (tokens.length !== 3) {
      return null;
    }

    const [operation, indexStr, valueStr] = tokens;
    const index = parseInt(indexStr, 10);

    if (isNaN(index)) {
      return null;
    }

    if (operation !== 'create-field') {
      return {
        operation,
        index,
        value: valueStr,
      };
    }

    const [type, value] = valueStr.split(':');
    const parsedValue = this.parseValue(type, value || '');

    return {
      operation,
      index,
      value: {
        type,
        value: parsedValue,
      },
    };
  }

  async processMultilineSyntax(input: string, asyncCallback: IAsyncCallback): Promise<void> {
    const newInput = input.slice(this.lastIndex);
    const lines = newInput.split('\n');

    // 更新 lastIndex 以跳过已解析的部分
    this.lastIndex = input.length - (lines.pop()?.length || 0);

    for (const line of lines) {
      const parsedLine = this.parseLine(line);
      if (parsedLine) {
        await asyncCallback(parsedLine);
      }
    }
  }
}
