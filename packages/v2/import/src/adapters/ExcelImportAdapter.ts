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
import * as XLSX from 'xlsx';

type DenseCell = { w?: string; v?: unknown };
type DenseRow = Array<DenseCell | undefined> | undefined;

const excelHeaderScanRows = 30;
const excelWorkbookCache = new WeakMap<Uint8Array, XLSX.WorkBook>();

const denseCellToString = (cell: DenseCell | undefined): string => {
  if (!cell) {
    return '';
  }
  const value = cell.w ?? cell.v;
  return value == null ? '' : String(value);
};

const filledCellCount = (row: DenseRow): number =>
  (row ?? []).reduce(
    (count, cell) => (denseCellToString(cell).trim() === '' ? count : count + 1),
    0
  );

const findExcelHeaderRowIndex = (rows: ReadonlyArray<DenseRow>): number => {
  const scanUntil = Math.min(rows.length, excelHeaderScanRows);
  let bestIndex = -1;
  let bestCount = 0;
  for (let index = 0; index < scanUntil; index++) {
    const count = filledCellCount(rows[index]);
    if (count > bestCount) {
      bestCount = count;
      bestIndex = index;
    }
  }
  return bestIndex;
};

const readDenseSheetRows = (sheet: XLSX.WorkSheet): Array<DenseRow> => {
  const dataProp = (sheet as { ['!data']?: unknown })['!data'];
  if (Array.isArray(dataProp) && dataProp.length > 0) {
    return dataProp as Array<DenseRow>;
  }
  if (Array.isArray(sheet)) {
    return sheet as Array<DenseRow>;
  }
  return [];
};

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

      const workbook = this.readWorkbook(buffer.value);
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

      // SheetJS dense sheets are the row array itself; 0.20+ also exposes the
      // same rows on `!data`. Used ranges that start below A1 leave a hole at
      // index 0, so headers cannot be taken from rawData[0].
      const rawData = readDenseSheetRows(sheet);
      const headerRowIndex = findExcelHeaderRowIndex(rawData);

      if (headerRowIndex < 0) {
        return ok({
          headers: [],
          rows: [],
          rowCount: 0,
          sheets: sheetNames.map((name, index) => ({ name, index })),
          currentSheet: targetSheet,
        });
      }

      const headerRow = rawData[headerRowIndex] ?? [];
      const headers = Array.from(
        { length: headerRow.length },
        (_, i) => denseCellToString(headerRow[i]) || `Column_${i + 1}`
      );

      // Include the detected header row so callers can skip it via useFirstRowAsHeader.
      const rows = this.createRowsIterable(rawData, headerRowIndex, headers.length);

      return ok({
        headers,
        rows,
        rowCount: Math.max(rawData.length - headerRowIndex, 0),
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

  private readWorkbook(buffer: Uint8Array): XLSX.WorkBook {
    const cached = excelWorkbookCache.get(buffer);
    if (cached) {
      return cached;
    }
    const workbook = XLSX.read(buffer, { type: 'array', dense: true });
    excelWorkbookCache.set(buffer, workbook);
    return workbook;
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
        const response = await safeFetch(source.url);
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
    rawData: ReadonlyArray<DenseRow>,
    startIndex: number,
    columnCount: number
  ): Iterable<ReadonlyArray<unknown>> {
    for (let i = startIndex; i < rawData.length; i++) {
      const row = rawData[i] ?? [];
      const values = Array.from({ length: columnCount }, (_, index) =>
        denseCellToString(row[index])
      );
      yield values;
    }
  }
}
