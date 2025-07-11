import { z } from 'zod';
import { ConversionVisitor, EvalVisitor } from '../../../formula';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { FieldType, CellValueType } from '../constant';
import type { FieldCore } from '../field';
import {
  unionFormattingSchema,
  getFormattingSchema,
  getDefaultFormatting,
  timeZoneStringSchema,
} from '../formatting';
import { getShowAsSchema, unionShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

export const formulaFieldOptionsSchema = z.object({
  expression: z
    .string()
    .describe(
      'The formula including fields referenced by their IDs. For example, LEFT(4, {Birthday}) input will be returned as LEFT(4, {fldXXX}) via API. The formula syntax in Teable is basically the same as Airtable'
    ),
  timeZone: timeZoneStringSchema.optional(),
  formatting: unionFormattingSchema.optional(),
  showAs: unionShowAsSchema.optional(),
});

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsSchema>;

const formulaFieldCellValueSchema = z.any();

export type IFormulaCellValue = z.infer<typeof formulaFieldCellValueSchema>;

export class FormulaFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): IFormulaFieldOptions {
    return {
      expression: '',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      formatting: getDefaultFormatting(cellValueType),
    };
  }

  static convertExpressionIdToName(
    expression: string,
    dependFieldMap: { [fieldId: string]: { name: string } }
  ): string {
    const tree = this.parse(expression);
    const nameToId = Object.entries(dependFieldMap).reduce<{ [fieldId: string]: string }>(
      (acc, [fieldId, field]) => {
        acc[fieldId] = field?.name;
        return acc;
      },
      {}
    );
    const visitor = new ConversionVisitor(nameToId);
    visitor.safe().visit(tree);
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

  static getParsedValueType(expression: string, dependFieldMap: { [fieldId: string]: FieldCore }) {
    const tree = this.parse(expression);
    const visitor = new EvalVisitor(dependFieldMap);
    const typedValue = visitor.visit(tree);
    return {
      cellValueType: typedValue.type,
      isMultipleCellValue: typedValue.isMultiple,
    };
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
