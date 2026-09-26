import type { CsvEncoding, CsvSource } from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import { safeFetch } from '@teable/v2-utils/fetch';
import Papa from 'papaparse';

import { createCsvReplayStore } from './createCsvReplayStore';
import { CsvDelimiterDetector } from './CsvDelimiterDetector';
import type { CsvReplayStore } from './CsvReplayStore';

const chunkSize = 64 * 1024;
const formatSampleSize = 1024 * 1024;

type CsvRowsOptions = {
  delimiter?: string;
  encoding?: CsvEncoding;
  skipEmptyLines?: boolean | 'greedy';
};

/**
 * Delimiter inference keeps only lexical counters. Ambiguous prefixes spill to
 * request-owned storage; the selected parser replays bounded chunks once known.
 */
export async function* parseCsvRows(
  source: CsvSource,
  options: CsvRowsOptions = {}
): AsyncGenerator<string[]> {
  const input = readCsvText(source, options.encoding)[Symbol.asyncIterator]();
  let replay: CsvReplayStore | undefined;
  try {
    const prepared = await prepareCsvInput(input, options);
    replay = prepared.replay;
    const state = new CsvChunkParser(
      prepared.delimiter,
      prepared.newline,
      options.skipEmptyLines ?? true
    );
    if (replay) {
      for await (const text of replay.read()) yield* state.consume(text, false);
      await replay.dispose();
      replay = undefined;
    } else {
      yield* state.consume(prepared.sample, prepared.exhausted);
      prepared.sample = '';
      if (prepared.exhausted) return;
      if (prepared.remainder) {
        yield* state.consume(prepared.remainder, false);
        prepared.remainder = '';
      }
    }
    while (!prepared.exhausted) {
      const next = await input.next();
      if (next.done) break;
      yield* state.consume(next.value, false);
    }
    yield* state.consume('', true);
  } finally {
    try {
      await input.return?.();
    } finally {
      await replay?.dispose();
    }
  }
}

async function prepareCsvInput(input: AsyncIterator<string>, options: CsvRowsOptions) {
  const initial = await readFormatSample(input);
  let sample = initial.text;
  let remainder = initial.remainder;
  const exhausted = initial.exhausted;
  const newline = detectNewline(sample);
  if (options.delimiter) {
    return {
      sample,
      remainder,
      exhausted,
      newline,
      delimiter: options.delimiter,
      replay: undefined,
    };
  }
  const detector = new CsvDelimiterDetector(newline, options.skipEmptyLines ?? true);
  detector.push(sample);
  detector.push(remainder);
  const delimiter = exhausted ? detector.finish() : detector.delimiter();
  if (delimiter) return { sample, remainder, exhausted, newline, delimiter, replay: undefined };

  const replay = await createCsvReplayStore();
  try {
    await appendReplayText(replay, sample);
    sample = '';
    await appendReplayText(replay, remainder);
    remainder = '';
    const detected = await sampleToReplay(input, detector, replay);
    return { sample, remainder, newline, replay, ...detected };
  } catch (error) {
    await replay.dispose();
    throw error;
  }
}

async function sampleToReplay(
  input: AsyncIterator<string>,
  detector: CsvDelimiterDetector,
  replay: CsvReplayStore
) {
  let next = await input.next();
  while (!next.done) {
    await appendReplayText(replay, next.value);
    detector.push(next.value);
    const delimiter = detector.delimiter();
    if (delimiter) return { delimiter, exhausted: false };
    next = await input.next();
  }
  return { delimiter: detector.finish(), exhausted: true };
}

async function appendReplayText(replay: CsvReplayStore, text: string): Promise<void> {
  // TextDecoder carry-over can expand a byte-sized block beyond the store's UTF-16 limit.
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    await replay.append(text.slice(offset, offset + chunkSize));
  }
}

async function readFormatSample(input: AsyncIterator<string>) {
  let text = '';
  let next = await input.next();
  while (!next.done) {
    const remaining = formatSampleSize - text.length;
    text += next.value.slice(0, remaining);
    if (next.value.length >= remaining) {
      return { text, remainder: next.value.slice(remaining), exhausted: false };
    }
    next = await input.next();
  }
  return { text, remainder: '', exhausted: true };
}

function detectNewline(text: string): '\r\n' | '\r' | '\n' {
  // Match Papa's guessLineEndings, including non-greedy quote-pair removal.
  const sample = text.slice(0, formatSampleSize).replace(/".*?"/gs, '');
  const carriageReturns = sample.split('\r');
  const lineFeeds = sample.split('\n');
  const lineFeedAppearsFirst =
    lineFeeds.length > 1 && lineFeeds[0].length < carriageReturns[0].length;
  if (carriageReturns.length === 1 || lineFeedAppearsFirst) return '\n';
  let followedByLineFeed = 0;
  for (const segment of carriageReturns) {
    if (segment[0] === '\n') followedByLineFeed++;
  }
  return followedByLineFeed >= carriageReturns.length / 2 ? '\r\n' : '\r';
}

class CsvChunkParser {
  private buffer = '';
  private readonly parser: Papa.Parser;
  private endedAtRecordBoundary = false;

  constructor(
    delimiter: string,
    newline: '\r\n' | '\r' | '\n',
    private readonly skipEmptyLines: boolean | 'greedy'
  ) {
    this.parser = new Papa.Parser({ delimiter, newline });
  }

  *consume(text: string, finished: boolean): Generator<string[]> {
    if (finished && this.endedAtRecordBoundary && !this.skipEmptyLines) {
      yield [''];
    }
    this.buffer += text;

    // A CR at the chunk edge may be the first half of a CRLF delimiter.
    const input = !finished && this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer;
    const parsed: Papa.ParseResult<string[]> = this.parser.parse(input, 0, !finished);
    // Papa may flag a closing quote before the next chunk supplies its delimiter.
    // Only completed records have final errors before EOF.
    const firstError = parsed.errors.find(
      (error) => finished || error.row === undefined || error.row < parsed.data.length
    );
    if (firstError) {
      throw domainError.validation({
        message: `CSV parse error at row ${firstError.row}: ${firstError.message}`,
        code: 'csv.parse_error',
        details: { errors: parsed.errors },
      });
    }
    const consumed = parsed.meta.cursor;
    this.endedAtRecordBoundary = consumed > 0 && consumed === this.buffer.length;
    this.buffer = this.buffer.slice(consumed);
    const rows: Array<string[] | undefined> = parsed.data;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      rows[index] = undefined;
      if (!this.isEmpty(row)) yield row;
    }
  }

  private isEmpty(row: string[]): boolean {
    if (this.skipEmptyLines === 'greedy') return row.every((cell) => cell.trim() === '');
    return this.skipEmptyLines && row.length === 1 && row[0] === '';
  }
}

async function* readCsvText(source: CsvSource, encoding: CsvEncoding = 'utf-8') {
  let firstText = true;
  for await (let text of decodeCsvText(source, encoding)) {
    if (!text) continue;
    if (firstText) {
      firstText = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (text) yield text;
  }
}

async function* decodeCsvText(source: CsvSource, encoding: CsvEncoding) {
  const decoder = new TextDecoder(encoding);
  for await (const chunk of readCsvSource(source)) {
    for (let offset = 0; offset < chunk.length; offset += chunkSize) {
      if (typeof chunk === 'string') {
        yield decoder.decode() + chunk.slice(offset, offset + chunkSize);
      } else {
        yield decoder.decode(chunk.subarray(offset, offset + chunkSize), { stream: true });
      }
    }
  }
  yield decoder.decode();
}

async function* readCsvSource(
  source: CsvSource
): AsyncGenerator<Uint8Array | string, void, undefined> {
  if (source.type === 'string' || source.type === 'buffer') {
    yield source.data;
    return;
  }
  if (source.type === 'stream') {
    yield* source.data;
    return;
  }

  const response = await safeFetch(source.url);
  if (!response.ok) {
    await response.body?.cancel();
    throw domainError.infrastructure({
      message: `Failed to fetch CSV from URL: ${response.status} ${response.statusText}`,
      code: 'csv.fetch_error',
    });
  }
  if (!response.body) {
    throw domainError.infrastructure({
      message: 'Response body is not available for streaming',
      code: 'csv.no_stream',
    });
  }

  const reader = response.body.getReader();
  let finished = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        return;
      }
      yield next.value;
    }
  } finally {
    try {
      if (!finished) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
