import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../base/BaseId';
import { domainError, type DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import { FieldConditionSpecBuilder } from '../records/specs/FieldConditionSpecBuilder';
import type { TableId } from '../TableId';
import { DbFieldName } from './DbFieldName';
import { DbFieldType } from './DbFieldType';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import type { FieldType } from './FieldType';
import { FieldSpecBuilder } from './specs/FieldSpecBuilder';
import type { CellValueMultiplicity } from './types/CellValueMultiplicity';
import { FieldComputed } from './types/FieldComputed';
import { FieldHasError } from './types/FieldHasError';
import { FieldNotNull } from './types/FieldNotNull';
import { FieldUnique } from './types/FieldUnique';
import { FieldValueTypeVisitor } from './visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from './visitors/IFieldVisitor';

export type FieldDuplicateParams = {
  newId: FieldId;
  newName: FieldName;
  baseId: BaseId;
  tableId: TableId;
};

export abstract class Field extends Entity<FieldId> {
  protected constructor(
    id: FieldId,
    private readonly nameValue: FieldName,
    private readonly typeValue: FieldType,
    dbFieldName?: DbFieldName,
    dependencies: ReadonlyArray<FieldId> = [],
    computed?: FieldComputed
  ) {
    super(id);
    this.dbFieldNameValue = dbFieldName ?? DbFieldName.empty();
    this.dbFieldTypeValue = DbFieldType.empty();
    this.dependenciesValue = [...dependencies];
    this.computedValue = computed ?? FieldComputed.manual();
    this.hasErrorValue = FieldHasError.ok();
    this.notNullValue = FieldNotNull.optional();
    this.uniqueValue = FieldUnique.disabled();
  }

  private dbFieldNameValue: DbFieldName;
  private dbFieldTypeValue: DbFieldType;
  private dependenciesValue: ReadonlyArray<FieldId>;
  private dependentsValue: ReadonlyArray<FieldId> | undefined;
  private readonly computedValue: FieldComputed;
  private hasErrorValue: FieldHasError;
  private notNullValue: FieldNotNull;
  private uniqueValue: FieldUnique;

  static specs(): FieldSpecBuilder {
    return FieldSpecBuilder.create();
  }

  name(): FieldName {
    return this.nameValue;
  }

  type(): FieldType {
    return this.typeValue;
  }

  computed(): FieldComputed {
    return this.computedValue;
  }

  hasError(): FieldHasError {
    return this.hasErrorValue;
  }

  setHasError(hasError: FieldHasError): void {
    this.hasErrorValue = hasError;
  }

  notNull(): FieldNotNull {
    if (this.computedValue.toBoolean()) return FieldNotNull.optional();
    return this.notNullValue;
  }

  unique(): FieldUnique {
    if (this.computedValue.toBoolean()) return FieldUnique.disabled();
    return this.uniqueValue;
  }

  setNotNull(notNull: FieldNotNull): Result<void, DomainError> {
    if (this.computedValue.toBoolean() && notNull.toBoolean()) {
      return err(domainError.validation({ message: 'Computed field cannot be not null' }));
    }
    if (this.notNullValue.equals(notNull)) return ok(undefined);
    this.notNullValue = notNull;
    return ok(undefined);
  }

  setUnique(unique: FieldUnique): Result<void, DomainError> {
    if (this.computedValue.toBoolean() && unique.toBoolean()) {
      return err(domainError.conflict({ message: 'Computed field cannot be unique' }));
    }
    if (this.uniqueValue.equals(unique)) return ok(undefined);
    this.uniqueValue = unique;
    return ok(undefined);
  }

  dbFieldName(): Result<DbFieldName, DomainError> {
    const valueResult = this.dbFieldNameValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbFieldNameValue);
  }

  setDbFieldName(dbFieldName: DbFieldName): Result<void, DomainError> {
    const nextValue = dbFieldName.value();
    if (nextValue.isErr()) return err(nextValue.error);

    const currentValue = this.dbFieldNameValue.value();
    if (currentValue.isOk()) {
      if (currentValue.value !== nextValue.value)
        return err(domainError.invariant({ message: 'DbFieldName already set' }));
      return ok(undefined);
    }

    this.dbFieldNameValue = dbFieldName;
    return ok(undefined);
  }

  dbFieldType(): Result<DbFieldType, DomainError> {
    const valueResult = this.dbFieldTypeValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbFieldTypeValue);
  }

  setDbFieldType(dbFieldType: DbFieldType): Result<void, DomainError> {
    const nextValue = dbFieldType.value();
    if (nextValue.isErr()) return err(nextValue.error);

    const currentValue = this.dbFieldTypeValue.value();
    if (currentValue.isOk()) {
      if (currentValue.value !== nextValue.value)
        return err(domainError.invariant({ message: 'DbFieldType already set' }));
      return ok(undefined);
    }

    this.dbFieldTypeValue = dbFieldType;
    return ok(undefined);
  }

  dependencies(): ReadonlyArray<FieldId> {
    return [...this.dependenciesValue];
  }

  setDependencies(dependencies: ReadonlyArray<FieldId>): Result<void, DomainError> {
    if (Field.hasSameFieldIds(this.dependenciesValue, dependencies)) return ok(undefined);
    if (this.dependenciesValue.length > 0)
      return err(domainError.invariant({ message: 'Field dependencies already set' }));
    this.dependenciesValue = [...dependencies];
    return ok(undefined);
  }

  dependents(): ReadonlyArray<FieldId> {
    return [...(this.dependentsValue ?? [])];
  }

  spec(): FieldConditionSpecBuilder {
    return FieldConditionSpecBuilder.create(this);
  }

  setDependents(dependents: ReadonlyArray<FieldId>): Result<void, DomainError> {
    if (Field.hasSameFieldIds(this.dependentsValue ?? [], dependents)) return ok(undefined);
    if (this.dependentsValue && this.dependentsValue.length > 0)
      return err(domainError.invariant({ message: 'Field dependents already set' }));
    this.dependentsValue = [...dependents];
    return ok(undefined);
  }

  private static hasSameFieldIds(
    left: ReadonlyArray<FieldId>,
    right: ReadonlyArray<FieldId>
  ): boolean {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id.equals(right[index]!));
  }

  abstract accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError>;

  /**
   * Creates a duplicate of this field with a new ID and name.
   *
   * Implementations should avoid copying dbFieldName/dbFieldType and must not
   * change the table's primary field (handled at table level).
   */
  abstract duplicate(params: FieldDuplicateParams): Result<Field, DomainError>;

  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    return this.accept(new FieldValueTypeVisitor()).map(
      (valueType) => valueType.isMultipleCellValue
    );
  }
}
