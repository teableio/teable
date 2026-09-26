import {
  domainError,
  type DomainError,
  type IImportSourceAdapter,
  type IImportOptions,
  type IImportParseResult,
  type IImportSource,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { BiffWorkbook } from './excel/BiffWorkbook';
import { DiskFile } from './excel/DiskStringTable';
import { HtmlWorkbook } from './excel/HtmlWorkbook';
import {
  excelError,
  TemporaryWorkbook,
  type PhysicalExcelRow,
  type StreamingWorkbook,
} from './excel/TemporaryWorkbook';
import { XmlWorkbook } from './excel/XmlWorkbook';
import { ZipWorkbook } from './excel/ZipWorkbook';

const excelHeaderScanRows = 30;

async function openWorkbook(owner: TemporaryWorkbook): Promise<StreamingWorkbook> {
  const file = new DiskFile(owner.path, owner);
  const signature = file.read(0, Math.min(file.size, 512));
  file.close();
  if (signature[0] === 0x50 && signature[1] === 0x4b) return ZipWorkbook.open(owner);
  const encoding =
    signature[0] === 0xff && signature[1] === 0xfe
      ? 'utf-16le'
      : signature[0] === 0xfe && signature[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  const text = new TextDecoder(encoding).decode(signature).trimStart();
  if (/<(?:\w+:)?Workbook\b/i.test(text)) return XmlWorkbook.open(owner);
  if (/<(?:!doctype\s+html|html|table)\b/i.test(text)) return HtmlWorkbook.open(owner);
  if (text.startsWith('<')) return XmlWorkbook.open(owner);
  return BiffWorkbook.open(owner);
}

async function scanHeader(physical: AsyncIterator<PhysicalExcelRow>) {
  const prefix: PhysicalExcelRow[] = [];
  let header: PhysicalExcelRow | undefined;
  let filled = 0;
  let next = await physical.next();
  while (!next.done) {
    prefix.push(next.value);
    if (next.value.index >= excelHeaderScanRows) break;
    const count = next.value.values.reduce((sum, value) => sum + (value?.trim() ? 1 : 0), 0);
    if (count > filled) {
      filled = count;
      header = next.value;
    }
    next = await physical.next();
  }
  return { prefix, header, exhausted: next.done === true };
}

async function* remainingRows(
  physical: AsyncIterator<PhysicalExcelRow>,
  prefix: PhysicalExcelRow[],
  start: number,
  exhausted: boolean
): AsyncGenerator<PhysicalExcelRow> {
  while (prefix.length) {
    // The fixed header window releases each consumed row immediately.
    const row = prefix.shift()!;
    if (row.index >= start) yield row;
  }
  while (!exhausted) {
    const next = await physical.next();
    if (next.done) break;
    yield next.value;
  }
}

async function* paddedRows(
  owner: TemporaryWorkbook,
  physical: AsyncIterator<PhysicalExcelRow>,
  prefix: PhysicalExcelRow[],
  start: number,
  width: number,
  exhausted: boolean
): AsyncGenerator<ReadonlyArray<unknown>> {
  let index = start;
  try {
    for await (const row of remainingRows(physical, prefix, start, exhausted)) {
      while (index < row.index) {
        yield Array<string>(width).fill('');
        index++;
      }
      yield Array.from({ length: width }, (_, column) => row.values[column] ?? '');
      index = row.index + 1;
    }
  } finally {
    await owner.close();
  }
}

function ownedRows(
  owner: TemporaryWorkbook,
  rows: AsyncGenerator<ReadonlyArray<unknown>>
): AsyncIterableIterator<ReadonlyArray<unknown>> {
  // Generator finally does not run when return() precedes the first next().
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => rows.next(),
    async return() {
      try {
        return await rows.return(undefined);
      } finally {
        await owner.close();
      }
    },
    async throw(cause) {
      try {
        return await rows.throw(cause);
      } finally {
        await owner.close();
      }
    },
  };
}

async function sheetRows(
  owner: TemporaryWorkbook,
  workbook: StreamingWorkbook,
  target: string
): Promise<Pick<IImportParseResult, 'headers' | 'rowsAsync' | 'rowCount'>> {
  const physical = workbook.rows(target)[Symbol.asyncIterator]();
  owner.own(async () => {
    await physical.return?.();
  });
  const { prefix, header, exhausted } = await scanHeader(physical);
  if (!header) {
    await owner.close();
    return {
      headers: [],
      rowsAsync: {
        async *[Symbol.asyncIterator]() {
          yield* [];
        },
      },
      rowCount: 0,
    };
  }
  const headers = Array.from(
    { length: header.values.length },
    (_, index) => header.values[index] || `Column_${index + 1}`
  );
  const rowCount = exhausted ? prefix[prefix.length - 1].index - header.index + 1 : undefined;
  return {
    headers,
    rowCount,
    rowsAsync: ownedRows(
      owner,
      paddedRows(owner, physical, prefix, header.index, headers.length, exhausted)
    ),
  };
}

/** Rows, shared strings and source bytes are never retained as a workbook in memory. */
export class ExcelImportAdapter implements IImportSourceAdapter {
  readonly supportedTypes = ['xlsx', 'xls', 'excel'] as const;

  supports(type: string): boolean {
    return (this.supportedTypes as readonly string[]).includes(type);
  }

  async parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>> {
    let owner: TemporaryWorkbook | undefined;
    try {
      owner = await TemporaryWorkbook.open(source);
      const workbook = await openWorkbook(owner);
      const sheets = workbook.sheets.map(({ name, index }) => ({ name, index }));
      if (!sheets.length) {
        await owner.close();
        return err(
          domainError.validation({
            message: 'Excel file has no sheets',
            code: 'import.excel.no_sheets',
          })
        );
      }
      const currentSheet = options?.sheetName ?? sheets[0].name;
      if (!sheets.some((sheet) => sheet.name === currentSheet)) {
        await owner.close();
        return err(
          domainError.validation({
            message: `Sheet "${currentSheet}" not found`,
            code: 'import.excel.sheet_not_found',
          })
        );
      }
      return ok({ ...(await sheetRows(owner, workbook, currentSheet)), sheets, currentSheet });
    } catch (cause) {
      await owner?.close();
      return err(excelError(cause));
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
    const parsed = await this.parse(source, options);
    if (parsed.isErr()) return err(parsed.error);
    const { headers, rowsAsync, sheets } = parsed.value;
    const sampleRows: unknown[][] = [];
    const skip = options?.skipFirstNLines ?? 1;
    let index = 0;
    try {
      if (rowsAsync && previewRows > 0) {
        for await (const row of rowsAsync) {
          if (index++ < skip) continue;
          sampleRows.push([...row]);
          if (sampleRows.length >= previewRows) break;
        }
      } else await rowsAsync?.[Symbol.asyncIterator]().return?.();
      return ok({ headers, sampleRows, sheets: sheets ?? [] });
    } catch (cause) {
      return err(excelError(cause));
    }
  }
}
