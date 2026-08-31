import {
  domainError,
  type DomainError,
  type IImportSourceAdapter,
  type IImportOptions,
  type IImportParseResult,
  type IImportSource,
} from '@teable/v2-core';
import { safeFetch } from '@teable/v2-utils';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import Papa from 'papaparse';

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
    if (source.stream) {
      return this.parseData(await collectAsyncText(source.stream), options);
    }

    if (source.url) {
      return this.parseUrl(source.url, options);
    }

    if (source.data !== undefined) {
      return this.parseData(source.data, options);
    }

    return err(
      domainError.validation({
        message: 'CSV source must have url, data, or stream',
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
      const response = await safeFetch(url);
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

      return ok({ headers, rows, rowCount: dataRows.length });
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
}

const collectAsyncText = async (stream: AsyncIterable<Uint8Array | string>): Promise<string> => {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) {
    text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
};
