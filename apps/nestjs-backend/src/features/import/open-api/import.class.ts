import { existsSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { getUniqName, FieldType } from '@teable/core';
import type { IValidateTypes, IAnalyzeVo } from '@teable/openapi';
import { SUPPORTEDTYPE, importTypeMap } from '@teable/openapi';
import { zip, toString, intersection, chunk as chunkArray } from 'lodash';
import fetch from 'node-fetch';
import sizeof from 'object-sizeof';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ZodType } from 'zod';
import z from 'zod';
import { exceptionParse } from '../../../utils/exception-parse';
import { toLineDelimitedStream } from './delimiter-stream';

const validateZodSchemaMap: Record<IValidateTypes, ZodType> = {
  [FieldType.Checkbox]: z.union([z.string(), z.boolean()]).refine((value: unknown) => {
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
  }),
  [FieldType.Date]: z.coerce.date(),
  [FieldType.Number]: z.coerce.number(),
  [FieldType.LongText]: z
    .string()
    .refine((value) => z.string().safeParse(value) && /\n/.test(value)),
  [FieldType.SingleLineText]: z.string(),
};

export interface IImportConstructorParams {
  url: string;
  type: SUPPORTEDTYPE;
  maxRowCount?: number;
  fileName?: string;
}

interface IParseResult {
  [x: string]: unknown[][];
}

export abstract class Importer {
  public static DEFAULT_ERROR_MESSAGE = 'unknown error';

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
    const { url, type } = this.config;
    const { body: stream, headers } = await fetch(url);

    const supportType = importTypeMap[type].accept.split(',');

    const fileFormat = headers
      .get('content-type')
      ?.split(';')
      ?.map((item: string) => item.trim());

    // if (!fileFormat?.length) {
    //   throw new BadRequestException(
    //     `Input url is not a standard document service without right content-type`
    //   );
    // }

    if (fileFormat?.length && !intersection(fileFormat, supportType).length) {
      throw new BadRequestException(
        `File format is not supported, only ${supportType.join(',')} are supported, your file's content type is ${fileFormat.join(';')}`
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

    return { stream, fileName: finalFileName };
  }

  async genColumns() {
    const supportTypes = Importer.SUPPORTEDTYPE;
    const parseResult = await this.parse();
    const { fileName, type } = this.config;
    const result: IAnalyzeVo['worksheets'] = {};

    for (const [sheetName, cols] of Object.entries(parseResult)) {
      const zipColumnInfo = zip(...cols);
      const existNames: string[] = [];
      const calculatedColumnHeaders = zipColumnInfo.map((column, index) => {
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
      });

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
  public static readonly CHECK_LINES = 5000;
  public static readonly DEFAULT_SHEETKEY = 'Import Table';

  parse(): Promise<IParseResult>;
  parse(
    options: Papa.ParseConfig & { skipFirstNLines: number; key: string },
    chunk: (chunk: Record<string, unknown[][]>) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<void>;
  async parse(
    ...args: [
      options?: Papa.ParseConfig & { skipFirstNLines: number; key: string },
      chunkCb?: (chunk: Record<string, unknown[][]>) => Promise<void>,
      onFinished?: () => void,
      onError?: (errorMsg: string) => void,
    ]
  ): Promise<unknown> {
    const [options, chunkCb, onFinished, onError] = args;
    const { stream } = await this.getFile();

    // chunk parse
    if (options && chunkCb) {
      return new Promise((resolve, reject) => {
        let isFirst = true;
        let recordBuffer: unknown[][] = [];
        let isAbort = false;
        let totalRowCount = 0;

        // TODO optimize toLineDelimitedStream slow down the import speed.
        Papa.parse(toLineDelimitedStream(stream), {
          download: false,
          dynamicTyping: true,
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
                onError?.('please upgrade your plan to import more records');
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
                recordBuffer.length &&
                  (await chunkCb({ [CsvImporter.DEFAULT_SHEETKEY]: recordBuffer }));
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
    chunk: (chunk: Record<string, unknown[][]>) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<void>;

  async parse(
    options?: { skipFirstNLines: number; key: string },
    chunk?: (chunk: Record<string, unknown[][]>) => Promise<void>,
    onFinished?: () => void,
    onError?: (errorMsg: string) => void
  ): Promise<unknown> {
    const { stream: fileSteam } = await this.getFile();

    const asyncRs = async (stream: NodeJS.ReadableStream): Promise<IParseResult> =>
      new Promise((res, rej) => {
        const buffers: Buffer[] = [];
        stream.on('data', function (data) {
          buffers.push(data);
        });
        stream.on('end', function () {
          const buf = Buffer.concat(buffers);
          const workbook = XLSX.read(buf, { dense: true });
          const result: IParseResult = {};
          Object.keys(workbook.Sheets).forEach((name) => {
            result[name] = workbook.Sheets[name]['!data']?.map((item) =>
              item.map((v) => v.w)
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
        onError?.('Please upgrade your plan to import more records');
        return;
      }

      for (let i = 0; i < parseResults.length; i++) {
        const currentChunk = parseResults[i];
        if (i === 0 && skipFirstNLines) {
          currentChunk.splice(0, 1);
        }
        try {
          await chunk({ [key]: currentChunk });
        } catch (e) {
          onError?.((e as Error)?.message || Importer.DEFAULT_ERROR_MESSAGE);
        }
      }
      onFinished?.();
    }

    return parseResult;
  }
}

export const importerFactory = (type: SUPPORTEDTYPE, config: IImportConstructorParams) => {
  switch (type) {
    case SUPPORTEDTYPE.CSV:
      return new CsvImporter(config);
    case SUPPORTEDTYPE.EXCEL:
      return new ExcelImporter(config);
    default:
      throw new Error('not support');
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
