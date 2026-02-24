import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../fields/DbFieldName';
import type { FieldId } from '../fields/FieldId';
import type { FieldNotNull } from '../fields/types/FieldNotNull';
import type { FieldUnique } from '../fields/types/FieldUnique';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for updating field constraints (notNull, unique).
 * Stores both previous and next values for undo/redo support.
 */
export class TableUpdateFieldConstraintsSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly dbFieldNameValue: DbFieldName,
    private readonly previousNotNullValue: FieldNotNull,
    private readonly nextNotNullValue: FieldNotNull,
    private readonly previousUniqueValue: FieldUnique,
    private readonly nextUniqueValue: FieldUnique
  ) {
    super();
  }

  static create(params: {
    fieldId: FieldId;
    dbFieldName: DbFieldName;
    previousNotNull: FieldNotNull;
    nextNotNull: FieldNotNull;
    previousUnique: FieldUnique;
    nextUnique: FieldUnique;
  }): TableUpdateFieldConstraintsSpec {
    return new TableUpdateFieldConstraintsSpec(
      params.fieldId,
      params.dbFieldName,
      params.previousNotNull,
      params.nextNotNull,
      params.previousUnique,
      params.nextUnique
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  dbFieldName(): DbFieldName {
    return this.dbFieldNameValue;
  }

  previousNotNull(): FieldNotNull {
    return this.previousNotNullValue;
  }

  nextNotNull(): FieldNotNull {
    return this.nextNotNullValue;
  }

  previousUnique(): FieldUnique {
    return this.previousUniqueValue;
  }

  nextUnique(): FieldUnique {
    return this.nextUniqueValue;
  }

  /**
   * Whether notNull constraint is changing
   */
  isNotNullChanging(): boolean {
    return !this.previousNotNullValue.equals(this.nextNotNullValue);
  }

  /**
   * Whether unique constraint is changing
   */
  isUniqueChanging(): boolean {
    return !this.previousUniqueValue.equals(this.nextUniqueValue);
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.updateFieldConstraints(this.fieldIdValue, this.nextNotNullValue, this.nextUniqueValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldConstraints(this).map(() => undefined);
  }
}
