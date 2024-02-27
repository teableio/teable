import axios from 'axios';
import { zip } from 'lodash';
import Papa from 'papaparse';
import type { ZodType } from 'zod';
import z from 'zod';
import { FieldType } from '../models';
import { getUniqName } from '../utils';
import { SUPPORTEDTYPE } from './types';
import type { IValidateTypes } from './types';

const validateZodSchemaMap: Record<IValidateTypes, ZodType> = {
  [FieldType.Checkbox]: z.boolean(),
  [FieldType.Date]: z.coerce.date(),
  [FieldType.Number]: z.number(),
  [FieldType.LongText]: z.string(),
};

export abstract class Importer {
  public static CHUNK_SIZE = 1024 * 1024 * 1;

  constructor(public config: { url: string }) {}

  abstract getFile(): unknown;

  abstract parse(options?: unknown): Promise<unknown>;

  abstract streamParse(
    options: unknown,
    fn: (chunk: Papa.ParseResult<unknown>['data']) => void
  ): void;

  abstract getSupportedFieldTypes(): IValidateTypes[];

  async generateColumnInfo() {
    const supportTypes = this.getSupportedFieldTypes();
    const columnInfo = (await this.parse({ preview: 2000 })) as string[];
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

  async generatePreWriteData() {
    return await this.parse();
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
  async getFile() {
    const result = await axios.get(this.config.url, { responseType: 'stream' });
    return result.data;
  }
  async parse(options: Papa.ParseConfig) {
    const fileStream = await this.getFile();
    return await new Promise((resolve, reject) => {
      Papa.parse(fileStream, {
        header: false,
        dynamicTyping: true,
        complete: function (results) {
          resolve(results.data);
        },
        error: (error) => {
          reject(error);
        },
        ...options,
      });
    });
  }
  async streamParse(
    options: Papa.ParseConfig & { skipFirstNLines: number },
    cb: (chunk: Papa.ParseResult<string>['data']) => void
  ) {
    const fileStream = await this.getFile();
    let isFirst = false;
    return await new Promise((resolve, reject) => {
      Papa.parse(fileStream, {
        header: false,
        dynamicTyping: true,
        complete: function (results) {
          resolve(results);
        },
        error: (error) => {
          reject(error);
        },
        chunkSize: Importer.CHUNK_SIZE,
        chunk: (result) => {
          // papaparse skipFirstNLines does't work hack it
          const newResult = [...result.data];
          if (options.skipFirstNLines && !isFirst) {
            isFirst = true;
            newResult.splice(0, 1);
          }

          cb(newResult);
        },
        ...options,
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
