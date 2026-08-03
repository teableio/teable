import type { IFilter } from '../../view/filter';
import type { CellValueType, FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { getDefaultFormatting, getFormattingSchema } from '../formatting';
import { getShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import {
  conditionalRollupFieldOptionsSchema,
  type IConditionalRollupFieldOptions,
} from './conditional-rollup-option.schema';
import { ROLLUP_FUNCTIONS } from './rollup-option.schema';
import { RollupFieldCore } from './rollup.field';

export class ConditionalRollupFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): Partial<IConditionalRollupFieldOptions> {
    return {
      expression: ROLLUP_FUNCTIONS[0],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone as string,
      formatting: getDefaultFormatting(cellValueType),
    };
  }

  static getParsedValueType(
    expression: string,
    cellValueType: CellValueType,
    isMultipleCellValue: boolean
  ) {
    return RollupFieldCore.getParsedValueType(expression, cellValueType, isMultipleCellValue);
  }

  type!: FieldType.ConditionalRollup;

  declare options: IConditionalRollupFieldOptions;

  meta?: undefined;

  override getFilter(): IFilter | undefined {
    return this.options?.filter ?? undefined;
  }

  static supportsOrdering(expression?: string): boolean {
    if (!expression) return false;
    const match = expression.match(/^(\w+)\(\{values\}\)$/i);
    if (!match) return false;
    switch (match[1].toLowerCase()) {
      case 'array_join':
      case 'array_compact':
      case 'array_unique':
      case 'concatenate':
        return true;
      default:
        return false;
    }
  }

  validateOptions() {
    return conditionalRollupFieldOptionsSchema
      .extend({
        formatting: getFormattingSchema(this.cellValueType),
        showAs: getShowAsSchema(this.cellValueType, this.isMultipleCellValue),
      })
      .safeParse(this.options);
  }

  getForeignTableId(): string | undefined {
    return this.options?.foreignTableId;
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitConditionalRollupField(this);
  }
}
