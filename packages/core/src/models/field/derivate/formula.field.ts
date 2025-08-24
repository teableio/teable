import { z } from 'zod';
import { ConversionVisitor, EvalVisitor } from '../../../formula';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { TableDomain } from '../../table/table-domain';
import type { FieldType, CellValueType } from '../constant';
import type { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import { isLinkField } from '../field.util';
import { getFormattingSchema, getDefaultFormatting } from '../formatting';
import { getShowAsSchema } from '../show-as';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import { type IFormulaFieldMeta, type IFormulaFieldOptions } from './formula-option.schema';
import type { LinkFieldCore } from './link.field';

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

  declare meta?: IFormulaFieldMeta;

  getExpression(): string {
    return this.options.expression;
  }

  getReferenceFieldIds() {
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(this.tree)));
  }

  /**
   * Get referenced fields from a table domain
   * @param tableDomain - The table domain to search for referenced fields
   * @returns Array of referenced field instances
   */
  getReferenceFields(tableDomain: TableDomain): FieldCore[] {
    const referenceFieldIds = this.getReferenceFieldIds();
    const referenceFields: FieldCore[] = [];

    for (const fieldId of referenceFieldIds) {
      const field = tableDomain.getField(fieldId);
      if (field) {
        referenceFields.push(field);
      }
    }

    return referenceFields;
  }

  override getLinkFields(tableDomain: TableDomain): LinkFieldCore[] {
    return this.getReferenceFields(tableDomain).filter(isLinkField) as LinkFieldCore[];
  }

  /**
   * Get the generated column name for database-generated formula fields
   * This should match the naming convention used in database-column-visitor
   */
  getGeneratedColumnName(): string {
    return this.dbFieldName;
  }

  getIsPersistedAsGeneratedColumn() {
    return this.meta?.persistedAsGeneratedColumn || false;
  }

  /**
   * Recalculates and updates the cellValueType, isMultipleCellValue, and dbFieldType for this formula field
   * based on its expression and the current field context
   * @param fieldMap Map of field ID to field instance for context
   */
  recalculateFieldTypes(fieldMap: Record<string, FieldCore>): void {
    const { cellValueType, isMultipleCellValue } = FormulaFieldCore.getParsedValueType(
      this.options.expression,
      fieldMap
    );

    this.cellValueType = cellValueType;
    this.isMultipleCellValue = isMultipleCellValue;
    // Update dbFieldType using the base class method
    this.updateDbFieldType();
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
