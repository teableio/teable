import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { CsvDelimiterDetector } from './CsvDelimiterDetector';

type Newline = '\r\n' | '\r' | '\n';
type SkipEmptyLines = boolean | 'greedy';

const papaDelimiter = (text: string, newline: Newline, skipEmptyLines: SkipEmptyLines) =>
  Papa.parse<string[]>(text, { newline, skipEmptyLines }).meta.delimiter;

const pushChunks = (detector: CsvDelimiterDetector, text: string, chunkSize: number) => {
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    detector.push(text.slice(offset, offset + chunkSize));
  }
};

const expectPapaDelimiter = (
  text: string,
  newline: Newline,
  skipEmptyLines: SkipEmptyLines,
  chunkSize: number
) => {
  const expected = papaDelimiter(text, newline, skipEmptyLines);
  const detector = new CsvDelimiterDetector(newline, skipEmptyLines);
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    detector.push(text.slice(offset, offset + chunkSize));
    const selected = detector.delimiter();
    if (selected !== undefined) expect(selected).toBe(expected);
  }
  expect(detector.finish()).toBe(expected);
  expect(detector.delimiter()).toBe(expected);
};

const longValue = 'x'.repeat(70_000);
const semicolonLines = `${'x'.repeat(100)},y\n`.repeat(12);
const commaLines = `${'x'.repeat(100)};y\n`.repeat(12);

const reportedCases = [
  {
    name: '70k first semicolon data row',
    prefix: `Name;Age\n${longValue.slice(0, 65_536)}`,
    suffix: `${longValue.slice(65_536)};30\nBob;40`,
  },
  {
    name: 'ambiguous header before a 70k semicolon data row',
    prefix: `name,full;age\n${longValue.slice(0, 65_536)}`,
    suffix: `${longValue.slice(65_536)};30\nBob;40`,
  },
  {
    name: 'twelve physical rows inside a semicolon value followed by 70k continuation',
    prefix: `name,full;note;age\nAlice;"${semicolonLines}`,
    suffix: `${'z'.repeat(70_000)}";30\nBob;last;40\n`,
  },
  {
    name: 'equal-width comma multiline and semicolon candidates',
    prefix: `name;full,age\nAlice,"${commaLines}`,
    suffix: `${'z'.repeat(70_000)}",30\nBob,40\n`,
  },
  {
    name: 'wider false-open semicolon candidate followed by a long comma tail',
    prefix: `name;full;extra,age\nBob;"Alice,30\n${'Bob;last,40\n'.repeat(10_000)}`,
    suffix: '',
  },
];

describe('CsvDelimiterDetector', () => {
  it.each(reportedCases)('preserves Papa scoring for $name', ({ prefix, suffix }) => {
    const expected = papaDelimiter(prefix + suffix, '\n', true);
    for (const chunkSize of [1, 127, 65_536]) {
      const detector = new CsvDelimiterDetector('\n', true);
      pushChunks(detector, prefix, chunkSize);
      expect(detector.delimiter()).toBeUndefined();
      pushChunks(detector, suffix, chunkSize);
      expect(detector.finish()).toBe(expected);
    }
  });

  it('settles only after each candidate has ten complete logical records', () => {
    const detector = new CsvDelimiterDetector('\n', true);
    detector.push('left;right\n'.repeat(9));
    expect(detector.delimiter()).toBeUndefined();
    detector.push('left;right');
    expect(detector.delimiter()).toBeUndefined();
    detector.push('\n');
    expect(detector.delimiter()).toBe(';');
    detector.push('left,middle,right\n'.repeat(20));
    expect(detector.finish()).toBe(';');
  });

  it.each<Newline>(['\n', '\r\n', '\r'])(
    'matches quoted, escaped and whitespace handling at every split with %j records',
    (newline) => {
      const text = [
        'name;note',
        '"Alice" \t;"first',
        'second ""quoted""" \t',
        '"";" \u00a0 "',
        'Bob;last',
      ].join(newline);
      for (const skipEmptyLines of [false, true, 'greedy'] satisfies SkipEmptyLines[]) {
        const expected = papaDelimiter(text, newline, skipEmptyLines);
        for (let split = 0; split <= text.length; split++) {
          const detector = new CsvDelimiterDetector(newline, skipEmptyLines);
          detector.push(text.slice(0, split));
          detector.push('');
          detector.push(text.slice(split));
          expect(detector.finish()).toBe(expected);
        }
        expectPapaDelimiter(text, newline, skipEmptyLines, 1);
      }
    }
  );

  it.each<SkipEmptyLines>([false, true, 'greedy'])(
    'counts empty records inside the ten-row sample with skipEmptyLines=%j',
    (skipEmptyLines) => {
      for (const text of [
        '',
        '\n',
        `${'\n'.repeat(9)}left;right\nlater,comma,row`,
        `${'\n'.repeat(10)}left;right\n`,
        '\n""\n \t\n;\n" ";"\t"\nleft;right\nlast;value\n',
        'a;b\n\n\n',
      ]) {
        expectPapaDelimiter(text, '\n', skipEmptyLines, 1);
      }
    }
  );

  it.each([',', '\t', '|', ';', Papa.RECORD_SEP, Papa.UNIT_SEP])(
    'matches every default candidate and its order-sensitive ties for %j',
    (delimiter) => {
      expectPapaDelimiter(`left${delimiter}right\nfirst${delimiter}second\n`, '\n', true, 1);
      expectPapaDelimiter(`a,b${delimiter}c\nd,e${delimiter}f\ng,h${delimiter}i`, '\n', true, 2);
    }
  );

  it('scores malformed quoted rows instead of discarding their candidates', () => {
    const fixtures = [
      'a,b;c\n"left"bad";right\nlast;value',
      'a,b;c\n"left"bad;right\nlast;value',
      'a,b;c\n"left" "more";right\nlast;value',
      'a,b;c\n"left"";right\nlast;value',
      'a,b;c\n"left" \t;right\nlast;value',
      'a,b;c\n"left" \t\nlast;value',
      'a,b;c\n""',
      'a,b;c\n"" ',
      'a,b;c\n"""',
      'a,b;c\n"',
      'a,b;c\n" \t" \t',
      'a,b;c\n" \t" \t;""\n',
      'a,b;c\n" \t" \t""\n',
      'a,b;c\nnot"quoted;right\nlast;value',
    ];
    for (const newline of ['\n', '\r\n', '\r'] satisfies Newline[]) {
      for (const skipEmptyLines of [false, true, 'greedy'] satisfies SkipEmptyLines[]) {
        for (const fixture of fixtures) {
          expectPapaDelimiter(fixture.replaceAll('\n', newline), newline, skipEmptyLines, 1);
        }
      }
    }
  });

  it('distinguishes CRLF records from lone carriage returns and line feeds', () => {
    for (const text of [
      'a;b\r\n"x\ry\nz";2\r\nlast;3\r',
      'a;b\r\n""\r;2\r\nlast;3\r\n',
      'a;b\r\n""\n\r\nlast;3\r\n',
      'a;b\r\n""\r',
    ]) {
      expectPapaDelimiter(text, '\r\n', false, 1);
      expectPapaDelimiter(text, '\r\n', 'greedy', 2);
    }
  });
});
