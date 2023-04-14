import { FieldType } from '@teable-group/core';

export type IParsedLine = {
  operation: string;
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
};

export type IAsyncCallback = (line: IParsedLine) => Promise<void>;

export class AISyntaxParser {
  private lastIndex = 0;
  private processing = false;
  private pendingInputs: string | undefined;

  constructor(private readonly asyncCallback: IAsyncCallback) {}

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
          `Invalid singleSelect field value: ${options}, it should be 'choices(name1:color1,name2:color2)'`
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
    const trimmedLine = line.endsWith(';') ? line.slice(0, -1) : line;
    const tokens = trimmedLine.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|'));

    console.log(tokens);
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
        const [name, type] = valueStr.split(':');
        const value = valueStr.slice((name + type).length + 1);
        const options = this.parseFieldOptions(type, value);
        return {
          operation,
          index,
          value: {
            name,
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

      case 'generate-chart': {
        return {
          operation,
          index,
          value: JSON.parse(valueStr.replaceAll('\n', '')),
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async processMultilineSyntax(input: string): Promise<void> {
    if (this.processing) {
      this.pendingInputs = input;
    } else {
      this.processing = true;

      const newInput = input.slice(this.lastIndex);
      const lines = newInput.split(';');

      const lastLine = lines.pop();

      if (lines.length > 0) {
        for (const line of lines) {
          const parsedLine = this.parseLine(line.trim());
          if (parsedLine) {
            await this.asyncCallback(parsedLine);
          }
        }

        if (lastLine) {
          this.lastIndex = input.length - lastLine.length;
        } else {
          this.lastIndex = input.length;
        }
      }

      this.processing = false;

      if (this.pendingInputs) {
        const pendingInput = this.pendingInputs;
        this.pendingInputs = undefined;
        if (pendingInput) {
          await this.processMultilineSyntax(pendingInput);
        }
      }
    }
  }
}
