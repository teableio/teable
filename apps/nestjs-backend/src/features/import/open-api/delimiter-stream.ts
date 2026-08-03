import type { TransformCallback } from 'stream';
import { Transform } from 'stream';

const defaults = {
  delimiter: '\n',
  encoding: 'utf8' as BufferEncoding,
};

interface IDelimiterStreamOptions {
  delimiter?: string;
  encoding?: BufferEncoding;
}

interface IDelimiterStreamInstance extends Transform {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _delimiter: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _encoding: BufferEncoding;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _stub: Buffer;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _delimiterBuffer: Buffer;
  getLines(chunk: Buffer): Buffer[];
  dispatchLines(lines: Buffer[]): void;
}

class DelimiterStream extends Transform implements IDelimiterStreamInstance {
  _delimiter: string;
  _encoding: BufferEncoding;
  _stub: Buffer;
  _delimiterBuffer: Buffer;

  constructor(options: IDelimiterStreamOptions = defaults) {
    super(options);

    this._delimiter = options.delimiter || defaults.delimiter;
    this._encoding = options.encoding || defaults.encoding;

    this._stub = Buffer.from([]);
    this._delimiterBuffer = Buffer.from(this._delimiter, this._encoding);
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
    const lines = this.getLines(chunk);
    this.dispatchLines(lines);
    done();
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _flush(done: () => void): void {
    this.push(this._stub.toString(this._encoding), this._encoding);
    done();
  }

  getLines(linesChunk: Buffer): Buffer[] {
    const delimiterLength = this._delimiterBuffer.length;
    const lines: Buffer[] = [];
    let delimiterHits = 0;
    let lastSplitIndex = 0;

    if (this._stub.length) {
      linesChunk = Buffer.concat([this._stub, linesChunk]);
      this._stub = Buffer.from('');
    }

    for (let charIndex = 0; charIndex < linesChunk.length; charIndex++) {
      const bufferChar = linesChunk[charIndex];
      const delimiterChar = this._delimiterBuffer[delimiterHits];

      if (bufferChar === delimiterChar) {
        delimiterHits++;
        if (delimiterHits === delimiterLength) {
          lines.push(linesChunk.slice(lastSplitIndex, charIndex + 1));
          lastSplitIndex = charIndex + 1;
          delimiterHits = 0;
        }
      } else {
        delimiterHits = 0;
      }
    }

    this._stub = linesChunk.slice(lastSplitIndex);
    return lines;
  }

  dispatchLines(lines: Buffer[], lineIndex = 0): void {
    const _encoding = this._encoding;
    const line = lines[lineIndex];

    // Check if the line is a _delimiter line => do not add it to the previous chunk!
    this.push(line, _encoding);

    lineIndex++;

    if (lineIndex < lines.length) {
      return this.dispatchLines(lines, lineIndex);
    }
  }
}

/**
 * workaround for the issue with the two-byte UTF characters
 * https://github.com/mholt/PapaParse/issues/751
 */
export const toLineDelimitedStream = (input: NodeJS.ReadableStream) => {
  // Two-byte UTF characters (such as "ä") can break because the chunk might get
  // split at the middle of the character, and papaparse parses the byte stream
  // incorrectly. We can use `DelimiterStream` to fix this, as it parses the
  // chunks to lines correctly before passing the data to papaparse.
  const output = new DelimiterStream();
  input.pipe(output);
  return output;
};
