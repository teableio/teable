import Papa from 'papaparse';

const previewRows = 10;
const whitespace = /\s/u;

type Newline = '\r\n' | '\r' | '\n';
type SkipEmptyLines = boolean | 'greedy';
type FieldState = 'start' | 'unquoted' | 'quoted' | 'afterQuote';

/**
 * Papa's delimiter preview without retaining fields or input. Each candidate
 * samples its own first ten logical rows, including rows later skipped as empty.
 * A quote under a competing delimiter can remain ambiguous until EOF.
 */
export class CsvDelimiterDetector {
  private readonly candidates: DelimiterCandidate[];

  constructor(newline: Newline, skipEmptyLines: SkipEmptyLines) {
    this.candidates = [',', '\t', '|', ';', Papa.RECORD_SEP, Papa.UNIT_SEP].map(
      (delimiter) => new DelimiterCandidate(delimiter, newline, skipEmptyLines)
    );
  }

  push(text: string): void {
    for (const candidate of this.candidates) candidate.push(text);
  }

  delimiter(): string | undefined {
    for (const candidate of this.candidates) {
      if (!candidate.complete) return undefined;
    }
    return this.selectDelimiter();
  }

  finish(): string {
    for (const candidate of this.candidates) candidate.finish();
    return this.selectDelimiter();
  }

  private selectDelimiter(): string {
    let delimiter = ',';
    let bestDelta = Infinity;
    let bestAverage = 1.99;
    for (const candidate of this.candidates) {
      const average = candidate.fields / candidate.countedRows;
      if (candidate.delta <= bestDelta && average > bestAverage) {
        delimiter = candidate.delimiter;
        bestDelta = candidate.delta;
        bestAverage = average;
      }
    }
    return delimiter;
  }
}

class DelimiterCandidate {
  complete = false;
  fields = 0;
  countedRows = 0;
  delta = 0;

  private sampledRows = 0;
  private previousWidth: number | undefined;
  private width = 1;
  private rowHasContent = false;
  private rowHasNonWhitespace = false;
  private state: FieldState = 'start';
  private spacesAfterQuote = false;
  private pendingCr = false;
  private hasInput = false;

  constructor(
    readonly delimiter: string,
    private readonly newline: Newline,
    private readonly skipEmptyLines: SkipEmptyLines
  ) {}

  push(text: string): void {
    if (this.complete || text.length === 0) return;
    this.hasInput = true;
    for (let index = 0; index < text.length && !this.complete; index++) {
      const character = text[index];
      if (this.pendingCr) {
        this.pendingCr = false;
        if (character === '\n') {
          this.consume('\r\n');
          continue;
        }
        this.consume('\r');
      }
      if (this.newline === '\r\n' && character === '\r') {
        this.pendingCr = true;
      } else {
        this.consume(character);
      }
    }
  }

  finish(): void {
    if (this.complete) return;
    if (this.pendingCr) {
      this.pendingCr = false;
      this.consume('\r');
    }
    // Papa accepts a closing quote at EOF, but not a quote followed by only
    // whitespace at EOF: the latter is recovered as part of an unclosed field.
    if (this.state === 'afterQuote' && this.spacesAfterQuote) this.addContent('"');
    if (this.hasInput) this.saveRow();
    this.complete = true;
  }

  private consume(character: string): void {
    if (this.state === 'quoted') {
      if (character === '"') {
        this.state = 'afterQuote';
        this.spacesAfterQuote = false;
      } else {
        this.addContent(character);
      }
      return;
    }

    if (this.state === 'afterQuote') {
      this.consumeAfterQuote(character);
      return;
    }

    if (character === this.delimiter) {
      this.width++;
      this.state = 'start';
    } else if (character === this.newline) {
      this.saveRow();
    } else if (this.state === 'start' && character === '"') {
      this.state = 'quoted';
    } else {
      this.state = 'unquoted';
      this.addContent(character);
    }
  }

  private consumeAfterQuote(character: string): void {
    if (character === '"' && !this.spacesAfterQuote) {
      this.addContent('"');
      this.state = 'quoted';
      return;
    }
    if (character === this.delimiter) {
      this.width++;
      this.state = 'start';
      return;
    }
    if (character === this.newline) {
      this.saveRow();
      return;
    }
    if (whitespace.test(character)) {
      this.spacesAfterQuote = true;
      return;
    }
    // InvalidQuotes does not disqualify a Papa candidate. Keep searching for
    // a later closing quote, with this malformed quote now part of the value.
    this.addContent('"');
    this.state = character === '"' ? 'afterQuote' : 'quoted';
    this.spacesAfterQuote = false;
  }

  private addContent(character: string): void {
    this.rowHasContent = true;
    if (!this.rowHasNonWhitespace && !whitespace.test(character)) {
      this.rowHasNonWhitespace = true;
    }
  }

  private saveRow(): void {
    const empty =
      this.skipEmptyLines === 'greedy'
        ? !this.rowHasNonWhitespace
        : this.skipEmptyLines && this.width === 1 && !this.rowHasContent;
    if (!empty) {
      this.fields += this.width;
      this.countedRows++;
      if (this.previousWidth !== undefined) this.delta += Math.abs(this.width - this.previousWidth);
      this.previousWidth = this.width;
    }
    this.sampledRows++;
    this.complete = this.sampledRows === previewRows;
    this.width = 1;
    this.rowHasContent = false;
    this.rowHasNonWhitespace = false;
    this.state = 'start';
  }
}
