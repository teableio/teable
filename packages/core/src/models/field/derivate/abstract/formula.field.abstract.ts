import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { z } from 'zod';
import { assertNever } from '../../../../asserts';
import { FormulaErrorListener } from '../../../../formula/error.listener';
import type { RootContext } from '../../../../formula/parser/Formula';
import { Formula } from '../../../../formula/parser/Formula';
import { FormulaLexer } from '../../../../formula/parser/FormulaLexer';
import { EvalVisitor } from '../../../../formula/visitor';
import type { IRecord } from '../../../record';
import { CellValueType } from '../../constant';
import { FieldCore } from '../../field';
import type { INumberFormatting, IDatetimeFormatting, IUnionFormatting } from '../../formatting';
import {
  formatNumberToString,
  formatDateToString,
  defaultNumberFormatting,
  defaultDatetimeFormatting,
} from '../../formatting';
import { booleanCellValueSchema } from '../checkbox.field';
import { dataFieldCellValueSchema } from '../date.field';
import { numberCellValueSchema } from '../number.field';
import { singleLineTextCelValueSchema } from '../single-line-text.field';

export const getFormulaCellValueSchema = (cellValueType: CellValueType) => {
  switch (cellValueType) {
    case CellValueType.Number:
      return numberCellValueSchema;
    case CellValueType.DateTime:
      return dataFieldCellValueSchema;
    case CellValueType.String:
      return singleLineTextCelValueSchema;
    case CellValueType.Boolean:
      return booleanCellValueSchema;
    default:
      assertNever(cellValueType);
  }
};

export abstract class FormulaAbstractCore extends FieldCore {
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

  options!: {
    expression: string;
    formatting?: IUnionFormatting;
  };

  cellValueType!: CellValueType;

  declare isMultipleCellValue?: boolean | undefined;

  protected _tree?: RootContext;

  protected get tree() {
    if (this._tree) {
      return this._tree;
    }
    this._tree = FormulaAbstractCore.parse(this.options.expression);
    return this._tree;
  }

  evaluate(dependFieldMap: { [fieldId: string]: FieldCore }, record: IRecord) {
    const visitor = new EvalVisitor(dependFieldMap, record);
    return visitor.visit(this.tree);
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue) {
      return (cellValue as unknown[]).map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue);
  }

  // formula do not support
  convertStringToCellValue(_value: string): null {
    return null;
  }

  item2String(value?: unknown) {
    const formatting = this.options.formatting;

    switch (this.cellValueType) {
      case CellValueType.Number:
        return formatNumberToString(
          value as number,
          (formatting as INumberFormatting) || defaultNumberFormatting
        );
      case CellValueType.DateTime:
        return formatDateToString(
          value as string,
          (formatting as IDatetimeFormatting) || defaultDatetimeFormatting
        );
    }
    return value == null ? '' : String(value);
  }

  // formula do not support
  repair(_value: unknown): null {
    return null;
  }

  validateCellValue(value: unknown) {
    const schema = getFormulaCellValueSchema(this.cellValueType);

    if (this.isMultipleCellValue) {
      return z.array(schema).nullable().safeParse(value);
    }
    return schema.nullable().safeParse(value);
  }
}
