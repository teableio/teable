import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../../shared/specification/composeAndSpecs';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { FieldDeletionContext, OnTeableFieldDeleted } from '../../OnTeableFieldDeleted';
import { UpdateFormulaExpressionSpec } from '../../specs/field-updates/UpdateFormulaExpressionSpec';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import type { Table } from '../../Table';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type { FieldUpdateContext, OnTeableFieldUpdated } from '../OnTeableFieldUpdated';
import { FieldValueTypeVisitor } from '../visitors/FieldValueTypeVisitor';
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

export class FormulaField extends Field implements OnTeableFieldUpdated, OnTeableFieldDeleted {
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
  }): Result<FormulaField, DomainError> {
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

  setExpression(expression: FormulaExpression): Result<void, DomainError> {
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

  setFormatting(formatting: FormulaFormatting): Result<void, DomainError> {
    if (this.formattingValue)
      return err(domainError.invariant({ message: 'FormulaField formatting already set' }));
    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      return err(domainError.invariant({ message: 'FormulaField result type not set' }));
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

  isPersistedAsGeneratedColumn(): Result<boolean, DomainError> {
    if (!this.metaValue) return ok(false);
    return this.metaValue.persistedAsGeneratedColumn();
  }

  cellValueType(): Result<CellValueType, DomainError> {
    if (!this.cellValueTypeValue)
      return err(domainError.invariant({ message: 'FormulaField cell value type not set' }));
    return ok(this.cellValueTypeValue);
  }

  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    if (!this.isMultipleCellValueValue)
      return err(domainError.invariant({ message: 'FormulaField multiplicity not set' }));
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

    return FormulaField.create({
      id: params.newId,
      name: params.newName,
      expression: this.expression(),
      timeZone: this.timeZone(),
      formatting: this.formatting(),
      showAs: this.showAs(),
      meta: this.meta(),
      resultType,
      dependencies: this.dependencies(),
    });
  }

  setResultType(
    cellValueType: CellValueType,
    isMultipleCellValue: CellValueMultiplicity
  ): Result<void, DomainError> {
    if (this.cellValueTypeValue && !this.cellValueTypeValue.equals(cellValueType)) {
      return err(domainError.invariant({ message: 'FormulaField cell value type already set' }));
    }
    if (this.isMultipleCellValueValue && !this.isMultipleCellValueValue.equals(isMultipleCellValue))
      return err(domainError.invariant({ message: 'FormulaField multiplicity already set' }));

    const validation = this.validateOptions(cellValueType, isMultipleCellValue);
    if (validation.isErr()) return err(validation.error);

    this.cellValueTypeValue = cellValueType;
    this.isMultipleCellValueValue = isMultipleCellValue;
    return ok(undefined);
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitFormulaField(this);
  }

  /**
   * Respond to updates of fields this formula depends on.
   *
   * Formula fields depend on fields referenced in their expression.
   * When a dependency field's type changes, the formula may need to
   * recalculate its result type (cellValueType).
   *
   * The actual result type recalculation requires the formula evaluator,
   * which is handled by the command processing flow. Here we just acknowledge
   * that we depend on this field.
   *
   * Note: Complex result type recalculation would require access to the
   * formula evaluator service, which is not available in the domain layer.
   * The FieldUpdateSideEffectService will handle triggering recalculation.
   */
  onDependencyUpdated(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    // Check if this is actually our dependency.
    // Prefer explicit dependency metadata, but fall back to parsing formula references
    // because some legacy fields may not have dependencies persisted.
    const dependencyFromMetadata = this.dependencies().some((depId) =>
      depId.equals(updatedField.id())
    );
    const dependencyFromExpression = !dependencyFromMetadata
      ? this.expression()
          .getReferencedFieldIds()
          .map((ids) => ids.some((depId) => depId.equals(updatedField.id())))
          .unwrapOr(false)
      : false;
    const isDependency = dependencyFromMetadata || dependencyFromExpression;
    if (!isDependency) {
      return ok(undefined);
    }

    const dependencyTypeChanged = updateSpecs.some(
      (spec): spec is TableUpdateFieldTypeSpec =>
        spec instanceof TableUpdateFieldTypeSpec &&
        spec.oldField().id().equals(updatedField.id()) &&
        spec.isTypeConversion()
    );

    const dependencyFormulaExpressionChanged = updateSpecs.some(
      (spec): spec is UpdateFormulaExpressionSpec =>
        spec instanceof UpdateFormulaExpressionSpec && spec.fieldId().equals(updatedField.id())
    );

    if (!dependencyTypeChanged && !dependencyFormulaExpressionChanged) {
      return ok(undefined);
    }

    const currentFieldResult = context.table.getField((f) => f.id().equals(this.id()));
    if (currentFieldResult.isErr()) return err(currentFieldResult.error);
    const currentField = currentFieldResult.value;
    if (!(currentField instanceof FormulaField)) {
      return ok(undefined);
    }

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const fieldValueTypes = context.table
      .getFields()
      .filter((candidate) => !candidate.id().equals(currentField.id()))
      .flatMap((candidate) => {
        const valueTypeResult = candidate.accept(valueTypeVisitor);
        if (valueTypeResult.isErr()) return [];
        return [{ id: candidate.id(), valueType: valueTypeResult.value }];
      });

    const inferredResultType = currentField.expression().getParsedValueType(fieldValueTypes);
    if (inferredResultType.isErr()) {
      return ok(undefined);
    }

    const currentCellValueType = currentField.cellValueType();
    const currentMultiplicity = currentField.isMultipleCellValue();
    if (currentCellValueType.isErr() || currentMultiplicity.isErr()) {
      return ok(undefined);
    }

    if (
      inferredResultType.value.cellValueType.equals(currentCellValueType.value) &&
      inferredResultType.value.isMultipleCellValue.equals(currentMultiplicity.value)
    ) {
      return ok(undefined);
    }

    const buildUpdatedField = (clearStyle: boolean): Result<FormulaField, DomainError> =>
      FormulaField.create({
        id: currentField.id(),
        name: currentField.name(),
        expression: currentField.expression(),
        timeZone: currentField.timeZone(),
        formatting: clearStyle ? undefined : currentField.formatting(),
        showAs: clearStyle ? undefined : currentField.showAs(),
        meta: currentField.meta(),
        resultType: inferredResultType.value,
        dependencies: currentField.dependencies(),
      });

    let updatedFieldResult = buildUpdatedField(false);
    if (updatedFieldResult.isErr()) {
      updatedFieldResult = buildUpdatedField(true);
      if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);
    }

    const dbFieldNameResult = currentField.dbFieldName();
    if (dbFieldNameResult.isOk()) {
      const setDbFieldNameResult = updatedFieldResult.value.setDbFieldName(dbFieldNameResult.value);
      if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
    }

    specs.push(TableUpdateFieldTypeSpec.create(currentField, updatedFieldResult.value));
    return ok(composeAndSpecsOrUndefined(specs));
  }

  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const deletedFromHostTable = context.sourceTable.id().equals(context.table.id());
    if (!deletedFromHostTable || this.hasError().isError()) {
      return ok(undefined);
    }

    const shouldSetError = this.dependsOnDeletedField(deletedField.id(), context.table, new Set());
    if (!shouldSetError) {
      return ok(undefined);
    }

    return ok(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
  }

  private dependsOnDeletedField(
    deletedFieldId: FieldId,
    table: Table,
    visitedFormulaIds: Set<string>
  ): boolean {
    const currentFormulaId = this.id().toString();
    if (visitedFormulaIds.has(currentFormulaId)) {
      return false;
    }
    visitedFormulaIds.add(currentFormulaId);

    const referencedFieldIds = this.referencedFieldIdsForDeleteCheck();
    if (referencedFieldIds.some((fieldId) => fieldId.equals(deletedFieldId))) {
      return true;
    }

    for (const referencedFieldId of referencedFieldIds) {
      const referencedField = table.getFields((field) => field.id().equals(referencedFieldId))[0];
      if (!(referencedField instanceof FormulaField)) {
        continue;
      }
      if (referencedField.dependsOnDeletedField(deletedFieldId, table, visitedFormulaIds)) {
        return true;
      }
    }

    return false;
  }

  private referencedFieldIdsForDeleteCheck(): ReadonlyArray<FieldId> {
    const dependencies = this.dependencies();
    if (dependencies.length > 0) {
      return dependencies;
    }
    return this.expression().getReferencedFieldIds().unwrapOr([]);
  }

  private validateOptions(
    cellValueType: CellValueType,
    multiplicity: CellValueMultiplicity
  ): Result<void, DomainError> {
    const formatting = this.formattingValue;
    const showAs = this.showAsValue;
    const isMultiple = multiplicity.isMultiple();

    if (cellValueType.equals(CellValueType.number())) {
      if (formatting && !(formatting instanceof NumberFormattingValue))
        return err(domainError.validation({ message: 'Invalid FormulaField formatting' }));
      if (showAs && !(showAs instanceof NumberShowAsValue))
        return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
      if (showAs) {
        const dto = showAs.toDto();
        const isSingle = 'showValue' in dto;
        if (isMultiple && isSingle)
          return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
        if (!isMultiple && !isSingle)
          return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
      }
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      if (formatting && !(formatting instanceof DateTimeFormattingValue))
        return err(domainError.validation({ message: 'Invalid FormulaField formatting' }));
      if (showAs) return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.string())) {
      if (formatting)
        return err(domainError.validation({ message: 'Invalid FormulaField formatting' }));
      if (showAs && !(showAs instanceof SingleLineTextShowAsValue))
        return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      if (formatting)
        return err(domainError.validation({ message: 'Invalid FormulaField formatting' }));
      if (showAs) return err(domainError.validation({ message: 'Invalid FormulaField showAs' }));
      return ok(undefined);
    }

    return err(domainError.validation({ message: 'Invalid FormulaField cell value type' }));
  }
}
