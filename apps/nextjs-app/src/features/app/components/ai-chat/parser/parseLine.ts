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
  parseFieldOptions(type: string, options?: string): any {
    switch (type) {
      case FieldType.SingleSelect: {
        if (!options) {
          throw new Error('Missing options for singleSelect field');
        }
        const match = options.match(/choices\((.+)\)/);
        if (match) {
          const choicesStr = match[1];
          const choices = choicesStr.split(',').map((choice) => {
            const [name, color] = choice
              .trim()
              .split(':')
              .map((i) => i.trim());
            return { name, color };
          });
          return { choices };
        }
        throw new Error(
          "Invalid singleSelect field value, it should be 'choices(name1:color1,name2:color2)'"
        );
      }
      case FieldType.Number: {
        if (!options) {
          throw new Error('Missing value for number field');
        }
        const precisionMatch = options.match(/precision\((\d+)\)/);
        if (precisionMatch) {
          return { precision: parseInt(precisionMatch[1], 10) };
        } else {
          throw new Error('Invalid number field value');
        }
      }
      default:
        return options;
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

    switch (operation) {
      case 'create-field': {
        const [type] = valueStr.split(':');
        const value = valueStr.slice(type.length + 1);
        const options = this.parseFieldOptions(type, value);
        return {
          operation,
          index,
          value: {
            type,
            options,
          },
        };
      }
      case 'create-table': {
        // create-table: Create a table
        // index: table order
        // value: {name}:{description}:{emojiIcon}
        const [name, description, emojiIcon] = valueStr
          .split(/(?<!\\):/)
          .map((part) => part.replace(/\\:/g, ':'));
        return {
          operation,
          index,
          value: {
            name,
            description,
            emojiIcon,
          },
        };
      }

      case 'set-record': {
        // set-record: set a record value
        // index: record order
        // value: {fieldName}:{recordValue}
        const [fieldName, recordValue] = valueStr
          .split(/(?<!\\):/)
          .map((part) => part.replace(/\\:/g, ':'));
        return {
          operation,
          index,
          value: {
            fieldName,
            recordValue,
          },
        };
      }

      default:
        return {
          operation,
          index,
          value: valueStr,
        };
    }
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
