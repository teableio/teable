import { z } from 'zod';
import { ConversionVisitor, EvalVisitor } from '../../../formula';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { IGeneratedColumnQuerySupportValidator } from '../../../formula/function-convertor.interface';
import { validateFormulaSupport } from '../../../utils/formula-validation';
import type { FieldType, CellValueType } from '../constant';
import type { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
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
  dbGenerated: z.boolean().optional().default(false).openapi({
    description:
      'Whether to create a database generated column for this formula field. When true, creates both the original formula column and a generated column with computed values.',
  }),
});

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsSchema>;

export const formulaFieldMetaSchema = z.object({
  persistedAsGeneratedColumn: z.boolean().optional().default(false).openapi({
    description:
      'Whether this formula field is persisted as a generated column in the database. When true, the field value is computed and stored as a database generated column.',
  }),
});

export type IFormulaFieldMeta = z.infer<typeof formulaFieldMetaSchema>;

const formulaFieldCellValueSchema = z.any();

export type IFormulaCellValue = z.infer<typeof formulaFieldCellValueSchema>;

export class FormulaFieldCore extends FormulaAbstractCore {
  static defaultOptions(cellValueType: CellValueType): IFormulaFieldOptions {
    return {
      expression: '',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      formatting: getDefaultFormatting(cellValueType),
      dbGenerated: true,
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

  declare meta?: IFormulaFieldMeta;

  getExpression(): string {
    return this.options.expression;
  }

  getReferenceFieldIds() {
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(this.tree)));
  }

  /**
   * Get the generated column name for database-generated formula fields
   * This should match the naming convention used in database-column-visitor
   */
  getGeneratedColumnName(): string {
    return this.dbFieldName;
  }

  /**
   * Validates whether this formula field's expression is supported for generated columns
   * @param supportValidator The database-specific support validator
   * @returns true if the formula is supported for generated columns, false otherwise
   */
  validateGeneratedColumnSupport(supportValidator: IGeneratedColumnQuerySupportValidator): boolean {
    const expression = this.getExpression();
    return validateFormulaSupport(supportValidator, expression);
  }

  getIsPersistedAsGeneratedColumn() {
    return this.meta?.persistedAsGeneratedColumn || false;
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

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitFormulaField(this);
  }
}
