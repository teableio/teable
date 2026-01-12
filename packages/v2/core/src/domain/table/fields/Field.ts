import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import { FieldConditionSpecBuilder } from '../records/specs/FieldConditionSpecBuilder';
import { DbFieldName } from './DbFieldName';
import { DbFieldType } from './DbFieldType';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import type { FieldType } from './FieldType';
import { FieldSpecBuilder } from './specs/FieldSpecBuilder';
import { FieldComputed } from './types/FieldComputed';
import { FieldNotNull } from './types/FieldNotNull';
import { FieldUnique } from './types/FieldUnique';
import type { IFieldVisitor } from './visitors/IFieldVisitor';

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
    this.notNullValue = FieldNotNull.optional();
    this.uniqueValue = FieldUnique.disabled();
  }

  private dbFieldNameValue: DbFieldName;
  private dbFieldTypeValue: DbFieldType;
  private dependenciesValue: ReadonlyArray<FieldId>;
  private dependentsValue: ReadonlyArray<FieldId> | undefined;
  private readonly computedValue: FieldComputed;
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
}
