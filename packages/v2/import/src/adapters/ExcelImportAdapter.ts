import * as XLSX from 'xlsx';
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
 * Excel Import Adapter
 * Supports XLSX, XLS files
 */
export class ExcelImportAdapter implements IImportSourceAdapter {
  readonly supportedTypes = ['xlsx', 'xls', 'excel'] as const;

  supports(type: string): boolean {
    return (this.supportedTypes as readonly string[]).includes(type);
  }

  async parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    try {
      const buffer = await this.getBuffer(source);
      if (buffer.isErr()) return err(buffer.error);

      const workbook = XLSX.read(buffer.value, { dense: true });
      const sheetNames = workbook.SheetNames;

      if (sheetNames.length === 0) {
        return err(
          domainError.validation({
            message: 'Excel file has no sheets',
            code: 'import.excel.no_sheets',
          })
        );
      }

      const targetSheet = options?.sheetName ?? sheetNames[0];
      const sheet = workbook.Sheets[targetSheet];

      if (!sheet) {
        return err(
          domainError.validation({
            message: `Sheet "${targetSheet}" not found`,
            code: 'import.excel.sheet_not_found',
          })
        );
      }

      const rawData = (sheet['!data'] ?? []) as Array<Array<{ w?: string; v?: unknown }>>;

      if (rawData.length === 0) {
        return ok({
          headers: [],
          rows: [],
          sheets: sheetNames.map((name, index) => ({ name, index })),
          currentSheet: targetSheet,
        });
      }

      const headerRow = rawData[0] ?? [];
      const headers = headerRow.map((cell, i) => String(cell?.w ?? cell?.v ?? `Column_${i + 1}`));

      // Use generator for memory efficiency (include header row)
      const rows = this.createRowsIterable(rawData, 0);

      return ok({
        headers,
        rows,
        sheets: sheetNames.map((name, index) => ({ name, index })),
        currentSheet: targetSheet,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Excel parsing failed: ${error}`,
          code: 'import.excel.parse_failed',
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
        sheets: ReadonlyArray<{ name: string; index: number }>;
      },
      DomainError
    >
  > {
    const parseResult = await this.parse(source, options);
    if (parseResult.isErr()) return err(parseResult.error);

    const { headers, rows, sheets } = parseResult.value;
    const sampleRows: unknown[][] = [];
    const skipFirstNLines = options?.skipFirstNLines ?? 1;
    let rowIndex = 0;

    if (rows) {
      for (const row of rows) {
        rowIndex++;
        if (rowIndex <= skipFirstNLines) continue;
        sampleRows.push([...row]);
        if (sampleRows.length >= previewRows) break;
      }
    }

    return ok({
      headers,
      sampleRows,
      sheets: sheets ?? [],
    });
  }

  private async getBuffer(source: IImportSource): Promise<Result<Uint8Array, DomainError>> {
    if (source.data) {
      if (typeof source.data === 'string') {
        return ok(new TextEncoder().encode(source.data));
      }
      return ok(source.data);
    }

    if (source.url) {
      try {
        const response = await fetch(source.url);
        if (!response.ok) {
          return err(
            domainError.infrastructure({
              message: `Failed to fetch Excel: ${response.status}`,
              code: 'import.excel.fetch_failed',
            })
          );
        }
        return ok(new Uint8Array(await response.arrayBuffer()));
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `Failed to download Excel: ${error}`,
            code: 'import.excel.download_failed',
          })
        );
      }
    }

    if (source.stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of source.stream) {
        if (typeof chunk === 'string') {
          chunks.push(new TextEncoder().encode(chunk));
        } else {
          chunks.push(chunk);
        }
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return ok(result);
    }

    return err(
      domainError.validation({
        message: 'Excel source must have url, stream, or data',
        code: 'import.excel.invalid_source',
      })
    );
  }

  private *createRowsIterable(
    rawData: Array<Array<{ w?: string; v?: unknown }>>,
    startIndex: number
  ): Iterable<ReadonlyArray<unknown>> {
    for (let i = startIndex; i < rawData.length; i++) {
      const row = rawData[i] ?? [];
      yield row.map((cell) => cell?.w ?? cell?.v ?? '');
    }
  }
}
