import Papa from 'papaparse';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  domainError,
  type DomainError,
  type IImportSourceAdapter,
  type IImportOptions,
  type IImportParseResult,
  type IImportSource,
} from '@teable/v2-core';

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
    // URL source: return async iterator
    if (source.url) {
      return this.parseUrl(source.url, options);
    }

    // Data source: return sync iterator
    if (source.data !== undefined) {
      return this.parseData(source.data, options);
    }

    return err(
      domainError.validation({
        message: 'CSV source must have url or data',
        code: 'import.csv.invalid_source',
      })
    );
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

    if (rowsAsync) {
      for await (const row of rowsAsync) {
        rowIndex++;
        if (rowIndex <= skipFirstNLines) continue;
        sampleRows.push([...row]);
        if (sampleRows.length >= previewRows) break;
      }
    } else if (rows) {
      for (const row of rows) {
        rowIndex++;
        if (rowIndex <= skipFirstNLines) continue;
        sampleRows.push([...row]);
        if (sampleRows.length >= previewRows) break;
      }
    }

    return ok({ headers, sampleRows });
  }

  /** Parse URL */
  private async parseUrl(
    url: string,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return err(
          domainError.infrastructure({
            message: `Failed to fetch CSV: ${response.status}`,
            code: 'import.csv.fetch_failed',
          })
        );
      }

      const text = await response.text();
      return this.parseData(text, options);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `CSV parsing failed: ${error}`,
          code: 'import.csv.parse_failed',
        })
      );
    }
  }

  /** Create async row iterator */
  private async *createAsyncRowIterator(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    initialBuffer: string,
    decoder: TextDecoder,
    options?: IImportOptions
  ): AsyncIterable<ReadonlyArray<unknown>> {
    let buffer = initialBuffer;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process by line
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.trim()) {
          const result = Papa.parse(line, { delimiter: options?.delimiter });
          if (result.data[0]) {
            yield result.data[0] as unknown[];
          }
        }
      }
    }

    // Process last line
    const lastLine = buffer.replace(/\r$/, '');
    if (lastLine.trim()) {
      const result = Papa.parse(lastLine, { delimiter: options?.delimiter });
      if (result.data[0]) {
        yield result.data[0] as unknown[];
      }
    }
  }

  /** Parse data - return sync iterator */
  private async parseData(
    data: string | Uint8Array,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const result = Papa.parse(text, {
        delimiter: options?.delimiter,
        skipEmptyLines: true,
      });

      const allRows = result.data as string[][];
      const headers = allRows[0] ?? [];
      const dataRows = allRows;

      // Use generator for memory efficiency
      const rows = this.createRowsIterable(dataRows);

      return ok({ headers, rows });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `CSV parsing failed: ${error}`,
          code: 'import.csv.parse_failed',
        })
      );
    }
  }

  private *createRowsIterable(dataRows: string[][]): Iterable<ReadonlyArray<unknown>> {
    for (const row of dataRows) {
      yield row;
    }
  }

  private async *prependHeaderRow(
    headerRow: string[] | null,
    rowsAsync: AsyncIterable<ReadonlyArray<unknown>>
  ): AsyncIterable<ReadonlyArray<unknown>> {
    if (headerRow) {
      yield headerRow;
    }
    for await (const row of rowsAsync) {
      yield row;
    }
  }
}
