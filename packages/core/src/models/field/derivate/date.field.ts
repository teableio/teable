import dayjs from 'dayjs';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { datetimeFormattingDef, defaultDatetimeFormatting, TimeFormatting } from '../formatting';

export const dateFieldOptionsDef = z.object({
  formatting: datetimeFormattingDef,
  autoFill: z.boolean(),
});

export type IDateFieldOptions = z.infer<typeof dateFieldOptionsDef>;

export class DateFieldCore extends FieldCore {
  type!: FieldType.Date;

  options!: IDateFieldOptions;

  defaultValue: string | number | null = null;

  cellValueType!: CellValueType.DateTime;

  static defaultOptions(): IDateFieldOptions {
    return {
      formatting: defaultDatetimeFormatting,
      autoFill: false,
    };
  }

  cellValue2String(cellValue: string) {
    if (cellValue == null) return '';
    const { date, time } = this.options.formatting;
    const format = time === TimeFormatting.None ? date : `${date} ${time}`;
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
    return dateFieldOptionsDef.safeParse(this.options);
  }

  validateDefaultValue() {
    return z.union([z.string(), z.number()]).optional().nullable().safeParse(this.defaultValue);
  }
}
