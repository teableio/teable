import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../../shared/specification/composeAndSpecs';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { ForeignTable } from '../../ForeignTable';
import type {
  FieldDeletionContext,
  FieldDeletionReaction,
  OnTeableFieldDeleted,
} from '../../OnTeableFieldDeleted';
import type {
  OnTeableTableDeleted,
  TableDeletionContext,
  TableDeletionReaction,
} from '../../OnTeableTableDeleted';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import type { Table } from '../../Table';
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
import type { FieldUpdateContext, OnTeableFieldUpdated } from '../OnTeableFieldUpdated';
import { FieldValueTypeVisitor } from '../visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import type { DateTimeFormatting } from './DateTimeFormatting';
import { DateTimeFormatting as DateTimeFormattingValue } from './DateTimeFormatting';
import { FieldComputed } from './FieldComputed';
import { FieldHasError } from './FieldHasError';
import { LinkField } from './LinkField';
import { NumberFormatting as NumberFormattingValue } from './NumberFormatting';
import type { NumberFormatting } from './NumberFormatting';
import { NumberShowAs as NumberShowAsValue } from './NumberShowAs';
import type { NumberShowAs } from './NumberShowAs';
import { isRollupFunctionSupportedForCellValueType, RollupExpression } from './RollupExpression';
import type { RollupFieldConfig, RollupFieldConfigValue } from './RollupFieldConfig';
import { SingleLineTextShowAs as SingleLineTextShowAsValue } from './SingleLineTextShowAs';
import type { SingleLineTextShowAs } from './SingleLineTextShowAs';
import type { TimeZone } from './TimeZone';
import { TimeZone as TimeZoneValue } from './TimeZone';

export type RollupFormatting = NumberFormatting | DateTimeFormatting;
export type RollupShowAs = NumberShowAs | SingleLineTextShowAs;

type RollupResultType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

type RollupValuesType = {
  cellValueType: CellValueType;
  isMultipleCellValue: CellValueMultiplicity;
};

export class RollupField
  extends Field
  implements
    ForeignTableRelatedField,
    OnTeableFieldUpdated,
    OnTeableFieldDeleted,
    OnTeableTableDeleted
{
  private constructor(
    id: FieldId,
    name: FieldName,
    private configValue: RollupFieldConfig,
    private expressionValue: RollupExpression,
    private readonly timeZoneValue: TimeZone | undefined,
    private formattingValue: RollupFormatting | undefined,
    private readonly showAsValue: RollupShowAs | undefined,
    private cellValueTypeValue: CellValueType | undefined,
    private isMultipleCellValueValue: CellValueMultiplicity | undefined,
    dependencies: ReadonlyArray<FieldId>
  ) {
    super(id, name, FieldType.rollup(), undefined, dependencies, FieldComputed.computed());
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    config: RollupFieldConfig;
    expression: RollupExpression;
    valuesField: Field;
    timeZone?: TimeZone;
    formatting?: RollupFormatting;
    showAs?: RollupShowAs;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<RollupField, DomainError> {
    const field = new RollupField(
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

  static createPending(params: {
    id: FieldId;
    name: FieldName;
    config: RollupFieldConfig;
    expression: RollupExpression;
    timeZone?: TimeZone;
    formatting?: RollupFormatting;
    showAs?: RollupShowAs;
    resultType?: RollupResultType;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<RollupField, DomainError> {
    const field = new RollupField(
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

  static rehydrate(params: {
    id: FieldId;
    name: FieldName;
    config: RollupFieldConfig;
    expression: RollupExpression;
    timeZone?: TimeZone;
    formatting?: RollupFormatting;
    showAs?: RollupShowAs;
    resultType: RollupResultType;
    dependencies?: ReadonlyArray<FieldId>;
  }): Result<RollupField, DomainError> {
    const field = new RollupField(
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

  static defaultOptions(valuesType: RollupValuesType): {
    expression: RollupExpression;
    timeZone: TimeZone;
    formatting?: RollupFormatting;
  } {
    const defaultExpression = RollupExpression.default();
    const resultType = defaultExpression.getParsedValueType(valuesType);
    if (resultType.isErr()) {
      return {
        expression: defaultExpression,
        timeZone: TimeZoneValue.default(),
      };
    }
    const formatting = RollupField.defaultFormatting(resultType.value.cellValueType);
    return {
      expression: defaultExpression,
      timeZone: TimeZoneValue.default(),
      ...(formatting ? { formatting } : {}),
    };
  }

  static defaultFormatting(cellValueType: CellValueType): RollupFormatting | undefined {
    if (cellValueType.equals(CellValueType.number())) {
      return NumberFormattingValue.default();
    }
    if (cellValueType.equals(CellValueType.dateTime())) {
      return DateTimeFormattingValue.default();
    }
    return undefined;
  }

  config(): RollupFieldConfig {
    return this.configValue;
  }

  configDto(): RollupFieldConfigValue {
    return this.configValue.toDto();
  }

  expression(): RollupExpression {
    return this.expressionValue;
  }

  setExpression(
    expression: RollupExpression,
    valuesType: RollupValuesType
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

  formatting(): RollupFormatting | undefined {
    return this.formattingValue;
  }

  setFormatting(formatting: RollupFormatting): Result<void, DomainError> {
    if (this.formattingValue)
      return err(domainError.invariant({ message: 'RollupField formatting already set' }));
    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      return err(domainError.invariant({ message: 'RollupField result type not set' }));
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

  showAs(): RollupShowAs | undefined {
    return this.showAsValue;
  }

  linkFieldId(): FieldId {
    return this.configValue.linkFieldId();
  }

  foreignTableId(): TableId {
    return this.configValue.foreignTableId();
  }

  lookupFieldId(): FieldId {
    return this.configValue.lookupFieldId();
  }

  linkField(hostTable: Table): Result<LinkField, DomainError> {
    return this.fieldFromHostTable(hostTable, this.linkFieldId()).andThen((field) => {
      if (!field.type().equals(FieldType.link())) {
        return err(
          domainError.validation({ message: 'RollupField link field must be a LinkField' })
        );
      }
      return ok(field as LinkField);
    });
  }

  lookupField(foreignTable: ForeignTable): Result<Field, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  cellValueType(): Result<CellValueType, DomainError> {
    if (!this.cellValueTypeValue) {
      if (this.hasError().isError()) {
        return ok(CellValueType.string());
      }
      return err(domainError.invariant({ message: 'RollupField cell value type not set' }));
    }
    return ok(this.cellValueTypeValue);
  }

  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    if (!this.isMultipleCellValueValue) {
      if (this.hasError().isError()) {
        return ok(CellValueMultiplicity.single());
      }
      return err(domainError.invariant({ message: 'RollupField multiplicity not set' }));
    }
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

    return RollupField.createPending({
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

  resolveResultType(valuesType: RollupValuesType): Result<void, DomainError> {
    if (
      !isRollupFunctionSupportedForCellValueType(
        this.expressionValue.toString(),
        valuesType.cellValueType
      )
    ) {
      return err(
        domainError.validation({ message: 'Invalid RollupExpression for RollupField value type' })
      );
    }
    const resultType = this.expressionValue.getParsedValueType(valuesType);
    if (resultType.isErr()) return err(resultType.error);
    return this.applyResultType(resultType.value);
  }

  private rehydrateResultType(resultType: RollupResultType): Result<void, DomainError> {
    return this.applyResultType(resultType);
  }

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    const linkFieldId = this.linkFieldId();
    const linkFieldSpecResult = Field.specs().withFieldId(linkFieldId).build();
    if (linkFieldSpecResult.isErr()) return err(linkFieldSpecResult.error);
    const [linkField] = context.hostTable.getFields(linkFieldSpecResult.value);
    if (!linkField)
      return err(domainError.notFound({ message: 'RollupField link field not found' }));
    if (linkField.type().toString() !== 'link') {
      return err(domainError.validation({ message: 'RollupField link field must be a LinkField' }));
    }

    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (!foreignTable)
      return err(domainError.invariant({ message: 'RollupField foreign table not loaded' }));

    const lookupField = ForeignTable.from(foreignTable)
      .fieldById(this.lookupFieldId())
      .mapErr(() => domainError.notFound({ message: 'RollupField lookup field not found' }));
    if (lookupField.isErr()) return err(lookupField.error);

    const valuesTypeResult = lookupField.value.accept(new FieldValueTypeVisitor());
    if (valuesTypeResult.isErr()) return err(valuesTypeResult.error);

    if (!this.cellValueTypeValue || !this.isMultipleCellValueValue) {
      const resolveResult = this.resolveResultType({
        cellValueType: valuesTypeResult.value.cellValueType,
        isMultipleCellValue: valuesTypeResult.value.isMultipleCellValue,
      });
      if (resolveResult.isErr()) {
        this.setHasError(FieldHasError.error());
      }
    }

    return this.ensureDependencies([linkFieldId]);
  }

  private ensureDependencies(nextDependencies: ReadonlyArray<FieldId>): Result<void, DomainError> {
    const deduped = nextDependencies.filter(
      (fieldId, index, array) => array.findIndex((candidate) => candidate.equals(fieldId)) === index
    );
    const current = this.dependencies();

    if (current.length === 0) {
      return this.setDependencies(deduped);
    }

    const isSameSet =
      current.length === deduped.length &&
      current.every((fieldId) => deduped.some((candidate) => candidate.equals(fieldId)));
    if (isSameSet) {
      return ok(undefined);
    }

    return err(
      domainError.invariant({
        message: 'RollupField dependencies conflict with resolved foreign-table dependencies',
      })
    );
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitRollupField(this);
  }

  /**
   * Respond to updates of fields this rollup depends on.
   *
   * This rollup field depends on:
   * - The link field (linkFieldId) in the same table
   * - The lookup field (lookupFieldId) in the foreign table
   *
   * When either is updated, this method is called to allow the rollup to respond.
   *
   * If the link field is type-converted to a non-link type, or the lookup field
   * is type-converted to a type incompatible with the rollup expression,
   * this rollup becomes invalid and should be marked with hasError.
   */
  onDependencyUpdated(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];

    // Check if the updated field is our link field or lookup field
    const isRelatedField =
      updatedField.id().equals(this.linkFieldId()) ||
      updatedField.id().equals(this.lookupFieldId());

    if (!isRelatedField) {
      // Not our dependency, no response needed
      return ok(undefined);
    }

    // Check if the field is being type-converted
    const hasTypeConversion = updateSpecs.some(
      (spec) => spec instanceof TableUpdateFieldTypeSpec && spec.isTypeConversion()
    );

    if (updatedField.id().equals(this.lookupFieldId()) && hasTypeConversion) {
      const nextFieldResult = this.rebuildForLookupTargetUpdate(updatedField, updateSpecs, context);
      if (nextFieldResult.isOk()) {
        specs.push(TableUpdateFieldTypeSpec.create(this, nextFieldResult.value));
      } else if (!this.hasError().isError()) {
        specs.push(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
      }

      return ok(composeAndSpecsOrUndefined(specs));
    }

    if (hasTypeConversion) {
      if (updatedField.id().equals(this.linkFieldId())) {
        const convertedLinkField = updateSpecs.find(
          (spec): spec is TableUpdateFieldTypeSpec =>
            spec instanceof TableUpdateFieldTypeSpec &&
            (spec.oldField().id().equals(this.linkFieldId()) ||
              spec.newField().id().equals(this.linkFieldId()))
        );
        const convertedNextField = convertedLinkField?.newField();
        const shouldSetError =
          !(convertedNextField instanceof LinkField) ||
          !convertedNextField.foreignTableId().equals(this.foreignTableId());
        if (shouldSetError && !this.hasError().isError()) {
          specs.push(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
        }
        if (!shouldSetError && this.hasError().isError()) {
          specs.push(TableUpdateFieldHasErrorSpec.clearError(this.id(), this.hasError()));
        }
      } else if (!this.hasError().isError()) {
        // A dependency is being converted to a different type
        // This rollup is now potentially invalid - mark as error
        specs.push(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
      }
    }

    return ok(composeAndSpecsOrUndefined(specs));
  }

  private rebuildForLookupTargetUpdate(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<RollupField, DomainError> {
    return this.resolveUpdatedLookupField(updatedField, updateSpecs, context).andThen(
      (valuesField) =>
        RollupField.create({
          id: this.id(),
          name: this.name(),
          config: this.configValue,
          expression: this.expressionValue,
          valuesField,
          timeZone: this.timeZoneValue,
          formatting: this.formattingValue,
          showAs: this.showAsValue,
          dependencies: this.dependencies(),
        })
    );
  }

  private resolveUpdatedLookupField(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<Field, DomainError> {
    const convertedSpec = updateSpecs.find(
      (spec): spec is TableUpdateFieldTypeSpec =>
        spec instanceof TableUpdateFieldTypeSpec &&
        (spec.oldField().id().equals(this.lookupFieldId()) ||
          spec.newField().id().equals(this.lookupFieldId()))
    );
    let nextLookupField = convertedSpec?.newField() ?? updatedField;

    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (foreignTable) {
      const foreignTableResult = ForeignTable.from(foreignTable).fieldById(this.lookupFieldId());
      if (foreignTableResult.isOk()) {
        nextLookupField = foreignTableResult.value;
      }
    }

    return ok(nextLookupField);
  }

  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<FieldDeletionReaction | undefined, DomainError> {
    const deletedFromHostTable = context.sourceTable.id().equals(context.table.id());
    const deletedFromForeignTable = context.sourceTable.id().equals(this.foreignTableId());

    const shouldSetError =
      (deletedFromHostTable && deletedField.id().equals(this.linkFieldId())) ||
      (deletedFromForeignTable && deletedField.id().equals(this.lookupFieldId()));

    if (!shouldSetError || this.hasError().isError()) {
      return ok(undefined);
    }

    return ok({
      spec: TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()),
      relatedFieldIds: [this.id()],
    });
  }

  onTableDeleted(
    deletedTable: Table,
    _context: TableDeletionContext
  ): Result<TableDeletionReaction | undefined, DomainError> {
    if (!deletedTable.id().equals(this.foreignTableId()) || this.hasError().isError()) {
      return ok(undefined);
    }

    return ok({
      spec: TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()),
    });
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({ message: 'ForeignTable does not match RollupField foreign table' })
      );
    }
    return ok(undefined);
  }

  private fieldFromHostTable(hostTable: Table, fieldId: FieldId): Result<Field, DomainError> {
    const fieldSpecResult = Field.specs().withFieldId(fieldId).build();
    if (fieldSpecResult.isErr()) return err(fieldSpecResult.error);
    const [field] = hostTable.getFields(fieldSpecResult.value);
    if (!field) return err(domainError.notFound({ message: 'Field not found in host Table' }));
    return ok(field);
  }

  private applyResultType(resultType: RollupResultType): Result<void, DomainError> {
    if (this.cellValueTypeValue && !this.cellValueTypeValue.equals(resultType.cellValueType)) {
      return err(domainError.invariant({ message: 'RollupField cell value type already set' }));
    }
    if (
      this.isMultipleCellValueValue &&
      !this.isMultipleCellValueValue.equals(resultType.isMultipleCellValue)
    )
      return err(domainError.invariant({ message: 'RollupField multiplicity already set' }));

    const validation = this.validateResultOptions(
      resultType.cellValueType,
      resultType.isMultipleCellValue
    );
    if (validation.isErr()) return err(validation.error);

    this.cellValueTypeValue = resultType.cellValueType;
    this.isMultipleCellValueValue = resultType.isMultipleCellValue;

    if (!this.formattingValue) {
      const defaultFormatting = RollupField.defaultFormatting(resultType.cellValueType);
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
        return err(domainError.validation({ message: 'Invalid RollupField formatting' }));
      if (showAs && !(showAs instanceof NumberShowAsValue))
        return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
      if (showAs) {
        const dto = showAs.toDto();
        const isSingle = 'showValue' in dto;
        if (isMultiple && isSingle)
          return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
        if (!isMultiple && !isSingle)
          return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
      }
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      if (formatting && !(formatting instanceof DateTimeFormattingValue))
        return err(domainError.validation({ message: 'Invalid RollupField formatting' }));
      if (showAs) return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.string())) {
      if (formatting)
        return err(domainError.validation({ message: 'Invalid RollupField formatting' }));
      if (showAs && !(showAs instanceof SingleLineTextShowAsValue))
        return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
      return ok(undefined);
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      if (formatting)
        return err(domainError.validation({ message: 'Invalid RollupField formatting' }));
      if (showAs) return err(domainError.validation({ message: 'Invalid RollupField showAs' }));
      return ok(undefined);
    }

    return err(domainError.validation({ message: 'Invalid RollupField cell value type' }));
  }
}
