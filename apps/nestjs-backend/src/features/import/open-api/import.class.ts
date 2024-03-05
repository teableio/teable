import type { IValidateTypes } from '@teable/core';
import { getUniqName, FieldType, SUPPORTEDTYPE } from '@teable/core';
import { axios } from '@teable/openapi';
import { zip } from 'lodash';
import Papa from 'papaparse';
import type { ZodType } from 'zod';
import z from 'zod';

const validateZodSchemaMap: Record<IValidateTypes, ZodType> = {
  [FieldType.Checkbox]: z.boolean(),
  [FieldType.Date]: z.coerce.date(),
  [FieldType.Number]: z.number(),
  [FieldType.LongText]: z
    .string()
    .refine((value) => z.string().safeParse(value) && /\n/.test(value)),
  [FieldType.SingleLineText]: z.string(),
};

export abstract class Importer {
  public static CHUNK_SIZE = 1024 * 1024 * 1;

  public static DEFAULT_COLUMN_TYPE: IValidateTypes = FieldType.SingleLineText;

  constructor(public config: { url: string }) {}

  abstract getFile(): unknown;

  abstract parse(options?: unknown): Promise<unknown>;

  abstract streamParse(
    options: unknown,
    fn: (chunk: Papa.ParseResult<unknown>['data']) => Promise<void>
  ): void;

  abstract getSupportedFieldTypes(): IValidateTypes[];

  async genColumns() {
    const supportTypes = this.getSupportedFieldTypes();
    const columnInfo = (await this.parse()) as string[];
    const zipColumnInfo = zip(...columnInfo);
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
      validatingFieldTypes = !isColumnEmpty ? validatingFieldTypes : [Importer.DEFAULT_COLUMN_TYPE];

      const name = getUniqName(column?.[0] ?? `Field ${index}`, existNames);

      existNames.push(name);

      return {
        type: validatingFieldTypes[0] || Importer.DEFAULT_COLUMN_TYPE,
        name: name.toString(),
      };
    });
    return {
      worksheets: [
        {
          name: 'import table',
          columns: calculatedColumnHeaders,
        },
      ],
    };
  }
}

export class CsvImporter extends Importer {
  public static CHECK_LINES = 5000;
  // order make sence
  public static readonly SUPPORTEDTYPE: IValidateTypes[] = [
    FieldType.Checkbox,
    FieldType.Number,
    FieldType.Date,
    FieldType.LongText,
    FieldType.SingleLineText,
  ];
  constructor(public config: { url: string }) {
    super(config);
  }
  getSupportedFieldTypes() {
    return CsvImporter.SUPPORTEDTYPE;
  }
  async getFile() {
    const { url } = this.config;
    const { data: stream } = await axios.get(url, {
      responseType: 'stream',
    });
    return stream;
  }
  async parse(): Promise<unknown[]> {
    const stream = await this.getFile();
    const data: Papa.ParseResult<unknown>['data'] = [];
    return new Promise((resolve, reject) => {
      Papa.parse(stream, {
        download: false,
        dynamicTyping: true,
        preview: CsvImporter.CHECK_LINES,
        chunkSize: Importer.CHUNK_SIZE,
        chunk: (chunk) => {
          data.push(...chunk.data);
        },
        complete: () => {
          resolve(data);
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }
  async streamParse(
    options: Papa.ParseConfig & { skipFirstNLines: number },
    cb: (chunk: unknown[][]) => Promise<void>
  ) {
    const stream = await this.getFile();
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
            await cb(newChunk);
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
  }
}

export const importerFactory = (type: SUPPORTEDTYPE, config: { url: string }) => {
  switch (type) {
    case SUPPORTEDTYPE.CSV:
      return new CsvImporter(config);
    case SUPPORTEDTYPE.EXCEL:
      throw new Error('not support');
    default:
      throw new Error('not support');
  }
};
