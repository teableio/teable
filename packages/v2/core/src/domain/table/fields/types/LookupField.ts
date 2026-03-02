import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../../shared/specification/composeAndSpecs';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { FieldDeletionContext, OnTeableFieldDeleted } from '../../OnTeableFieldDeleted';
import { ForeignTable } from '../../ForeignTable';
import { UpdateLookupOptionsSpec } from '../../specs/field-updates/UpdateLookupOptionsSpec';
import { UpdateMultipleSelectOptionsSpec } from '../../specs/field-updates/UpdateMultipleSelectOptionsSpec';
import { UpdateSingleSelectOptionsSpec } from '../../specs/field-updates/UpdateSingleSelectOptionsSpec';
import { UpdateLinkRelationshipSpec } from '../../specs/field-updates/UpdateLinkRelationshipSpec';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableUpdateFieldHasErrorSpec } from '../../specs/TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldTypeSpec } from '../../specs/TableUpdateFieldTypeSpec';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import {
  buildFieldFilterSyncPlan,
  hasFieldFilterSyncPlanChanges,
  hasFieldReferenceInFilter,
  isEquivalentFilter,
  syncFilterByFieldChanges,
} from '../filter-sync';
import type {
  ForeignTableRelatedField,
  ForeignTableValidationContext,
} from '../ForeignTableRelatedField';
import type { FieldUpdateContext, OnTeableFieldUpdated } from '../OnTeableFieldUpdated';
import { FieldValueTypeVisitor, type FieldValueType } from '../visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FieldComputed } from './FieldComputed';
import { LinkField } from './LinkField';
import { LookupOptions, type LookupOptionsValue } from './LookupOptions';

/**
 * LookupField is a wrapper field that retrieves values from a linked table.
 *
 * It wraps another field type (the "inner field") which determines the value type
 * and formatting options, while the lookup configuration determines how values
 * are resolved from the foreign table.
 *
 * Key characteristics:
 * - Computed field (values are derived, not directly editable)
 * - Can be single or multiple cell values depending on link relationship type
 * - The inner field determines cellValueType, formatting, showAs, etc.
 */
export class LookupField
  extends Field
  implements ForeignTableRelatedField, OnTeableFieldUpdated, OnTeableFieldDeleted
{
  private innerFieldValue: Field | undefined;
  private readonly innerOptionsPatchValue: Readonly<Record<string, unknown>> | undefined;
  private readonly legacyMultiplicityDerivationEnabled: boolean;
  /**
   * Override for isMultipleCellValue. When set, this value is used instead of
   * defaulting to multiple. This is important for compatibility with v1 where
   * lookup fields could be single-value (e.g., ManyOne relationship looking up
   * a single-value field like AutoNumber would result in an INTEGER column).
   */
  private isMultipleCellValueOverride: boolean | undefined;

  private constructor(
    id: FieldId,
    name: FieldName,
    innerField: Field | undefined,
    private readonly lookupOptionsValue: LookupOptions,
    dbFieldName?: DbFieldName,
    dependencies?: ReadonlyArray<FieldId>,
    isMultipleCellValue?: boolean,
    innerOptionsPatch?: Readonly<Record<string, unknown>>,
    legacyMultiplicityDerivation?: boolean
  ) {
    super(id, name, FieldType.lookup(), dbFieldName, dependencies ?? [], FieldComputed.computed());
    this.innerFieldValue = innerField;
    this.isMultipleCellValueOverride = isMultipleCellValue;
    this.innerOptionsPatchValue = innerOptionsPatch ? { ...innerOptionsPatch } : undefined;
    this.legacyMultiplicityDerivationEnabled = legacyMultiplicityDerivation === true;
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
    innerOptionsPatch?: Readonly<Record<string, unknown>>;
    legacyMultiplicityDerivation?: boolean;
  }): Result<LookupField, DomainError> {
    // Nested lookups are supported - inner field can be another LookupField
    // This enables lookups across 3+ tables (e.g., Table A -> Table B -> Table C)
    return ok(
      new LookupField(
        params.id,
        params.name,
        params.innerField,
        params.lookupOptions,
        params.dbFieldName,
        params.dependencies ?? [params.lookupOptions.linkFieldId()],
        params.isMultipleCellValue,
        params.innerOptionsPatch,
        params.legacyMultiplicityDerivation
      )
    );
  }

  /**
   * Creates a pending LookupField without the inner field resolved.
   * The inner field will be resolved during foreign table validation.
   */
  static createPending(params: {
    id: FieldId;
    name: FieldName;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
    innerOptionsPatch?: Readonly<Record<string, unknown>>;
    legacyMultiplicityDerivation?: boolean;
  }): Result<LookupField, DomainError> {
    return ok(
      new LookupField(
        params.id,
        params.name,
        undefined, // Inner field will be resolved during validation
        params.lookupOptions,
        params.dbFieldName,
        params.dependencies,
        params.isMultipleCellValue,
        params.innerOptionsPatch,
        params.legacyMultiplicityDerivation
      )
    );
  }

  /**
   * Rehydrates a LookupField from persistence with the inner field already resolved.
   */
  static rehydrate(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
    innerOptionsPatch?: Readonly<Record<string, unknown>>;
    legacyMultiplicityDerivation?: boolean;
  }): Result<LookupField, DomainError> {
    return LookupField.create(params);
  }

  /**
   * Whether this lookup field is in a pending state (inner field not yet resolved).
   */
  isPending(): boolean {
    return this.innerFieldValue === undefined;
  }

  /**
   * The wrapped field that determines the value type and options.
   * This field exists only to define the lookup's data characteristics,
   * not as an actual field in any table.
   * Returns error if the field is still pending (not resolved).
   */
  innerField(): Result<Field, DomainError> {
    if (!this.innerFieldValue) {
      return err(domainError.unexpected({ message: 'LookupField inner field not yet resolved' }));
    }
    return ok(this.innerFieldValue);
  }

  /**
   * The type of the wrapped field (e.g., number, singleLineText, etc.)
   * Returns error if the field is still pending.
   */
  innerFieldType(): Result<FieldType, DomainError> {
    return this.innerField().map((f) => f.type());
  }

  /**
   * The lookup configuration (linkFieldId, lookupFieldId, foreignTableId).
   */
  lookupOptions(): LookupOptions {
    return this.lookupOptionsValue;
  }

  lookupOptionsDto(): LookupOptionsValue {
    return this.lookupOptionsValue.toDto();
  }

  innerOptionsPatch(): Readonly<Record<string, unknown>> | undefined {
    return this.innerOptionsPatchValue;
  }

  /**
   * The ID of the Link field used for lookup.
   */
  linkFieldId(): FieldId {
    return this.lookupOptionsValue.linkFieldId();
  }

  /**
   * The ID of the field being looked up in the foreign table.
   */
  lookupFieldId(): FieldId {
    return this.lookupOptionsValue.lookupFieldId();
  }

  /**
   * The ID of the foreign table containing the lookup field.
   */
  foreignTableId(): TableId {
    return this.lookupOptionsValue.foreignTableId();
  }

  /**
   * Get the link field from the host table.
   */
  linkField(hostTable: Table): Result<LinkField, DomainError> {
    const linkFieldId = this.linkFieldId();
    const fieldResult = hostTable.getField((candidate) => candidate.id().equals(linkFieldId));
    if (fieldResult.isErr())
      return err(domainError.notFound({ message: 'LookupField link field not found' }));

    const field = fieldResult.value;
    if (!field.type().equals(FieldType.link())) {
      return err(domainError.validation({ message: 'LookupField link field must be a LinkField' }));
    }
    return ok(field as LinkField);
  }

  /**
   * Get the lookup target field from the foreign table.
   */
  lookupField(foreignTable: ForeignTable): Result<Field, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  /**
   * Get the cell value type based on the inner field.
   * If pending (inner field not resolved), returns string as default.
   */
  cellValueType(): Result<CellValueType, DomainError> {
    if (!this.innerFieldValue) {
      // Default to string for pending lookup fields
      return ok(CellValueType.string());
    }
    return this.innerFieldValue.accept(new FieldValueTypeVisitor()).map((vt) => vt.cellValueType);
  }

  /**
   * Get whether this is a multiple cell value field.
   * Uses the override value if set (from v1 persistence), otherwise defaults to multiple.
   */
  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    if (this.isMultipleCellValueOverride !== undefined) {
      return ok(
        this.isMultipleCellValueOverride
          ? CellValueMultiplicity.multiple()
          : CellValueMultiplicity.single()
      );
    }
    // Default to multiple for new lookup fields (v2 behavior)
    return ok(CellValueMultiplicity.multiple());
  }

  /**
   * Get the field value type (cellValueType + multiplicity).
   */
  fieldValueType(): Result<FieldValueType, DomainError> {
    return this.isMultipleCellValue().andThen((isMultipleCellValue) =>
      this.cellValueType().map((cellValueType) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
  }

  duplicate(_params: FieldDuplicateParams): Result<Field, DomainError> {
    const isMultipleResult = this.isMultipleCellValue();
    const isMultipleCellValue = isMultipleResult.isOk()
      ? isMultipleResult.value.isMultiple()
      : undefined;

    if (this.innerFieldValue) {
      return LookupField.create({
        id: _params.newId,
        name: _params.newName,
        innerField: this.innerFieldValue,
        lookupOptions: this.lookupOptionsValue,
        isMultipleCellValue,
        dependencies: this.dependencies(),
        innerOptionsPatch: this.innerOptionsPatchValue,
        legacyMultiplicityDerivation: this.legacyMultiplicityDerivationEnabled,
      });
    }

    return LookupField.createPending({
      id: _params.newId,
      name: _params.newName,
      lookupOptions: this.lookupOptionsValue,
      isMultipleCellValue,
      dependencies: this.dependencies(),
      innerOptionsPatch: this.innerOptionsPatchValue,
      legacyMultiplicityDerivation: this.legacyMultiplicityDerivationEnabled,
    });
  }

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    // 1. Validate link field exists in host table
    const linkFieldResult = this.linkField(context.hostTable);
    if (linkFieldResult.isErr()) return err(linkFieldResult.error);
    const linkField = linkFieldResult.value;

    // 2. Validate that link field points to our foreign table
    if (!linkField.foreignTableId().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({
          message: 'LookupField foreign table does not match link field target',
        })
      );
    }

    // 3. Find the foreign table
    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (!foreignTable) {
      return err(domainError.invariant({ message: 'LookupField foreign table not loaded' }));
    }

    // 4. Validate lookup field exists in foreign table and resolve inner field
    const ft = ForeignTable.from(foreignTable);
    const lookupFieldResult = ft.fieldById(this.lookupFieldId());
    if (lookupFieldResult.isErr()) {
      return err(
        domainError.notFound({ message: 'LookupField lookup field not found in foreign table' })
      );
    }
    if (this.legacyMultiplicityDerivationEnabled) {
      this.deriveMultiplicityOverride(linkField, lookupFieldResult.value);
    }

    // 5. Resolve the inner field from the foreign table's lookup field
    // Nested lookups are supported - enables lookups across 3+ tables (e.g., Table A -> Table B -> Table C)
    this.innerFieldValue = lookupFieldResult.value;

    // 6. Set dependencies to include link field and referenced host fields in filter values.
    const hostFieldIds = new Set(
      context.hostTable.getFields().map((field) => field.id().toString())
    );
    const conditionFieldIds = this.lookupOptionsValue
      .condition()
      ?.referencedFieldIds()
      .filter(
        (fieldId) => !fieldId.equals(this.linkFieldId()) && hostFieldIds.has(fieldId.toString())
      );
    return this.ensureDependencies([this.linkFieldId(), ...(conditionFieldIds ?? [])]);
  }

  private deriveMultiplicityOverride(linkField: LinkField, lookupField: Field): void {
    if (this.isMultipleCellValueOverride !== undefined) {
      return;
    }

    const relationship = linkField.relationship().toString();
    const linkIsMultiple = relationship === 'manyMany' || relationship === 'oneMany';
    const lookupFieldValueType = lookupField.accept(new FieldValueTypeVisitor());
    const lookupTargetIsMultiple = lookupFieldValueType.isOk()
      ? lookupFieldValueType.value.isMultipleCellValue.toBoolean()
      : false;

    this.isMultipleCellValueOverride = linkIsMultiple || lookupTargetIsMultiple;
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

    return ok(undefined);
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLookupField(this);
  }

  /**
   * Respond to updates of fields this lookup depends on.
   *
   * This lookup field depends on the link field (linkFieldId) in the same table.
   * When the link field is updated (e.g., relationship type changes), this method
   * is called to allow the lookup to respond.
   *
   * If the link field is type-converted to a non-link type, this lookup becomes
   * invalid and should be marked with hasError.
   *
   * Note: Cross-table dependencies (lookup target field changes in foreign table)
   * are handled separately by the cross-table update flow.
   */
  onDependencyUpdated(
    updatedField: Field,
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    context: FieldUpdateContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const specs: ISpecification<Table, ITableSpecVisitor>[] = [];
    const plan = buildFieldFilterSyncPlan(updatedField, updateSpecs);
    const hasTypeConversion = updateSpecs.some(
      (spec) => spec instanceof TableUpdateFieldTypeSpec && spec.isTypeConversion()
    );
    const isLookupTargetUpdated = updatedField.id().equals(this.lookupFieldId());
    const hasLookupTargetSelectOptionChanges = this.hasLookupTargetSelectOptionChanges(updateSpecs);

    if (isLookupTargetUpdated && (hasTypeConversion || hasLookupTargetSelectOptionChanges)) {
      let nextInnerField: Field = updatedField;
      const foreignTable = context.foreignTables.find((candidate) =>
        candidate.id().equals(this.foreignTableId())
      );
      if (foreignTable) {
        const foreignTableResult = ForeignTable.from(foreignTable).fieldById(this.lookupFieldId());
        if (foreignTableResult.isOk()) {
          nextInnerField = foreignTableResult.value;
        }
      }

      const isMultipleResult = this.isMultipleCellValue();
      if (isMultipleResult.isErr()) {
        return err(isMultipleResult.error);
      }
      const dbFieldNameResult = this.dbFieldName();
      const nextLookupFieldResult = LookupField.create({
        id: this.id(),
        name: this.name(),
        innerField: nextInnerField,
        lookupOptions: this.lookupOptionsValue,
        dbFieldName: dbFieldNameResult.isOk() ? dbFieldNameResult.value : undefined,
        isMultipleCellValue: isMultipleResult.value.isMultiple(),
        dependencies: this.dependencies(),
        innerOptionsPatch: this.innerOptionsPatchValue,
        legacyMultiplicityDerivation: this.legacyMultiplicityDerivationEnabled,
      });
      if (nextLookupFieldResult.isErr()) {
        return err(nextLookupFieldResult.error);
      }
      specs.push(TableUpdateFieldTypeSpec.create(this, nextLookupFieldResult.value));
      if (hasTypeConversion) {
        return ok(composeAndSpecsOrUndefined(specs));
      }
    }

    // When the link field's relationship type changes (e.g. ManyMany → ManyOne),
    // the lookup's isMultipleCellValue may need to change (array → scalar or vice versa).
    // Detect this via UpdateLinkRelationshipSpec and emit a TableUpdateFieldTypeSpec.
    if (updatedField.id().equals(this.linkFieldId()) && updatedField instanceof LinkField) {
      const relationshipSpec = updateSpecs.find(
        (spec): spec is UpdateLinkRelationshipSpec =>
          spec instanceof UpdateLinkRelationshipSpec &&
          spec.fieldId().equals(this.linkFieldId()) &&
          spec.isRelationshipTypeChanging()
      );
      if (relationshipSpec) {
        const currentMultipleResult = this.isMultipleCellValue();
        if (currentMultipleResult.isErr()) return err(currentMultipleResult.error);

        const newIsMultiple = updatedField.isMultipleValue();
        const currentIsMultiple = currentMultipleResult.value.isMultiple();

        if (newIsMultiple !== currentIsMultiple) {
          const dbFieldNameResult = this.dbFieldName();
          const innerField = this.innerFieldValue;
          const nextLookupFieldResult = innerField
            ? LookupField.create({
                id: this.id(),
                name: this.name(),
                innerField,
                lookupOptions: this.lookupOptionsValue,
                dbFieldName: dbFieldNameResult.isOk() ? dbFieldNameResult.value : undefined,
                isMultipleCellValue: newIsMultiple,
                dependencies: this.dependencies(),
                innerOptionsPatch: this.innerOptionsPatchValue,
                legacyMultiplicityDerivation: this.legacyMultiplicityDerivationEnabled,
              })
            : LookupField.createPending({
                id: this.id(),
                name: this.name(),
                lookupOptions: this.lookupOptionsValue,
                dbFieldName: dbFieldNameResult.isOk() ? dbFieldNameResult.value : undefined,
                isMultipleCellValue: newIsMultiple,
                dependencies: this.dependencies(),
                innerOptionsPatch: this.innerOptionsPatchValue,
                legacyMultiplicityDerivation: this.legacyMultiplicityDerivationEnabled,
              });
          if (nextLookupFieldResult.isErr()) return err(nextLookupFieldResult.error);
          specs.push(TableUpdateFieldTypeSpec.create(this, nextLookupFieldResult.value));
          return ok(composeAndSpecsOrUndefined(specs));
        }
      }
    }

    const condition = this.lookupOptionsValue.condition();
    const referencesUpdatedField =
      updatedField.id().equals(this.linkFieldId()) ||
      Boolean(condition?.referencesField(updatedField.id()));

    if (referencesUpdatedField) {
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
          specs.push(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
        }
      }
    }

    if (!condition) return ok(composeAndSpecsOrUndefined(specs));
    const filter = condition.toDto().filter;
    if (filter == null) return ok(composeAndSpecsOrUndefined(specs));
    if (!hasFieldFilterSyncPlanChanges(plan)) return ok(composeAndSpecsOrUndefined(specs));
    if (!hasFieldReferenceInFilter(filter, updatedField.id()))
      return ok(composeAndSpecsOrUndefined(specs));

    const nextFilter = syncFilterByFieldChanges(filter, updatedField.id(), plan);
    if (isEquivalentFilter(filter, nextFilter)) {
      return ok(composeAndSpecsOrUndefined(specs));
    }

    const nextOptionsResult = LookupOptions.create({
      ...this.lookupOptionsValue.toDto(),
      filter: nextFilter === null ? undefined : nextFilter,
    });
    if (nextOptionsResult.isErr()) {
      return err(nextOptionsResult.error);
    }
    const nextOptions = nextOptionsResult.value;
    if (!nextOptions.equals(this.lookupOptionsValue)) {
      specs.push(UpdateLookupOptionsSpec.create(this.id(), this.lookupOptionsValue, nextOptions));
    }

    return ok(composeAndSpecsOrUndefined(specs));
  }

  onFieldDeleted(
    deletedField: Field,
    context: FieldDeletionContext
  ): Result<ISpecification<Table, ITableSpecVisitor> | undefined, DomainError> {
    const deletedFromHostTable = context.sourceTable.id().equals(context.table.id());
    const deletedFromForeignTable = context.sourceTable.id().equals(this.foreignTableId());
    const condition = this.lookupOptionsValue.condition();

    const shouldSetError =
      (deletedFromHostTable &&
        (deletedField.id().equals(this.linkFieldId()) ||
          Boolean(condition?.referencesField(deletedField.id())))) ||
      (deletedFromForeignTable && deletedField.id().equals(this.lookupFieldId()));

    if (!shouldSetError || this.hasError().isError()) {
      return ok(undefined);
    }

    return ok(TableUpdateFieldHasErrorSpec.setError(this.id(), this.hasError()));
  }

  private hasLookupTargetSelectOptionChanges(
    updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
  ): boolean {
    return updateSpecs.some((spec) => {
      if (
        spec instanceof UpdateSingleSelectOptionsSpec ||
        spec instanceof UpdateMultipleSelectOptionsSpec
      ) {
        if (!spec.fieldId().equals(this.lookupFieldId())) {
          return false;
        }
        return (
          spec.addedOptions().length > 0 ||
          spec.removedOptions().length > 0 ||
          spec.modifiedOptions().length > 0
        );
      }

      return false;
    });
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({ message: 'ForeignTable does not match LookupField foreign table' })
      );
    }
    return ok(undefined);
  }
}
