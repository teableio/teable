import { existsSync } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import { getUniqName, FieldType, HttpErrorCode } from '@teable/core';
import type { IValidateTypes, IAnalyzeVo } from '@teable/openapi';
import { SUPPORTEDTYPE, importTypeMap } from '@teable/openapi';
import jschardet from 'jschardet';
import { zip, toString, intersection, chunk as chunkArray } from 'lodash';
import fetch from 'node-fetch';
import sizeof from 'object-sizeof';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { CustomHttpException } from '../../../custom.exception';
import { exceptionParse } from '../../../utils/exception-parse';
import { toLineDelimitedStream } from './delimiter-stream';

export const DEFAULT_IMPORT_CPU_USAGE = 0.5;

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
      return !isNaN(Number(value));
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

function flushSampleAsUtf8(sampleChunks: Buffer[], output: PassThrough, encoding: string) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  for (const buf of sampleChunks) {
    output.write(Buffer.from(decoder.decode(buf, { stream: true })));
  }
  return decoder;
}

/**
 * Detect the encoding of a stream by sampling the first N bytes,
 * then return a UTF-8 stream. If the source is already UTF-8/ASCII,
 * the original bytes are passed through with zero overhead.
 */
function createEncodingConvertStream(input: NodeJS.ReadableStream): NodeJS.ReadableStream {
  const output = new PassThrough();
  const sampleChunks: Buffer[] = [];
  let sampleSize = 0;
  let detected = false;

  input.on('data', (chunk: Buffer) => {
    if (detected) return;

    sampleChunks.push(chunk);
    sampleSize += chunk.length;

    if (sampleSize < encodingSampleSize) return;

    detected = true;
    const { isUtf8, encoding } = detectAndDecode(Buffer.concat(sampleChunks));

    if (isUtf8) {
      for (const buf of sampleChunks) output.write(buf);
      input.on('data', (c: Buffer) => output.write(c));
    } else {
      const decoder = flushSampleAsUtf8(sampleChunks, output, encoding);
      input.on('data', (c: Buffer) => {
        output.write(Buffer.from(decoder.decode(c, { stream: true })));
      });
      input.on('end', () => {
        const tail = decoder.decode();
        if (tail) output.write(Buffer.from(tail));
      });
    }
  });

  input.on('end', () => {
    if (!detected && sampleChunks.length > 0) {
      const sample = Buffer.concat(sampleChunks);
      const { isUtf8, encoding } = detectAndDecode(sample);

      if (isUtf8) {
        output.write(sample);
      } else {
        const decoder = new TextDecoder(encoding, { fatal: false });
        output.write(Buffer.from(decoder.decode(sample)));
      }
    }
    output.end();
  });

  input.on('error', (err) => output.destroy(err));

  return output;
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
  public static DEFAULT_ERROR_MESSAGE = 'unknown error';

  public static OVER_PLAN_ROW_COUNT_ERROR_MESSAGE = OVER_PLAN_ROW_COUNT_ERROR_MESSAGE;

  public static CHUNK_SIZE = 1024 * 1024 * 0.2;

  public static MAX_CHUNK_LENGTH = 500;

  public static DEFAULT_COLUMN_TYPE: IValidateTypes = FieldType.SingleLineText;

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

    const { body: stream, headers } = await fetch(url);

    const supportType = importTypeMap[type].accept.split(',');

    const fileFormat = headers
      .get('content-type')
      ?.split(';')
      ?.map((item: string) => item.trim());

    if (fileFormat?.length && !intersection(fileFormat, supportType).length) {
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
        contentDisposition.match(/filename\*=UTF-8''([^;]+)/) ||
        contentDisposition.match(/filename="?([^"]+)"?/);
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

  async genColumns() {
    const supportTypes = Importer.SUPPORTEDTYPE;
    const parseResult = await this.parse();
    const { fileName, type } = this.config;
    const result: IAnalyzeVo['worksheets'] = {};

    for (const [sheetName, cols] of Object.entries(parseResult)) {
      const zipColumnInfo = zip(...cols);
      const existNames: string[] = [];
      const calculatedColumnHeaders = zipColumnInfo
        .map((column, index) => {
          let isColumnEmpty = true;
          let validatingFieldTypes = [...supportTypes];
          for (let i = 0; i < column.length; i++) {
            if (validatingFieldTypes.length <= 1) {
              break;
            }

            // ignore empty value and first row causing first row as header
            if (column[i] === '' || column[i] == null || i === 0) {
              continue;
            }

            // when the whole columns aren't empty should flag
            isColumnEmpty = false;

            // when one of column's value validates long text, then break;
            if (validateZodSchemaMap[FieldType.LongText].safeParse(column[i]).success) {
              validatingFieldTypes = [FieldType.LongText];
              break;
            }

            const matchTypes = validatingFieldTypes.filter((type) => {
              const schema = validateZodSchemaMap[type];
              return schema.safeParse(column[i]).success;
            });

            validatingFieldTypes = matchTypes;
          }

          // empty columns should be default type
          validatingFieldTypes = !isColumnEmpty
            ? validatingFieldTypes
            : [Importer.DEFAULT_COLUMN_TYPE];

          const name = getUniqName(toString(column?.[0]).trim() || `Field ${index}`, existNames);

          existNames.push(name);

          return {
            type: validatingFieldTypes[0] || Importer.DEFAULT_COLUMN_TYPE,
            name: name.toString(),
          };
        })
        ?.filter((column) => Boolean(column));

      result[sheetName] = {
        name: type === SUPPORTEDTYPE.EXCEL ? sheetName : fileName ? fileName : sheetName,
        columns: calculatedColumnHeaders,
      };
    }

    return {
      worksheets: result,
    };
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

              if (this.config.maxRowCount && totalRowCount > this.config.maxRowCount) {
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
      });
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
      });
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
    });
  }
}

export class ExcelImporter extends Importer {
  public static readonly SUPPORTEDTYPE: IValidateTypes[] = [
    FieldType.Checkbox,
    FieldType.Number,
    FieldType.Date,
    FieldType.SingleLineText,
    FieldType.LongText,
  ];

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
    const { stream: fileSteam } = await this.getFile();

    const asyncRs = async (stream: NodeJS.ReadableStream): Promise<IParseResult> =>
      new Promise((res, rej) => {
        const buffers: Uint8Array[] = [];
        stream.on('data', function (data) {
          buffers.push(data);
        });
        stream.on('end', function () {
          const buf = Buffer.concat(buffers);
          const workbook = XLSX.read(buf, { dense: true });
          const result: IParseResult = {};
          Object.keys(workbook.Sheets).forEach((name) => {
            result[name] = workbook.Sheets[name]['!data']?.map((item) =>
              item.map((v) => v.w ?? v.v)
            ) as unknown[][];
          });
          res(result);
        });
        stream.on('error', (e) => {
          onError?.(e?.message || Importer.DEFAULT_ERROR_MESSAGE);
          rej(e);
        });
      });

    const parseResult = await asyncRs(fileSteam);

    if (options && chunk) {
      const { skipFirstNLines, key } = options;
      const chunks = parseResult[key];
      const parseResults = chunkArray(chunks, Importer.MAX_CHUNK_LENGTH);

      if (this.config.maxRowCount && chunks.length > this.config.maxRowCount) {
        onError?.(Importer.OVER_PLAN_ROW_COUNT_ERROR_MESSAGE);
        return;
      }

      for (let i = 0; i < parseResults.length; i++) {
        const currentChunk = parseResults[i];
        if (i === 0 && skipFirstNLines) {
          currentChunk.splice(0, 1);
        }
        const lastChunk = i === parseResults.length - 1;
        try {
          await chunk({ [key]: currentChunk }, lastChunk);
        } catch (e) {
          onError?.((e as Error)?.message || Importer.DEFAULT_ERROR_MESSAGE);
        }
      }
      onFinished?.();
    }

    return parseResult;
  }

  async getRawContent() {
    return await this.parse();
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
