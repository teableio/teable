import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { z } from 'zod';
import { assertNever } from '../../../asserts';
import { ConversionVisitor, EvalVisitor } from '../../../formula';
import { FormulaErrorListener } from '../../../formula/error.listener';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { RootContext } from '../../../formula/parser/Formula';
import { Formula } from '../../../formula/parser/Formula';
import { FormulaLexer } from '../../../formula/parser/FormulaLexer';
import type { IRecord } from '../../record';
import type { FieldType } from '../constant';
import { CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IDatetimeFormatting, INumberFormatting } from '../formatting';
import {
  datetimeFormattingSchema,
  formatDateToString,
  formatNumberToString,
  numberFormattingSchema,
} from '../formatting';
import { booleanCellValueSchema } from './checkbox.field';
import { dataFieldCellValueSchema } from './date.field';
import { numberCellValueSchema } from './number.field';
import { singleLineTextCelValueSchema } from './single-line-text.field';

export const formulaFormattingSchema = z
  .union([datetimeFormattingSchema, numberFormattingSchema])
  .optional();

export type IFormulaFormatting = z.infer<typeof formulaFormattingSchema>;

export const formulaFieldOptionsSchema = z.object({
  expression: z.string(),
  formatting: formulaFormattingSchema,
});

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsSchema>;

const formulaFieldCellValueSchema = z.any();

export type IFormulaCellValue = z.infer<typeof formulaFieldCellValueSchema>;

export class FormulaFieldCore extends FieldCore {
  static defaultOptions(): IFormulaFieldOptions {
    return {
      expression: '',
    };
  }

  static parse(expression: string) {
    const inputStream = CharStreams.fromString(expression);
    const lexer = new FormulaLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new Formula(tokenStream);
    parser.removeErrorListeners();
    const errorListener = new FormulaErrorListener();
    parser.addErrorListener(errorListener);
    return parser.root();
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

  static convertExpressionIdToName(
    expression: string,
    dependFieldMap: { [fieldId: string]: Pick<FieldCore, 'name'> }
  ): string {
    const tree = this.parse(expression);
    const idToName = Object.entries(dependFieldMap).reduce<{ [fieldId: string]: string }>(
      (acc, [fieldId, field]) => {
        acc[fieldId] = field.name;
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
    dependFieldMap: { [fieldId: string]: Pick<FieldCore, 'name'> }
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

  options!: IFormulaFieldOptions;

  cellValueType!: CellValueType;

  declare isMultipleCellValue?: boolean | undefined;

  private _tree?: RootContext;

  private get tree() {
    if (this._tree) {
      return this._tree;
    }
    this._tree = FormulaFieldCore.parse(this.options.expression);
    return this._tree;
  }

  getReferenceFieldIds() {
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(this.tree)));
  }

  evaluate(dependFieldMap: { [fieldId: string]: FieldCore }, record: IRecord) {
    const visitor = new EvalVisitor(dependFieldMap, record);
    return visitor.visit(this.tree);
  }

  cellValue2String(cellValue: unknown) {
    const formatting = this.options.formatting;
    const formatter = (value: unknown) => {
      switch (this.cellValueType) {
        case CellValueType.Number:
          return formatNumberToString(value as number, formatting as INumberFormatting);
        case CellValueType.DateTime:
          return formatDateToString(value as string, formatting as IDatetimeFormatting);
      }
      return String(value);
    };

    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue) {
      return (cellValue as unknown[]).map((v) => formatter(v)).join(', ');
    }
    return formatter(cellValue);
  }

  // formula do not support
  convertStringToCellValue(_value: string): null {
    return null;
  }

  // formula do not support
  repair(_value: unknown): null {
    return null;
  }

  validateOptions() {
    const getFormulaFormattingSchema = () => {
      switch (this.cellValueType) {
        case CellValueType.Number:
          return numberFormattingSchema;
        case CellValueType.DateTime:
          return datetimeFormattingSchema;
        default:
          return z.undefined().openapi({
            description: 'Only number and datetime cell value type support formatting',
          });
      }
    };

    return z
      .object({
        expression: z.string(),
        formatting: getFormulaFormattingSchema(),
      })
      .safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    const getFormulaCellValueSchema = () => {
      switch (this.cellValueType) {
        case CellValueType.Number:
          return numberCellValueSchema;
        case CellValueType.DateTime:
          return dataFieldCellValueSchema;
        case CellValueType.String:
          return singleLineTextCelValueSchema;
        case CellValueType.Boolean:
          return booleanCellValueSchema;
        default:
          assertNever(this.cellValueType);
      }
    };
    const schema = getFormulaCellValueSchema();

    if (this.isMultipleCellValue) {
      return z.array(schema).nullable().safeParse(value);
    }
    return schema.nullable().safeParse(value);
  }
}
