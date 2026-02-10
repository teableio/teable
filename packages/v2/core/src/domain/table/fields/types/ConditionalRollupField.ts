import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ForeignTable } from '../../ForeignTable';
import type { TableId } from '../../TableId';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type {
  ForeignTableRelatedField,
  ForeignTableValidationContext,
} from '../ForeignTableRelatedField';
import { FieldValueTypeVisitor } from '../visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import type { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import type {
  ConditionalRollupConfig,
  ConditionalRollupConfigValue,
} from './ConditionalRollupConfig';
import type { DateTimeFormatting } from './DateTimeFormatting';
import { DateTimeFormatting as DateTimeFormattingValue } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { NumberFormatting as NumberFormattingValue } from './NumberFormatting';
import type { NumberFormatting } from './NumberFormatting';
import { NumberShowAs as NumberShowAsValue } from './NumberShowAs';
import type { NumberShowAs } from './NumberShowAs';
import { isRollupFunctionSupportedForCellValueType, RollupExpression } from './RollupExpression';
import { SingleLineTextShowAs as SingleLineTextShowAsValue } from './SingleLineTextShowAs';
import type { SingleLineTextShowAs } from './SingleLineTextShowAs';
import type { TimeZone } from './TimeZone';
import { TimeZone as TimeZoneValue } from './TimeZone';

export type ConditionalRollupFormatting = NumberFormatting | DateTimeFormatting;
export type ConditionalRollupShowAs = NumberShowAs | SingleLineTextShowAs;

type ConditionalRollupResultType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

type ConditionalRollupValuesType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

/**
 * ConditionalRollupField is a field type that aggregates values from a foreign table
 * based on a condition (filter/sort/limit), rather than through a link field.
 *
 * Unlike regular RollupField which uses a LinkField to determine related records,
 * ConditionalRollupField uses a FieldCondition to query records from the foreign table.
 *
 * Key differences from RollupField:
 * - No linkFieldId - uses condition instead
 * - Queries foreign table directly based on condition
 * - Supports filter, sort, and limit in the condition
 */
export class ConditionalRollupField extends Field implements ForeignTableRelatedField {
  private constructor(
    id: FieldId,
    name: FieldName,
    private configValue: ConditionalRollupConfig,
    private expressionValue: RollupExpression,
    private readonly timeZoneValue: TimeZone | undefined,
    private formattingValue: ConditionalRollupFormatting | undefined,
    private readonly showAsValue: ConditionalRollupShowAs | undefined,
    private cellValueTypeValue: CellValueType | undefined,
    private isMultipleCellValueValue: CellValueMultiplicity | undefined,
    dependencies: ReadonlyArray<FieldId>
  ) {
    super(
      id,
      name,
      FieldType.conditionalRollup(),
      undefined,
      dependencies,
      FieldComputed.computed()
    );
  }

  /**
   * Creates a ConditionalRollupField with a known values field type.
   */
  static create(params: {
    id: FieldId;
    name: FieldName;
    config: ConditionalRollupConfig;
    expression: RollupExpression;
    valuesField: Field;
    timeZone?: TimeZone;
    formatting?: ConditionalRollupFormatting;
    showAs?: ConditionalRollupShowAs;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<ConditionalRollupField, DomainError> {
    const field = new ConditionalRollupField(
      params.id,
      params.name,
      params.config,
      params.expression,
      params.timeZone,
      params.formatting,
      params.showAs,
      undefined,
      undefined,
      params.dependencies ?? []
    );

    const valuesTypeResult = params.valuesField.accept(new FieldValueTypeVisitor());
    if (valuesTypeResult.isErr()) return err(valuesTypeResult.error);

    const resolveResult = field.resolveResultType({
      cellValueType: valuesTypeResult.value.cellValueType,
      isMultipleCellValue: valuesTypeResult.value.isMultipleCellValue,
    });
    if (resolveResult.isErr()) return err(resolveResult.error);

    return ok(field);
  }

  /**
   * Creates a pending ConditionalRollupField (without resolving result type).
   * Used during table creation when foreign table context is not yet available.
   */
  static createPending(params: {
    id: FieldId;
    name: FieldName;
    config: ConditionalRollupConfig;
    expression: RollupExpression;
    timeZone?: TimeZone;
    formatting?: ConditionalRollupFormatting;
    showAs?: ConditionalRollupShowAs;
    resultType?: ConditionalRollupResultType;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<ConditionalRollupField, DomainError> {
    const field = new ConditionalRollupField(
      params.id,
      params.name,
      params.config,
      params.expression,
      params.timeZone,
      params.formatting,
      params.showAs,
      undefined,
      undefined,
      params.dependencies ?? []
    );
    if (params.resultType) {
      const setResult = field.applyResultType(params.resultType);
      if (setResult.isErr()) return err(setResult.error);
    }
    return ok(field);
  }

  /**
   * Rehydrates a ConditionalRollupField from persistence.
   */
  static rehydrate(params: {
    id: FieldId;
    name: FieldName;
    config: ConditionalRollupConfig;
    expression: RollupExpression;
    timeZone?: TimeZone;
    formatting?: ConditionalRollupFormatting;
    showAs?: ConditionalRollupShowAs;
    resultType: ConditionalRollupResultType;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<ConditionalRollupField, DomainError> {
    const field = new ConditionalRollupField(
      params.id,
      params.name,
      params.config,
      params.expression,
      params.timeZone,
      params.formatting,
      params.showAs,
      undefined,
      undefined,
      params.dependencies ?? []
    );

    const setResult = field.rehydrateResultType(params.resultType);
    if (setResult.isErr()) return err(setResult.error);
    return ok(field);
  }

  /**
   * Returns default options for a new ConditionalRollupField.
   */
  static defaultOptions(valuesType: ConditionalRollupValuesType): {
    expression: RollupExpression;
    timeZone: TimeZone;
    formatting?: ConditionalRollupFormatting;
  } {
    const defaultExpression = RollupExpression.default();
    const resultType = defaultExpression.getParsedValueType(valuesType);
    if (resultType.isErr()) {
      return {
        expression: defaultExpression,
        timeZone: TimeZoneValue.default(),
      };
    }
    const formatting = ConditionalRollupField.defaultFormatting(resultType.value.cellValueType);
    return {
      expression: defaultExpression,
      timeZone: TimeZoneValue.default(),
      ...(formatting ? { formatting } : {}),
    };
  }

  static defaultFormatting(cellValueType: CellValueType): ConditionalRollupFormatting | undefined {
    if (cellValueType.equals(CellValueType.number())) {
      return NumberFormattingValue.default();
    }
    if (cellValueType.equals(CellValueType.dateTime())) {
      return DateTimeFormattingValue.default();
    }
    return undefined;
  }

  config(): ConditionalRollupConfig {
    return this.configValue;
  }

  configDto(): ConditionalRollupConfigValue {
    return this.configValue.toDto();
  }

  expression(): RollupExpression {
    return this.expressionValue;
  }

  setExpression(
    expression: RollupExpression,
    valuesType: ConditionalRollupValuesType
  ): Result<void, DomainError> {
    if (this.expressionValue.equals(expression)) return ok(undefined);
    const previousExpression = this.expressionValue;
    const previousType = this.cellValueTypeValue;
    const previousMultiplicity = this.isMultipleCellValueValue;
    const previousFormatting = this.formattingValue;
    this.expressionValue = expression;
    const resolveResult = this.resolveResultType(valuesType);
    if (resolveResult.isErr()) {
      this.expressionValue = previousExpression;
      this.cellValueTypeValue = previousType;
      this.isMultipleCellValueValue = previousMultiplicity;
      this.formattingValue = previousFormatting;
      return err(resolveResult.error);
    }
    return ok(undefined);
  }

  timeZone(): TimeZone | undefined {
    return this.timeZoneValue;
  }

  formatting(): ConditionalRollupFormatting | undefined {
    return this.formattingValue;
  }

  setFormatting(formatting: ConditionalRollupFormatting): Result<void, DomainError> {
    if (this.formattingValue)
      return err(
        domainError.invariant({ message: 'ConditionalRollupField formatting already set' })
      );
    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      return err(domainError.invariant({ message: 'ConditionalRollupField result type not set' }));
    }

    const previous = this.formattingValue;
    this.formattingValue = formatting;
    const validation = this.validateResultOptions(
      this.cellValueTypeValue,
      this.isMultipleCellValueValue
    );
    if (validation.isErr()) {
      this.formattingValue = previous;
      return err(validation.error);
    }
    return ok(undefined);
  }

  showAs(): ConditionalRollupShowAs | undefined {
    return this.showAsValue;
  }

  foreignTableId(): TableId {
    return this.configValue.foreignTableId();
  }

  lookupFieldId(): FieldId {
    return this.configValue.lookupFieldId();
  }

  lookupField(foreignTable: ForeignTable): Result<Field, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  cellValueType(): Result<CellValueType, DomainError> {
    if (!this.cellValueTypeValue)
      return err(
        domainError.invariant({ message: 'ConditionalRollupField cell value type not set' })
      );
    return ok(this.cellValueTypeValue);
  }

  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    if (!this.isMultipleCellValueValue)
      return err(domainError.invariant({ message: 'ConditionalRollupField multiplicity not set' }));
    return ok(this.isMultipleCellValueValue);
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    const cellValueTypeResult = this.cellValueType();
    const isMultipleResult = this.isMultipleCellValue();
    const resultType =
      cellValueTypeResult.isOk() && isMultipleResult.isOk()
        ? {
            cellValueType: cellValueTypeResult.value,
            isMultipleCellValue: isMultipleResult.value,
          }
        : undefined;

    return ConditionalRollupField.createPending({
      id: params.newId,
      name: params.newName,
      config: this.config(),
      expression: this.expression(),
      timeZone: this.timeZone(),
      formatting: this.formatting(),
      showAs: this.showAs(),
      resultType,
      dependencies: this.dependencies(),
    });
  }

  resolveResultType(valuesType: ConditionalRollupValuesType): Result<void, DomainError> {
    if (
      !isRollupFunctionSupportedForCellValueType(
        this.expressionValue.toString(),
        valuesType.cellValueType
      )
    ) {
      return err(
        domainError.validation({
          message: 'Invalid RollupExpression for ConditionalRollupField value type',
        })
      );
    }
    const resultType = this.expressionValue.getParsedValueType(valuesType);
    if (resultType.isErr()) return err(resultType.error);
    return this.applyResultType(resultType.value);
  }

  private rehydrateResultType(resultType: ConditionalRollupResultType): Result<void, DomainError> {
    return this.applyResultType(resultType);
  }

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    // Unlike regular RollupField, ConditionalRollupField does not have a linkFieldId
    // It directly references a foreign table and applies conditions

    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (!foreignTable)
      return err(
        domainError.invariant({ message: 'ConditionalRollupField foreign table not loaded' })
      );

    const lookupField = ForeignTable.from(foreignTable)
      .fieldById(this.lookupFieldId())
      .mapErr(() =>
        domainError.notFound({ message: 'ConditionalRollupField lookup field not found' })
      );
    if (lookupField.isErr()) return err(lookupField.error);

    const valuesTypeResult = lookupField.value.accept(new FieldValueTypeVisitor());
    if (valuesTypeResult.isErr()) return err(valuesTypeResult.error);

    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      const resolveResult = this.resolveResultType({
        cellValueType: valuesTypeResult.value.cellValueType,
        isMultipleCellValue: valuesTypeResult.value.isMultipleCellValue,
      });
      if (resolveResult.isErr()) return err(resolveResult.error);
    }

    // Dependencies include field IDs referenced in the condition filter
    const conditionFieldIds = this.configValue.condition().filterFieldIds();
    return this.setDependencies([...conditionFieldIds, this.lookupFieldId()]);
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitConditionalRollupField(this);
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({
          message: 'ForeignTable does not match ConditionalRollupField foreign table',
        })
      );
    }
    return ok(undefined);
  }

  private applyResultType(resultType: ConditionalRollupResultType): Result<void, DomainError> {
    if (this.cellValueTypeValue && !this.cellValueTypeValue.equals(resultType.cellValueType)) {
      return err(
        domainError.invariant({ message: 'ConditionalRollupField cell value type already set' })
      );
    }
    if (
      this.isMultipleCellValueValue &&
      !this.isMultipleCellValueValue.equals(resultType.isMultipleCellValue)
    )
      return err(
        domainError.invariant({ message: 'ConditionalRollupField multiplicity already set' })
      );

    const validation = this.validateResultOptions(
      resultType.cellValueType,
      resultType.isMultipleCellValue
    );
    if (validation.isErr()) return err(validation.error);

    this.cellValueTypeValue = resultType.cellValueType;
    this.isMultipleCellValueValue = resultType.isMultipleCellValue;

    if (!this.formattingValue) {
      const defaultFormatting = ConditionalRollupField.defaultFormatting(resultType.cellValueType);
      if (defaultFormatting) {
        this.formattingValue = defaultFormatting;
      }
    }
    return ok(undefined);
  }

  private validateResultOptions(
    cellValueType: CellValueType,
    multiplicity: CellValueMultiplicity
  ): Result<void, DomainError> {
    const formatting = this.formattingValue;
    const showAs = this.showAsValue;
    const isMultiple = multiplicity.isMultiple();

    if (cellValueType.equals(CellValueType.number())) {
      if (formatting && !(formatting instanceof NumberFormattingValue))
        return err(
          domainError.validation({ message: 'Invalid ConditionalRollupField formatting' })
        );
      if (showAs && !(showAs instanceof NumberShowAsValue))
        return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
      if (showAs) {
        const dto = showAs.toDto();
        const isSingle = 'showValue' in dto;
        if (isMultiple && isSingle)
          return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
        if (!isMultiple && !isSingle)
          return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
      }
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      if (formatting && !(formatting instanceof DateTimeFormattingValue))
        return err(
          domainError.validation({ message: 'Invalid ConditionalRollupField formatting' })
        );
      if (showAs)
        return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.string())) {
      if (formatting)
        return err(
          domainError.validation({ message: 'Invalid ConditionalRollupField formatting' })
        );
      if (showAs && !(showAs instanceof SingleLineTextShowAsValue))
        return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      if (formatting)
        return err(
          domainError.validation({ message: 'Invalid ConditionalRollupField formatting' })
        );
      if (showAs)
        return err(domainError.validation({ message: 'Invalid ConditionalRollupField showAs' }));
      return ok(undefined);
    }

    return err(
      domainError.validation({ message: 'Invalid ConditionalRollupField cell value type' })
    );
  }
}
