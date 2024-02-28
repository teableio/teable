import type { IValidateTypes } from '@teable/core';
import { getUniqName, FieldType, SUPPORTEDTYPE } from '@teable/core';
import { zip } from 'lodash';
import fetch from 'node-fetch';
import Papa from 'papaparse';
import type { ZodType } from 'zod';
import z from 'zod';

const validateZodSchemaMap: Record<IValidateTypes, ZodType> = {
  [FieldType.Checkbox]: z.boolean(),
  [FieldType.Date]: z.coerce.date(),
  [FieldType.Number]: z.number(),
  [FieldType.LongText]: z.string(),
};

export abstract class Importer {
  public static CHUNK_SIZE = 1024 * 1024 * 1;

  constructor(public config: { url: string }) {}

  // abstract getFile(): unknown;

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
      let validatingFieldTypes = [...supportTypes];
      for (let i = 0; i < column.length; i++) {
        if (validatingFieldTypes.length <= 1) {
          break;
        }

        // ignore empty value and first row causing first row as header
        if (column[i] === '' || column[i] == null || i === 0) {
          continue;
        }

        const matchTypes = validatingFieldTypes.filter((type) => {
          const schema = validateZodSchemaMap[type];
          return schema.safeParse(column[i]).success;
        });

        validatingFieldTypes = matchTypes;
      }

      // why do this, papa parser return data in first data add extra ·
      const name = getUniqName(column?.[0] ?? `Field ${index}`, existNames);

      existNames.push(name);

      return {
        type: validatingFieldTypes[0],
        name: name.toString(),
      };
    });
    return {
      calculatedColumnHeaders,
    };
  }
}

export class CsvImporter extends Importer {
  // order make sence
  public static readonly SUPPORTEDTYPE: IValidateTypes[] = [
    FieldType.Checkbox,
    FieldType.Number,
    FieldType.Date,
    FieldType.LongText,
  ];
  constructor(public config: { url: string }) {
    super(config);
  }
  getSupportedFieldTypes() {
    return CsvImporter.SUPPORTEDTYPE;
  }
  async parse(): Promise<unknown[]> {
    const { url } = this.config;
    return new Promise((resolve, reject) => {
      fetch(url).then((response) => {
        const stream = response.body;
        const data: Papa.ParseResult<unknown>['data'] = [];
        Papa.parse(stream, {
          download: false,
          dynamicTyping: true,
          preview: 2000,
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
    });
  }
  streamParse(
    options: Papa.ParseConfig & { skipFirstNLines: number },
    cb: (chunk: unknown[][]) => Promise<void>
  ) {
    const { url } = this.config;
    return new Promise((resolve, reject) => {
      fetch(url)
        .then((response) => {
          let isFirst = true;
          const stream = response.body;
          Papa.parse(stream, {
            download: false,
            dynamicTyping: true,
            chunkSize: Importer.CHUNK_SIZE,
            chunk: (chunk, parser) => {
              const newChunk = [...chunk.data] as unknown[][];
              if (isFirst && options.skipFirstNLines) {
                newChunk.splice(0, 1);
                isFirst = false;
              }
              parser.pause();
              cb(newChunk)
                .then(() => {
                  parser.resume();
                })
                .catch(() => {
                  parser.pause();
                });
            },
            complete: () => {
              resolve({});
            },
            error: (err) => {
              reject(err);
            },
          });
        })
        .catch((e) => {
          reject(e);
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
