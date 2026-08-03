import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import type { FieldType, CellValueType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { defaultDatetimeFormatting } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import type { IFormulaFieldMeta } from './formula-option.schema';
import type {
  ILastModifiedTimeFieldOptions,
  ILastModifiedTimeFieldOptionsRo,
} from './last-modified-time-option.schema';
import { lastModifiedTimeFieldOptionsRoSchema } from './last-modified-time-option.schema';

extend(timezone);

export class LastModifiedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.LastModifiedTime;

  declare options: ILastModifiedTimeFieldOptions;

  declare meta?: IFormulaFieldMeta;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ILastModifiedTimeFieldOptionsRo {
    return {
      formatting: defaultDatetimeFormatting,
      expression: 'LAST_MODIFIED_TIME()',
      trackedFieldIds: [],
    };
  }

  validateOptions() {
    return lastModifiedTimeFieldOptionsRoSchema.safeParse(this.options);
  }

  getExpression() {
    return this.options.expression;
  }

  getDatetimeFormatting() {
    return this.options?.formatting ?? defaultDatetimeFormatting;
  }

  getTrackedFieldIds(): string[] {
    return this.options?.trackedFieldIds ?? [];
  }

  isTrackAll(): boolean {
    const persistedAsGeneratedColumn = this.meta?.persistedAsGeneratedColumn;
    return persistedAsGeneratedColumn !== false && this.getTrackedFieldIds().length === 0;
  }

  shouldUpdate(changedFieldIds: Set<string>): boolean {
    const trackedFieldIds = this.getTrackedFieldIds();
    return this.isTrackAll() || trackedFieldIds.some((id) => changedFieldIds.has(id));
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLastModifiedTimeField(this);
  }
}
