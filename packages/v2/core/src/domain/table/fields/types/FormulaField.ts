import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Field } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import type { DateTimeFormatting } from './DateTimeFormatting';
import { DateTimeFormatting as DateTimeFormattingValue } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { FormulaExpression } from './FormulaExpression';
import type { FormulaMeta } from './FormulaMeta';
import type { NumberFormatting } from './NumberFormatting';
import { NumberFormatting as NumberFormattingValue } from './NumberFormatting';
import { NumberShowAs as NumberShowAsValue } from './NumberShowAs';
import type { NumberShowAs } from './NumberShowAs';
import { SingleLineTextShowAs as SingleLineTextShowAsValue } from './SingleLineTextShowAs';
import type { SingleLineTextShowAs } from './SingleLineTextShowAs';
import { TimeZone } from './TimeZone';

export type FormulaFormatting = NumberFormatting | DateTimeFormatting;
export type FormulaShowAs = NumberShowAs | SingleLineTextShowAs;

type FormulaResultType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

export class FormulaField extends Field {
  private constructor(
    id: FieldId,
    name: FieldName,
    private expressionValue: FormulaExpression,
    private readonly timeZoneValue: TimeZone | undefined,
    private formattingValue: FormulaFormatting | undefined,
    private readonly showAsValue: FormulaShowAs | undefined,
    private readonly metaValue: FormulaMeta | undefined,
    private cellValueTypeValue: CellValueType | undefined,
    private isMultipleCellValueValue: CellValueMultiplicity | undefined,
    dependencies: ReadonlyArray<FieldId>
  ) {
    super(id, name, FieldType.formula(), undefined, dependencies, FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    expression: FormulaExpression;
    timeZone?: TimeZone;
    formatting?: FormulaFormatting;
    showAs?: FormulaShowAs;
    meta?: FormulaMeta;
    resultType?: FormulaResultType;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<FormulaField, string> {
    const field = new FormulaField(
      params.id,
      params.name,
      params.expression,
      params.timeZone,
      params.formatting,
      params.showAs,
      params.meta,
      undefined,
      undefined,
      params.dependencies ?? []
    );

    if (params.resultType) {
      const setResult = field.setResultType(
        params.resultType.cellValueType,
        params.resultType.isMultipleCellValue
      );
      if (setResult.isErr()) return err(setResult.error);
    }

    return ok(field);
  }

  static defaultOptions(cellValueType: CellValueType): {
    expression: FormulaExpression;
    timeZone: TimeZone;
    formatting?: FormulaFormatting;
  } {
    const formatting = FormulaField.defaultFormatting(cellValueType);
    return {
      expression: FormulaExpression.create('')._unsafeUnwrap(),
      timeZone: TimeZone.default(),
      ...(formatting ? { formatting } : {}),
    };
  }

  static defaultFormatting(cellValueType: CellValueType): FormulaFormatting | undefined {
    if (cellValueType.equals(CellValueType.number())) {
      return NumberFormattingValue.default();
    }
    if (cellValueType.equals(CellValueType.dateTime())) {
      return DateTimeFormattingValue.default();
    }
    return undefined;
  }

  expression(): FormulaExpression {
    return this.expressionValue;
  }

  setExpression(expression: FormulaExpression): Result<void, string> {
    if (this.expressionValue.equals(expression)) return ok(undefined);
    this.expressionValue = expression;
    return ok(undefined);
  }

  timeZone(): TimeZone | undefined {
    return this.timeZoneValue;
  }

  formatting(): FormulaFormatting | undefined {
    return this.formattingValue;
  }

  setFormatting(formatting: FormulaFormatting): Result<void, string> {
    if (this.formattingValue) return err('FormulaField formatting already set');
    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      return err('FormulaField result type not set');
    }

    const previous = this.formattingValue;
    this.formattingValue = formatting;
    const validation = this.validateOptions(this.cellValueTypeValue, this.isMultipleCellValueValue);
    if (validation.isErr()) {
      this.formattingValue = previous;
      return err(validation.error);
    }
    return ok(undefined);
  }

  showAs(): FormulaShowAs | undefined {
    return this.showAsValue;
  }

  meta(): FormulaMeta | undefined {
    return this.metaValue;
  }

  isPersistedAsGeneratedColumn(): Result<boolean, string> {
    if (!this.metaValue) return ok(false);
    return this.metaValue.persistedAsGeneratedColumn();
  }

  cellValueType(): Result<CellValueType, string> {
    if (!this.cellValueTypeValue) return err('FormulaField cell value type not set');
    return ok(this.cellValueTypeValue);
  }

  isMultipleCellValue(): Result<CellValueMultiplicity, string> {
    if (!this.isMultipleCellValueValue) return err('FormulaField multiplicity not set');
    return ok(this.isMultipleCellValueValue);
  }

  setResultType(
    cellValueType: CellValueType,
    isMultipleCellValue: CellValueMultiplicity
  ): Result<void, string> {
    if (this.cellValueTypeValue && !this.cellValueTypeValue.equals(cellValueType)) {
      return err('FormulaField cell value type already set');
    }
    if (this.isMultipleCellValueValue && !this.isMultipleCellValueValue.equals(isMultipleCellValue))
      return err('FormulaField multiplicity already set');

    const validation = this.validateOptions(cellValueType, isMultipleCellValue);
    if (validation.isErr()) return err(validation.error);

    this.cellValueTypeValue = cellValueType;
    this.isMultipleCellValueValue = isMultipleCellValue;
    return ok(undefined);
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string> {
    return visitor.visitFormulaField(this);
  }

  private validateOptions(
    cellValueType: CellValueType,
    multiplicity: CellValueMultiplicity
  ): Result<void, string> {
    const formatting = this.formattingValue;
    const showAs = this.showAsValue;
    const isMultiple = multiplicity.isMultiple();

    if (cellValueType.equals(CellValueType.number())) {
      if (formatting && !(formatting instanceof NumberFormattingValue))
        return err('Invalid FormulaField formatting');
      if (showAs && !(showAs instanceof NumberShowAsValue))
        return err('Invalid FormulaField showAs');
      if (showAs) {
        const dto = showAs.toDto();
        const isSingle = 'showValue' in dto;
        if (isMultiple && isSingle) return err('Invalid FormulaField showAs');
        if (!isMultiple && !isSingle) return err('Invalid FormulaField showAs');
      }
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      if (formatting && !(formatting instanceof DateTimeFormattingValue))
        return err('Invalid FormulaField formatting');
      if (showAs) return err('Invalid FormulaField showAs');
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.string())) {
      if (formatting) return err('Invalid FormulaField formatting');
      if (showAs && !(showAs instanceof SingleLineTextShowAsValue))
        return err('Invalid FormulaField showAs');
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      if (formatting) return err('Invalid FormulaField formatting');
      if (showAs) return err('Invalid FormulaField showAs');
      return ok(undefined);
    }

    return err('Invalid FormulaField cell value type');
  }
}
