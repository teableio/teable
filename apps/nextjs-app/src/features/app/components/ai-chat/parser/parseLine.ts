/* eslint-disable @typescript-eslint/no-empty-function */
export type IParsedLine = {
  operation: string;
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
};

export type IAsyncCallback = (line: IParsedLine) => Promise<unknown>;

export class AISyntaxParser {
  private lastIndex = 0;
  private processing = false;
  private pendingInputs: string | undefined;

  constructor(private readonly asyncCallback: IAsyncCallback) {}

  parseLine(line: string): IParsedLine | null {
    const trimmedLine = line.endsWith(';') ? line.slice(0, -1) : line;
    const tokens = trimmedLine.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|'));
    console.log('line: ', line);
    if (tokens.length !== 3) {
      return null;
    }

    // eslint-disable-next-line prefer-const
    let [operation, indexStr, valueStr] = tokens;
    const index = parseInt(indexStr, 10);

    if (isNaN(index)) {
      return null;
    }

    // eslint-disable-next-line sonarjs/no-small-switch
    switch (operation) {
      case 'generate-chart': {
        return {
          operation,
          index,
          value: JSON.parse(valueStr.replaceAll('\n', '')),
        };
      }

      case 'create-record': {
        return {
          operation,
          index,
          value: undefined,
        };
      }

      default: {
        let valueJson;
        if (valueStr === 'undefined') {
          valueStr = '';
        }
        try {
          valueJson = valueStr ? JSON.parse(valueStr) : undefined;
        } catch (e) {
          console.error(valueStr);
          throw e;
        }

        return {
          operation,
          index,
          value: valueJson,
        };
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async processMultilineSyntax(
    input: string,
    callBack: (result: unknown) => void = () => {}
  ): Promise<void> {
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
            callBack(await this.asyncCallback(parsedLine));
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
          await this.processMultilineSyntax(pendingInput, callBack);
        }
      }
    }
  }
}
