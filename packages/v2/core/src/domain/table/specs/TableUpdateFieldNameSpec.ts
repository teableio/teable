import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import type { FieldName } from '../fields/FieldName';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for updating a field's name.
 * Stores both previous and next name for undo/redo support.
 */
export class TableUpdateFieldNameSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousNameValue: FieldName,
    private readonly nextNameValue: FieldName
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousName: FieldName,
    nextName: FieldName
  ): TableUpdateFieldNameSpec {
    return new TableUpdateFieldNameSpec(fieldId, previousName, nextName);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousName(): FieldName {
    return this.previousNameValue;
  }

  nextName(): FieldName {
    return this.nextNameValue;
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.updateFieldName(this.fieldIdValue, this.nextNameValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldName(this).map(() => undefined);
  }
}
