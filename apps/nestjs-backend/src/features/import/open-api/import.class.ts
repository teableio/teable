import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { getUniqName, FieldType, HttpErrorCode } from '@teable/core';
import type { IValidateTypes, IAnalyzeVo } from '@teable/openapi';
import { SUPPORTEDTYPE, importTypeMap } from '@teable/openapi';
import type { IImportParseResult, IImportSource } from '@teable/v2-core';
import { ExcelImportAdapter, prepareExcelImportSource } from '@teable/v2-import';
import jschardet from 'jschardet';
import { toString, intersection } from 'lodash';
import sizeof from 'object-sizeof';
import Papa from 'papaparse';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { CustomHttpException } from '../../../custom.exception';
import { exceptionParse } from '../../../utils/exception-parse';
import { safeFetch } from '../../../utils/ssrf-http';
import { toLineDelimitedStream } from './delimiter-stream';

export const DEFAULT_IMPORT_CPU_USAGE = 0.5;

type ImportSheetAnalysis = {
  rowCount: number;
  columns: { header: unknown; candidates: IValidateTypes[]; hasValue: boolean }[];
};

export const parseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const lowered = value.replaceAll("'", '').replaceAll('"', '').toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }

  return Boolean(value);
};

/**
 * Whitelist of regex patterns for date-like strings.
 * Only values matching one of these patterns are considered for Date type detection.
 * Avoids false positives from JavaScript's lenient parsing (e.g. "CC-38716" → year 38716).
 */
const dateFormatPatterns: RegExp[] = [
  /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD (ISO date)
  /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?$/, // YYYY-MM-DD HH:mm:ss
  /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/, // ISO 8601 datetime
  /^\d{1,2}-\d{1,2}-\d{4}$/, // DD-MM-YYYY or MM-DD-YYYY
  /^\d{4}\/\d{1,2}\/\d{1,2}$/, // YYYY/MM/DD
  /^\d{1,2}\/\d{1,2}\/\d{4}$/, // MM/DD/YYYY (US)
  /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?$/, // MM/DD/YYYY HH:mm:ss (US)
];

const reasonableYearMin = 1;
const reasonableYearMax = 9999;
const invalidDateStr = 'Invalid Date';

function isValidDateForImport(value: unknown): boolean {
  if (value === '' || value == null) return false;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    const d = new Date(value);
    if (d.toString() === invalidDateStr) return false;
    const year = d.getFullYear();
    return year >= reasonableYearMin && year <= reasonableYearMax;
  }

  if (typeof value !== 'string') return false;

  const str = value.trim();
  if (!str) return false;
  if (!dateFormatPatterns.some((p) => p.test(str))) return false;

  const d = new Date(value);
  if (d.toString() === invalidDateStr) return false;

  const year = d.getFullYear();
  return year >= reasonableYearMin && year <= reasonableYearMax;
}

const validateZodSchemaMap: Record<IValidateTypes, ZodType> = {
  [FieldType.Checkbox]: z.union([z.string(), z.boolean()]).refine(
    (value: unknown) => {
      if (typeof value === 'boolean') {
        return true;
      }
      if (
        typeof value === 'string' &&
        (value.toLowerCase() === 'false' || value.toLowerCase() === 'true')
      ) {
        return true;
      }
      return false;
    },
    { message: 'Invalid checkbox value' }
  ),
  [FieldType.Date]: z.any().refine(isValidDateForImport, { message: 'Invalid date' }),
  [FieldType.Number]: z.any().refine(
    (value) => {
      return !Number.isNaN(Number(value));
    },
    { message: 'Invalid number' }
  ),
  [FieldType.LongText]: z
    .string()
    .refine((value) => z.string().safeParse(value) && /\n/.test(value), {
      message: 'Invalid long text',
    }),
  [FieldType.SingleLineText]: z.string(),
};

const encodingSampleSize = 64 * 1024; // 64KB for encoding detection

function isUtf8Compatible(encoding: string | null): boolean {
  const normalized = (encoding || 'utf-8').toLowerCase();
  return normalized === 'utf-8' || normalized === 'ascii';
}

function detectAndDecode(sample: Buffer): { isUtf8: boolean; encoding: string } {
  const { encoding } = jschardet.detect(sample);
  return { isUtf8: isUtf8Compatible(encoding), encoding: encoding || 'utf-8' };
}

/**
 * Detect the encoding of a stream by sampling the first N bytes,
 * then return a UTF-8 stream. If the source is already UTF-8/ASCII,
 * the original bytes are passed through with zero overhead.
 */
function createEncodingConvertStream(input: Readable): Transform {
  let sampleChunks: Buffer[] = [];
  let sampleSize = 0;
  let detected = false;
  let decoder: TextDecoder | undefined;
  const output = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (!detected) {
          sampleChunks.push(chunk);
          sampleSize += chunk.length;
          if (sampleSize < encodingSampleSize) {
            callback();
            return;
          }
          const sample = Buffer.concat(sampleChunks, sampleSize);
          const { isUtf8, encoding } = detectAndDecode(sample);
          decoder = isUtf8 ? undefined : new TextDecoder(encoding, { fatal: false });
          detected = true;
          sampleChunks = [];
          this.push(decoder ? Buffer.from(decoder.decode(sample, { stream: true })) : sample);
        } else {
          this.push(decoder ? Buffer.from(decoder.decode(chunk, { stream: true })) : chunk);
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (!detected && sampleSize > 0) {
          const sample = Buffer.concat(sampleChunks, sampleSize);
          const { isUtf8, encoding } = detectAndDecode(sample);
          this.push(isUtf8 ? sample : Buffer.from(new TextDecoder(encoding).decode(sample)));
          sampleChunks = [];
        } else if (decoder) {
          const remaining = decoder.decode();
          if (remaining) this.push(Buffer.from(remaining));
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  const forwardError = (error: Error) => output.destroy(error);
  input.once('error', forwardError);
  input.once('close', () => input.removeListener('error', forwardError));
  output.once('close', () => input.destroy());
  return input.pipe(output);
}

export interface IImportConstructorParams {
  url: string;
  type: SUPPORTEDTYPE;
  maxRowCount?: number;
  fileName?: string;
}

export interface IParseResult {
  [x: string]: unknown[][];
}

export const OVER_PLAN_ROW_COUNT_ERROR_MESSAGE = 'Please upgrade your plan to import more records';

export abstract class Importer {
  public static readonly DEFAULT_ERROR_MESSAGE = 'unknown error';

  public static readonly OVER_PLAN_ROW_COUNT_ERROR_MESSAGE = OVER_PLAN_ROW_COUNT_ERROR_MESSAGE;

  public static readonly CHUNK_SIZE = 1024 * 1024 * 0.2;

  public static readonly MAX_CHUNK_LENGTH = 500;

  public static readonly DEFAULT_COLUMN_TYPE: IValidateTypes = FieldType.SingleLineText;

  // order make sence
  public static readonly SUPPORTEDTYPE: IValidateTypes[] = [
    FieldType.Checkbox,
    FieldType.Number,
    FieldType.Date,
    FieldType.LongText,
    FieldType.SingleLineText,
  ];

  constructor(public config: IImportConstructorParams) {}

  abstract parse(
    ...args: [
      options?: unknown,
      chunk?: (
        chunk: Record<string, unknown[][]>,
        onFinished?: () => void,
        onError?: (errorMsg: string) => void
      ) => Promise<void>,
    ]
  ): Promise<IParseResult>;

  private setFileNameFromHeader(fileName: string) {
    this.config.fileName = fileName;
  }

  getConfig() {
    return this.config;
  }

  async getFile() {
    const { url: _url, type } = this.config;
    let url = _url.trim();
    if (!z.string().url().safeParse(url).success) {
      url = `http://localhost:${process.env.PORT}${url}`;
    }

    const { body, headers } = await safeFetch(url);
    // node-fetch returns a Node Readable; its v2 types expose only the narrower interface.
    const stream = body as Readable;

    const supportType = importTypeMap[type].accept.split(',');

    const fileFormat = headers
      .get('content-type')
      ?.split(';')
      ?.map((item: string) => item.trim());

    if (fileFormat?.length && !intersection(fileFormat, supportType).length) {
      stream.destroy();
      throw new CustomHttpException(
        `File format is not supported, only ${supportType.join(',')} are supported, your file's content type is ${fileFormat.join(';')}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.import.notSupportedFileFormat',
            context: {
              supportType: supportType.join(','),
              fileFormat: fileFormat?.join(';'),
            },
          },
        }
      );
    }

    const contentDisposition = headers.get('content-disposition');
    let fileName = 'Import Table.csv';

    if (contentDisposition) {
      const fileNameMatch =
        /filename\*=UTF-8''([^;]+)/.exec(contentDisposition) ||
        /filename="?([^"]+)"?/.exec(contentDisposition);
      if (fileNameMatch) {
        fileName = fileNameMatch[1];
      }
    }

    const finalFileName = fileName.split('.').shift() as string;

    this.setFileNameFromHeader(decodeURIComponent(finalFileName));

    // Only apply encoding conversion for text-based formats (CSV).
    // Binary formats like XLSX handle encoding internally and must not be
    // piped through a text decoder — doing so would corrupt the data.
    const finalStream =
      this.config.type === SUPPORTEDTYPE.CSV ? createEncodingConvertStream(stream) : stream;

    return { stream: finalStream, fileName: finalFileName };
  }

  protected async *analysisRows(): AsyncGenerator<{
    sheetName: string;
    row: ReadonlyArray<unknown>;
  }> {
    const parsed = await this.parse();
    for (const [sheetName, rows] of Object.entries(parsed)) {
      if (rows.length === 0) yield { sheetName, row: [] };
      for (const row of rows) yield { sheetName, row };
    }
  }

  async genColumns() {
    const sheets = new Map<string, ImportSheetAnalysis>();
    for await (const { sheetName, row } of this.analysisRows()) {
      let sheet = sheets.get(sheetName);
      if (!sheet) {
        sheet = { rowCount: 0, columns: [] };
        sheets.set(sheetName, sheet);
      }
      this.accumulateAnalysisRow(sheet, row);
    }

    const worksheets: IAnalyzeVo['worksheets'] = {};
    for (const [sheetName, sheet] of sheets) {
      const names: string[] = [];
      const columns = sheet.columns.map((column, index) => {
        const name = getUniqName(toString(column.header).trim() || `Field ${index}`, names);
        names.push(name);
        return {
          name,
          type: column.hasValue
            ? column.candidates[0] || Importer.DEFAULT_COLUMN_TYPE
            : Importer.DEFAULT_COLUMN_TYPE,
        };
      });
      worksheets[sheetName] = {
        name:
          this.config.type === SUPPORTEDTYPE.EXCEL ? sheetName : this.config.fileName || sheetName,
        columns,
      };
    }
    return { worksheets };
  }

  private accumulateAnalysisRow(sheet: ImportSheetAnalysis, row: ReadonlyArray<unknown>): void {
    for (let index = 0; index < row.length; index++) {
      const column = (sheet.columns[index] ??= {
        header: sheet.rowCount === 0 ? row[index] : undefined,
        candidates: [...Importer.SUPPORTEDTYPE],
        hasValue: false,
      });
      const value = row[index];
      if (sheet.rowCount === 0 || value === '' || value == null || column.candidates.length <= 1) {
        continue;
      }
      column.hasValue = true;
      if (validateZodSchemaMap[FieldType.LongText].safeParse(value).success) {
        column.candidates = [FieldType.LongText];
      } else {
        column.candidates = column.candidates.filter(
          (type) => validateZodSchemaMap[type].safeParse(value).success
        );
      }
    }
    sheet.rowCount++;
  }
}

export class CsvImporter extends Importer {
  public static readonly CHECK_LINES = 500;
  public static readonly DEFAULT_SHEETKEY = 'Import Table';

  parse(): Promise<IParseResult>;
  parse(
    options: Papa.ParseConfig & { skipFirstNLines: number; key: string },
    chunk: (chunk: Record<string, unknown[][]>, lastChunk?: boolean) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<void>;
  async parse(
    ...args: [
      options?: Papa.ParseConfig & { skipFirstNLines: number; key: string },
      chunkCb?: (chunk: Record<string, unknown[][]>, lastChunk?: boolean) => Promise<void>,
      onFinished?: () => void,
      onError?: (errorMsg: string) => void,
    ]
  ): Promise<unknown> {
    const [options, chunkCb, onFinished, onError] = args;
    const { stream } = await this.getFile();

    // reload function, having chunkCb support chunk, otherwise in one operation.
    if (options && chunkCb) {
      return new Promise((resolve, reject) => {
        let isFirst = true;
        let recordBuffer: unknown[][] = [];
        let isAbort = false;
        let totalRowCount = 0;

        Papa.parse(toLineDelimitedStream(stream), {
          download: false,
          dynamicTyping: false,
          chunk: (chunk, parser) => {
            (async () => {
              const newChunk = [...chunk.data] as unknown[][];
              if (isFirst && options.skipFirstNLines) {
                newChunk.splice(0, 1);
                isFirst = false;
              }

              recordBuffer.push(...newChunk);
              totalRowCount += newChunk.length;

              if (this.config.maxRowCount != null && totalRowCount > this.config.maxRowCount) {
                isAbort = true;
                recordBuffer = [];
                onError?.(Importer.OVER_PLAN_ROW_COUNT_ERROR_MESSAGE);
                parser.abort();
              }

              if (
                recordBuffer.length >= Importer.MAX_CHUNK_LENGTH ||
                sizeof(recordBuffer) > Importer.CHUNK_SIZE
              ) {
                parser.pause();
                try {
                  await chunkCb({ [CsvImporter.DEFAULT_SHEETKEY]: recordBuffer });
                } catch (e) {
                  isAbort = true;
                  recordBuffer = [];
                  const error = exceptionParse(e as Error);
                  onError?.(error?.message || Importer.DEFAULT_ERROR_MESSAGE);
                  parser.abort();
                }
                recordBuffer = [];
                parser.resume();
              }
            })();
          },
          complete: () => {
            (async () => {
              try {
                // whatever execute chunkCb, empty recordBuffer
                await chunkCb({ [CsvImporter.DEFAULT_SHEETKEY]: recordBuffer }, true);
              } catch (e) {
                isAbort = true;
                recordBuffer = [];
                const error = exceptionParse(e as Error);
                onError?.(error?.message || Importer.DEFAULT_ERROR_MESSAGE);
              }
              !isAbort && onFinished?.();
              resolve({});
            })();
          },
          error: (e) => {
            onError?.(e?.message || Importer.DEFAULT_ERROR_MESSAGE);
            reject(e);
          },
        });
      }).finally(() => stream.destroy());
    } else {
      return new Promise((resolve, reject) => {
        Papa.parse(stream, {
          download: false,
          dynamicTyping: true,
          preview: CsvImporter.CHECK_LINES,
          complete: (result) => {
            resolve({
              [CsvImporter.DEFAULT_SHEETKEY]: result.data,
            });
          },
          error: (err) => {
            reject(err);
          },
        });
      }).finally(() => stream.destroy());
    }
  }

  async getRawContent({ limit = CsvImporter.CHECK_LINES }: { limit?: number } = {}) {
    const { stream } = await this.getFile();
    return new Promise<IParseResult>((resolve, reject) => {
      Papa.parse(stream, {
        download: false,
        dynamicTyping: false,
        preview: limit,
        complete: (result) => {
          resolve({
            [CsvImporter.DEFAULT_SHEETKEY]: result.data,
          } as IParseResult);
        },
        error: (err) => {
          reject(err);
        },
      });
    }).finally(() => stream.destroy());
  }
}

export class ExcelImporter extends Importer {
  private readonly adapter = new ExcelImportAdapter();

  private async readSheet(
    source: IImportSource,
    sheetName?: string
  ): Promise<IImportParseResult & { rowsAsync: AsyncIterable<ReadonlyArray<unknown>> }> {
    const result = await this.adapter.parse(source, { sheetName });
    if (result.isErr()) throw new Error(result.error.message);
    const rowsAsync = result.value.rowsAsync;
    if (!rowsAsync) throw new Error('Excel parser did not provide streaming rows');
    return { ...result.value, rowsAsync };
  }

  private async checkRowLimit(rows: AsyncIterable<ReadonlyArray<unknown>>, limit: number) {
    const iterator = rows[Symbol.asyncIterator]();
    try {
      let count = 0;
      let next = await iterator.next();
      while (!next.done) {
        if (++count > limit) throw new Error(Importer.OVER_PLAN_ROW_COUNT_ERROR_MESSAGE);
        next = await iterator.next();
      }
    } finally {
      await iterator.return?.();
    }
  }

  private async *sheets(
    sheetName?: string,
    enforceRowLimit = false
  ): AsyncGenerator<{ name: string; rows: AsyncIterable<ReadonlyArray<unknown>> }> {
    const { stream } = await this.getFile();
    const preparedResult = await prepareExcelImportSource({ type: 'excel', stream });
    if (preparedResult.isErr()) throw new Error(preparedResult.error.message);
    const prepared = preparedResult.value;
    try {
      let parsed = await this.readSheet(prepared.source, sheetName);
      const names = sheetName ? [sheetName] : (parsed.sheets ?? []).map((sheet) => sheet.name);
      for (const [index, name] of names.entries()) {
        if (index > 0) {
          parsed = await this.readSheet(prepared.source, name);
        }
        if (enforceRowLimit && this.config.maxRowCount != null) {
          await this.checkRowLimit(parsed.rowsAsync, this.config.maxRowCount);
          parsed = await this.readSheet(prepared.source, name);
        }
        const iterator = parsed.rowsAsync[Symbol.asyncIterator]();
        try {
          yield { name, rows: { [Symbol.asyncIterator]: () => iterator } };
        } finally {
          await iterator.return?.();
        }
      }
    } finally {
      await prepared.dispose();
    }
  }

  protected async *analysisRows(): AsyncGenerator<{
    sheetName: string;
    row: ReadonlyArray<unknown>;
  }> {
    for await (const sheet of this.sheets()) {
      let hasRows = false;
      for await (const row of sheet.rows) {
        hasRows = true;
        yield { sheetName: sheet.name, row };
      }
      if (!hasRows) yield { sheetName: sheet.name, row: [] };
    }
  }
  private async preview(): Promise<IParseResult> {
    const preview: IParseResult = {};
    for await (const sheet of this.sheets()) {
      const rows: unknown[][] = [];
      for await (const row of sheet.rows) {
        rows.push([...row]);
        if (rows.length >= CsvImporter.CHECK_LINES) break;
      }
      preview[sheet.name] = rows;
    }
    return preview;
  }

  private async emitSheetBatches(
    sheet: { name: string; rows: AsyncIterable<ReadonlyArray<unknown>> },
    skipFirstNLines: number,
    chunk: (chunk: Record<string, unknown[][]>, lastChunk?: boolean) => Promise<void>
  ): Promise<void> {
    let rowIndex = 0;
    let batch: unknown[][] = [];
    let batchBytes = 0;
    for await (const row of sheet.rows) {
      if (rowIndex++ < skipFirstNLines) continue;
      if (batch.length >= Importer.MAX_CHUNK_LENGTH || batchBytes >= Importer.CHUNK_SIZE) {
        await chunk({ [sheet.name]: batch }, false);
        batch = [];
        batchBytes = 0;
      }
      batch.push([...row]);
      batchBytes += sizeof(row);
    }
    await chunk({ [sheet.name]: batch }, true);
  }

  parse(): Promise<IParseResult>;
  parse(
    options: { skipFirstNLines: number; key: string },
    chunk: (chunk: Record<string, unknown[][]>, lastChunk?: boolean) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<void>;
  async parse(
    options?: { skipFirstNLines: number; key: string },
    chunk?: (chunk: Record<string, unknown[][]>, lastChunk?: boolean) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<unknown> {
    if (!options || !chunk) return this.preview();

    try {
      for await (const sheet of this.sheets(options.key, true)) {
        await this.emitSheetBatches(sheet, options.skipFirstNLines, chunk);
      }
      onFinished?.();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : Importer.DEFAULT_ERROR_MESSAGE);
      if (!onError) throw error;
    }
  }
}

export const importerFactory = (type: SUPPORTEDTYPE, config: IImportConstructorParams) => {
  switch (type) {
    case SUPPORTEDTYPE.CSV:
      return new CsvImporter(config);
    case SUPPORTEDTYPE.EXCEL:
      return new ExcelImporter(config);
    default:
      throw new CustomHttpException(
        'Import file type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.import.notSupportedFileType',
          },
        }
      );
  }
};

export const getWorkerPath = (fileName: string) => {
  // there are two possible paths for worker
  const workerPath = join(__dirname, 'worker', `${fileName}.js`);
  const workerPath2 = join(process.cwd(), 'dist', 'worker', `${fileName}.js`);

  if (existsSync(workerPath)) {
    return workerPath;
  } else {
    return workerPath2;
  }
};
