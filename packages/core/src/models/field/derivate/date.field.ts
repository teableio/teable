import dayjs from 'dayjs';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export enum DateFormatting {
  YMDForIncline = 'YYYY/MM/DD',
  YMDForHorizontal = 'YYYY-MM-DD',
  DMY = 'DD/MM/YYYY',
  YM = 'YYYY-MM',
  MD = 'MM-DD',
  Y = 'YYYY',
  M = 'MM',
  D = 'DD',
}

export class DateFieldOptions {
  formatting!: DateFormatting;
  autoFill!: boolean;
}

export class DateFieldCore extends FieldCore {
  type!: FieldType.Date;

  options!: DateFieldOptions;

  defaultValue: string | null = null;

  cellValueType!: CellValueType.DateTime;

  static defaultOptions() {
    return {
      formatting: DateFormatting.YMDForIncline,
      autoFill: false,
    };
  }

  cellValue2String(cellValue: string) {
    if (cellValue == null) return '';
    return dayjs(cellValue).format(this.options.formatting);
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }
    return dayjs(value).toISOString();
  }

  repair(value: unknown) {
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateOptions() {
    return z
      .object({
        formatting: z.enum([
          DateFormatting.YMDForIncline,
          DateFormatting.YMDForHorizontal,
          DateFormatting.DMY,
          DateFormatting.YM,
          DateFormatting.MD,
          DateFormatting.Y,
          DateFormatting.M,
          DateFormatting.D,
        ]),
        autoFill: z.boolean(),
      })
      .optional()
      .safeParse(this.options);
  }

  validateDefaultValue() {
    return z.string().optional().nullable().safeParse(this.defaultValue);
  }
}
