import { z } from 'zod';
import { ConversionVisitor } from '../../../formula';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { FieldType, CellValueType } from '../constant';
import { unionFormattingSchema, getFormattingSchema, getDefaultFormatting } from '../formatting';
import { getShowAsSchema, numberShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

export const formulaFieldOptionsSchema = z
  .object({
    expression: z.string(),
    formatting: unionFormattingSchema.optional(),
    showAs: numberShowAsSchema.optional(),
  })
  .strict();

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsSchema>;

const formulaFieldCellValueSchema = z.any();

export type IFormulaCellValue = z.infer<typeof formulaFieldCellValueSchema>;

export class FormulaFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): IFormulaFieldOptions {
    return {
      expression: '',
      formatting: getDefaultFormatting(cellValueType),
    };
  }

  static convertExpressionIdToName(
    expression: string,
    dependFieldMap: { [fieldId: string]: { name: string } },
    withFallback?: boolean
  ): string {
    const tree = this.parse(expression);
    const idToName = Object.entries(dependFieldMap).reduce<{ [fieldId: string]: string }>(
      (acc, [fieldId, field]) => {
        acc[fieldId] = field?.name;
        if (!acc[fieldId]) {
          if (withFallback) {
            acc[fieldId] = fieldId;
          } else {
            throw new Error(`Field ${fieldId} not found`);
          }
        }
        return acc;
      },
      {}
    );
    const visitor = new ConversionVisitor(idToName);
    visitor.visit(tree);
    return visitor.getResult();
  }

  static convertExpressionNameToId(
    expression: string,
    dependFieldMap: { [fieldId: string]: { name: string } }
  ): string {
    const tree = this.parse(expression);
    const idToName = Object.entries(dependFieldMap).reduce<{ [fieldName: string]: string }>(
      (acc, [fieldId, field]) => {
        acc[field.name] = fieldId;
        return acc;
      },
      {}
    );
    const visitor = new ConversionVisitor(idToName);
    visitor.visit(tree);
    return visitor.getResult();
  }

  static getReferenceFieldIds(expression: string) {
    const tree = this.parse(expression);
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(tree)));
  }

  type!: FieldType.Formula;

  declare options: IFormulaFieldOptions;

  getReferenceFieldIds() {
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(this.tree)));
  }

  validateOptions() {
    return z
      .object({
        expression: z.string(),
        formatting: getFormattingSchema(this.cellValueType),
        showAs: getShowAsSchema(this.cellValueType, this.isMultipleCellValue),
      })
      .safeParse(this.options);
  }
}
