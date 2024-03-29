import { BadRequestException } from '@nestjs/common';
import { getUniqName, FieldType } from '@teable/core';
import { SUPPORTEDTYPE, importTypeMap } from '@teable/openapi';
import type { IValidateTypes, IAnalyzeVo } from '@teable/openapi';
import { zip, toString, intersection } from 'lodash';
import fetch from 'node-fetch';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ZodType } from 'zod';
import z from 'zod';

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

interface IImportConstructorParams {
  url: string;
  type: SUPPORTEDTYPE;
}

interface IParseResult {
  [x: string]: unknown[][];
}

export abstract class Importer {
  public static CHUNK_SIZE = 1024 * 1024 * 1;

  public static DEFAULT_COLUMN_TYPE: IValidateTypes = FieldType.SingleLineText;

  constructor(public config: IImportConstructorParams) {}

  abstract parse(
    ...args: [options?: unknown, cb?: (chunk: Record<string, unknown[][]>) => Promise<void>]
  ): Promise<IParseResult>;

  abstract getSupportedFieldTypes(): IValidateTypes[];

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
        `File format is not supported, only ${supportType.join(',')} are supported,`
      );
    }

    return stream;
  }

  async genColumns() {
    const supportTypes = this.getSupportedFieldTypes();
    const parseResult = await this.parse();
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
        name: sheetName,
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
  // order make sence
  public static readonly SUPPORTEDTYPE: IValidateTypes[] = [
    FieldType.Checkbox,
    FieldType.Number,
    FieldType.Date,
    FieldType.LongText,
    FieldType.SingleLineText,
  ];
  getSupportedFieldTypes() {
    return CsvImporter.SUPPORTEDTYPE;
  }

  parse(): Promise<IParseResult>;
  parse(
    options: Papa.ParseConfig & { skipFirstNLines: number; key: string },
    cb: (chunk: Record<string, unknown[][]>) => Promise<void>
  ): Promise<void>;
  async parse(
    ...args: [
      options?: Papa.ParseConfig & { skipFirstNLines: number; key: string },
      cb?: (chunk: Record<string, unknown[][]>) => Promise<void>,
    ]
  ): Promise<unknown> {
    const [options, cb] = args;
    const stream = await this.getFile();

    // chunk parse
    if (options && cb) {
      return new Promise((resolve, reject) => {
        let isFirst = true;
        Papa.parse(stream, {
          download: false,
          dynamicTyping: true,
          chunkSize: Importer.CHUNK_SIZE,
          chunk: (chunk, parser) => {
            (async () => {
              const newChunk = [...chunk.data] as unknown[][];
              if (isFirst && options.skipFirstNLines) {
                newChunk.splice(0, 1);
                isFirst = false;
              }
              parser.pause();
              await cb({ [CsvImporter.DEFAULT_SHEETKEY]: newChunk });
              parser.resume();
            })();
          },
          complete: () => {
            resolve({});
          },
          error: (err) => {
            reject(err);
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
    cb: (chunk: Record<string, unknown[][]>) => Promise<void>
  ): Promise<void>;

  async parse(
    options?: { skipFirstNLines: number; key: string },
    cb?: (chunk: Record<string, unknown[][]>) => Promise<void>
  ): Promise<unknown> {
    const fileSteam = await this.getFile();

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
          rej(e);
        });
      });

    const parseResult = await asyncRs(fileSteam);

    if (options && cb) {
      const { skipFirstNLines, key } = options;
      if (skipFirstNLines) {
        parseResult[key].splice(0, 1);
      }
      return await cb(parseResult);
    }

    return parseResult;
  }
  getSupportedFieldTypes() {
    return CsvImporter.SUPPORTEDTYPE;
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
