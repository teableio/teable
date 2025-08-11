import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import type { FieldType, CellValueType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { defaultDatetimeFormatting } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import type {
  ILastModifiedTimeFieldOptions,
  ILastModifiedTimeFieldOptionsRo,
} from './last-modified-time-option.schema';
import { lastModifiedTimeFieldOptionsRoSchema } from './last-modified-time-option.schema';

extend(timezone);

export class LastModifiedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.LastModifiedTime;

  declare options: ILastModifiedTimeFieldOptions;

  meta?: undefined;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ILastModifiedTimeFieldOptionsRo {
    return {
      formatting: defaultDatetimeFormatting,
    };
  }

  validateOptions() {
    return lastModifiedTimeFieldOptionsRoSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLastModifiedTimeField(this);
  }
}
