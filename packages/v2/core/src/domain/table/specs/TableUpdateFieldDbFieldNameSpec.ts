import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { DbFieldName } from '../fields/DbFieldName';
import type { FieldId } from '../fields/FieldId';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for renaming a field's physical database column name (dbFieldName).
 * Stores both previous and next dbFieldName for undo/redo support.
 *
 * The mutation on the in-memory Table is a no-op because the physical rename is
 * handled entirely by the persistence layer (ALTER TABLE RENAME COLUMN + metadata update).
 */
export class TableUpdateFieldDbFieldNameSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousDbFieldNameValue: DbFieldName,
    private readonly nextDbFieldNameValue: DbFieldName
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousDbFieldName: DbFieldName,
    nextDbFieldName: DbFieldName
  ): TableUpdateFieldDbFieldNameSpec {
    return new TableUpdateFieldDbFieldNameSpec(fieldId, previousDbFieldName, nextDbFieldName);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousDbFieldName(): DbFieldName {
    return this.previousDbFieldNameValue;
  }

  nextDbFieldName(): DbFieldName {
    return this.nextDbFieldNameValue;
  }

  mutate(_t: Table): Result<Table, DomainError> {
    return _t.updateFieldDbFieldName(this.fieldIdValue, this.nextDbFieldNameValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldDbFieldName(this).map(() => undefined);
  }
}
