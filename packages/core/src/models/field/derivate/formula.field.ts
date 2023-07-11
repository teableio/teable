import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { z } from 'zod';
import { ConversionVisitor, EvalVisitor } from '../../../formula';
import { FormulaErrorListener } from '../../../formula/error.listener';
import { FieldReferenceVisitor } from '../../../formula/field-reference.visitor';
import type { RootContext } from '../../../formula/parser/Formula';
import { Formula } from '../../../formula/parser/Formula';
import { FormulaLexer } from '../../../formula/parser/FormulaLexer';
import type { IRecord } from '../../record';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { datetimeFormattingDef, numberFormattingDef } from '../formatting';

export const formulaFormattingDef = z
  .union([datetimeFormattingDef, numberFormattingDef])
  .optional();

export type IFormulaFormatting = z.infer<typeof formulaFormattingDef>;

export const formulaFieldOptionsDef = z.object({
  expression: z.string(),
  formatting: formulaFormattingDef,
});

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsDef>;

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

  defaultValue!: null;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cellValue2String(cellValue: any) {
    if (Array.isArray(cellValue)) {
      return cellValue.join(', ');
    }
    return cellValue ? String(cellValue) : '';
  }

  convertStringToCellValue(_value: string): string[] | null {
    return null;
  }

  repair(value: unknown) {
    return value;
  }

  validateOptions() {
    return formulaFieldOptionsDef.safeParse(this.options);
  }

  validateDefaultValue() {
    return z.null().optional().safeParse(this.defaultValue);
  }

  getReferenceFieldIds() {
    const visitor = new FieldReferenceVisitor();
    return Array.from(new Set(visitor.visit(this.tree)));
  }

  evaluate(dependFieldMap: { [fieldId: string]: FieldCore }, record: IRecord) {
    const visitor = new EvalVisitor(dependFieldMap, record);
    return visitor.visit(this.tree);
  }
}
