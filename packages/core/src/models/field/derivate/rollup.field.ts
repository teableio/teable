import { plainToInstance } from 'class-transformer';
import { z } from 'zod';
import { EvalVisitor } from '../../../formula/visitor';
import { FieldType, CellValueType } from '../constant';
import type { ILookupOptionsVo } from '../field.schema';
import { getDefaultFormatting, getFormattingSchema, unionFormattingSchema } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import { SingleLineTextFieldCore } from './single-line-text.field';

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

  static getParsedValueType(expression: string) {
    const tree = this.parse(expression);
    // generate a virtual field to evaluate the expression
    // field type is not important here
    const visitor = new EvalVisitor({
      values: plainToInstance(SingleLineTextFieldCore, {
        type: FieldType.SingleLineText,
        id: 'values',
        name: 'values',
        cellValueType: CellValueType.String,
      }),
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
      })
      .safeParse(this.options);
  }
}
