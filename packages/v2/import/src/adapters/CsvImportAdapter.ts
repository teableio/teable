import { parseCsvRows } from '@teable/v2-adapter-csv-parser-papaparse';
import {
  domainError,
  type CsvSource,
  type DomainError,
  type IImportSourceAdapter,
  type IImportOptions,
  type IImportParseResult,
  type IImportSource,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * CSV Import Adapter
 * Supports CSV, TSV, and plain text files
 */
export class CsvImportAdapter implements IImportSourceAdapter {
  readonly supportedTypes = ['csv', 'tsv', 'txt'] as const;

  supports(type: string): boolean {
    return (this.supportedTypes as readonly string[]).includes(type);
  }

  async parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    let csvSource: CsvSource;
    if (source.stream) {
      csvSource = { type: 'stream', data: source.stream };
    } else if (source.url) {
      csvSource = { type: 'url', url: source.url };
    } else if (source.data !== undefined) {
      csvSource =
        typeof source.data === 'string'
          ? { type: 'string', data: source.data }
          : { type: 'buffer', data: source.data };
    } else {
      return err(
        domainError.validation({
          message: 'CSV source must have url, data, or stream',
          code: 'import.csv.invalid_source',
        })
      );
    }
    return this.parseStream(csvSource, options);
  }

  private async parseStream(
    source: CsvSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    const iterator = parseCsvRows(source, {
      delimiter: options?.delimiter,
      skipEmptyLines: true,
    });
    try {
      const first = await iterator.next();
      const headers = first.done ? [] : first.value;
      let pending = first.done ? undefined : first.value;
      const rowsAsync: AsyncIterableIterator<ReadonlyArray<unknown>> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (pending) {
            const row = pending;
            pending = undefined;
            return { done: false, value: row };
          }
          return iterator.next();
        },
        async return() {
          pending = undefined;
          return iterator.return(undefined);
        },
        async throw(error) {
          pending = undefined;
          return iterator.throw(error);
        },
      };
      return ok({ headers, rowsAsync });
    } catch (error) {
      await iterator.return(undefined);
      const failure = domainError.fromUnknown(error);
      if (failure.tags.includes('validation')) return err(failure);
      return err(
        domainError.infrastructure({
          message: `CSV parsing failed: ${failure.message}`,
          code:
            failure.code === 'csv.fetch_error'
              ? 'import.csv.fetch_failed'
              : 'import.csv.parse_failed',
        })
      );
    }
  }

  async analyze(
    source: IImportSource,
    options?: IImportOptions,
    previewRows = 500
  ): Promise<
    Result<
      {
        headers: ReadonlyArray<string>;
        sampleRows: ReadonlyArray<ReadonlyArray<unknown>>;
      },
      DomainError
    >
  > {
    const parseResult = await this.parse(source, options);
    if (parseResult.isErr()) return err(parseResult.error);

    const { headers, rows, rowsAsync } = parseResult.value;
    const sampleRows: unknown[][] = [];
    const skipFirstNLines = options?.skipFirstNLines ?? 1;
    let rowIndex = 0;

    for await (const row of rowsAsync ?? rows ?? []) {
      rowIndex++;
      if (rowIndex <= skipFirstNLines) continue;
      sampleRows.push([...row]);
      if (sampleRows.length >= previewRows) break;
    }

    return ok({ headers, sampleRows });
  }
}
