import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Entity } from '../../shared/Entity';
import { DbFieldName } from './DbFieldName';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import type { FieldType } from './FieldType';
import { FieldComputed } from './types/FieldComputed';
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
    this.dependenciesValue = [...dependencies];
    this.computedValue = computed ?? FieldComputed.manual();
  }

  private dbFieldNameValue: DbFieldName;
  private dependenciesValue: ReadonlyArray<FieldId>;
  private dependentsValue: ReadonlyArray<FieldId> | undefined;
  private readonly computedValue: FieldComputed;

  name(): FieldName {
    return this.nameValue;
  }

  type(): FieldType {
    return this.typeValue;
  }

  computed(): FieldComputed {
    return this.computedValue;
  }

  dbFieldName(): Result<DbFieldName, string> {
    const valueResult = this.dbFieldNameValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbFieldNameValue);
  }

  setDbFieldName(dbFieldName: DbFieldName): Result<void, string> {
    const nextValue = dbFieldName.value();
    if (nextValue.isErr()) return err(nextValue.error);

    const currentValue = this.dbFieldNameValue.value();
    if (currentValue.isOk()) {
      if (currentValue.value !== nextValue.value) return err('DbFieldName already set');
      return ok(undefined);
    }

    this.dbFieldNameValue = dbFieldName;
    return ok(undefined);
  }

  dependencies(): ReadonlyArray<FieldId> {
    return [...this.dependenciesValue];
  }

  setDependencies(dependencies: ReadonlyArray<FieldId>): Result<void, string> {
    if (Field.hasSameFieldIds(this.dependenciesValue, dependencies)) return ok(undefined);
    if (this.dependenciesValue.length > 0) return err('Field dependencies already set');
    this.dependenciesValue = [...dependencies];
    return ok(undefined);
  }

  dependents(): ReadonlyArray<FieldId> {
    return [...(this.dependentsValue ?? [])];
  }

  setDependents(dependents: ReadonlyArray<FieldId>): Result<void, string> {
    if (Field.hasSameFieldIds(this.dependentsValue ?? [], dependents)) return ok(undefined);
    if (this.dependentsValue && this.dependentsValue.length > 0)
      return err('Field dependents already set');
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

  abstract accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string>;
}
