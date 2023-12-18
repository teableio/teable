import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { datetimeFormattingSchema, defaultDatetimeFormatting } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

extend(timezone);

export const lastModifiedTimeFieldOptionsSchema = z.object({
  expression: z.literal('LAST_MODIFIED_TIME()'),
  formatting: datetimeFormattingSchema,
});

export type ILastModifiedTimeFieldOptions = z.infer<typeof lastModifiedTimeFieldOptionsSchema>;

export const lastModifiedTimeFieldOptionsRoSchema = lastModifiedTimeFieldOptionsSchema.omit({
  expression: true,
});

export type ILastModifiedTimeFieldOptionsRo = z.infer<typeof lastModifiedTimeFieldOptionsRoSchema>;

export class LastModifiedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.LastModifiedTime;

  declare options: ILastModifiedTimeFieldOptions;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ILastModifiedTimeFieldOptionsRo {
    return {
      formatting: defaultDatetimeFormatting,
    };
  }

  validateOptions() {
    return lastModifiedTimeFieldOptionsRoSchema.safeParse(this.options);
  }
}
