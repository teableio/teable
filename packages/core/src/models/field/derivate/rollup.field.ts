import { z } from 'zod';
import { EvalVisitor } from '../../../formula/visitor';
import type { CellValueType, FieldType } from '../constant';
import type { FieldCore } from '../field';
import type { ILookupOptionsVo } from '../field.schema';
import {
  getDefaultFormatting,
  getFormattingSchema,
  timeZoneStringSchema,
  unionFormattingSchema,
} from '../formatting';
import { getShowAsSchema, unionShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

export const ROLLUP_FUNCTIONS = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'sum({values})',
  'max({values})',
  'min({values})',
  'and({values})',
  'or({values})',
  'xor({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
] as const;

export const rollupFieldOptionsSchema = z.object({
  expression: z.enum(ROLLUP_FUNCTIONS),
  timeZone: timeZoneStringSchema.optional(),
  formatting: unionFormattingSchema.optional(),
  showAs: unionShowAsSchema.optional(),
});

export type IRollupFieldOptions = z.infer<typeof rollupFieldOptionsSchema>;

export const rollupCelValueSchema = z.any();

export type IRollupCellValue = z.infer<typeof rollupCelValueSchema>;

export class RollupFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): IRollupFieldOptions {
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
    const tree = this.parse(expression);
    // nly need to perform shallow copy to generate virtual field to evaluate the expression
    const clonedInstance = new RollupFieldCore();
    clonedInstance.id = 'values';
    clonedInstance.name = 'values';
    clonedInstance.cellValueType = cellValueType;
    clonedInstance.isMultipleCellValue = isMultipleCellValue;
    // field type is not important here
    const visitor = new EvalVisitor({
      values: clonedInstance as FieldCore,
    });
    const typedValue = visitor.visit(tree);
    return {
      cellValueType: typedValue.type,
      isMultipleCellValue: typedValue.isMultiple,
    };
  }

  type!: FieldType.Rollup;

  declare options: IRollupFieldOptions;

  declare lookupOptions: ILookupOptionsVo;

  validateOptions() {
    return z
      .object({
        expression: rollupFieldOptionsSchema.shape.expression,
        formatting: getFormattingSchema(this.cellValueType),
        showAs: getShowAsSchema(this.cellValueType, this.isMultipleCellValue),
      })
      .safeParse(this.options);
  }
}
