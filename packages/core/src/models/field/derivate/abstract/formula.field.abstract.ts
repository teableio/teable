import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { z } from 'zod';
import { assertNever } from '../../../../asserts';
import { FormulaErrorListener } from '../../../../formula/error.listener';
import type { RootContext } from '../../../../formula/parser/Formula';
import { Formula } from '../../../../formula/parser/Formula';
import { FormulaLexer } from '../../../../formula/parser/FormulaLexer';
import { EvalVisitor } from '../../../../formula/visitor';
import type { IRecord } from '../../../record/record.schema';
import { CellValueType } from '../../constant';
import { FieldCore } from '../../field';
import type { INumberFormatting, IDatetimeFormatting, IUnionFormatting } from '../../formatting';
import { formatNumberToString, formatDateToString } from '../../formatting';
import { booleanCellValueSchema } from '../checkbox.field';
import { dataFieldCellValueSchema } from '../date.field';
import { numberCellValueSchema } from '../number.field';
import { singleLineTextCelValueSchema } from '../single-line-text.field';

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

  static getParsedValueType(expression: string, dependFieldMap: { [fieldId: string]: FieldCore }) {
    const tree = this.parse(expression);
    const visitor = new EvalVisitor(dependFieldMap);
    const typedValue = visitor.visit(tree);
    return {
      cellValueType: typedValue.type,
      isMultipleCellValue: typedValue.isMultiple,
    };
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
