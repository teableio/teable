import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import {
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  formatDateToString,
} from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import { dataFieldCellValueSchema } from './date.field';

extend(timezone);

export const createdTimeFieldOptionsSchema = z
  .object({
    expression: z.literal('CREATED_TIME()'),
    formatting: datetimeFormattingSchema,
  })
  .strict();

export type ICreatedTimeFieldOptions = z.infer<typeof createdTimeFieldOptionsSchema>;

export const createdTimeFieldOptionsRoSchema = createdTimeFieldOptionsSchema.partial({
  expression: true,
});

export type ICreatedTimeFieldOptionsRo = z.infer<typeof createdTimeFieldOptionsRoSchema>;

export class CreatedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.CreatedTime;

  declare options: ICreatedTimeFieldOptions;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ICreatedTimeFieldOptions {
    return {
      expression: 'CREATED_TIME()',
      formatting: defaultDatetimeFormatting,
    };
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) return '';
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue as string);
  }

  item2String(item?: unknown) {
    return formatDateToString(item as string, this.options.formatting);
  }

  convertStringToCellValue(_value: string): null {
    return null;
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return createdTimeFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(dataFieldCellValueSchema).nonempty().nullable().safeParse(cellValue);
    }
    return dataFieldCellValueSchema.nullable().safeParse(cellValue);
  }
}
