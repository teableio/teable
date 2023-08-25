import { instanceToInstance } from 'class-transformer';
import { z } from 'zod';
import { EvalVisitor } from '../../../formula/visitor';
import type { CellValueType, FieldType } from '../constant';
import { Relationship } from '../constant';
import type { FieldCore } from '../field';
import type { ILookupOptionsVo } from '../field.schema';
import { getDefaultFormatting, getFormattingSchema, unionFormattingSchema } from '../formatting';
import { getShowAsSchema, numberShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

export const ROLLUP_FUNCTIONS = [
  'countall({values})',
  'sum({values})',
  'concatenate({values})',
  'and({values})',
] as const;

export const rollupFieldOptionsSchema = z
  .object({
    expression: z.enum(ROLLUP_FUNCTIONS),
    formatting: unionFormattingSchema.optional(),
    showAs: numberShowAsSchema.optional(),
  })
  .strict();

export type IRollupFieldOptions = z.infer<typeof rollupFieldOptionsSchema>;

export const rollupCelValueSchema = z.any();

export type IRollupCellValue = z.infer<typeof rollupCelValueSchema>;

export class RollupFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): IRollupFieldOptions {
    return {
      expression: ROLLUP_FUNCTIONS[0],
      formatting: getDefaultFormatting(cellValueType),
    };
  }

  static getParsedValueType(
    expression: string,
    relationship: Relationship,
    dependentField: FieldCore
  ) {
    const tree = this.parse(expression);
    // generate a virtual field to evaluate the expression
    const clonedInstance = instanceToInstance(dependentField);
    clonedInstance.id = 'values';
    clonedInstance.name = 'values';
    clonedInstance.isMultipleCellValue = relationship !== Relationship.ManyOne;
    // field type is not important here
    const visitor = new EvalVisitor({
      values: clonedInstance,
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
