import dayjs from 'dayjs';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export enum DateFormatting {
  YMDWithSlash = 'YYYY/MM/DD',
  YMDWithDash = 'YYYY-MM-DD',
  DMY = 'DD/MM/YYYY',
  YM = 'YYYY-MM',
  MD = 'MM-DD',
  Y = 'YYYY',
  M = 'MM',
  D = 'DD',
}

export enum TimeFormatting {
  Hour24 = 'HH:mm',
  Hour12 = 'hh:mm',
  None = 'None',
}

export class DateFieldOptions {
  dateFormatting!: DateFormatting;
  timeFormatting!: TimeFormatting;
  autoFill!: boolean;
  timeZone!: string;
}

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

export class DateFieldCore extends FieldCore {
  type!: FieldType.Date;

  options!: DateFieldOptions;

  defaultValue: string | number | null = null;

  cellValueType!: CellValueType.DateTime;

  static defaultOptions() {
    return {
      dateFormatting: DateFormatting.YMDWithSlash,
      timeFormatting: TimeFormatting.Hour24,
      timeZone: DEFAULT_TIME_ZONE,
      autoFill: false,
    };
  }

  cellValue2String(cellValue: string) {
    if (cellValue == null) return '';
    const { dateFormatting, timeFormatting } = this.options;
    const format =
      timeFormatting === TimeFormatting.None
        ? dateFormatting
        : `${dateFormatting} ${timeFormatting}`;
    return dayjs(cellValue).format(format);
  }

  convertStringToCellValue(value: string | number): string | null {
    if (value === '' || value == null) return null;
    const formatValue = dayjs(value);
    if (!formatValue.isValid()) return null;
    return formatValue.toISOString();
  }

  repair(value: unknown) {
    if (typeof value === 'string' || typeof value === 'number') {
      return this.convertStringToCellValue(value);
    }
    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateOptions() {
    return z
      .object({
        dateFormatting: z.enum([
          DateFormatting.YMDWithSlash,
          DateFormatting.YMDWithDash,
          DateFormatting.DMY,
          DateFormatting.YM,
          DateFormatting.MD,
          DateFormatting.Y,
          DateFormatting.M,
          DateFormatting.D,
        ]),
        timeFormatting: z.enum([TimeFormatting.Hour24, TimeFormatting.Hour12]),
        timeZone: z.string(),
        autoFill: z.boolean(),
      })
      .optional()
      .safeParse(this.options);
  }

  validateDefaultValue() {
    return z.union([z.string(), z.number()]).optional().nullable().safeParse(this.defaultValue);
  }
}
