import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Entity } from '../../shared/Entity';
import { DbFieldName } from './DbFieldName';
import type { FieldId } from './FieldId';
import type { FieldName } from './FieldName';
import type { FieldType } from './FieldType';
import type { IFieldVisitor } from './visitors/IFieldVisitor';

export abstract class Field extends Entity<FieldId> {
  protected constructor(
    id: FieldId,
    private readonly nameValue: FieldName,
    private readonly typeValue: FieldType,
    dbFieldName?: DbFieldName
  ) {
    super(id);
    this.dbFieldNameValue = dbFieldName ?? DbFieldName.empty();
  }

  private dbFieldNameValue: DbFieldName;

  name(): FieldName {
    return this.nameValue;
  }

  type(): FieldType {
    return this.typeValue;
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

  abstract accept<T = void>(visitor: IFieldVisitor<T>): Result<T, string>;
}
